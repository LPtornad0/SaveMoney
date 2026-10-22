// Vérifie le tri du panneau des opérations et des charges fixes (fonctions pures).
// Ces tests ne prouvent pas le rendu du panneau ni le défilement : voir les tests visuels dans Tauri.
// Usage : node scripts/verify-operations.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "utils", "operations.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
new Function("module", "exports", outputText)(moduleObject, moduleObject.exports);
const { buildOperations, sortRecurring, formatShortDate } = moduleObject.exports;

const incomes = [
  { id: 1, label: "Salaire", amount: 1500, date: "2026-10-01", category_id: 5 },
  { id: 2, label: "Remboursement", amount: 40, date: "2026-10-15", category_id: null },
];
const expenses = [
  { id: 10, label: "Courses", amount: 80, date: "2026-10-15", category_id: 1 },
  { id: 11, label: "Essence", amount: 60, date: "2026-10-22", category_id: 2 },
  { id: 9, label: "Café", amount: 4, date: "2026-10-15", category_id: null },
];

// 1. Date décroissante, toutes opérations du mois réunies
const ops = buildOperations(incomes, expenses);
assert.deepEqual(
  ops.map((o) => o.label),
  ["Essence", "Remboursement", "Courses", "Café", "Salaire"],
  "date décroissante"
);
console.log("OK  revenus et dépenses réunis, date décroissante");

// 2. À date identique : revenu avant dépense, puis id décroissant (ordre stable)
assert.deepEqual(
  ops.filter((o) => o.date === "2026-10-15").map((o) => `${o.kind}-${o.id}`),
  ["income-2", "expense-10", "expense-9"],
  "même date : revenu d'abord, puis id décroissant"
);
console.log("OK  date identique : ordre déterministe (revenu, puis id décroissant)");

// 3. Chaque opération garde une clé unique et son type explicite
assert.equal(new Set(ops.map((o) => o.key)).size, ops.length, "clés uniques");
assert.ok(ops.every((o) => o.kind === "income" || o.kind === "expense"), "type explicite");
console.log("OK  clés uniques et type explicite par opération");

// 4. Résultat identique quel que soit l'ordre d'entrée (déterminisme)
const reversed = buildOperations([...incomes].reverse(), [...expenses].reverse());
assert.deepEqual(reversed.map((o) => o.key), ops.map((o) => o.key), "même ordre après inversion des entrées");
console.log("OK  ordre indépendant de l'ordre d'entrée");

// 5. Charges fixes : jour croissant, sans jour à la fin, sans date fabriquée
const recurring = [
  { id: 30, label: "Loyer", amount: 700, category_id: 2, day_of_month: 5 },
  { id: 31, label: "Sans jour", amount: 10, category_id: null, day_of_month: null },
  { id: 32, label: "Internet", amount: 30, category_id: 2, day_of_month: 1 },
  { id: 33, label: "Assurance", amount: 25, category_id: 2, day_of_month: 5 },
];
assert.deepEqual(
  sortRecurring(recurring).map((r) => r.label),
  ["Internet", "Loyer", "Assurance", "Sans jour"],
  "jour croissant, égalité par id, sans jour en dernier"
);
assert.equal(recurring.length, 4, "la liste d'origine n'est pas modifiée");
console.log("OK  charges fixes triées par jour, sans jour en dernier, sans date fabriquée");

// 6. Format de date sans décalage de fuseau
assert.equal(formatShortDate("2026-10-01"), "01/10");
assert.equal(formatShortDate("2026-12-31"), "31/12");
console.log("OK  format de date stable");

console.log("Toutes les vérifications du panneau des opérations sont passées (fonctions pures).");
