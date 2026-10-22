// Vérifie les lignes du graphique et le filtre au clic (fonctions pures uniquement).
// Ces tests ne valident pas le rendu Chart.js ni le clic réel : voir les tests visuels dans Tauri.
// Usage : node scripts/verify-chart-rows.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

// Charge un module TypeScript de src/utils ; ses imports relatifs sont résolus via ce même chargeur.
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

const { buildChartRows, filterByCategory, isSameFilter, UNCATEGORIZED_LABEL } = load("chartRows");

const categories = [
  { id: 1, name: "Alimentation", type: "expense" },
  { id: 2, name: "Logement", type: "expense" },
  { id: 3, name: "Loisirs", type: "expense" },
  { id: 4, name: "Épargne", type: "expense" },
  { id: 5, name: "Salaire", type: "income" },
  { id: 6, name: "Vide", type: "expense" },
  { id: 7, name: "Savings account", type: "expense" },
  { id: 8, name: "Sans catégorie", type: "expense" }, // catégorie réelle au même nom
];

const data = {
  categories,
  expenses: [
    { id: 1, amount: 200, category_id: 1 },
    { id: 2, amount: 50, category_id: 3 },
    { id: 3, amount: 50, category_id: 4 }, // épargne : exclue
    { id: 4, amount: 999, category_id: null }, // sans catégorie
    { id: 5, amount: 40, category_id: 7 }, // « savings » : exclue
    { id: 6, amount: 30, category_id: 42 }, // identifiant inexistant : sans catégorie
    { id: 7, amount: 5, category_id: 8 }, // vraie catégorie « Sans catégorie »
  ],
  recurringExpenses: [
    { id: 10, amount: 100, category_id: 1 },
    { id: 11, amount: 400, category_id: 2 },
    { id: 12, amount: 50, category_id: 4 }, // épargne récurrente : exclue
  ],
};

const rows = buildChartRows(data);
const byLabel = (label) => rows.find((r) => r.label === label);

// 1. Tri décroissant commun à toutes les lignes (y compris « Sans catégorie »)
assert.deepEqual(
  rows.map((r) => [r.label, r.total]),
  [
    [UNCATEGORIZED_LABEL, 1029],
    ["Logement", 400],
    ["Alimentation", 300],
    ["Loisirs", 50],
    ["Sans catégorie", 5],
  ],
  "tri décroissant ; 999 + 30 (sans catégorie) = 1029"
);
console.log("OK  tri décroissant, « Sans catégorie » incluse dans le même tri");

// 2. Épargne et revenus exclus
assert.ok(!rows.some((r) => r.label === "Épargne" || r.label === "Savings account"), "épargne exclue");
assert.ok(!rows.some((r) => r.label === "Salaire"), "revenus exclus");
console.log("OK  épargne (nom « Épargne » ou « savings ») et revenus exclus");

// 3. Lignes à total nul ou négatif masquées
assert.equal(byLabel("Vide"), undefined, "catégorie vide masquée");
console.log("OK  lignes à total nul masquées");

// 4. Une catégorie réelle nommée « Sans catégorie » reste distincte de la ligne générée
const realNamed = rows.find((r) => r.filter.kind === "category" && r.filter.categoryId === 8);
const generated = rows.find((r) => r.filter.kind === "uncategorized");
assert.deepEqual(realNamed.filter, { kind: "category", categoryId: 8 });
assert.deepEqual(generated.filter, { kind: "uncategorized" });
console.log("OK  catégorie homonyme distincte de la ligne « Sans catégorie »");

// 5. Clic : l'index après tri renvoie le filtre de la bonne ligne
assert.deepEqual(rows[2].filter, { kind: "category", categoryId: 1 }, "la troisième barre filtre Alimentation");
console.log("OK  clic après tri : le filtre correspond à la barre cliquée");

// 6. Filtre « aucun » : toutes les opérations ; filtre catégorie : identifiant seulement
const expenses = data.expenses;
assert.equal(filterByCategory(expenses, null, categories).length, expenses.length, "aucun filtre garde tout");
const onlyAlimentation = filterByCategory(expenses, { kind: "category", categoryId: 1 }, categories);
assert.deepEqual(onlyAlimentation.map((e) => e.id), [1]);
console.log("OK  aucun filtre garde tout ; filtre catégorie ne garde que son identifiant");

// 7. Filtre « Sans catégorie » : sans identifiant valide, pas la catégorie homonyme
const uncategorized = filterByCategory(expenses, { kind: "uncategorized" }, categories);
assert.deepEqual(uncategorized.map((e) => e.id), [4, 6], "null et identifiant inexistant seulement");
const realNamedOnly = filterByCategory(expenses, { kind: "category", categoryId: 8 }, categories);
assert.deepEqual(realNamedOnly.map((e) => e.id), [7], "la catégorie homonyme n'est pas « Sans catégorie »");
console.log("OK  « Sans catégorie » filtre les opérations sans catégorie valide, distinctes de l'homonyme");

// 8. Revenus filtrables de la même façon
const incomes = [
  { id: 20, amount: 1000, category_id: null },
  { id: 21, amount: 500, category_id: 5 },
];
assert.deepEqual(filterByCategory(incomes, { kind: "uncategorized" }, categories).map((i) => i.id), [20]);
console.log("OK  revenus filtrés par « Sans catégorie »");

// 9. Comparaison des filtres pour le second clic
assert.equal(isSameFilter(null, { kind: "uncategorized" }), false, "aucun filtre ≠ Sans catégorie");
assert.equal(isSameFilter({ kind: "uncategorized" }, { kind: "category", categoryId: 1 }), false);
assert.equal(isSameFilter({ kind: "category", categoryId: 1 }, { kind: "category", categoryId: 1 }), true);
assert.equal(isSameFilter({ kind: "uncategorized" }, { kind: "uncategorized" }), true);
console.log("OK  second clic : aucun filtre, catégorie et « Sans catégorie » bien distingués");

// 10. Sans données : aucune ligne
assert.deepEqual(buildChartRows({ categories: [], expenses: [], recurringExpenses: [] }), []);
console.log("OK  sans données : aucune ligne");

console.log("Toutes les vérifications de la fonction du graphique sont passées (hors rendu Chart.js).");
