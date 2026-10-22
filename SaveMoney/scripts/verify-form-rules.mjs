// Vérifie les règles de validation des formulaires (montants, jour, date).
// Usage : node scripts/verify-form-rules.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "utils", "formValidation.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
new Function("module", "exports", outputText)(moduleObject, moduleObject.exports);
const { parseAmount, parseDayOfMonth, isValidCalendarDate, monthOfDate } = moduleObject.exports;

// Montants : positifs et finis uniquement
for (const value of ["", "   ", "0", "-5", "abc", "NaN", "Infinity"]) {
  assert.equal(parseAmount(value), null, `parseAmount(${JSON.stringify(value)}) doit être rejeté`);
}
assert.equal(parseAmount("12.5"), 12.5);
assert.equal(parseAmount("1500"), 1500);
console.log("OK  montants : vides, nuls, négatifs, non numériques et infinis rejetés");

// Jour de charge fixe : entier entre 1 et 31
for (const value of ["", " ", "0", "32", "2.5", "2,5", "1e1", "-1", "abc", "+5"]) {
  assert.equal(parseDayOfMonth(value), null, `parseDayOfMonth(${JSON.stringify(value)}) doit être rejeté`);
}
assert.equal(parseDayOfMonth("1"), 1);
assert.equal(parseDayOfMonth("31"), 31);
assert.equal(parseDayOfMonth(" 5 "), 5);
console.log("OK  jour : hors bornes, décimaux et formats non entiers rejetés");

// Date : obligatoire et calendaire valide
for (const value of ["", "2026-1-1", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-22T00:00"]) {
  assert.equal(isValidCalendarDate(value), false, `isValidCalendarDate(${JSON.stringify(value)}) doit être rejeté`);
}
assert.equal(isValidCalendarDate("2024-02-29"), true, "29 février d'une année bissextile");
assert.equal(isValidCalendarDate("2026-10-31"), true);
console.log("OK  date : vide, format incorrect et dates inexistantes rejetées");

// Mois d'enregistrement : dérivé de la date
assert.equal(monthOfDate("2026-10-22"), "2026-10");
assert.equal(monthOfDate("2027-01-01"), "2027-01");
console.log("OK  mois : dérivé de la date saisie");

console.log("Toutes les règles de formulaire sont vérifiées.");
