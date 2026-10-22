// Vérifie le calcul du Disponible et des variations mensuelles.
// Usage : node scripts/verify-summary.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "utils", "computeSummary.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
new Function("module", "exports", outputText)(moduleObject, moduleObject.exports);
const { summarizeMonth } = moduleObject.exports;

const categories = [
  { id: 1, name: "Alimentation" },
  { id: 2, name: "Épargne" },
];

const month = {
  incomes: [{ amount: 1000, category_id: null }],
  expenses: [
    { amount: 200, category_id: 1 },
    { amount: 50, category_id: 2 },
  ],
  recurringExpenses: [
    { amount: 100, category_id: 1 },
    { amount: 50, category_id: 2 },
  ],
  categories,
};

// Cas 1 : Disponible = 1000 - 200 - 100 - (50 + 50) = 600
const summary = summarizeMonth(month);
assert.equal(summary.revenusTotal, 1000);
assert.equal(summary.depensesTotal, 200);
assert.equal(summary.chargesFixesTotal, 100);
assert.equal(summary.epargneTotal, 100);
assert.equal(summary.disponible, 600);
console.log("OK  cas 1 : Disponible attendu 600 €");

// Cas 2 : deux mois identiques (épargne incluse) donnent une variation de 0 €
const current = summarizeMonth(month);
const previous = summarizeMonth(month);
assert.equal(current.disponible - previous.disponible, 0);
assert.equal(current.depensesTotal - previous.depensesTotal, 0);
assert.equal(current.chargesFixesTotal - previous.chargesFixesTotal, 0);
assert.equal(current.epargneTotal - previous.epargneTotal, 0);
assert.equal(current.revenusTotal - previous.revenusTotal, 0);
console.log("OK  cas 2 : variation de 0 € pour deux mois identiques avec épargne");

// Cas 3 : une dépense ou une charge sans catégorie reste une dépense hors épargne
const withoutCategory = summarizeMonth({
  ...month,
  expenses: [{ amount: 200, category_id: null }, { amount: 50, category_id: 2 }],
  recurringExpenses: [{ amount: 100, category_id: null }, { amount: 50, category_id: 2 }],
});
assert.equal(withoutCategory.depensesTotal, 200);
assert.equal(withoutCategory.chargesFixesTotal, 100);
assert.equal(withoutCategory.epargneTotal, 100);
assert.equal(withoutCategory.disponible, 600);
console.log("OK  cas 3 : entrées sans catégorie classées comme dépenses hors épargne");

console.log("Toutes les vérifications de calcul sont passées.");
