# CLAUDE.md — Contexte projet pour Claude Code

Ce fichier donne à Claude Code le contexte nécessaire pour reprendre et faire évoluer le projet **MétréPro**.

## Ce qu'est le projet

MétréPro est un **logiciel de métré, de chiffrage et de quantitatif matériaux** pour le
bâtiment, orienté aussi **structure béton armé**. Il s'inspire des logiciels de métré du
marché (type JLogiciels) : on part d'un plan, on mesure, et on obtient un devis + la liste
des matériaux nécessaires.

C'est un **outil de devis / estimatif**, PAS un logiciel de calcul de béton armé
réglementaire (BAEL / Eurocode 2). L'utilisateur fournit les paramètres (dimensions,
armatures) ; le logiciel estime les quantités.

## État actuel

Prototype **frontend uniquement**, 100 % client (aucun backend). Fonctionne en ouvrant
`src/index.html` dans un navigateur. Tout l'état vit en mémoire (rien n'est persisté :
recharger la page remet à zéro — c'est la première limite à lever).

Version actuelle : v0.5.

## Architecture des fichiers

```
src/          Application web MétréPro (métré et chiffrage)
  index.html   Structure (barre d'outils, étapes, panneaux, modales) + inclut styles.css et app.js
  styles.css   Tout le style (thème sombre, grille de l'app, tableau, modales)
  app.js       Toute la logique (~1200 lignes, vanilla JS, aucune dépendance sauf pdf.js via CDN)

mobile/       Application mobile MétréCards (scan de cartes de visite) — voir mobile/README.md
```

Les deux applications sont indépendantes : elles partagent l'univers métier
(bâtiment, carnet d'adresses professionnel) et la charte graphique, mais aucun
code. `mobile/` a sa propre pile technique (React Native + Expo + TypeScript),
ses propres dépendances et ses propres tests ; voir `mobile/AGENTS.md` pour les
conventions qui s'y appliquent.

`app.js` charge **pdf.js** depuis cdnjs (lecture des PDF). Aucune autre dépendance externe.

### Organisation de `app.js` (repères de sections, commentées)

- **Constantes** : palette, unités, masses linéiques acier (`STEEL_MASS`), types d'éléments
  structure (`ST_LABEL`, `ST_SHORT`, `TYPE_PHASE`, `DIMLABELS`), phases (`PHASES`).
- **`state`** : objet global unique. Contient `img`, `pxPerMeter` (échelle), `shapes`
  (toutes les mesures), `library` (ouvrages avec prix + composition matériaux `comp`),
  `matPrices`, `defaults` (paramètres par défaut par type structure), `currency`, `tva`,
  `phase`, `activeType`, `quickMode`, `dockView`.
- **Canvas / rendu** : `render()`, `drawStd()`, `drawStruct()`, `drawDraft()`, pan/zoom.
- **Géométrie** : `polyLenPx`, `areaPx` (shoelace), `px2m` (conversion pixels→mètres).
- **Structure BA** : `computeStruct()` calcule volume béton (m³) et poids acier (kg) à
  partir des dimensions + armatures (barres principales + cadres/étriers).
- **`tableRows()`** : source unique de vérité du tableau ; transforme `shapes` en lignes.
- **Import** : `routeFile()` (dispatch par extension), `loadPDF`, `loadImage`,
  `renderDXF()` (parseur DXF maison : LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC + $INSUNITS).
- **Analyse auto** : bouton `#btnAuto` → lit `state.autoEntities` (géométrie DXF ou plan
  d'exemple) → propose d'affecter un ouvrage aux surfaces / longueurs → génère les mesures.
- **Quantitatif matériaux** : `materialsAgg()` agrège la composition (`comp`) de chaque
  ouvrage × quantité mesurée → liste de matériaux + coûts. Vue basculable dans le dock.
- **Export** : CSV et impression PDF (via `window.print`).

## Conventions importantes

- Les mesures sont stockées en **coordonnées image** (pixels du plan). L'échelle
  `pxPerMeter` convertit en mètres. Ne pas mélanger coordonnées écran et image.
- `id()` génère les identifiants — NE PAS référencer `state` avant son initialisation
  (piège de "temporal dead zone" déjà corrigé une fois).
- Éviter `localStorage`/`sessionStorage` dans l'environnement d'artifact ; pour la vraie
  app (hors navigateur restreint), la persistance passera par un backend ou IndexedDB.

## Tests

Aucun framework installé. Les tests se font avec **Playwright** (Chromium) en chargeant
`src/index.html` en `file://` et en vérifiant `pageerror` + comportements clés
(analyse auto, calcul structure, changement de devise, édition de ligne). Exemple de
vérification métier : un rectangle 5×4 m doit donner 20 m² ; 1 m³ de béton = 350 kg de
ciment (ratio par défaut).

## Feuille de route (par priorité)

1. **Persistance des projets** — enregistrer / rouvrir un métré (JSON export/import, puis
   IndexedDB, puis backend). C'est la limite la plus gênante aujourd'hui.
2. **Éditeur de composition matériaux** — permettre à l'utilisateur de définir les
   matériaux et dosages de chaque ouvrage (aujourd'hui codés en dur pour les ouvrages par
   défaut ; les ouvrages ajoutés n'ont pas de composition).
3. **Backend de conversion DWG → DXF** — pour avaler le format natif AutoCAD (impossible
   côté navigateur). Piste : service serveur avec ODA File Converter / Teigha.
4. **Analyse automatique d'images/PDF scannés** — nécessite vision/IA côté serveur
   (détection de murs, OCR des cotes). Brique lourde, « version pro ».
5. Plus de types d'éléments (escaliers, longrines détaillées, aciers en attente), export
   PDF du quantitatif matériaux, multi-pages/plans, comptes utilisateurs.

## Comment lancer

```
cd metrepro
npm start        # sert le dossier sur http://localhost:3000 (via npx serve)
# ou simplement ouvrir src/index.html dans un navigateur
```
