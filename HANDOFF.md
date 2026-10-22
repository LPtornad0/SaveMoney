# HANDOFF — SaveMoney, refonte UX/UI (branche `ui-refonte`)

Ce fichier décrit l'état opérationnel de la session. Le plan et les décisions durables sont dans `PLAN.md`.
Chemins relatifs à la racine du dépôt git, sauf mention contraire.

## 1. Projet et architecture

**Stack** : React 19 + TypeScript, Vite, hooks, Chart.js + react-chartjs-2, CSS (`App.css`), Tauri v2 (Rust), SQLite via `@tauri-apps/plugin-sql`.

**Chemins**
- Racine du dépôt git : `.` (contient le dossier `SaveMoney/` et `node_modules/` suivi par git).
- Application (là où se lancent `npm` et `tauri`) : `SaveMoney/`.
- Dans l'application : `src/`, `src-tauri/`, `scripts/`, `package.json`, `vite.config.ts`.
- Un `package.json` et un `package-lock.json` existent aussi à la racine du dépôt. Ils ne sont pas utilisés pour les commandes. Leur rôle reste à clarifier.

**Fichiers principaux** (dans `SaveMoney/src/`)
- `pages/Dashboard.tsx` : page unique. KPI, graphique, « Opérations du mois » et « Charges fixes actives » (avec édition en ligne), objectifs, dettes, formulaires, toasts, suppression différée, filtre au clic, garde de fermeture.
- `components/OperationEditForm.tsx` : formulaire d'édition d'une ligne.
- `hooks/useMonthlyBudget.ts` : chargement du mois affiché, ignore les réponses obsolètes (`runLatest`).
- `hooks/useGoals.ts`, `hooks/useDebts.ts` : objectifs et dettes (partiels, voir section 7).
- `db/client.ts` : connexion SQLite et schéma (`initSchema`, en TypeScript, pas de migrations Rust).
- `types/budget.ts` : types métier.
- `utils/computeSummary.ts` : calcul pur des totaux, `summarizeMonth`, `isSavingsCategory`.
- `utils/monthBudget.ts` : requêtes et calculs du mois (`fetchMonthBudget`).
- `utils/requestGate.ts` : `createRequestGate` et `runLatest`.
- `utils/formValidation.ts` : règles pures et messages partagés (ajout et édition).
- `utils/chartRows.ts` : lignes du graphique, filtre à trois états.
- `utils/operations.ts` : tri des opérations et des charges fixes, format de date.
- `utils/categoryColor.ts` : couleur stable des pastilles, calculée à partir de l'identifiant.
- `utils/inlineEdit.ts` : règles de l'édition (comparaison, validation, UPDATE paramétrés, transitions, garde de sauvegarde `createSaveGuard` / `runGuarded`).
- `utils/deferredDeletions.ts` : file de suppressions différées (`DeferredDeletionQueue`).
- `utils/closeGate.ts` : décision de fermeture (`createCloseGate`, et `createEditAwareClose` qui vérifie le brouillon d'abord).
- `utils/formatEUR.ts` : formatage en euros.
- `App.css` : tokens de thème et classes de mise en page, formulaires, opérations, boutons.
- `src-tauri/capabilities/default.json` : permissions Tauri, dont `core:window:allow-close`.
- `vite.config.ts` : filtre `watch.ignored` pour `src-tauri` et `target`.

## 2. Règles de travail

- Travailler **phase par phase**, dans l'ordre. En fin de lot : vérifier, présenter le diff, proposer le message de commit, **attendre la validation** avant tout commit.
- Branche : `ui-refonte`.
- **Pas de push sans autorisation explicite**, à chaque fois. Une autorisation de commit ne vaut pas autorisation de push.
- **Aucune nouvelle dépendance** sans demande préalable.
- **Aucune modification du schéma SQLite** ni des calculs financiers sans accord explicite.
- Préserver les modifications locales et ne pas toucher à `node_modules` (ni nettoyage, ni suppression de fichiers non suivis sans accord).
- Commits : indexer explicitement les fichiers du lot (jamais `git add .` ni `-A`). Vérifier le diff indexé.
- Ne pas déclarer une validation fonctionnelle à partir de tests automatisés seuls. Ne pas déclarer validés des scénarios d'erreur simulés non testés dans Tauri.
- Une demande de **proposition** n'est pas une autorisation de coder : attendre l'accord explicite.

## 3. Source de référence

- `PLAN.md` (racine du dépôt) : plan par phases, décisions durables, statuts.
- `HANDOFF.md` (ce fichier) : état opérationnel. Suivi par git depuis le commit documentaire `docs(plan)`.

## 4. Travail réalisé

**Commits** (chronologique)
- `c91b35b` : tokens CSS, cartes KPI, disponible, variations, graphique et layout initiaux (phases 1 et 2 regroupées).
- `7075716` : détection des catégories d'épargne.
- `6e11674` : calcul mensuel unifié, correction du double comptage de l'épargne dans le mois précédent.
- `ca711ec` : premier commit de la phase 5, antérieur au périmètre validé (remplacé par `bc839ac`).
- `bc839ac` : formulaires Revenu, Dépense, Charge fixe (labels, validation, feedback, date des dépenses, « Jour du mois »).
- `e9ac9f8` : suppression différée avec annulation.
- `8a7dde4` : finalisation des suppressions avant changement de mois et fermeture (permission `core:window:allow-close`).
- `2432581` : `vite.config.ts`, exclusion de `src-tauri` et `target` de la surveillance.
- `74d838a` : phase 3, graphique trié, valeurs, infobulles, filtre au clic, « Sans catégorie ».
- `9dc0948` : phase 4, graphique pleine largeur et deux cartes côte à côte.
- `4379315` : `PLAN.md` mis à jour (documentaire seul).
- `f148113` : correction du chargement mensuel (réponses obsolètes ignorées).
- `119a4e5` : phase 6, édition en ligne, pastilles de catégorie, boutons `.ops-delete`, états vides. Validée manuellement dans Tauri par l'utilisateur.
- Commit documentaire `docs(plan)` : documente la phase 6 et actualise la reprise (son identifiant figure dans `git log`).

**Par phase**
- **Phase 1** : réalisée (tokens, typographie, `formatEUR`, `max-width`). Styles inline encore présents dans le Dashboard.
- **Phase 2** : réalisée (`computeSummary`, cartes KPI, variations, infobulle, icônes).
- **Phase 3** : réalisée et validée manuellement dans Tauri (`74d838a`).
- **Phase 4** : réalisée et validée visuellement dans Tauri (`9dc0948`).
- **Phase 5** : périmètre validé pour Revenu, Dépense, Charge fixe (`bc839ac`). Fusion des formulaires **écartée**. Catégorie des revenus **conservée**.
- **Phase 6** : réalisée et validée manuellement dans Tauri (`e9ac9f8`, `8a7dde4`, `9dc0948`, `119a4e5`), sur le périmètre décrit dans `PLAN.md`. Scénarios d'erreur SQL et de fermeture simulée **non testés dans Tauri**, non déclarés validés.
- **Phase 7** : **non commencée**. Non autorisée pour l'instant.
- **Phase 8** : non commencée, sauf les objectifs partiels (voir section 7).

## 5. Décisions produit à préserver

- **Disposition** : graphique pleine largeur, puis deux cartes côte à côte, défilement indépendant, repli vertical sous 900 px. Les formulaires sont sous cette zone.
- **Formulaires** : Revenu, Dépense, Charge fixe séparés. Fusion écartée.
- **Catégorie des revenus** : conservée volontairement.
- **Graphique** : dépenses ponctuelles + charges fixes, hors épargne, lignes à total strictement positif, tri décroissant, ligne « Sans catégorie ».
- **Filtre au clic** : trois états (aucun, catégorie par identifiant, sans catégorie). Réinitialisé uniquement après un changement de mois réussi.
- **Suppression** : différée 5 s avec « Annuler ». Finalisation forcée avant un changement de mois et avant la fermeture normale. Un refus de fermeture ne lance pas la finalisation forcée ; le minuteur normal d'une suppression en attente continue.
- **Changement de mois** : centralisé dans `requestMonthChange`, y compris pour une dépense datée d'un autre mois.
- **Édition en ligne** : une ligne à la fois ; libellé, montant, catégorie (et jour pour les charges fixes) ; dates et mois non modifiables ; objectifs et dettes exclus. Confirmation avant abandon d'un brouillon réellement modifié. Transitions bloquées pendant un enregistrement. Succès jamais renvoyé ; erreur SQL affichée sur la ligne.
- **Épargne** : « Épargne » proposée pour les dépenses et les charges fixes, pas pour les revenus. Classification existante (`summarizeMonth`, `isSavingsCategory`), sans nouvelle règle.
- **Pastilles** : palette calculée à partir de l'identifiant, rien n'est écrit en base. « Sans catégorie » en anneau neutre.
- **Format du mois** : le code utilise `YYYY-MM` (sélecteur `input type="month"`, `currentMonth()`, `getPreviousMonth`). Ce format ne doit pas être changé pour reproduire une notation du plan initial.

## 6. Vérifications

**Commandes** (depuis `SaveMoney/`)
```
node scripts/verify-summary.mjs            # 3 cas
node scripts/verify-form-rules.mjs         # 4 groupes
node scripts/verify-deferred-deletions.mjs # 12 cas
node scripts/verify-close-gate.mjs         # 9 cas
node scripts/verify-chart-rows.mjs         # 10 cas
node scripts/verify-operations.mjs         # 6 cas
node scripts/verify-month-load.mjs         # 8 cas
node scripts/verify-inline-edit.mjs        # 11 groupes
npx tsc --noEmit
npm run build
npm run tauri dev                          # lancement Tauri, à lancer manuellement
```
Dernière exécution avant le commit `119a4e5` : les huit scripts passent, `tsc` et `build` ont le code 0.

**Tests automatisés** : fonctions pures et logique extraite (file de suppressions, garde de fermeture, `runLatest` et `fetchMonthBudget`, règles de formulaire, règles d'édition, garde de sauvegarde, lignes du graphique, tri, pastilles). **Ils n'exécutent pas le composant React, ni les effets de hooks, ni le rendu Chart.js, ni `window.confirm`, ni le SQL réel, ni la fenêtre Tauri.**

**Tests manuels rapportés par l'utilisateur dans Tauri, passés**
- Phase 3 : tri, montants, valeurs sur les barres, clic et second clic, ligne « Sans catégorie », réinitialisation après changement de mois.
- Phase 4 : disposition validée visuellement.
- Phase 5 : formulaires Revenu, Dépense, Charge fixe.
- Suppression différée, annulation, finalisation avant changement de mois et fermeture (scénarios sans erreur simulée).
- Chargement mensuel : quatre scénarios.
- Phase 6 (`119a4e5`) : édition et sauvegarde, double envoi, conservation du brouillon après suppression d'une autre ligne, refus d'abandon au changement de mois et à la fermeture, sortie du filtre après sauvegarde, validation des champs, pastilles, états vides et boutons.

**Scénarios non testés dans Tauri** (ne pas les déclarer validés)
- Erreur SQL simulée pendant une suppression, un ajout, une bascule ou une édition.
- Erreur de fermeture simulée (permission refusée ou équivalente).
- Réponse de rechargement en erreur après un `UPDATE` réussi.

## 7. Points techniques ouverts

- **Perte de focus et démontage temporaire pendant un rechargement** : après une suppression ou un ajout, le Dashboard affiche « Chargement... », ce qui démonte le formulaire d'édition. Le brouillon est conservé dans l'état et les champs le restituent, mais le focus est perdu et une frappe pendant la fenêtre de chargement est perdue. Limite connue, **non corrigée** ; à ne pas traiter sans accord.
- **Version `@tauri-apps/api`** : `package.json` demande `2.11.5`, `node_modules` installe `2.11.1`. Décision à prendre.
- **Règle date/mois des revenus** : un revenu est enregistré avec la date du jour, dans le mois affiché. Règle inchangée, à discuter.
- **Objectifs d'épargne** : création, barre et pourcentage affichés. Aucune interface ne modifie `current_amount` ni ne modifie ou supprime un objectif : la jauge reste à 0 %.
- **Dettes** : liste et ajout. La barre est fixe à 100 %, faute de remboursements enregistrés.
- **Formulaires Objectifs et Dettes** : en lecture DOM, sans messages d'erreur reliés aux champs. Hors périmètre validé.
- **Phase 7** : non commencée (navigation de mois par flèches, états `:hover`/`:focus-visible`/`:disabled` partiels, navigation clavier et contrastes non audités).
- **Édition en ligne** : pas de touche Échap pour annuler ; une catégorie stockée qui n'existe plus apparaît sous le libellé « Catégorie introuvable ».
- **Chargement mensuel** : les requêtes ne sont pas annulées, leurs résultats obsolètes sont ignorés.
- **Dépôt git** : `node_modules` est suivi par git à la racine du dépôt (environ 2 700 fichiers). Une copie accidentelle antérieure a laissé des entrées non suivies sous `node_modules/` (`.vite/deps/`, sous-dossiers de `@tauri-apps`), non supprimées sur demande. Intervention distincte, après accord.

## 8. Prochaine étape

**Phase 6 validée** (commit `119a4e5`), documentation commitée (`docs(plan)`). Aucune tâche autorisée pour l'instant.

- Push des commits locaux sur `origin/ui-refonte` : **non autorisé** à ce stade, à autoriser séparément.
- Phase 7 : **non autorisée**.
- Correction de la perte de focus pendant le rechargement : **non autorisée**.

## 9. Reprise

La première action de la prochaine session :
1. Vérifier `git status` et `git log --oneline -5` dans la racine du dépôt, et comparer avec ce fichier.
2. Lancer `git fetch origin ui-refonte`, puis vérifier l'écart `git rev-list --left-right --count origin/ui-refonte...HEAD`.
3. Ne reprendre que la tâche autorisée (section 8).

**État git (daté, à revérifier à la reprise)** : au moment de cette rédaction, la branche `ui-refonte` a les commits locaux listés par `git log origin/ui-refonte..HEAD`, et le dépôt n'est pas poussé. Ces points changeront après un push, et ne sont pas permanents. Les entrées non suivies sous `node_modules/` ne sont pas concernées par les commits.
