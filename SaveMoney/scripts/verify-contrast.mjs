// Contrôle des contrastes des couleurs déclarées dans le projet (src/App.css, src/utils/categoryColor.ts,
// couleurs inline de src/pages/Dashboard.tsx).
// Ce script ne rend rien : il calcule les ratios WCAG à partir des valeurs écrites dans le code.
// Il ne remplace ni Lighthouse, ni axe, ni un contrôle à l'écran. Les limites sont affichées à la fin.
// Usage : node scripts/verify-contrast.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "src", "App.css"), "utf8");
const dashboard = readFileSync(path.join(root, "src", "pages", "Dashboard.tsx"), "utf8");
const palette = readFileSync(path.join(root, "src", "utils", "categoryColor.ts"), "utf8");

// Tokens de la première règle :root (le bloc de thème sombre reprend les mêmes valeurs)
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const tokens = Object.fromEntries(
  [...rootBlock.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2].toUpperCase()])
);

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// filter: brightness(f) du navigateur : chaque canal est multiplié, plafonné à 255 (texte et fond sont touchés)
function brightness(hex, factor) {
  return "#" + [1, 3, 5]
    .map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const resolve = (name) => {
  if (name.startsWith("#")) return name.toUpperCase();
  const value = tokens[name];
  if (!value) throw new Error(`token absent de App.css : ${name}`);
  return value;
};

let failures = 0;
function measure(label, fgHex, bgHex, min, kind) {
  const value = ratio(fgHex, bgHex);
  const ok = value >= min;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "OK   " : "ECHEC"} ${value.toFixed(2).padStart(5)}:1 (min ${min}:1) ${kind.padEnd(8)} ${label} [${fgHex} sur ${bgHex}]`
  );
}

// 1. Couleurs de base (texte 4,5:1 ; éléments non textuels 3:1)
const base = [
  ["text-primary", "surface-card", 4.5, "texte principal sur carte"],
  ["text-primary", "surface-background", 4.5, "texte principal sur fond"],
  ["text-secondary", "surface-card", 4.5, "texte secondaire sur carte"],
  ["text-secondary", "surface-background", 4.5, "texte secondaire sur fond"],
  ["color-expense", "surface-card", 4.5, "message d'erreur sur carte"],
  ["color-expense", "surface-background", 4.5, "message d'erreur sur fond"],
  ["color-income", "surface-card", 4.5, "lien ou texte bleu sur carte"],
  ["color-income", "surface-background", 4.5, "lien ou texte bleu sur fond"],
  ["on-color", "color-income", 4.5, "texte sur bleu : bouton principal, badge revenu, toast de succès, puce de filtre"],
  ["on-color", "color-expense", 4.5, "texte sur rouge : badge dépense, toast d'erreur"],
  ["on-color", "color-recurring", 4.5, "texte sur ambre : badge charge fixe, carte Charges fixes"],
  ["on-color", "color-available", 4.5, "texte sur vert : carte Disponible"],
  ["on-color", "color-savings", 4.5, "texte sur turquoise : carte Épargne"],
  ["control-border", "surface-card", 3, "bordure des champs (non textuel)"],
  ["color-income", "surface-card", 3, "anneau de focus sur carte (non textuel)"],
  ["color-income", "surface-background", 3, "anneau de focus sur fond (non textuel)"],
];
console.log("-- Couleurs de base");
for (const [fg, bg, min, label] of base) {
  measure(label, resolve(fg), resolve(bg), min, min === 3 ? "non-text" : "texte");
}

// 2. Survols : valeurs réellement appliquées dans App.css
console.log("-- Survols");
// btn-primary:hover applique filter: brightness(1.08) à tout l'élément (fond et texte)
measure(
  "bouton principal survolé (brightness 1.08 sur fond et texte)",
  brightness(resolve("on-color"), 1.08),
  brightness(resolve("color-income"), 1.08),
  4.5,
  "texte"
);
// ops-delete:hover : fond rouge plein, texte on-color
measure("bouton de suppression survolé (fond rouge, texte sombre)", resolve("on-color"), resolve("color-expense"), 4.5, "texte");
// ops-edit, btn-ghost, filter-remove, month-nav-btn survolés : texte principal sur carte
measure("boutons Modifier, Annuler, × de filtre, ‹ › survolés (texte principal)", resolve("text-primary"), resolve("surface-card"), 4.5, "texte");
// Bordure de month-nav-btn survolée : couleur texte secondaire sur carte
measure("bordure des boutons ‹ › survolés", resolve("text-secondary"), resolve("surface-card"), 3, "non-text");

// 3. Pastilles de catégorie : couleurs de la palette lues dans categoryColor.ts
console.log("-- Pastilles (couleurs de la palette, sur carte)");
const paletteBlock = palette.slice(palette.indexOf("CATEGORY_PALETTE"), palette.indexOf("] as const"));
const dotColors = [...paletteBlock.matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
if (dotColors.length !== 8) throw new Error(`palette : ${dotColors.length} couleurs lues, 8 attendues`);
for (const color of dotColors) {
  measure(`pastille ${color}`, color, resolve("surface-card"), 3, "non-text");
}
measure("anneau de la pastille « Sans catégorie »", resolve("text-secondary"), resolve("surface-card"), 3, "non-text");

// 4. Couleurs littérales encore présentes dans Dashboard.tsx (chargement et erreur de chargement, fond de page)
console.log("-- Couleurs littérales du Dashboard");
measure("texte « Chargement... » (white)", "#FFFFFF", resolve("surface-background"), 4.5, "texte");
measure("message d'erreur de chargement (#fca5a5)", "#FCA5A5", resolve("surface-background"), 4.5, "texte");

// 5. Contrôle statique : aucune couleur inline ne doit annuler les corrections des classes concernées
console.log("-- Couleurs inline (contrôle statique)");
const corrected = ["btn-primary", "ops-kind", "ops-delete", "toast", "toast-action", "filter-remove", "month-nav-btn", "ops-edit", "btn-ghost", "chart-filter"];
const lines = dashboard.split("\n");
let overrides = 0;
lines.forEach((line, index) => {
  if (!corrected.some((cls) => line.includes(`className="${cls}"`) || line.includes(`className={\`${cls}`))) return;
  const window = lines.slice(index, index + 4).join("\n");
  if (/style=\{\{[^}]*\bcolor:/.test(window)) {
    overrides += 1;
    console.log(`ECHEC  couleur inline proche de la classe corrigée, ligne ${index + 1}`);
  }
});
if (overrides > 0) failures += overrides;
const inlineColors = [...dashboard.matchAll(/(?<![\w-])color: ['"]([^'"]+)['"]/g)].map((m) => m[1]);
const distinct = [...new Set(inlineColors)];
console.log(`OK     aucune couleur inline sur les classes corrigées (${corrected.length} classes examinées)`);
console.log(`       couleurs inline distinctes dans Dashboard.tsx : ${distinct.join(", ")}`);

// Limites : ce qui n'est pas mesuré ici
console.log("-- Non mesuré (limites)");
const placeholderRule = /::placeholder|:placeholder/.test(css);
console.log(
  placeholderRule
    ? "LIMITE placeholder : une règle ::placeholder existe, non mesurée ici"
    : "LIMITE placeholder : aucune couleur de placeholder définie dans le projet ; le style natif du navigateur n'est pas mesuré"
);
console.log("LIMITE états désactivés (opacity 0,5 ou 0,6) : exemptés du seuil WCAG, non mesurés comme contraste");
console.log("LIMITE styles natifs des <select> et des <input type=\"date\"|\"month\"> : non mesurés");
console.log("LIMITE rendu réel : aucun contrôle à l'écran, aucun Lighthouse, aucun axe n'a été exécuté");

if (failures > 0) {
  console.log(`${failures} contraste(s) ou contrôle(s) insuffisant(s).`);
  process.exit(1);
}
console.log("Toutes les mesures calculées à partir du code atteignent leur seuil.");
