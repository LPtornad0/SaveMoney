// Vérifie le calcul des flèches de mois (src/utils/monthNavigation.ts).
// Le câblage des boutons et l'appel à requestMonthChange ne sont pas testés ici : ils se vérifient dans Tauri.
// Usage : node scripts/verify-month-navigation.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "utils", "monthNavigation.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
new Function("module", "exports", outputText)(moduleObject, moduleObject.exports);
const { addMonths } = moduleObject.exports;

// Passages d'année, dans les deux sens
assert.equal(addMonths("2026-12", 1), "2027-01", "décembre vers janvier, année suivante");
assert.equal(addMonths("2027-01", -1), "2026-12", "janvier vers décembre, année précédente");
assert.equal(addMonths("2026-01", -1), "2025-12");
assert.equal(addMonths("2026-11", 2), "2027-01", "deux mois de plus, passage d'année");
assert.equal(addMonths("2026-03", -2), "2026-01");
console.log("OK  passages décembre/janvier et janvier/décembre");

// Décalages entiers et neutre
assert.equal(addMonths("2026-08", 0), "2026-08", "décalage nul : même mois");
assert.equal(addMonths("2026-08", 12), "2027-08", "un an de plus");
assert.equal(addMonths("2026-08", -13), "2025-07", "décalage négatif supérieur à un an");
console.log("OK  décalages : nul, un an, plus d'un an");

// Format conservé : YYYY-MM, avec zéros de remplissage
assert.equal(addMonths("0999-12", 1), "1000-01", "année sur quatre chiffres");
assert.equal(addMonths("2026-09", 1), "2026-10", "mois à deux chiffres");
assert.equal(addMonths("2026-01", 1), "2026-02", "zéro de remplissage conservé");
for (const value of [addMonths("2026-12", 1), addMonths("2026-01", -1), addMonths("2026-08", 5)]) {
  assert.match(value, /^\d{4}-\d{2}$/, `format YYYY-MM pour ${value}`);
}
console.log("OK  format YYYY-MM conservé");

// Entrées invalides : rien n'est calculé
for (const value of ["", "2026-13", "2026-00", "2026-1", "26-01", "2026-08-01", "2026/08", "abc"]) {
  assert.equal(addMonths(value, 1), null, `entrée invalide ${JSON.stringify(value)} refusée`);
}
assert.equal(addMonths("2026-08", 1.5), null, "décalage non entier refusé");
console.log("OK  entrées invalides refusées");

console.log("Toutes les vérifications de navigation entre les mois sont passées (fonction pure).");
