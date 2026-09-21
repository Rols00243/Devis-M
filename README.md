# MétréPro

Logiciel de **métré, chiffrage et quantitatif matériaux** pour le bâtiment, avec un module
**structure béton armé** (semelles, poteaux, poutres, dalles… → volume de béton et poids
d'acier) et une **analyse automatique** des plans vectoriels.

> Outil de **devis / estimatif**. Ce n'est pas un logiciel de calcul de béton armé
> réglementaire : l'utilisateur fournit les paramètres, le logiciel estime les quantités.

## Fonctionnalités

- **Import de plans** : DXF (CAO, avec détection automatique de l'échelle), PDF, images
  (BMP / JPG / PNG). Le DWG (AutoCAD) doit être converti en DXF/PDF au préalable.
- **Mise à l'échelle** manuelle (tracer une cote connue) ou automatique (DXF).
- **Outils de mesure** : longueur (ml), surface (m²), volume (m³), comptage (u).
- **Analyse automatique** : détecte les surfaces et longueurs d'un plan vectoriel et
  génère le devis d'un clic.
- **Structure béton armé** : on place un élément, le logiciel demande dimensions +
  armatures, puis calcule le **béton (m³)** et l'**acier (kg)**.
- **Travail par étapes** : Fondations → Élévation → Second œuvre.
- **Paramètres par défaut** par type + **placement rapide** (un clic = un élément).
- **Tableau de métré** modifiable ligne par ligne, groupé par étape.
- **Quantitatif matériaux** : quantités de ciment, sable, gravier, acier, peinture… et
  coût estimé, déduits automatiquement des mesures.
- **Bibliothèque d'ouvrages** éditable, **devise** paramétrable (€, $, £, FCFA, ₦, DH…),
  **TVA**, export **CSV** et **devis PDF**.

## Lancer

```bash
npm start          # sert le dossier sur http://localhost:3000
```

Ou ouvrez simplement `src/index.html` dans un navigateur (Chrome, Firefox, Edge…).

## Structure

- `src/index.html` — interface
- `src/styles.css` — style
- `src/app.js` — logique (vanilla JS, seule dépendance : pdf.js via CDN)
- `mobile/` — **MétréCards**, l'application mobile de scan de cartes de visite
- `CLAUDE.md` — contexte et feuille de route pour développer avec Claude Code

## MétréCards — application mobile

`mobile/` contient une application Android et iOS (React Native + Expo +
TypeScript) qui photographie une carte de visite, en extrait les coordonnées par
**OCR + IA**, les fait vérifier, puis crée le contact **dans le répertoire du
téléphone**. Elle fonctionne hors ligne et peut sauvegarder les cartes en ligne.

```bash
cd mobile
npm install
npm run android     # ou npm run ios (macOS)
```

Voir `mobile/README.md` pour l'architecture, la configuration du cloud et les
décisions techniques.

## Feuille de route

Voir `CLAUDE.md`. En résumé : persistance des projets, éditeur de composition matériaux,
conversion DWG côté serveur, analyse IA des plans scannés.

## Licence

Propriétaire — © 2026. Tous droits réservés.
