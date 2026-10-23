// Vérifie les règles du montant courant d'un objectif (src/utils/goalRules.ts) et la suppression différée des objectifs
// (src/utils/deferredDeletions.ts, type « goal »).
// Le câblage React (brouillon, gardes, focus, confirmation window.confirm, updateGoal réel, SQL) n'est pas exécuté ici :
// il se vérifie dans Tauri.
// Usage : node scripts/verify-goals.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = readFileSync(path.join(root, "src", "utils", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleObject = { exports: {} };
  cache.set(name, moduleObject.exports);
  const localRequire = (specifier) => load(specifier.replace(/^\.\//, ""));
  new Function("module", "exports", "require", outputText)(moduleObject, moduleObject.exports, localRequire);
  cache.set(name, moduleObject.exports);
  return moduleObject.exports;
}

const rules = load("goalRules");
const queueModule = load("deferredDeletions");
const tick = () => new Promise((resolve) => setImmediate(resolve));

// 1. Validation du montant courant : zéro et décimales acceptés, le reste refusé
{
  assert.equal(rules.parseCurrentAmount("0"), 0, "zéro accepté");
  assert.ok(Object.is(rules.parseCurrentAmount("-0"), 0), "-0 devient 0");
  assert.equal(rules.parseCurrentAmount("12.5"), 12.5, "décimale acceptée");
  assert.equal(rules.parseCurrentAmount(" 300 "), 300, "espaces ignorés");
  assert.equal(rules.parseCurrentAmount("1000"), 1000, "au-delà de la cible : valeur exacte conservée");
  for (const value of ["", "   ", "-1", "-0.01", "abc", "NaN", "Infinity", "-Infinity", "12,5"]) {
    assert.equal(rules.parseCurrentAmount(value), null, `${JSON.stringify(value)} refusé`);
  }
  console.log("OK  validation : zéro, décimales et montants au-delà de la cible acceptés ; vide, négatif, non numérique, non fini refusés");
}

// 2. Brouillon : comparaison par valeur, un brouillon illisible compte comme modifié
{
  assert.equal(rules.isGoalDraftChanged(100, "100"), false, "même valeur");
  assert.equal(rules.isGoalDraftChanged(100, "100.00"), false, "100 et 100.00 : même montant");
  assert.equal(rules.isGoalDraftChanged(100, " 100 "), false, "espaces ignorés");
  assert.equal(rules.isGoalDraftChanged(100, "100.5"), true, "valeur différente");
  assert.equal(rules.isGoalDraftChanged(0, "0"), false, "zéro inchangé");
  assert.equal(rules.isGoalDraftChanged(100, ""), true, "vide : modifié");
  assert.equal(rules.isGoalDraftChanged(100, "abc"), true, "illisible : modifié");
  console.log("OK  brouillon : comparaison par valeur ; vide ou illisible compté comme modifié");
}

// 3. Affichage : jauge et pourcentage plafonnés à 100 %, montant réel conservé
{
  assert.deepEqual(rules.goalProgress(500, 1000), { percent: 50, amount: 500 });
  assert.deepEqual(rules.goalProgress(1000, 1000), { percent: 100, amount: 1000 }, "cible atteinte");
  assert.deepEqual(rules.goalProgress(1200, 1000), { percent: 100, amount: 1200 }, "dépassement : jauge à 100 %, montant réel 1200");
  assert.deepEqual(rules.goalProgress(0, 1000), { percent: 0, amount: 0 }, "vide");
  assert.deepEqual(rules.goalProgress(0, 0), { percent: 0, amount: 0 }, "cible nulle : pas de division par zéro");
  assert.deepEqual(rules.goalProgress(50, -5), { percent: 0, amount: 50 }, "cible négative : jauge vide");
  console.log("OK  affichage : jauge plafonnée à 100 %, montant réel jamais plafonné, cible nulle sans NaN");
}

// 4. Suppression différée d'un objectif : même file que les opérations
{
  const { DeferredDeletionQueue } = queueModule;
  const timers = [];
  const executed = [];
  const failures = [];
  let failNext = false;
  const queue = new DeferredDeletionQueue({
    delayMs: 5000,
    schedule: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
    execute: async (type, id) => {
      if (failNext) {
        failNext = false;
        throw new Error("base verrouillée");
      }
      executed.push(`${type}-${id}`);
    },
    onChange: () => {},
    onSuccess: () => {},
    onFailure: (item) => failures.push(item),
  });

  // Annulation avant l'échéance : aucun DELETE, l'objectif reste
  const undone = queue.schedule(7, "goal");
  assert.deepEqual(queue.pending().map((item) => item.type), ["goal"], "objectif en attente");
  assert.equal(queue.undo(undone), true, "annulation possible");
  timers[0].run();
  await tick();
  assert.deepEqual(executed, [], "annulé : aucun DELETE");
  assert.equal(queue.hasPending(), false);

  // Échéance sans annulation : un seul DELETE, de type goal
  queue.schedule(8, "goal");
  timers[1].run();
  await tick();
  assert.deepEqual(executed, ["goal-8"], "un seul DELETE à l'échéance");

  // Échec SQL : signalé, l'objectif n'est plus en attente et peut être restauré (aucune annonce de succès)
  failNext = true;
  queue.schedule(9, "goal");
  timers[2].run();
  await tick();
  assert.equal(failures.length, 1, "échec signalé");
  assert.equal(failures[0].id, 9);
  assert.equal(queue.hasPending(), false, "échec : objectif de nouveau visible");
  assert.deepEqual(executed, ["goal-8"], "échec : aucun succès enregistré");

  // Finalisation forcée : chaque objectif en attente est supprimé une seule fois
  queue.schedule(10, "goal");
  queue.schedule(11, "goal");
  const outcomes = await queue.flushAll();
  assert.equal(outcomes.filter((o) => o.ok).length, 2);
  assert.deepEqual(executed, ["goal-8", "goal-10", "goal-11"], "finalisation : une fois chacun");
  console.log("OK  suppression différée : annulation, un seul DELETE, échec signalé sans succès, finalisation unique");
}

console.log("Toutes les vérifications des objectifs (règles pures et file de suppression) sont passées.");
