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

- Grille CSS deux colonnes : graphique (~60 %) à gauche, dernières opérations (~40 %) à droite.
- Media query de repli en une colonne sous ~900 px.
- Supprimer l'espace vide à droite du graphique.
- Les trois blocs d'ajout passent sous cette zone (ou en panneau, voir phase 5).

---

## Phase 5 : Formulaires

- Vrais `<label>` visibles au-dessus des champs ; les placeholders servent uniquement d'exemples.
- Corriger la ligne qui casse : grille CSS (`grid-template-columns`) avec le bouton « Ajouter » aligné sur la ligne.
- Charge fixe : libellé explicite « Jour du mois » (`type="number"`, `min=1`, `max=31`).
- Revenu : retirer ou adapter le champ « Catégorie ».
- **Dépense : champ date.** Vérifier d'abord dans le schéma si la date existe déjà ; **si une migration est nécessaire, me la proposer avant** (migrations déclarées côté Rust via le plugin SQL).
- Validation : libellé non vide, montant numérique > 0, messages d'erreur sous le champ.
- Après ajout : réinitialiser les champs, remettre le focus sur le premier champ (`useRef`), afficher un toast discret.
- **Option à discuter avec moi :** fusionner les trois formulaires en un seul avec un sélecteur de type (Revenu / Dépense / Charge fixe).

---

## Phase 6 : Listes d'opérations

- Retirer les puces. Une ligne par opération : libellé, pastille de catégorie, date, montant aligné à droite (`tabular-nums`).
- Bouton de suppression `.btn-icon` discret (gris, rouge au survol), zone cliquable ≥ 32 px, avec `aria-label`.
- **Suppression avec annulation :** masquer la ligne immédiatement dans l'état, afficher un toast « Annuler » pendant ~5 s, et n'exécuter le `DELETE` SQL qu'à l'expiration. Forcer l'exécution des suppressions en attente au changement de mois et à la fermeture de la fenêtre.
- Édition en ligne d'une opération (libellé, montant, catégorie).
- Filtre par catégorie (lié au clic sur le graphique, phase 3) avec une puce « filtre actif » supprimable.
- État vide soigné quand aucune opération n'existe pour le mois.

---

## Phase 7 : Navigation et accessibilité

- Remplacer ou compléter le `input type="month"` par des flèches ‹ › : état `month` au format `-MM-YYYY` et helper `addMonths`.
- États `:hover`, `:focus-visible`, `:disabled` sur tous les éléments interactifs.
- Navigation clavier complète, ordre de tabulation cohérent, `aria-label` sur les boutons-icônes.
- Ne pas porter le sens par la couleur seule (icône ou texte en plus).
- Audit de contraste (Lighthouse ou axe) et correction des écarts.

---

## Phase 8 : Évolutions fonctionnelles (optionnelles, une par une, sur validation)

1. **Budgets par catégorie** avec barres de progression et alerte de dépassement (nouvelle table `budgets` → migration à valider).
2. **Objectif d'épargne** avec jauge de progression.
3. **Courbe d'évolution** revenus/dépenses sur plusieurs mois (Chart.js `Line`).
4. **Export CSV** (via les commandes/plugins Tauri de fichiers, après accord sur les permissions de `capabilities/`).
5. **Récurrence automatique** des charges fixes.
6. **Thème clair** optionnel via `prefers-color-scheme`.

---

## Récapitulatif des commits attendus

| Phase | Message de commit |
|---|---|
| 1 | `feat(ui): design tokens, typographie, mise en page contrainte` |
| 2 | `feat(ui): cartes KPI hiérarchisées + calcul du disponible isolé` |
| 3 | `feat(ui): graphique trié, valeurs, infobulles, filtre au clic` |
| 4 | `feat(ui): grille deux colonnes responsive` |
| 5 | `feat(ui): formulaires avec labels, validation et feedback` |
| 6 | `feat(ui): listes enrichies, suppression avec annulation` |
| 7 | `feat(a11y): navigation de mois, focus, contrastes` |
| 8 | un commit par fonctionnalité |

**Commence par la phase 0 et attends ma validation avant de passer à la phase 1.**