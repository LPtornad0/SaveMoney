// Vérifie la file de suppressions différées avec une horloge simulée (aucun SQL réel).
// Ces tests couvrent la logique de la file uniquement : ils ne prouvent pas la fermeture
// de la fenêtre ni le comportement dans Tauri (voir les tests manuels).
// Usage : node scripts/verify-deferred-deletions.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "utils", "deferredDeletions.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
new Function("module", "exports", outputText)(moduleObject, moduleObject.exports);
const { DeferredDeletionQueue } = moduleObject.exports;

const DELAY = 5000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Horloge simulée : les timers ne se déclenchent que via advance().
// `execute` peut échouer pour certains identifiants, ou attendre une libération manuelle.
function createHarness({ failIds = new Set(), manualRelease = false } = {}) {
  let now = 0;
  const timers = [];
  const executed = [];
  const successes = [];
  const failures = [];
  const releases = [];
  let lastPending = [];
  const queue = new DeferredDeletionQueue({
    delayMs: DELAY,
    schedule: (run, delayMs) => {
      const timer = { at: now + delayMs, run, cancelled: false, fired: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
    execute: (type, id) => {
      executed.push({ type, id, at: now });
      const attempt = async () => {
        if (failIds.has(id)) throw new Error("SQL failure");
      };
      if (!manualRelease) return attempt();
      return new Promise((resolve, reject) => {
        releases.push(() => attempt().then(resolve, reject));
      });
    },
    onChange: (pending) => {
      lastPending = pending;
    },
    onSuccess: (item) => successes.push(item),
    onFailure: (item, error) => failures.push({ item, message: error.message }),
  });
  return {
    queue,
    executed,
    successes,
    failures,
    timers,
    releases,
    pending: () => lastPending,
    async advance(ms) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && !timer.fired && timer.at <= now) {
          timer.fired = true;
          timer.run();
        }
      }
      await flush();
    },
  };
}

// 1. Expiration sans annulation : un seul DELETE, puis la ligne n'est plus en attente
{
  const h = createHarness();
  h.queue.schedule(10, "expense");
  await h.advance(DELAY - 1);
  assert.equal(h.executed.length, 0, "aucun DELETE avant l'expiration");
  await h.advance(1);
  assert.deepEqual(h.executed.map((e) => [e.type, e.id]), [["expense", 10]]);
  assert.equal(h.pending().length, 0);
  assert.equal(h.successes.length, 1);
  console.log("OK  expiration sans annulation : un seul DELETE");
}

// 2. Annulation avant expiration : aucun DELETE, timer annulé
{
  const h = createHarness();
  const key = h.queue.schedule(11, "income");
  assert.equal(h.queue.undo(key), true);
  await h.advance(DELAY * 2);
  assert.equal(h.executed.length, 0, "aucun DELETE après annulation");
  assert.equal(h.timers[0].cancelled, true, "le timer est annulé");
  assert.equal(h.pending().length, 0);
  console.log("OK  annulation avant expiration : aucun DELETE");
}

// 3. Plusieurs suppressions en parallèle, indépendantes
{
  const h = createHarness();
  h.queue.schedule(1, "income"); // expire à t = 5000
  await h.advance(1000);
  const b = h.queue.schedule(2, "expense"); // expire à t = 6000
  await h.advance(1000);
  h.queue.schedule(3, "recurring"); // expire à t = 7000
  assert.equal(h.pending().length, 3);

  assert.equal(h.queue.undo(b), true);
  assert.deepEqual(h.pending().map((p) => p.id).sort(), [1, 3]);

  await h.advance(3000); // t = 5000 : A expire
  assert.deepEqual(h.executed.map((e) => e.id), [1]);
  await h.advance(2000); // t = 7000 : C expire, B n'est jamais exécuté
  assert.deepEqual(h.executed.map((e) => e.id), [1, 3]);
  assert.equal(h.pending().length, 0);
  console.log("OK  plusieurs suppressions : annulation de B sans effet sur A et C");
}

// 4. Un ancien timer ne supprime jamais une nouvelle opération
{
  const h = createHarness();
  const oldKey = h.queue.schedule(20, "expense");
  h.queue.undo(oldKey);
  const newKey = h.queue.schedule(20, "expense");
  assert.notEqual(oldKey, newKey);
  h.timers[0].run(); // ancien timer, déjà annulé
  await flush();
  assert.equal(h.executed.length, 0, "l'ancien timer ne doit rien exécuter");
  assert.deepEqual(h.pending().map((p) => p.key), [newKey]);
  await h.advance(DELAY);
  assert.equal(h.executed.length, 1, "la nouvelle opération est exécutée à son propre délai");
  console.log("OK  ancien timer : aucune exécution, nouvelle opération intacte");
}

// 5. Erreur SQL : signalée, ligne de nouveau visible, nouvelle tentative possible
{
  const h = createHarness({ failIds: new Set([30]) });
  h.queue.schedule(30, "recurring");
  await h.advance(DELAY);
  assert.equal(h.failures.length, 1, "l'erreur est signalée");
  assert.equal(h.failures[0].message, "SQL failure");
  assert.equal(h.successes.length, 0, "aucun succès déclaré");
  assert.equal(h.pending().length, 0, "la ligne n'est plus masquée");
  const retry = h.queue.schedule(30, "recurring");
  assert.ok(retry > 0, "une nouvelle suppression peut être planifiée");
  console.log("OK  erreur SQL : signalée, opération de nouveau accessible");
}

// 6. Annulation pendant l'exécution SQL : refusée, un seul DELETE
{
  const h = createHarness({ manualRelease: true });
  const key = h.queue.schedule(40, "expense");
  await h.advance(DELAY); // le timer lance le DELETE
  assert.equal(h.executed.length, 1, "le DELETE a démarré");
  assert.equal(h.queue.undo(key), false, "annulation refusée pendant l'exécution");
  h.releases[0]();
  await flush();
  assert.equal(h.executed.length, 1, "toujours un seul DELETE");
  console.log("OK  annulation pendant l'exécution : refusée, un seul DELETE");
}

// 7. Finalisation forcée de plusieurs suppressions en attente
{
  const h = createHarness();
  h.queue.schedule(50, "income");
  h.queue.schedule(51, "expense");
  h.queue.schedule(52, "recurring");
  const outcomes = await h.queue.flushAll();
  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((o) => o.ok), "toutes les suppressions réussissent");
  assert.deepEqual(h.executed.map((e) => e.id).sort(), [50, 51, 52]);
  assert.equal(h.queue.hasPending(), false);
  await h.advance(DELAY * 2); // les timers annulés ne relancent rien
  assert.equal(h.executed.length, 3, "aucun DELETE supplémentaire après la finalisation");
  console.log("OK  finalisation forcée : plusieurs suppressions exécutées une fois chacune");
}

// 8. Finalisation qui attend une suppression déjà en cours
{
  const h = createHarness({ manualRelease: true });
  h.queue.schedule(60, "expense");
  await h.advance(DELAY); // DELETE 60 en cours, pas encore résolu
  h.queue.schedule(61, "income");
  let settled = false;
  const finalization = h.queue.flushAll().then((outcomes) => {
    settled = true;
    return outcomes;
  });
  await flush();
  assert.equal(settled, false, "la finalisation attend la suppression en cours");
  assert.equal(h.executed.length, 2, "61 démarre, 60 n'est pas relancé");
  h.releases.forEach((release) => release());
  const outcomes = await finalization;
  assert.equal(settled, true);
  assert.deepEqual(outcomes.map((o) => o.item.id).sort(), [60, 61]);
  assert.equal(h.executed.filter((e) => e.id === 60).length, 1, "60 n'a jamais été exécuté deux fois");
  console.log("OK  attente d'une suppression en cours : finalisation terminée après elle");
}

// 9. Pas de doublon entre le timer et la finalisation forcée
{
  const h = createHarness();
  h.queue.schedule(70, "recurring");
  await h.queue.flushAll();
  await h.advance(DELAY * 2); // le timer, déjà annulé, ne doit rien faire
  assert.equal(h.executed.length, 1);
  console.log("OK  timer et finalisation : un seul DELETE");
}

// 10. Plusieurs finalisations simultanées : un seul DELETE par opération
{
  const h = createHarness({ manualRelease: true });
  h.queue.schedule(80, "expense");
  h.queue.schedule(81, "income");
  const runs = [h.queue.flushAll(), h.queue.flushAll(), h.queue.flushAll()];
  assert.equal(h.executed.length, 2, "chaque opération démarre une seule fois");
  h.releases.forEach((release) => release());
  const results = await Promise.all(runs);
  results.forEach((outcomes) => assert.equal(outcomes.length, 2));
  assert.equal(h.executed.length, 2);
  console.log("OK  finalisations simultanées : un seul DELETE par opération");
}

// 11. Échec partiel : les réussites sont acquises, l'échec redevient accessible
{
  const h = createHarness({ failIds: new Set([91]) });
  h.queue.schedule(90, "income");
  h.queue.schedule(91, "expense");
  h.queue.schedule(92, "recurring");
  const outcomes = await h.queue.flushAll();
  assert.deepEqual(outcomes.map((o) => o.ok), [true, false, true]);
  assert.equal(h.successes.length, 2);
  assert.equal(h.failures.length, 1);
  assert.equal(h.queue.hasPending(), false, "la ligne en échec n'est plus masquée");
  assert.ok(h.queue.schedule(91, "expense") > 0, "l'opération peut être relancée");
  console.log("OK  échec partiel : réussites conservées, échec signalé et accessible");
}

// 12. Annulation impossible après démarrage ou fin
{
  const h = createHarness();
  const finishedKey = h.queue.schedule(100, "income");
  await h.queue.flushAll();
  assert.equal(h.queue.undo(finishedKey), false, "une opération terminée ne peut plus être annulée");
  const runningKey = h.queue.schedule(101, "income");
  const running = h.queue.flushAll();
  assert.equal(h.queue.undo(runningKey), false, "une opération en cours ne peut plus être annulée");
  await running;
  assert.equal(h.executed.filter((e) => e.id === 101).length, 1);
  console.log("OK  annulation impossible après démarrage ou fin");
}

console.log("Toutes les vérifications de la file de suppression sont passées.");
