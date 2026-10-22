# PLAN : Refonte UX/UI de SaveMoney

**Stack :** React 19 + TypeScript, Vite, hooks, Chart.js + react-chartjs-2, CSS (`App.css` + styles inline), Tauri v2 (Rust), SQLite via `@tauri-apps/plugin-sql`.

## Règles de travail (à respecter à chaque phase)

- Travailler **phase par phase**, dans l'ordre. En fin de phase : vérifier, résumer les changements, faire **un commit dédié**, puis **attendre ma validation**.
- Branche dédiée : `ui-refonte`.
- **Aucune modification du schéma SQLite** ni de la logique métier sans me le signaler et obtenir mon accord. Sauvegarder le fichier `.db` avant toute migration.
- **Aucune nouvelle dépendance** sans demande préalable (préférer une solution native quand elle existe).
- En cas de choix produit ambigu, **poser la question** au lieu de trancher.
- Vérifications standard à chaque phase :
  - `npx tsc --noEmit` (types)
  - `npm run build` (build Vite)
  - `npm run tauri dev` (contrôle visuel dans la fenêtre Tauri)
  - `cargo check` dans `src-tauri/` uniquement si du Rust est modifié

---

## Phase 0 : Exploration et filet de sécurité

1. Créer la branche `ui-refonte`.
2. Cartographier le projet : `src/App.tsx` (et composants éventuels), `src/App.css`, fichiers de requêtes SQL, `src-tauri/src/lib.rs` ou `main.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`.
3. Identifier : le schéma SQLite actuel (tables revenus, dépenses, charges fixes, épargne), la façon dont les migrations sont déclarées côté Rust, où et comment le « Disponible » et les totaux sont calculés.
4. Lister les styles inline à migrer vers des classes CSS.
5. Vérifier que l'app se lance et que le build passe.

**Livrable :** résumé de l'architecture, schéma de données, et liste des fichiers touchés par chaque phase suivante.

---

## Phase 1 : Fondations visuelles

- Dans `App.css`, définir des **variables CSS** sur `:root` :
  - surfaces : fond `#0F0F10`, cartes `#1A1A1C`, bordures `#2A2A2D`
  - texte : principal, secondaire `#A1A1AA` minimum (contraste AA)
  - couleurs sémantiques : revenus `#3B82F6`, dépenses `#EF4444`, charges fixes `#F59E0B`, disponible `#22C55E`, épargne `#14B8A6`
  - échelle d'espacements (4/8/16/24/32), rayons, tailles de texte
- **Police :** appliquer `font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif` à tout le body. Pour embarquer Inter en local (indispensable en desktop hors ligne), proposer `@fontsource-variable/inter` **et attendre mon accord** ; sinon rester sur la pile système.
- `font-variant-numeric: tabular-nums` sur tous les montants.
- Centraliser le formatage dans un utilitaire `formatEUR` basé sur `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })`.
- Contenu centré avec `max-width: 1280px`.
- Définir une taille minimale de fenêtre dans `tauri.conf.json` (par ex. `minWidth: 900`, `minHeight: 600`).
- Migrer progressivement les styles inline vers des classes CSS (une classe par composant : `.kpi-card`, `.panel`, `.btn-primary`, `.btn-icon`…).

**Validation :** plus aucune police serif par défaut, « Disponible » et « Épargne » de couleurs différentes.

---

## Phase 2 : Cartes d'indicateurs

1. Extraire le calcul des totaux dans une **fonction pure** `computeSummary(revenus, depenses, chargesFixes, epargne)`.
2. **QUESTION À ME POSER AVANT DE CODER :** l'épargne doit-elle être déduite du « Disponible » ? (Actuellement : Revenus − Dépenses − Charges fixes = 303,55 €, l'épargne de 100 € n'est pas soustraite.)
3. Mettre « Disponible » en avant (plus grand, ou en première position).
4. Ajouter une ligne de contexte sous chaque montant (ex. part du revenu en %).
5. Variation vs mois précédent : requête SQL supplémentaire sur le mois N−1 lancée en parallèle (`Promise.all`) dans le `useEffect` de chargement ; masquer la variation s'il n'y a pas de données.
6. Infobulle (attribut `title` ou petit composant) expliquant la formule du Disponible.
7. Ajouter une icône à chaque carte (SVG inline, sans nouvelle dépendance).

---

## Phase 3 : Graphique (Chart.js / react-chartjs-2)

**Statut : réalisée et validée manuellement dans Tauri** (commit `74d838a`).

Décisions prises et appliquées :
- Définition retenue : dépenses ponctuelles + charges fixes, épargne exclue, lignes à total strictement positif. Le graphique peut donc différer de la carte « Dépenses du mois », qui n'a pas été modifiée.
- Ligne « Sans catégorie » : dépenses et charges fixes sans catégorie valide, triées avec les autres.
- Filtre au clic à trois états distincts : aucun filtre, catégorie identifiée par son id, « Sans catégorie ». Un second clic retire le filtre.
- Le filtre est réinitialisé après un changement de mois réussi, et conservé si la bascule est bloquée ou échoue.

Points réalisés :
- Trier les catégories par montant décroissant (`useMemo`).
- Masquer la légende (`plugins.legend.display: false`).
- Axe Y : `ticks.callback` pour afficher l'unité €, grille discrète, couleurs de texte lisibles. Définir `Chart.defaults.color` et `Chart.defaults.borderColor` une fois pour le thème sombre.
- Infobulle : `plugins.tooltip.callbacks.label` avec `formatEUR`.
- Valeurs affichées sur les barres via un **petit plugin Chart.js inline** (`afterDatasetsDraw`) plutôt qu'une dépendance supplémentaire, ou `chartjs-plugin-datalabels` après accord.
- Clarifier dans le titre ou le sous-titre si les charges fixes sont incluses ; **me demander** si le graphique doit refléter la même définition que la carte « Dépenses du mois ».
- Interaction : `onClick` sur le graphique (via la ref du chart et `getElementsAtEventForMode`) pour **filtrer la liste d'opérations** par catégorie ; clic à nouveau pour retirer le filtre.

**Validation :** le poste principal se lit sans consulter l'axe.

---

## Phase 4 : Mise en page

**Statut : réalisée et validée visuellement dans Tauri** (commit `9dc0948`).

Disposition retenue, qui remplace la grille 60/40 prévue initialement :
- Graphique sur toute la largeur disponible, dans un conteneur responsive (plus de largeur fixe de 700 px).
- Sous le graphique, deux cartes de largeur égale côte à côte : « Opérations du mois » (revenus et dépenses ponctuelles du mois affiché, triés par date décroissante, ordre déterministe à date égale) et « Charges fixes actives » (triées par jour du mois, sans date fabriquée, sans jour en dernier).
- Chaque carte a sa propre liste avec défilement vertical, dans une zone de même hauteur maximale.
- Sous environ 900 px, les deux cartes passent l'une sous l'autre sans débordement horizontal.
- Conteneur centré, largeur maximale de 1280 px.
- Les trois formulaires d'ajout sont placés sous cette zone. Les listes ne sont plus dupliquées sous les formulaires.
- Objectifs et dettes sont conservés, et placés après la zone principale.

---

## Phase 5 : Formulaires

**Statut : périmètre validé pour les trois formulaires Revenu, Dépense et Charge fixe**, avec tests manuels effectués dans Tauri (commit `bc839ac`, puis tests validés par vous). Les erreurs SQL et les erreurs de fermeture simulées ne sont pas testées dans Tauri : elles ne sont pas déclarées validées.

Décisions prises :
- Fusion des trois formulaires : **écartée**. Ce n'est pas une tâche manquante.
- Catégorie des revenus : **conservée volontairement**.
- Formulaires Objectifs et Dettes : hors du périmètre validé ; amélioration éventuelle distincte.

Éléments du périmètre :
- Vrais `<label>` visibles au-dessus des champs ; les placeholders servent uniquement d'exemples.
- Corriger la ligne qui casse : grille CSS (`grid-template-columns`) avec le bouton « Ajouter » aligné sur la ligne.
- Charge fixe : libellé explicite « Jour du mois » (`type="number"`, `min=1`, `max=31`).
- Revenu : retirer ou adapter le champ « Catégorie ».
- **Dépense : champ date.** Vérifier d'abord dans le schéma si la date existe déjà ; **si une migration est nécessaire, me la proposer avant** (migrations déclarées côté Rust via le plugin SQL).
- Validation : libellé non vide, montant numérique > 0, messages d'erreur sous le champ.
- Après ajout : réinitialiser les champs, remettre le focus sur le premier champ (`useRef`), afficher un toast discret.
- **Option écartée :** fusion des trois formulaires en un seul avec un sélecteur de type (Revenu / Dépense / Charge fixe).

---

## Phase 6 : Listes d'opérations

**Statut : partiellement réalisée. La phase n'est pas terminée.**

Réalisé et testé manuellement dans Tauri (scénarios sans erreur simulée) :
- Suppression différée avec toast « Annuler » pendant 5 s ; le `DELETE` n'est exécuté qu'à l'expiration, et l'annulation annule le timer (commits `e9ac9f8`, `8a7dde4`).
- Finalisation forcée des suppressions en attente avant un changement de mois réussi et avant la fermeture normale de la fenêtre (commit `8a7dde4`).
- Filtre par catégorie lié au graphique, avec puce « Filtre actif » supprimable.
- Liste sans puces, une ligne par opération : libellé, catégorie, date, montant aligné à droite (`tabular-nums`) (commit `9dc0948`).
- Bouton de suppression `.ops-delete` : 32 px, `aria-label` renseigné, état désactivé pendant une finalisation.

Réalisé mais non testé dans certains scénarios :
- Échec SQL pendant une suppression, et échec de fermeture simulé : la logique est couverte par des tests automatisés sur la file et la garde, mais **non testée dans Tauri**. Ces scénarios ne sont pas déclarés validés.

Restant à faire :
- **Pastilles de catégorie** : absentes des lignes. La catégorie s'affiche en texte. Écart avec le plan initial, à traiter.
- **Boutons-icônes** : le bouton est cohérent (taille, `aria-label`), mais il n'a pas d'état de survol (rouge au survol) ni de style de focus visible explicite. La classe `.btn-icon` n'est pas utilisée ; ce n'est pas une obligation, seule la cohérence compte.
- **Édition en ligne** d'une opération (libellé, montant, catégorie) : non réalisée. Elle demande une proposition préalable (types concernés, Enregistrer/Annuler, validation, erreurs SQL, interactions avec filtres, tris et suppressions en attente).
- **États vides** : messages présents, mais présentation non travaillée.

---

## Phase 7 : Navigation et accessibilité

**Statut : non réalisée (hors les `aria-label` des boutons de suppression et le libellé des revenus et dépenses).**

Restant à faire :
- Remplacer ou compléter le `input type="month"` par des flèches ‹ › : état `month` au format `-MM-YYYY` et helper `addMonths`.
- États `:hover`, `:focus-visible`, `:disabled` sur tous les éléments interactifs.
- Navigation clavier complète, ordre de tabulation cohérent.
- Ne pas porter le sens par la couleur seule : déjà traité pour les types d'opérations (libellé texte), à vérifier partout.
- Audit de contraste (Lighthouse ou axe) et correction des écarts.

---

## Phase 8 : Évolutions fonctionnelles (optionnelles, une par une, sur validation)

**Statut : une fonctionnalité partiellement présente (objectifs), les autres non commencées.** Chaque point demande une validation préalable.

1. **Budgets par catégorie** avec barres de progression et alerte de dépassement (nouvelle table `budgets` → migration à valider). Non commencé.
2. **Objectif d'épargne** avec jauge de progression. **Partiellement présent, pas entièrement utilisable** : création d'un objectif, barre de progression et pourcentage affichés. Aucune interface ne modifie le montant courant, ni ne modifie ou supprime un objectif : la jauge reste à 0 % en pratique. Ce point n'est donc pas déclaré réalisé.
3. **Courbe d'évolution** revenus/dépenses sur plusieurs mois (Chart.js `Line`). Non commencé.
4. **Export CSV** (via les commandes/plugins Tauri de fichiers, après accord sur les permissions de `capabilities/`). Non commencé.
5. **Récurrence automatique** des charges fixes. Non commencé.
6. **Thème clair** optionnel via `prefers-color-scheme`. Non commencé.

**Hors plan, à suivre :**
- Formulaires Objectifs et Dettes : en lecture DOM, sans messages d'erreur reliés aux champs. La barre de dette est toujours à 100 %, faute de remboursements enregistrés. Amélioration éventuelle, distincte.
- Chargement mensuel : une réponse obsolète peut écraser les données d'un changement de mois récent (voir le diagnostic transmis).
- Version de `@tauri-apps/api` : installée 2.11.1, demandée 2.11.5 dans `package.json`.
- Règle date/mois des revenus : un revenu est enregistré avec la date du jour, dans le mois affiché. Règle inchangée, à discuter.

---

## Récapitulatif des commits

| Phase | Message de commit | Commit |
|---|---|---|
| 1 et 2 | design tokens, cartes KPI hiérarchisées, calcul du disponible isolé (regroupés) | `c91b35b` (message d'origine très long, non conforme au plan) |
| 3 | `feat(ui): graphique trié, valeurs, infobulles, filtre au clic` | `74d838a` |
| 4 | `feat(ui): graphique pleine largeur et listes d'opérations côte à côte` | `9dc0948` |
| 5 | `feat(ui): formulaires avec labels, validation et feedback` | `bc839ac` |
| 6 | `fix(ui)`, `fix(budget)` : suppression différée, finalisation avant navigation et fermeture | `e9ac9f8`, `8a7dde4` |
| 7 | `feat(a11y): navigation de mois, focus, contrastes` | Non commencé |
| 8 | un commit par fonctionnalité | Non commencé |

Commits hors plan : `ca711ec` (premier commit de la phase 5, antérieur au périmètre validé, remplacé par `bc839ac`) ; `6e11674` (corrections de calcul mensuel, types des hooks et compilation) ; `2432581` (watcher Vite).

**Commence par la phase 0 et attends ma validation avant de passer à la phase 1.**