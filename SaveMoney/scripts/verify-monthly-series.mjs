// Vérifie la courbe d'évolution sur 6 mois (src/utils/monthlySeries.ts) et la protection des résultats périmés
// (src/utils/requestGate.ts, comme utilisé par src/hooks/useMonthlySeries.ts).
// Le câblage React (effets, rendu de la carte, Chart.js, clics) n'est pas exécuté ici : il se vérifie dans Tauri.
// Usage : node scripts/verify-monthly-series.mjs
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

const series = load("monthlySeries");
const summary = load("computeSummary");
const gate = load("requestGate");

const categories = [
  { id: 1, name: "Courses" },
  { id: 2, name: "Épargne" },
  { id: 3, name: "Savings jar" },
];
const period = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

// Données de test : une dépense « Épargne », une sans catégorie, des revenus et des dépenses dans et hors période
const incomes = [
  { id: 1, month: "2026-03", amount: 1000, category_id: null },
  { id: 2, month: "2026-03", amount: 200, category_id: null },
  { id: 3, month: "2026-08", amount: 1500, category_id: null },
  { id: 4, month: "2026-02", amount: 999, category_id: null }, // avant la période
  { id: 5, month: "2026-09", amount: 777, category_id: null }, // après le mois sélectionné
];
const expenses = [
  { id: 10, month: "2026-03", amount: 50, category_id: 1 },
  { id: 11, month: "2026-03", amount: 30, category_id: null },
  { id: 12, month: "2026-03", amount: 400, category_id: 2 }, // Épargne : exclue des dépenses ponctuelles
  { id: 13, month: "2026-05", amount: 60, category_id: 3 }, // « Savings jar » : épargne
  { id: 14, month: "2026-08", amount: 120, category_id: 1 },
  { id: 15, month: "2026-07", amount: 999, category_id: 1 }, // hors période pour un autre test
];
const recurringExpenses = [{ id: 90, amount: 500, category_id: 1, month: "2026-08" }]; // charges fixes : jamais dans la courbe

const source = { months: period, incomes, expenses, categories };

// 1. Six mois dans l'ordre chronologique, passages d'année, mois futur sans extrapolation
{
  assert.deepEqual(series.periodMonths("2026-08"), period, "six mois, du plus ancien au plus récent, finissant au mois sélectionné");
  assert.deepEqual(
    series.periodMonths("2027-02"),
    ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"],
    "passage d'année"
  );
  assert.deepEqual(series.periodMonths("2030-01").slice(-1), ["2030-01"], "mois futur : la période se termine quand même sur ce mois");
  assert.equal(series.periodMonths("2026-08").length, series.SERIES_LENGTH);
  console.log("OK  six mois dans l'ordre, passages d'année, mois futur sans extrapolation");
}

// 2. Mois sans données : valeur 0 et indication « pas de donnée » ; un mois avec seulement de l'épargne compte comme donnée
{
  const rows = series.buildMonthlySeries({ ...source, incomes: [], expenses: [] });
  for (const row of rows) {
    assert.equal(row.revenus, 0);
    assert.equal(row.depensesPonctuelles, 0);
    assert.equal(row.status, "none", `${row.month} sans aucune opération`);
  }
  const onlySavings = series.buildMonthlySeries({
    months: ["2026-05"],
    incomes: [],
    expenses: [{ id: 99, month: "2026-05", amount: 60, category_id: 3 }],
    categories,
  });
  assert.equal(onlySavings[0].depensesPonctuelles, 0, "épargne seule : pas une dépense ponctuelle");
  assert.equal(onlySavings[0].status, "savings-only", "épargne seule : statut distinct d'un mois vide");
  const pendingOnly = series.buildMonthlySeries({
    months: ["2026-05"],
    incomes: [{ id: 7, month: "2026-05", amount: 100, category_id: null }],
    expenses: [],
    categories,
    excluded: [{ id: 7, type: "income" }],
  });
  assert.equal(pendingOnly[0].status, "pending-only", "opération en attente seule : statut distinct d'un mois vide");
  assert.equal(pendingOnly[0].revenus, 0);
  console.log("OK  statuts : mois vide, épargne seule et opération en attente sont distincts");
}

// 3. Sommes par mois ; charges fixes et épargne exclues ; catégorie absente = dépense ponctuelle
{
  const rows = series.buildMonthlySeries(source);
  const byMonth = Object.fromEntries(rows.map((row) => [row.month, row]));
  assert.equal(byMonth["2026-03"].revenus, 1200, "revenus de mars : 1000 + 200");
  assert.equal(byMonth["2026-03"].depensesPonctuelles, 80, "mars : 50 + 30, épargne 400 exclue");
  assert.equal(byMonth["2026-05"].depensesPonctuelles, 0, "mai : seule l'épargne « Savings jar »");
  assert.equal(byMonth["2026-08"].revenus, 1500);
  assert.equal(byMonth["2026-08"].depensesPonctuelles, 120, "août : la charge fixe de 500 n'entre pas");
  console.log("OK  sommes par mois : revenus, dépenses ponctuelles, épargne et charges fixes exclues");
}

// 4. Bornes : le mois précédant la période et le mois suivant le mois sélectionné n'entrent pas
{
  const rows = series.buildMonthlySeries(source);
  assert.equal(rows.length, 6, "exactement six lignes");
  assert.equal(rows.some((row) => row.month === "2026-02" || row.month === "2026-09"), false, "aucune ligne hors période");
  const total = rows.reduce((sum, row) => sum + row.revenus, 0);
  assert.equal(total, 1200 + 1500, "le revenu du 2026-02 et celui du 2026-09 ne sont pas comptés");
  console.log("OK  bornes : mois précédant la période et mois suivant exclus");
}

// 5. Suppressions en attente : exclues comme dans les listes ; un identifiant identique d'un autre type ne l'est pas
{
  const rows = series.buildMonthlySeries({
    ...source,
    excluded: [
      { id: 1, type: "income" },
      { id: 14, type: "expense" },
    ],
  });
  const byMonth = Object.fromEntries(rows.map((row) => [row.month, row]));
  assert.equal(byMonth["2026-03"].revenus, 200, "revenu 1 en attente de suppression : exclu");
  assert.equal(byMonth["2026-08"].depensesPonctuelles, 0, "dépense 14 en attente : exclue");
  assert.equal(byMonth["2026-08"].revenus, 1500, "le revenu d'août n'est pas touché");
  const sameIdOtherType = series.buildMonthlySeries({ ...source, excluded: [{ id: 10, type: "income" }] });
  assert.equal(sameIdOtherType.find((row) => row.month === "2026-03").depensesPonctuelles, 80, "id 10 d'un autre type : dépense non exclue");
  console.log("OK  suppressions en attente exclues comme dans les listes ; types distingués");
}

// 6. Cohérence : le mois sélectionné égale les totaux non filtrés calculés par summarizeMonth (charges fixes incluses dans l'entrée)
{
  const rows = series.buildMonthlySeries(source);
  const selected = rows.find((row) => row.month === "2026-08");
  const monthSummary = summary.summarizeMonth({
    incomes: incomes.filter((i) => i.month === "2026-08"),
    expenses: expenses.filter((e) => e.month === "2026-08"),
    recurringExpenses,
    categories,
  });
  assert.equal(selected.revenus, monthSummary.revenusTotal, "revenus : même valeur que le total du mois");
  assert.equal(selected.depensesPonctuelles, monthSummary.depensesTotal, "dépenses ponctuelles : même valeur que le total du mois");
  console.log("OK  cohérence : revenus et dépenses ponctuelles du mois égaux aux totaux de summarizeMonth");
}

// 7. Requête groupée : trois lectures pour toute la période, bornes inclusives, aucune écriture
{
  const calls = [];
  const db = {
    async select(query, params = []) {
      calls.push({ query, params });
      if (query.startsWith("SELECT id, month, amount, category_id FROM incomes")) return incomes.filter((i) => i.month >= params[0] && i.month <= params[1]);
      if (query.startsWith("SELECT id, month, amount, category_id FROM expenses")) return expenses.filter((e) => e.month >= params[0] && e.month <= params[1]);
      if (query.startsWith("SELECT * FROM categories")) return categories;
      throw new Error(`requête inattendue : ${query}`);
    },
  };
  const rows = await series.fetchSeriesRows(db, period);
  assert.equal(calls.length, 3, "une lecture par table, et non une par mois");
  assert.deepEqual(calls[0].params, ["2026-03", "2026-08"], "bornes de la période");
  assert.deepEqual(calls[1].params, ["2026-03", "2026-08"]);
  assert.ok(calls.every((c) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(c.query)), "aucune écriture");
  assert.equal(rows.incomes.some((i) => i.month === "2026-02"), false, "lignes hors période non lues");
  assert.equal(rows.expenses.some((e) => e.month === "2026-09"), false);
  // Le résultat de la lecture groupée, passé au calcul, donne les mêmes montants que les données directes
  const fromQuery = series.buildMonthlySeries(rows);
  assert.deepEqual(fromQuery, series.buildMonthlySeries(source), "lecture groupée et données directes : mêmes lignes");
  console.log("OK  requête groupée : trois lectures sur la période, bornes inclusives, aucune écriture");
}

// 8. Erreur de lecture : aucune valeur à zéro n'est produite ; l'erreur reste distincte
{
  let rowsState = null;
  let errorState = null;
  const requests = gate.createRequestGate();
  await gate.runLatest(
    requests,
    async () => {
      throw new Error("base indisponible");
    },
    {
      onResult: (value) => {
        rowsState = value;
      },
      onError: (error) => {
        errorState = `Impossible de charger l'évolution. ${error.message}`;
        rowsState = null;
      },
      onSettled: () => {},
    }
  );
  assert.equal(rowsState, null, "erreur : aucune ligne à zéro");
  assert.equal(errorState, "Impossible de charger l'évolution. base indisponible");
  console.log("OK  erreur de lecture : pas de valeurs à zéro, erreur distincte");
}

// 9. Résultats périmés : un ancien résultat, arrivé après un nouveau, ou après une invalidation, n'écrit rien
{
  const requests = gate.createRequestGate();
  let written = null;
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const oldRequest = deferred();
  const newRequest = deferred();
  const handlers = {
    onResult: (value) => {
      written = value;
    },
    onError: () => {},
    onSettled: () => {},
  };
  const oldRun = gate.runLatest(requests, () => oldRequest.promise, handlers);
  const newRun = gate.runLatest(requests, () => newRequest.promise, handlers);
  newRequest.resolve("période récente");
  await newRun;
  oldRequest.resolve("période ancienne");
  await oldRun;
  assert.equal(written, "période récente", "le résultat récent n'est pas remplacé par l'ancien");

  // Changement de mois ou nouvelle donnée : l'invalidation rend le résultat en cours obsolète
  const pending = deferred();
  written = null;
  const run = gate.runLatest(requests, () => pending.promise, handlers);
  requests.invalidate();
  pending.resolve("période invalidée");
  await run;
  assert.equal(written, null, "résultat arrivé après invalidation : ignoré");
  console.log("OK  résultats périmés : l'ancien ne remplace pas le récent, l'invalidation est respectée");
}

console.log("Toutes les vérifications de la courbe d'évolution (fonctions pures, requête, erreurs, résultats périmés) sont passées.");
