// Vérifie les options du sélecteur clavier de catégorie (src/utils/categoryFilterOptions.ts).
// Le filtrage reste dans chartRows.ts : ce test vérifie que le sélecteur produit les mêmes filtres que les lignes du graphique.
// Le câblage (changeFilter, gardes, confirmation, réinitialisation après changement de mois) n'est pas exécuté ici : il se vérifie dans Tauri.
// Usage : node scripts/verify-category-filter.mjs
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

const options = load("categoryFilterOptions");
const chart = load("chartRows");

const categories = [
  { id: 1, name: "Courses", type: "expense" },
  { id: 2, name: "Épargne", type: "expense" },
  { id: 3, name: "Transport", type: "expense" },
  { id: 4, name: "Revenu", type: "income" },
];
// Courses : 10 €, une dépense sans catégorie : 5 €, Transport : 0 € (masqué), Épargne exclue du graphique
const rows = chart.buildChartRows({
  categories,
  expenses: [
    { amount: 10, category_id: 1 },
    { amount: 5, category_id: null },
  ],
  recurringExpenses: [],
});

// 1. Encodage : allers-retours, valeurs inconnues refusées
assert.equal(options.filterToValue(null), "", "aucun filtre : valeur vide");
assert.equal(options.filterToValue({ kind: "uncategorized" }), "uncategorized");
assert.equal(options.filterToValue({ kind: "category", categoryId: 4 }), "category:4");
assert.equal(options.valueToFilter(""), null, "valeur vide : aucun filtre");
assert.deepEqual(options.valueToFilter("uncategorized"), { kind: "uncategorized" });
assert.deepEqual(options.valueToFilter("category:4"), { kind: "category", categoryId: 4 });
for (const value of ["category:abc", "category:0", "category:-1", "category:1.5", "autre", "all"]) {
  assert.equal(options.valueToFilter(value), undefined, `valeur ${JSON.stringify(value)} refusée`);
}
console.log("OK  encodage : allers-retours, valeurs inconnues refusées");

// 2. Options : « Toutes » puis les lignes du graphique, « Sans catégorie » seulement si elle est représentée
{
  const list = options.buildFilterOptions(rows, null, "");
  assert.deepEqual(
    list.map((o) => o.label),
    ["Toutes les catégories", "Courses", "Sans catégorie"],
    "Épargne et catégories à total nul absentes ; « Sans catégorie » présente"
  );
  assert.equal(list[0].value, "");
  console.log("OK  options : toutes les catégories, lignes du graphique, « Sans catégorie » seulement si représentée");
}

{
  const withoutUncategorized = chart.buildChartRows({
    categories,
    expenses: [{ amount: 10, category_id: 1 }],
    recurringExpenses: [],
  });
  const list = options.buildFilterOptions(withoutUncategorized, null, "");
  assert.equal(list.some((o) => o.label === "Sans catégorie"), false, "pas d'option « Sans catégorie » sans ligne correspondante");
  console.log("OK  options : pas de « Sans catégorie » quand le graphique n'en contient pas");
}

// 3. Chaque option décode vers le même filtre que la ligne du graphique qu'elle représente
{
  for (const row of rows) {
    const option = options.buildFilterOptions(rows, null, "").find((o) => o.label === row.label);
    assert.ok(option, `option présente pour ${row.label}`);
    assert.deepEqual(options.valueToFilter(option.value), row.filter, `${row.label} : même filtre que la barre`);
  }
  console.log("OK  correspondance : chaque option décode vers le filtre de sa barre");
}

// 4. Filtre actif hors graphique : option ajoutée, pour qu'il reste visible et retirable
{
  const gone = { kind: "category", categoryId: 3 }; // Transport : total nul, absent du graphique
  const list = options.buildFilterOptions(rows, gone, "Transport");
  const last = list[list.length - 1];
  assert.equal(last.value, "category:3");
  assert.equal(last.label, "Transport (absente du graphique)");
  assert.equal(list.filter((o) => o.value === "category:3").length, 1, "pas de doublon");
  console.log("OK  filtre actif absent du graphique : option ajoutée et sélectionnable");
}

// 5. Filtre actif présent : aucune option en double, sélection reconnue comme inchangée
{
  const active = { kind: "category", categoryId: 1 };
  const list = options.buildFilterOptions(rows, active, "Courses");
  assert.equal(list.filter((o) => o.value === "category:1").length, 1);
  assert.equal(list.some((o) => o.label.includes("absente")), false);
  assert.equal(chart.isSameFilter(active, options.valueToFilter("category:1")), true, "même valeur : pas de changement");
  assert.equal(chart.isSameFilter(null, options.valueToFilter("category:1")), false);
  console.log("OK  filtre actif présent : option unique, comparaison identique à celle du clic");
}

// 6. Libellés : même libellé pour la puce et le sélecteur
{
  assert.equal(options.filterLabel({ kind: "uncategorized" }, categories), "Sans catégorie");
  assert.equal(options.filterLabel({ kind: "category", categoryId: 1 }, categories), "Courses");
  assert.equal(options.filterLabel({ kind: "category", categoryId: 99 }, categories), "Catégorie");
  console.log("OK  libellés : catégorie, « Sans catégorie », catégorie inconnue");
}

console.log("Toutes les vérifications du sélecteur de catégorie (fonctions pures) sont passées.");
