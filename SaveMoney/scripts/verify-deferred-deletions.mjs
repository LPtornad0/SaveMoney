// Vérifie la file de suppressions différées avec une horloge simulée (aucun SQL réel).
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

// Horloge simulée : les timers sont déclenchés uniquement par advance().
function createHarness({ failIds = new Set() } = {}) {
  let now = 0;
  const timers = [];
  const executed = [];
  const successes = [];
  const failures = [];
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
    execute: async (type, id) => {
      executed.push({ type, id, at: now });
      if (failIds.has(id)) throw new Error("SQL failure");
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
  const a = h.queue.schedule(1, "income"); // expire à t = 5000
  await h.advance(1000);
  const b = h.queue.schedule(2, "expense"); // expire à t = 6000
  await h.advance(1000);
  const c = h.queue.schedule(3, "recurring"); // expire à t = 7000
  assert.equal(h.pending().length, 3);

  // Annulation de B seulement
  assert.equal(h.queue.undo(b), true);
  assert.deepEqual(h.pending().map((p) => p.id).sort(), [1, 3]);

  await h.advance(3000); // t = 5000 : A expire
  assert.deepEqual(h.executed.map((e) => e.id), [1]);
  await h.advance(2000); // t = 7000 : C expire, B n'est jamais exécuté
  assert.deepEqual(h.executed.map((e) => e.id), [1, 3]);
  assert.equal(h.pending().length, 0);
  assert.ok(a && c, "les trois clés ont été créées");
  console.log("OK  plusieurs suppressions : annulation de B sans effet sur A et C");
}

// 4. Un ancien timer ne supprime jamais une nouvelle opération
{
  const h = createHarness();
  const oldKey = h.queue.schedule(20, "expense");
  h.queue.undo(oldKey);
  const newKey = h.queue.schedule(20, "expense"); // même ligne, nouvelle opération
  assert.notEqual(oldKey, newKey);
  // Déclenche directement l'ancien timer, même annulé
  h.timers[0].run();
  await flush();
  assert.equal(h.executed.length, 0, "l'ancien timer ne doit rien exécuter");
  assert.deepEqual(h.pending().map((p) => p.key), [newKey], "la nouvelle opération reste en attente");
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
  let release;
  const executed = [];
  const queue = new DeferredDeletionQueue({
    delayMs: DELAY,
    schedule: (run) => setTimeout(run, 0),
    cancel: (handle) => clearTimeout(handle),
    execute: (type, id) => new Promise((resolve) => { executed.push(id); release = resolve; }),
    onChange: () => {},
    onSuccess: () => {},
    onFailure: () => {},
  });
  const key = queue.schedule(40, "expense");
  // Laisse le timer simulé se déclencher
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(executed, [40], "le DELETE a démarré");
  assert.equal(queue.undo(key), false, "annulation refusée pendant l'exécution");
  release();
  await flush();
  assert.deepEqual(executed, [40], "toujours un seul DELETE");
  console.log("OK  annulation pendant l'exécution : refusée, un seul DELETE");
}

console.log("Toutes les vérifications de suppression différée sont passées.");
