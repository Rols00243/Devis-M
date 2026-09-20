# CartePro — scanner de cartes de visite

Application **mobile** (PWA installable) qui photographie une carte de visite, en lit le
texte, en extrait les coordonnées et **enregistre automatiquement la fiche dans le
répertoire**. Elle peut ensuite pousser le contact dans le carnet d'adresses du téléphone.

Tout fonctionne **côté client** : aucune photo, aucun contact n'est envoyé sur un serveur.

## Fonctionnement

```
Photo (caméra ou galerie)
  → pré-traitement canvas (redimensionnement, niveaux de gris, contraste)
  → OCR Tesseract.js (français + anglais)
  → analyse du texte (nom, société, fonction, tél., e-mails, sites, adresse)
  → fiche enregistrée dans IndexedDB  ← « répertoire »
  → export vCard (.vcf) vers les contacts du téléphone
```

## Fonctionnalités

- **Scan** par appareil photo natif ou caméra en direct (avec cadre de visée), ou import
  d'une image existante ; rotation + relance de la lecture si le résultat est mauvais.
- **Extraction automatique** : prénom / nom (y compris « DUPONT Jean » remis dans l'ordre,
  recoupé avec l'adresse e-mail), société (formes juridiques SARL, SAS, Ltd…), fonction,
  téléphones **typés** (mobile / bureau / fax) et normalisés au format international,
  e-mails, sites web, rue, code postal, ville, pays. Les numéros SIRET / TVA sont ignorés.
- **Enregistrement automatique** dans le répertoire dès la fin de la lecture (désactivable),
  avec **détection des doublons** (même e-mail, même numéro ou même nom) et fusion des
  fiches plutôt que duplication.
- **Répertoire** : recherche instantanée (insensible aux accents), tri, fiche détaillée avec
  appel / SMS / e-mail / itinéraire, édition, suppression, photo de la carte conservée.
- **Carnet d'adresses du téléphone** : bouton « Ajouter au téléphone » → partage natif du
  fichier vCard (Android / iOS) ou téléchargement `.vcf`.
- **Import / export** : `.vcf` (vCard 2.1 / 3.0 / 4.0) et CSV (séparateur `;`, compatible Excel).
- **PWA** : installable sur l'écran d'accueil, utilisable hors connexion (la coque et le
  moteur OCR sont mis en cache après la première lecture).

## Lancer

```bash
npm run start:cartes      # http://localhost:3000  (puis ouvrir sur le téléphone)
```

La caméra et le service worker exigent **HTTPS** (ou `localhost`) : pour tester depuis un
téléphone sur le réseau local, passez par un tunnel HTTPS ou déployez le dossier sur un
hébergement statique.

## Tester

```bash
npm run test:cartes       # Playwright / Chromium — 61 vérifications
```

Deux suites : `tests/app.test.js` (analyse des cartes, vCard, parcours répertoire,
doublons, persistance) et `tests/ocr.test.js` (chaîne photo → OCR → fiche, pré-traitement
de l'image, repli quand le moteur OCR est indisponible — le moteur est simulé pour que les
tests tournent hors connexion).

## Fichiers

```
cartes/
  index.html            écrans (scan, répertoire, réglages, fiche) + navigation
  styles.css            thème sombre mobile (mêmes variables que MétréPro)
  app.js                toute la logique, en sections numérotées :
                        1 capture · 2 pré-traitement · 3 OCR · 4 analyse du texte
                        5 formulaire · 6 répertoire · 7 vCard · 8 réglages
  sw.js                 service worker (hors-ligne + cache du moteur OCR)
  manifest.webmanifest  métadonnées PWA
  icons/                icônes (SVG + PNG 192/512 + maskable)
  tests/                suites Playwright
```

## Réglages disponibles

Langues de l'OCR · indicatif pays par défaut (normalisation des numéros commençant par 0) ·
enregistrement automatique · proposition d'ajout au téléphone · conservation de la photo.

## Limites connues

- L'écriture directe dans les contacts du téléphone n'existe pas sur le web : le passage se
  fait par un fichier vCard (un tap pour confirmer l'import).
- La qualité de l'OCR dépend de la photo : carte bien à plat, nette, sans reflet.
- Les logos et les cartes très graphiques (texte sur fond coloré, vertical) restent difficiles
  à lire ; la fiche est alors partiellement remplie et se corrige à la main.
- Le moteur OCR (~ 5 Mo) est téléchargé à la première utilisation, puis mis en cache.
