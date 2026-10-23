# HANDOFF — SaveMoney, refonte UX/UI (branche `ui-refonte`)

Ce fichier décrit l'état opérationnel de la session. Le plan et les décisions durables sont dans `PLAN.md`.
Chemins relatifs à la racine du dépôt git, sauf mention contraire.
État de référence : **2026-10-22**, après le deuxième lot de phase 8 (courbe d'évolution sur six mois). **Cet état git doit être revérifié à la reprise** (section 9).

## 1. Projet et architecture

**Stack** : React 19 + TypeScript, Vite, hooks, Chart.js + react-chartjs-2, CSS (`App.css`), Tauri v2 (Rust), SQLite via `@tauri-apps/plugin-sql`.

**Chemins**
- Racine du dépôt git : `.` (contient le dossier `SaveMoney/`). `node_modules/` n'est pas suivi (section 7).
- Application (là où se lancent `npm` et `tauri`) : `SaveMoney/`.
- Dans l'application : `src/`, `src-tauri/`, `scripts/`, `package.json`, `vite.config.ts`.
- Un `package.json` et un `package-lock.json` existent aussi à la racine du dépôt. Ils ne sont pas utilisés pour les commandes. Leur rôle reste à clarifier.

**Fichiers principaux** (dans `SaveMoney/src/`)
- `pages/Dashboard.tsx` : page unique. Sélecteur de mois avec flèches, KPI, graphique avec sélecteur clavier de catégorie, carte « Évolution sur 6 mois » sous le graphique, « Opérations du mois » et « Charges fixes actives » (édition en ligne), objectifs (montant courant éditable, suppression annulable), dettes, formulaires, toasts, suppression différée, filtre au clic, garde de fermeture.
- `components/EvolutionCard.tsx` : carte de la courbe, tableau accessible, états (chargement, erreur, aucune donnée). Lecture seule.
- `components/OperationEditForm.tsx` : formulaire d'édition d'une opération, focus sur les champs en erreur.
- `components/GoalAmountForm.tsx` : formulaire d'édition du montant courant d'un objectif, libellé visible, erreur reliée au champ.
- `hooks/useMonthlyBudget.ts` : chargement du mois affiché, ignore les réponses obsolètes (`runLatest`).
- `hooks/useMonthlySeries.ts` : chargement de la période de la courbe, relancé après chaque rechargement des données mensuelles, ignore les résultats périmés.
- `hooks/useGoals.ts` : objectifs. `updateGoal` est utilisé ; `deleteGoal` ne l'est pas (la suppression passe par la file différée).
- `hooks/useDebts.ts` : dettes (partielles, voir section 7).
- `db/client.ts` : connexion SQLite et schéma (`initSchema`, en TypeScript, pas de migrations Rust).
- `types/budget.ts` : types métier.
- `utils/computeSummary.ts` : calcul pur des totaux, `summarizeMonth`, `isSavingsCategory`, `isSavingsEntry` (règle de classement d'une entrée, partagée avec la courbe).
- `utils/monthBudget.ts` : requêtes et calculs du mois (`fetchMonthBudget`).
- `utils/monthlySeries.ts` : période de six mois, statut par mois, agrégation, lecture groupée de la période.
- `utils/monthNavigation.ts` : `addMonths`, décalage de mois au format `YYYY-MM`.
- `utils/requestGate.ts` : `createRequestGate` et `runLatest`.
- `utils/formValidation.ts` : règles pures et messages partagés (ajout et édition).
- `utils/goalRules.ts` : règles du montant courant d'un objectif (validation, brouillon, plafonnement de la jauge).
- `utils/chartRows.ts` : lignes du graphique, filtre à trois états.
- `utils/categoryFilterOptions.ts` : options et encodage du sélecteur clavier (pas de logique de filtrage propre).
- `utils/operations.ts` : tri des opérations et des charges fixes, format de date.
- `utils/categoryColor.ts` : couleur stable des pastilles, calculée à partir de l'identifiant.
- `utils/inlineEdit.ts` : règles de l'édition des opérations (comparaison, validation, UPDATE paramétrés, transitions, garde de sauvegarde `createSaveGuard` / `runGuarded`).
- `utils/deferredDeletions.ts` : file de suppressions différées (`DeferredDeletionQueue`), types `income`, `expense`, `recurring` et `goal`.
- `utils/closeGate.ts` : décision de fermeture (`createCloseGate`, et `createEditAwareClose` qui vérifie le brouillon d'abord).
- `utils/formatEUR.ts` : formatage en euros.
- `App.css` : tokens de thème (dont `--on-color` et `--control-border`), mise en page, formulaires, opérations, boutons, focus visible, carte d'évolution.
- `src-tauri/capabilities/default.json` : permissions Tauri, dont `core:window:allow-close`.
- `vite.config.ts` : filtre `watch.ignored` pour `src-tauri` et `target`.

## 2. Règles de travail

- Travailler **phase par phase**, dans l'ordre. En fin de lot : vérifier, présenter le diff, proposer le message de commit, **attendre la validation** avant tout commit.
- Branche : `ui-refonte`.
- **Pas de push sans autorisation explicite**, à chaque fois. Une autorisation de commit ne vaut pas autorisation de push.
- **Aucune nouvelle dépendance** sans demande préalable.
- **Aucune modification du schéma SQLite** ni des calculs financiers sans accord explicite.
- Préserver les modifications locales. `node_modules` : ne pas toucher à son contenu sur disque sans accord.
- Commits : indexer explicitement les fichiers du lot (jamais `git add .` ni `-A`). Vérifier le diff indexé.
- Ne pas déclarer une validation fonctionnelle à partir de tests automatisés seuls. Ne pas déclarer validés des scénarios d'erreur simulés non testés dans Tauri. Ne pas présenter un retour manuel comme un audit d'accessibilité.
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
- `119a4e5` : phase 6, édition en ligne, pastilles de catégorie, boutons `.ops-delete`, états vides.
- `e6e583d` : `docs(plan)`, documentation de la phase 6 et du fichier de reprise.
- `134c671` : phase 7, navigation de mois, sélecteur clavier, focus et contrastes.
- `e577b47` : commit ajoutant au suivi git des fichiers sous `node_modules/` (confirmé par l'utilisateur comme une erreur de sa part). Défait par `1887eef`.
- `1887eef` : `chore(git)`, retrait de `node_modules/` du suivi et `.gitignore` racine.
- `2fab48b` : phase 8, premier lot : montant courant des objectifs modifiable, suppression annulable.
- Commit du deuxième lot de phase 8 : `feat(evolution): courbe des revenus et dépenses ponctuelles sur 6 mois` (identifiant : voir `git log`).

**Par phase**
- **Phase 1** : réalisée (tokens, typographie, `formatEUR`, `max-width`). Styles inline encore présents dans le Dashboard.
- **Phase 2** : réalisée (`computeSummary`, cartes KPI, variations, infobulle, icônes).
- **Phase 3** : réalisée et validée manuellement dans Tauri (`74d838a`).
- **Phase 4** : réalisée et validée visuellement dans Tauri (`9dc0948`).
- **Phase 5** : périmètre validé pour Revenu, Dépense, Charge fixe (`bc839ac`). Fusion des formulaires **écartée**. Catégorie des revenus **conservée**.
- **Phase 6** : réalisée et validée manuellement dans Tauri (`119a4e5`). Scénarios d'erreur SQL et de fermeture simulée **non testés dans Tauri**.
- **Phase 7** : réalisée, retour manuel positif dans Tauri (`134c671`). **Ce n'est pas un audit d'accessibilité** : pas de Lighthouse ni d'axe, contrastes calculés à partir du code.
- **Phase 8** : **deux lots livrés et validés** : objectifs (montant courant, suppression annulable, `2fab48b`) et courbe d'évolution sur six mois (deuxième lot). **Le reste de la phase 8 n'est pas commencé** : budgets, export CSV, récurrence, thème clair. La phase 8 n'est pas marquée comme terminée.

## 5. Décisions produit à préserver

- **Disposition** : graphique pleine largeur, puis la carte d'évolution, puis deux cartes côte à côte, défilement indépendant, repli vertical sous 900 px. Les formulaires sont sous cette zone.
- **Formulaires** : Revenu, Dépense, Charge fixe séparés. Fusion écartée.
- **Catégorie des revenus** : conservée volontairement.
- **Graphique** : dépenses ponctuelles + charges fixes, hors épargne, lignes à total strictement positif, tri décroissant, ligne « Sans catégorie ».
- **Filtre** : trois états (aucun, catégorie par identifiant, sans catégorie). Trois moyens de le changer, même chemin (`changeFilter`) : clic sur une barre, puce, sélecteur clavier « Filtrer la liste par catégorie ». Réinitialisé uniquement après un changement de mois réussi. La courbe ne dépend pas du filtre.
- **Suppression** : différée 5 s avec « Annuler ». Finalisation forcée avant un changement de mois et avant la fermeture normale. Un refus de fermeture ne lance pas la finalisation forcée ; le minuteur normal d'une suppression en attente continue. Valable pour les opérations et pour les objectifs.
- **Changement de mois** : centralisé dans `requestMonthChange`, y compris pour une dépense datée d'un autre mois. Les flèches ‹ › et le sélecteur passent par ce même point d'entrée. Format `YYYY-MM` conservé.
- **Blocage pendant un enregistrement** : navigation de mois, filtre, autre édition, fermeture et suppressions bloqués. Décision validée, conservée.
- **Édition en ligne des opérations** : une ligne à la fois ; libellé, montant, catégorie (et jour pour les charges fixes) ; dates et mois non modifiables. Confirmation avant abandon d'un brouillon réellement modifié. Succès jamais renvoyé ; erreur SQL affichée sur la ligne.
- **Montant courant d'un objectif** : la saisie remplace le montant, elle n'est pas additionnée. Zéro et décimales acceptés ; vide, négatif, non numérique ou non fini refusés. Au-delà de la cible, le montant réel est conservé ; seuls la jauge et le pourcentage sont plafonnés à 100 %. Pendant l'édition, les boutons « Modifier le montant » et × de l'objectif sont remplacés par le formulaire (décision validée). Aucun effet sur Disponible, Épargne, revenus, dépenses ni graphiques.
- **Suppression d'un objectif** : différée 5 s avec annulation, via la même file que les opérations. Le message affiché au départ est « Objectif en cours de suppression » ; il ne déclare pas le succès.
- **Courbe d'évolution sur six mois** (deuxième lot) :
  - Six mois, du plus ancien au plus récent, se terminant au mois sélectionné. Pas de prévision : si le mois est futur, la période se termine quand même sur ce mois.
  - Deux séries : Revenus et Dépenses ponctuelles, avec la même classification que le calcul mensuel (`isSavingsEntry`). Charges fixes et épargne exclues ; mention visible « Hors charges fixes et épargne ».
  - Opérations en attente de suppression exclues, comme dans les listes. Écart temporaire accepté pendant les 5 secondes : les cartes existantes les incluent jusqu'à la finalisation. Ce comportement des cartes n'est pas modifié.
  - Statuts par mois, distincts : **mois vide** (aucune opération : « Aucune donnée enregistrée (ce n'est pas une validation du mois). ») ; **épargne seule** (« Aucun revenu ni dépense ponctuelle enregistré ; épargne exclue. ») ; **opérations en attente de suppression** (« Opérations en attente de suppression, exclues de la courbe. », libellé ajouté pour ne pas confondre ce cas avec un mois vide) ; **mois enregistré**.
  - Si aucun mois n'a d'opération, la courbe est remplacée par le message « Aucune donnée enregistrée sur ces six mois. », et le tableau reste affiché.
  - Les totaux sont comparés **uniquement** sur le même périmètre (revenus et dépenses ponctuelles, mois sélectionné), **hors suppression en attente**. Un test vérifie l'égalité avec `summarizeMonth` pour le mois sélectionné.
  - Lecture groupée : trois requêtes pour toute la période (revenus, dépenses, catégories). Le chargement mensuel n'est pas modifié.
  - Résultats périmés ignorés (même mécanisme que le chargement mensuel). Recalcul après chaque rechargement des données mensuelles : création, modification, suppression, annulation.
  - Lecture seule : aucun clic sur la carte ne change le mois, le filtre ou l'édition.
  - Erreur de lecture : affichée à part, sans valeurs à zéro.
- **Épargne** : « Épargne » proposée pour les dépenses et les charges fixes, pas pour les revenus. Classification existante (`summarizeMonth`, `isSavingsCategory`), sans nouvelle règle.
- **Pastilles** : palette calculée à partir de l'identifiant, rien n'est écrit en base. « Sans catégorie » en anneau neutre.
- **Texte sur couleurs pleines** : sombre (`--on-color`, `#0F0F10`) sur les fonds colorés. Les textes secondaires et les variations dans les cartes KPI héritent de la couleur de la carte ; le signe `+` ou `-` porte le sens.
- **Format du mois** : le code utilise `YYYY-MM`. Ce format ne doit pas être changé pour reproduire une notation du plan initial.

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
node scripts/verify-month-navigation.mjs   # 4 groupes
node scripts/verify-category-filter.mjs    # 7 groupes
node scripts/verify-contrast.mjs           # mesures calculées à partir du code (voir limites)
node scripts/verify-goals.mjs              # 4 groupes : validation, brouillon, plafonnement, suppression différée (goal)
node scripts/verify-monthly-series.mjs     # 9 groupes : période, statuts, sommes, bornes, attente, cohérence, requête, erreur, résultats périmés
npx tsc --noEmit
npm run build
npm run tauri dev                          # lancement Tauri, à lancer manuellement
```
Dernière exécution avant le commit du deuxième lot : les **treize** scripts passent, `tsc` et `build` ont le code 0.

**Tests automatisés** : fonctions pures et logique extraite (file de suppressions, garde de fermeture, `runLatest` et `fetchMonthBudget`, règles de formulaire, règles d'édition, garde de sauvegarde, lignes du graphique, tri, pastilles, calcul des mois, options du sélecteur, contrastes calculés, règles du montant courant d'un objectif, séries de la courbe, statuts par mois, requête groupée avec base factice, résultats périmés). **Ils n'exécutent pas le composant React, ni les effets de hooks, ni le câblage des gardes, du focus, des flèches, du sélecteur, des objectifs ou de la carte d'évolution, ni le rendu Chart.js, ni `window.confirm`, ni le SQL réel sur la base, ni la fenêtre Tauri.**

**Contrastes** : `verify-contrast.mjs` calcule les ratios WCAG à partir des valeurs écrites dans `App.css`, `categoryColor.ts` et `Dashboard.tsx`. Il ne rend rien. Il ne remplace ni Lighthouse, ni axe, ni un contrôle à l'écran. Les couleurs des lignes de la courbe (`#3B82F6`, `#EF4444`) sont écrites dans `EvolutionCard.tsx` ; elles ne sont pas listées explicitement dans `verify-contrast.mjs`. Leurs ratios sur la carte (4,72:1 et 4,62:1) sont les mêmes que ceux des textes bleu et rouge déjà mesurés.

**Tests manuels rapportés par l'utilisateur dans Tauri, passés**
- Phase 3 : tri, montants, valeurs sur les barres, clic et second clic, ligne « Sans catégorie », réinitialisation après changement de mois.
- Phase 4 : disposition validée visuellement.
- Phase 5 : formulaires Revenu, Dépense, Charge fixe.
- Suppression différée, annulation, finalisation avant changement de mois et fermeture (scénarios sans erreur simulée).
- Chargement mensuel : quatre scénarios.
- Phase 6 (`119a4e5`) : édition et sauvegarde, double envoi, conservation du brouillon après suppression d'une autre ligne, refus d'abandon au changement de mois et à la fermeture, sortie du filtre après sauvegarde, validation des champs, pastilles, états vides et boutons.
- Phase 7 (`134c671`) : retour utilisateur **positif** sur la checklist de phase 7. Ce retour ne vaut pas certification d'accessibilité.
- Phase 8, premier lot (`2fab48b`) : retour utilisateur **positif** sur la checklist du lot : remplacement du montant (zéro, décimales), dépassement de la cible, saisies invalides avec message et focus, annulation d'un brouillon, protections au changement de mois, de filtre et d'autre édition, suppression d'un objectif de test et annulation dans les 5 secondes, suppression laissée à échéance et persistance après réouverture, persistance d'un montant après réouverture, retour du focus après sauvegarde, absence d'effet sur Disponible, Épargne, revenus, dépenses et graphiques.
- Phase 8, deuxième lot (courbe d'évolution) : retour utilisateur **positif** sur la checklist du lot. Ce retour couvre les scénarios de la checklist de ce lot, et ne couvre pas les scénarios non testés listés ci-dessous.

**Scénarios non vérifiés** (ne pas les déclarer validés)
- Échecs SQL non simulés : écriture du montant d'un objectif, suppression d'un objectif.
- Blocages pendant une sauvegarde : trop rapides pour être observés, non vérifiés.
- Erreur SQL simulée pendant une suppression, un ajout, une bascule ou une édition d'opération.
- Erreur de fermeture simulée (permission refusée ou équivalente).
- Réponse de rechargement en erreur après une écriture réussie.
- Erreurs de lecture réelles de la courbe d'évolution : non simulées dans Tauri.
- Câblage React des gardes, du focus, des objectifs et de la carte d'évolution : non testé automatiquement.
- SQL de la courbe : testé avec une base factice seulement.

**Non mesuré ou non vérifié**
- Lighthouse et axe : non exécutés.
- Contrastes sur le rendu réel : non mesurés. Placeholders (aucune couleur définie dans le projet), styles natifs des `select` et des champs date/mois, états désactivés (opacité), couleurs des lignes de la courbe sur le rendu réel : non mesurés comme contrastes.
- Ordre de tabulation : retour manuel seulement, sans audit complet.

## 7. Points techniques ouverts

- **Démontage temporaire pendant un rechargement** : après une suppression, un ajout ou une sauvegarde d'objectif, le Dashboard affiche « Chargement... », ce qui démonte les formulaires. L'état est conservé et les champs le restituent, mais le focus est perdu et une frappe pendant la fenêtre de chargement est perdue. **Limite connue, non corrigée**, à traiter séparément, sur accord.
- **Écart temporaire courbe / cartes** : pendant les 5 secondes d'une suppression en attente, la courbe exclut l'opération alors que les cartes existantes l'incluent encore. Accepté pour le deuxième lot, sans modification des cartes. À harmoniser seulement sur décision.
- **Message « Opération supprimée »** : affiché avant l'écriture effective de la suppression d'une opération. Il annonce un succès non encore acquis. **Correction séparée, non traitée dans les lots de phase 8.** Le message des objectifs (« Objectif en cours de suppression ») ne pose pas ce problème.
- **`deleteGoal`** (dans `useGoals.ts`) : inutilisé. Il supprimerait immédiatement et rechargerait les objectifs, ce qui contournerait la file différée. À supprimer ou à garder en l'état, à décider.
- **Couleurs de la courbe** : codées en dur dans `EvolutionCard.tsx`, comme le graphique existant. Pas de refonte des tokens à ce stade.
- **Touche Échap** : non gérée pour annuler une édition. Non ajoutée, sur décision.
- **Formulaires Objectifs (création) et Dettes** : non refondus. Libellés non reliés aux champs, messages d'erreur non reliés, boutons « Ajouter » sans état de survol. Hors périmètre validé.
- **Version `@tauri-apps/api`** : `package.json` demande `2.11.5`, `node_modules` installe `2.11.1`. Décision à prendre.
- **Règle date/mois des revenus** : un revenu est enregistré avec la date du jour, dans le mois affiché. Règle inchangée, à discuter.
- **Charges fixes non historisées** : `recurring_expenses` n'a pas de mois. Elles ne figurent donc pas dans la courbe, ce qui rendrait un mois passé faux.
- **Dettes** : liste et ajout. La barre est fixe à 100 %, faute de remboursements enregistrés.
- **Édition en ligne** : une catégorie stockée qui n'existe plus apparaît sous le libellé « Catégorie introuvable ».
- **Chargement mensuel** : les requêtes ne sont pas annulées, leurs résultats obsolètes sont ignorés.
- **Montants personnels dans `PLAN.md`** : deux montants issus du plan d'origine (section Phase 2, question sur le Disponible) sont restés dans le fichier. Non modifiés à ce jour, à anonymiser ultérieurement sur accord.
- **Dépôt git** : `node_modules/` n'est plus suivi (`1887eef`). Les fichiers restent présents sur disque et sont ignorés par le `.gitignore` racine. Les commits antérieurs (y compris `e577b47`) restent dans l'historique.

## 8. Prochaine étape

**Deuxième lot de phase 8 validé** (courbe d'évolution sur six mois). Commit créé, documentation à jour. La phase 8 n'est **pas** terminée. **Aucune tâche autorisée pour l'instant.**

- Push des commits des lots 1 et 2 sur `origin/ui-refonte` : **non autorisé** à ce stade, à autoriser séparément.
- Autres options de la phase 8 (budgets, export CSV, récurrence, thème clair) : **non cadrées, non autorisées**. Chacune demande un cadrage et une validation séparés.
- Correction du message « Opération supprimée » : **non autorisée** à ce stade.
- Correction du démontage pendant le rechargement : **non autorisée** sans accord.
- Harmonisation de la courbe et des cartes pendant une suppression en attente : **non autorisée** sans accord.
- Anonymisation des montants de `PLAN.md` : **non autorisée** pour l'instant.

## 9. Reprise

La première action de la prochaine session :
1. Vérifier `git status` et `git log --oneline -5` dans la racine du dépôt, et comparer avec ce fichier.
2. Lancer `git fetch origin ui-refonte`, puis vérifier l'écart `git rev-list --left-right --count origin/ui-refonte...HEAD`.
3. Ne reprendre que la tâche autorisée (section 8).

**État git (daté au 2026-10-22, à revérifier à la reprise)** : au moment de la rédaction, la branche `ui-refonte` avait le commit du deuxième lot de phase 8 en avance sur `origin/ui-refonte`, non poussé. Ces points changent après un push ou un nouveau commit. Les fichiers sous `node_modules/` ne sont plus suivis et ne font pas partie des commits du lot.
