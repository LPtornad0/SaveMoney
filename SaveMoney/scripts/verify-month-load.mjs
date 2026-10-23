// Vérifie que seule la réponse la plus récente écrit l'état du chargement mensuel.
// Les fonctions testées sont celles appelées par useMonthlyBudget : runLatest, createRequestGate
// et fetchMonthBudget. Le câblage React (useState, useEffect) n'est pas exécuté ici :
// il doit être vérifié dans Tauri. L'invalidation est testée par gate.invalidate(), appelé par le nettoyage de l'effet.
// Usage : node scripts/verify-month-load.mjs
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

const { createRequestGate, runLatest } = load("requestGate");
const { fetchMonthBudget, emptyMonthBudget, getPreviousMonth } = load("monthBudget");

// Base factice : une ligne de revenu dont le libellé identifie le mois interrogé.
function fakeDb() {
  const queries = [];
  return {
    queries,
    async select(query, params = []) {
      queries.push({ query, params });
      if (query.startsWith("SELECT * FROM incomes")) {
        return [{ id: 1, date: "2026-01-01", month: params[0], label: `revenu-${params[0]}`, amount: 100, category_id: null }];
      }
      return [];
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// État modélisé comme dans le hook : données, erreur, chargement, et nombre de fins de chargement.
function createState() {
  return { data: null, error: null, loading: true, settled: 0 };
}

function handlersFor(state) {
  return {
    onResult: (value) => {
      state.data = value;
    },
    onError: (error) => {
      state.error = `Impossible de charger les données. ${error.message}`;
      state.data = emptyMonthBudget();
    },
    onSettled: () => {
      state.loading = false;
      state.settled += 1;
    },
  };
}

// Reproduit le début de load() dans le hook : état de chargement remis à zéro, puis runLatest.
function startLoad(state, gate, work) {
  state.loading = true;
  state.error = null;
  return runLatest(gate, work, handlersFor(state));
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// 1. Ancienne réponse arrivant après la nouvelle : la nouvelle reste affichée
{
  const gate = createRequestGate();
  const state = createState();
  const oldRequest = deferred();
  const newRequest = deferred();
  const oldRun = startLoad(state, gate, () => oldRequest.promise);
  const newRun = startLoad(state, gate, () => newRequest.promise);

  newRequest.resolve(await fetchMonthBudget(fakeDb(), "2026-10"));
  await newRun;
  oldRequest.resolve(await fetchMonthBudget(fakeDb(), "2026-09"));
  await oldRun;

  assert.equal(state.data.incomes[0].label, "revenu-2026-10", "la réponse la plus récente reste affichée");
  assert.equal(state.loading, false);
  console.log("OK  ancienne réponse après la nouvelle : données du mois affiché conservées");
}

// 2. Ancienne erreur arrivant après une nouvelle réussite : pas d'erreur affichée
{
  const gate = createRequestGate();
  const state = createState();
  const oldRequest = deferred();
  const newRequest = deferred();
  const oldRun = startLoad(state, gate, () => oldRequest.promise);
  const newRun = startLoad(state, gate, () => newRequest.promise);

  newRequest.resolve(await fetchMonthBudget(fakeDb(), "2026-10"));
  await newRun;
  oldRequest.reject(new Error("base indisponible"));
  await oldRun;

  assert.equal(state.error, null, "l'erreur ancienne n'est pas affichée");
  assert.equal(state.data.incomes[0].label, "revenu-2026-10");
  console.log("OK  ancienne erreur après une nouvelle réussite : aucune erreur affichée");
}

// 3. Ancien finally : le chargement ne se termine pas tant que la requête courante n'a pas fini
{
  const gate = createRequestGate();
  const state = createState();
  const oldRequest = deferred();
  const newRequest = deferred();
  const oldRun = startLoad(state, gate, () => oldRequest.promise);
  const newRun = startLoad(state, gate, () => newRequest.promise);

  oldRequest.resolve(await fetchMonthBudget(fakeDb(), "2026-09"));
  await oldRun;
  assert.equal(state.loading, true, "l'ancien finally ne retire pas l'état de chargement");
  assert.equal(state.settled, 0);

  newRequest.resolve(await fetchMonthBudget(fakeDb(), "2026-10"));
  await newRun;
  assert.equal(state.loading, false, "la requête courante termine le chargement");
  assert.equal(state.settled, 1, "une seule fin de chargement");
  console.log("OK  ancien finally : le chargement reste actif jusqu'à la requête courante");
}

// 4. Deux refresh concurrents : seul le dernier lancé écrit son résultat
{
  const gate = createRequestGate();
  const state = createState();
  const first = deferred();
  const second = deferred();
  const firstRun = startLoad(state, gate, () => first.promise);
  const secondRun = startLoad(state, gate, () => second.promise);

  second.resolve(await fetchMonthBudget(fakeDb(), "2026-10"));
  await secondRun;
  first.resolve(await fetchMonthBudget(fakeDb(), "2026-10-bis"));
  await firstRun;

  assert.equal(state.data.incomes[0].label, "revenu-2026-10", "le second refresh gagne");
  assert.equal(state.settled, 1);
  console.log("OK  deux refresh concurrents : seul le dernier écrit son résultat");
}

// 5. Résultat arrivant après invalidation (changement de mois ou nettoyage de l'effet)
{
  const gate = createRequestGate();
  const state = createState();
  const pending = deferred();
  const run = startLoad(state, gate, () => pending.promise);

  gate.invalidate(); // le nettoyage de l'effet précède le chargement du mois suivant
  pending.resolve(await fetchMonthBudget(fakeDb(), "2026-09"));
  await run;

  assert.equal(state.data, null, "rien n'est écrit après invalidation");
  assert.equal(state.settled, 0, "pas de fin de chargement pour une requête invalidée");
  console.log("OK  résultat après invalidation : ignoré");
}

// 6. Démontage pendant une requête : une réponse tardive n'écrit rien (même erreur)
{
  const gate = createRequestGate();
  const state = createState();
  const pending = deferred();
  const run = startLoad(state, gate, () => pending.promise);

  gate.invalidate(); // démontage
  pending.reject(new Error("erreur tardive"));
  await run;

  assert.equal(state.error, null, "l'erreur tardive n'est pas écrite");
  assert.equal(state.data, null);
  console.log("OK  démontage pendant une requête : réponse et erreur tardives ignorées");
}

// 7. La requête courante après une invalidation fonctionne normalement
{
  const gate = createRequestGate();
  const state = createState();
  const stale = deferred();
  const staleRun = startLoad(state, gate, () => stale.promise);
  gate.invalidate();
  stale.resolve(await fetchMonthBudget(fakeDb(), "2026-09"));
  await staleRun;

  const fresh = deferred();
  const freshRun = startLoad(state, gate, () => fresh.promise);
  fresh.resolve(await fetchMonthBudget(fakeDb(), "2026-10"));
  await freshRun;
  assert.equal(state.data.incomes[0].label, "revenu-2026-10");
  assert.equal(state.loading, false);
  console.log("OK  après invalidation, une nouvelle requête est écrite normalement");
}

// 8. Calcul de la requête : le mois précédent est bien interrogé (règle inchangée)
{
  const db = fakeDb();
  await fetchMonthBudget(db, "2026-01");
  const previousQueries = db.queries.filter((q) => q.query.startsWith("SELECT * FROM incomes")).map((q) => q.params[0]);
  assert.deepEqual(previousQueries, ["2026-01", "2025-12"]);
  assert.equal(getPreviousMonth("2026-03"), "2026-02");
  console.log("OK  requêtes : mois courant et mois précédent (changement d'année inclus)");
}

console.log("Toutes les vérifications du chargement mensuel sont passées (runLatest et fetchMonthBudget).");
