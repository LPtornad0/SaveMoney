// Vérifie les règles pures de l'édition en ligne (src/utils/inlineEdit.ts et categoryColor.ts).
// Ce script ne teste ni window.confirm, ni le SQL réel, ni le câblage React : ces points se vérifient dans Tauri.
// Usage : node scripts/verify-inline-edit.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

// Charge un module TypeScript de src/utils ; les imports relatifs sont résolus de la même façon.
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

const edit = load("inlineEdit");
const colors = load("categoryColor");
const queueModule = load("deferredDeletions");
const closeModule = load("closeGate");

const categories = [
  { id: 1, name: "Courses", type: "expense" },
  { id: 2, name: "Épargne", type: "expense" },
  { id: 3, name: "Salaire", type: "income" },
];

const baselineIncome = { label: "Salaire", amount: 1500, categoryId: 3, day: null };
const baselineExpense = { label: "Supermarché", amount: 10, categoryId: 1, day: null };
const baselineRecurring = { label: "Loyer", amount: 700, categoryId: 1, day: 5 };
const draftOf = (baseline) => edit.draftFromBaseline(baseline);

// 1. Modifications : comparaison selon le sens des valeurs
{
  assert.equal(edit.isDraftChanged("expense", baselineExpense, draftOf(baselineExpense)), false, "brouillon identique");
  assert.equal(
    edit.isDraftChanged("expense", baselineExpense, { ...draftOf(baselineExpense), label: "  Supermarché  " }),
    false,
    "libellé : les espaces autour ne comptent pas"
  );
  assert.equal(
    edit.isDraftChanged("expense", baselineExpense, { ...draftOf(baselineExpense), label: "Supermarché 2" }),
    true,
    "libellé réellement modifié"
  );
  assert.equal(
    edit.isDraftChanged("expense", baselineExpense, { ...draftOf(baselineExpense), amount: "10.00" }),
    false,
    "10 devient 10.00 : même montant, pas une modification"
  );
  assert.equal(
    edit.isDraftChanged("expense", baselineExpense, { ...draftOf(baselineExpense), amount: "10.5" }),
    true,
    "montant réellement modifié"
  );
  assert.equal(
    edit.isDraftChanged("expense", baselineExpense, { ...draftOf(baselineExpense), amount: "" }),
    true,
    "montant vide : considéré comme une modification (il sera refusé à l'enregistrement)"
  );
  assert.equal(
    edit.isDraftChanged("expense", baselineExpense, { ...draftOf(baselineExpense), categoryId: "" }),
    true,
    "catégorie retirée"
  );
  assert.equal(
    edit.isDraftChanged("income", { ...baselineIncome, categoryId: null }, { ...draftOf(baselineIncome), categoryId: "" }),
    false,
    "catégorie vide et absence de catégorie : identiques"
  );
  assert.equal(
    edit.isDraftChanged("recurring", baselineRecurring, { ...draftOf(baselineRecurring), day: "05" }),
    false,
    "jour : 05 et 5 sont le même entier"
  );
  assert.equal(
    edit.isDraftChanged("recurring", baselineRecurring, { ...draftOf(baselineRecurring), day: "6" }),
    true,
    "jour réellement modifié"
  );
  assert.equal(
    edit.isDraftChanged("recurring", baselineRecurring, { ...draftOf(baselineRecurring), day: "2.5" }),
    true,
    "jour décimal : considéré comme une modification"
  );
  assert.equal(
    edit.isDraftChanged("income", baselineIncome, { ...draftOf(baselineIncome), day: "12" }),
    false,
    "le jour n'existe pas pour un revenu : ignoré"
  );
  console.log("OK  modifications : libellé, montant, catégorie et jour comparés selon leur sens");
}

// 2. Validation commune avec les formulaires d'ajout
{
  const empty = edit.validateDraft("expense", { label: "  ", amount: "5", categoryId: "", day: "" });
  assert.ok("errors" in empty && empty.errors.label, "libellé vide refusé");

  const zero = edit.validateDraft("expense", { label: "x", amount: "0", categoryId: "", day: "" });
  assert.ok("errors" in zero && zero.errors.amount, "montant 0 refusé");

  const badDay = edit.validateDraft("recurring", { label: "x", amount: "5", categoryId: "", day: "32" });
  assert.ok("errors" in badDay && badDay.errors.day, "jour 32 refusé");

  const decimalDay = edit.validateDraft("recurring", { label: "x", amount: "5", categoryId: "", day: "2.5" });
  assert.ok("errors" in decimalDay && decimalDay.errors.day, "jour décimal refusé");

  const ignoredDay = edit.validateDraft("expense", { label: "x", amount: "5", categoryId: "", day: "" });
  assert.ok("values" in ignoredDay, "le jour n'est pas exigé pour une dépense");

  const ok = edit.validateDraft("recurring", { label: " Loyer ", amount: "700", categoryId: "2", day: "5" });
  assert.deepEqual(ok, { values: { label: "Loyer", amount: 700, categoryId: 2, day: 5 } });
  console.log("OK  validation : mêmes règles que les formulaires d'ajout, valeurs normalisées");
}

// 3. UPDATE paramétrés : colonnes existantes uniquement, ni date ni mois
{
  const income = edit.buildUpdate("income", 4, { label: "Prime", amount: 200, categoryId: null, day: null });
  assert.equal(income.sql, "UPDATE incomes SET label = ?, amount = ?, category_id = ? WHERE id = ?");
  assert.deepEqual(income.params, ["Prime", 200, null, 4]);

  const expense = edit.buildUpdate("expense", 7, { label: "Pain", amount: 2, categoryId: 1, day: null });
  assert.equal(expense.sql, "UPDATE expenses SET label = ?, amount = ?, category_id = ? WHERE id = ?");
  assert.deepEqual(expense.params, ["Pain", 2, 1, 7]);

  const recurring = edit.buildUpdate("recurring", 2, { label: "Loyer", amount: 700, categoryId: 1, day: 5 });
  assert.equal(
    recurring.sql,
    "UPDATE recurring_expenses SET label = ?, amount = ?, category_id = ?, day_of_month = ? WHERE id = ?"
  );
  assert.deepEqual(recurring.params, ["Loyer", 700, 1, 5, 2]);

  for (const sql of [income.sql, expense.sql, recurring.sql]) {
    assert.doesNotMatch(sql, /\bdate\b|\bmonth\b/, "date et mois ne sont jamais écrits");
    assert.match(sql, /\?/, "valeurs paramétrées");
  }
  console.log("OK  UPDATE : colonnes existantes, valeurs en paramètres, pas de date ni de mois");
}

// 4. Échec de l'UPDATE contre succès : un succès ne se réessaie pas, un échec garde le brouillon
{
  const values = { label: "Pain", amount: 2, categoryId: null, day: null };
  const calls = [];
  const okOutcome = await edit.submitEdit("expense", 7, values, async (sql, params) => {
    calls.push({ sql, params });
  });
  assert.equal(okOutcome, "saved");
  assert.equal(calls.length, 1, "un seul UPDATE");

  let reported = null;
  const failed = await edit.submitEdit(
    "expense",
    7,
    values,
    async () => {
      throw new Error("base verrouillée");
    },
    (error) => {
      reported = error;
    }
  );
  assert.equal(failed, "failed");
  assert.equal(reported.message, "base verrouillée", "l'erreur SQL est transmise à l'appelant");
  console.log("OK  sauvegarde : succès sans nouvel envoi, échec SQL signalé sans perte du brouillon");
}

// 5. Garde de transition : enregistrement en cours, brouillon inchangé, confirmation
{
  let asked = 0;
  const confirmYes = () => {
    asked += 1;
    return true;
  };
  const confirmNo = () => {
    asked += 1;
    return false;
  };

  assert.equal(edit.requestEditTransition({ dirty: true, saving: true }, confirmYes), "blocked", "enregistrement en cours : bloqué");
  assert.equal(asked, 0, "pendant un enregistrement, la confirmation n'est même pas proposée");

  assert.equal(edit.requestEditTransition({ dirty: false, saving: false }, confirmNo), "proceed", "brouillon inchangé : pas de confirmation");
  assert.equal(asked, 0);

  assert.equal(edit.requestEditTransition({ dirty: true, saving: false }, confirmNo), "blocked", "refus : l'état est conservé");
  assert.equal(asked, 1);

  assert.equal(edit.requestEditTransition({ dirty: true, saving: false }, confirmYes), "proceed", "accord : la transition a lieu");
  assert.equal(asked, 2, "une seule question par transition");
  console.log("OK  transitions : blocage pendant l'enregistrement, pas de question sans changement, refus conservé");
}

// 6. Double envoi : runGuarded et createSaveGuard sont les fonctions utilisées par handleEditSubmit du Dashboard
{
  const guard = edit.createSaveGuard();
  let writes = 0;
  let release;
  const work = () =>
    new Promise((resolve) => {
      release = resolve;
    }).then(() => {
      writes += 1;
      return "saved";
    });
  const first = edit.runGuarded(guard, work);
  assert.equal(guard.isSaving(), true, "pendant le premier envoi, la garde est active");
  const second = await edit.runGuarded(guard, work);
  assert.equal(second, "skipped", "le second envoi est ignoré");
  release();
  assert.equal(await first, "saved");
  assert.equal(writes, 1, "un seul enregistrement");
  assert.equal(guard.isSaving(), false, "garde libérée après succès");

  const failure = await edit.runGuarded(guard, async () => {
    throw new Error("base verrouillée");
  }).catch((error) => error.message);
  assert.equal(failure, "base verrouillée", "l'erreur de travail remonte");
  assert.equal(guard.isSaving(), false, "garde libérée après échec");
  console.log("OK  double envoi : runGuarded refuse le second envoi, libère la garde après succès ou échec");
}

// 11. Fermeture : refus sans finalisation ; suppression déjà en attente = minuteur normal, pas finalisation forcée
{
  const { DeferredDeletionQueue } = queueModule;
  const { createCloseGate, createEditAwareClose } = closeModule;
  const timers = [];
  const executed = [];
  let flushes = 0;
  let closed = 0;
  let discarded = 0;
  let prevented = 0;
  let saveNotices = 0;
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
      executed.push(`${type}-${id}`);
    },
    onChange: () => {},
    onSuccess: () => {},
    onFailure: () => {},
  });
  const gate = createCloseGate({
    hasPending: () => queue.hasPending(),
    flush: async () => {
      flushes += 1;
      const outcomes = await queue.flushAll();
      return { failed: outcomes.filter((outcome) => !outcome.ok).length };
    },
    close: async () => {
      closed += 1;
    },
    onBlocked: () => {},
  });
  const event = () => ({
    preventDefault: () => {
      prevented += 1;
    },
  });
  const makeClose = (state) =>
    createEditAwareClose({
      isSaving: () => state.saving,
      isDirty: () => state.dirty,
      confirmDiscard: () => state.confirm,
      onSaving: () => {
        saveNotices += 1;
      },
      discardEdit: () => {
        discarded += 1;
      },
      gate,
    });

  queue.schedule(1, "income");

  // Refus : aucune finalisation, aucune fermeture, aucun abandon
  await makeClose({ saving: false, dirty: true, confirm: false })(event());
  assert.equal(prevented, 1, "la fermeture est empêchée");
  assert.equal(flushes, 0, "flushAll n'est pas appelé après un refus");
  assert.equal(closed, 0);
  assert.equal(discarded, 0, "le brouillon reste");

  // Le minuteur normal de la suppression en attente continue et exécute le DELETE une seule fois
  assert.equal(timers.length, 1);
  timers[0].run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(executed, ["income-1"], "exécution par le minuteur, pas par une finalisation forcée");
  assert.equal(flushes, 0);

  // Enregistrement en cours : refus avec message, aucune finalisation
  queue.schedule(2, "expense");
  await makeClose({ saving: true, dirty: true, confirm: true })(event());
  assert.equal(saveNotices, 1);
  assert.equal(flushes, 0, "pendant un enregistrement, aucune finalisation");

  // Accord : abandon du brouillon puis finalisation (une seule fois) et fermeture
  await makeClose({ saving: false, dirty: true, confirm: true })(event());
  assert.equal(discarded, 1);
  assert.equal(flushes, 1, "finalisation forcée après accord");
  assert.equal(closed, 1);
  assert.deepEqual(executed, ["income-1", "expense-2"]);
  console.log("OK  fermeture : refus sans flushAll, minuteur normal conservé, accord puis finalisation unique");
}

// 7. Sortie du filtre et passage en épargne
{
  const categoryFilter = { kind: "category", categoryId: 1 };
  assert.equal(edit.outsideFilter(1, null, categories), false, "sans filtre, rien ne sort");
  assert.equal(edit.outsideFilter(1, categoryFilter, categories), false, "même catégorie : reste dans le filtre");
  assert.equal(edit.outsideFilter(2, categoryFilter, categories), true, "autre catégorie : sort du filtre");
  assert.equal(edit.outsideFilter(null, categoryFilter, categories), true, "sans catégorie : sort du filtre");
  assert.equal(
    edit.outsideFilter(null, { kind: "uncategorized" }, categories),
    false,
    "filtre « Sans catégorie » : une opération sans catégorie y reste"
  );
  assert.equal(
    edit.outsideFilter(1, { kind: "uncategorized" }, categories),
    true,
    "filtre « Sans catégorie » : une opération catégorisée en sort"
  );

  assert.equal(edit.movesToSavings("expense", 2, categories), true, "dépense vers Épargne : sort du graphique");
  assert.equal(edit.movesToSavings("recurring", 2, categories), true, "charge fixe vers Épargne : sort du graphique");
  assert.equal(edit.movesToSavings("expense", 1, categories), false, "dépense hors épargne");
  assert.equal(edit.movesToSavings("expense", null, categories), false, "sans catégorie");
  assert.equal(edit.movesToSavings("income", 3, categories), false, "revenu : pas concerné");
  console.log("OK  filtre et épargne : sortie du filtre et passage en épargne détectés");
}

// 8. Messages après enregistrement
{
  assert.match(edit.editSuccessMessage(true, false), /filtre actif/);
  assert.match(edit.editSuccessMessage(false, true), /épargne/);
  assert.equal(edit.editSuccessMessage(false, false), "Opération modifiée avec succès");
  console.log("OK  messages : filtre, épargne, cas courant");
}

// 9. Pastilles : palette stable, neutre sans catégorie
{
  const many = Array.from({ length: colors.CATEGORY_PALETTE.length }, (_, i) => ({
    id: i + 1,
    name: `Catégorie ${i + 1}`,
    type: "expense",
  }));
  const first = colors.categoryDotColor(4, many);
  const again = colors.categoryDotColor(4, [...many].reverse());
  assert.equal(first, again, "même identifiant, même couleur, quel que soit l'ordre des catégories");
  assert.ok(colors.CATEGORY_PALETTE.includes(first), "couleur issue de la palette");
  assert.equal(colors.categoryDotColor(null, many), null, "sans catégorie : neutre");
  assert.equal(colors.categoryDotColor(99, many), null, "catégorie inconnue : neutre");
  const seen = new Set(many.map((cat) => colors.categoryDotColor(cat.id, many)));
  assert.equal(seen.size, colors.CATEGORY_PALETTE.length, "les identifiants 1 à 8 ont des couleurs distinctes");
  console.log("OK  pastilles : couleur stable à partir de l'identifiant, neutre sans catégorie");
}

// 10. Clés et identifiants
{
  assert.equal(edit.editKey("income", 4), "income-4");
  assert.equal(edit.editKey("recurring", 2), "recurring-2");
  assert.equal(edit.editButtonId("expense-7"), "edit-expense-7");
  console.log("OK  clés : identiques à celles de la liste d'opérations");
}

console.log("Toutes les vérifications de l'édition en ligne (règles pures) sont passées.");
