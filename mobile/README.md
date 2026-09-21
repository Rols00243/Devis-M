# MétréCards — scanner de cartes de visite

Application mobile **Android et iOS** (React Native + Expo + TypeScript) qui
photographie une carte de visite, en extrait les informations par **OCR + IA**,
les fait vérifier à l'utilisateur, puis crée le contact **dans le répertoire du
téléphone**.

```
OUVRIR  →  SCANNER  →  OCR + IA  →  VÉRIFIER  →  « ENREGISTRER »  →  CONTACT CRÉÉ
```

---

## Ce qui est implémenté

| Domaine | État |
|---|---|
| Capture caméra, cadre de visée, capture automatique sur stabilité | ✅ |
| Scanner natif (détection des bords + perspective redressée) | ✅ |
| Import depuis la galerie | ✅ |
| Recto-verso : le dos complète les champs restés vides | ✅ |
| OCR hors ligne (Google ML Kit) | ✅ |
| Extraction intelligente des 14 champs | ✅ |
| Extraction IA cloud (Claude vision) en renfort, dont l'arabe | ✅ |
| Écran de vérification, champs peu sûrs signalés | ✅ |
| Détection des doublons (numéro, e-mail, nom + entreprise) | ✅ |
| Création / mise à jour du contact natif | ✅ |
| Base locale SQLite, fonctionnement hors ligne complet | ✅ |
| Historique, recherche multi-critères, fiche détaillée | ✅ |
| Export vCard et CSV, partage | ✅ |
| Compte, sauvegarde cloud, synchronisation automatique | ✅ |
| Confidentialité : cloisonnement par utilisateur (RLS), suppression définitive | ✅ |

---

## Démarrer

### 1. Installer

```bash
cd mobile
npm install
cp .env.example .env      # facultatif : uniquement pour le cloud
```

### 2. Construire l'application

L'application utilise des **modules natifs** (OCR ML Kit, scanner de document,
répertoire). Elle ne fonctionne donc **pas dans Expo Go** : il faut un *build de
développement*, généré une fois, puis réutilisé à chaque modification du code JS.

```bash
# Android (téléphone branché en USB, débogage USB activé, ou émulateur lancé)
npm run android

# iOS (macOS + Xcode requis)
npm run ios
```

Puis, pour le développement quotidien :

```bash
npm start          # serveur de développement, l'app se recharge à chaque sauvegarde
```

> Sans build natif, l'application démarre quand même : elle signale que la
> reconnaissance hors ligne est indisponible et propose la saisie manuelle ou
> l'extraction cloud.

### 3. Vérifier

```bash
npm run check      # typecheck TypeScript + tests du moteur d'extraction
```

---

## Activer le cloud (facultatif)

Sans configuration, **tout reste sur le téléphone** et l'application est
pleinement fonctionnelle. Le cloud ajoute la sauvegarde, la synchronisation
multi-appareils et l'extraction IA.

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Exécuter `supabase/schema.sql` dans le SQL Editor : tables, règles d'accès
   par utilisateur (RLS) et bucket d'images.
3. Renseigner dans `.env` :
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=votre-cle-anon
   ```
4. Déployer les fonctions serveur :
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # clé du modèle : SERVEUR uniquement
   supabase functions deploy extract-card
   supabase functions deploy delete-account
   ```

**La clé du modèle d'IA ne doit jamais figurer dans l'application mobile** : un
APK se décompile. Elle est un secret de la fonction Edge, qui vérifie la session
de l'utilisateur avant chaque appel.

---

## Architecture

```
src/
  ai/            extraction intelligente des champs (pur TypeScript, testé)
    dictionaries.ts   formes juridiques, fonctions, villes, pays, indicatifs
    patterns.ts       e-mail, URL, LinkedIn, téléphone (E.164), normalisation
    extractor.ts      moteur : attribue chaque ligne au bon champ
    merge.ts          fusion local + cloud, champ par champ
  ocr/           pipeline image → texte
    imagePipeline.ts  redimensionnement et compression selon l'usage
    localOcr.ts       ML Kit, hors ligne
    cloudOcr.ts       appel de la fonction d'extraction IA
    documentScanner.ts scanner natif (détection des bords)
    index.ts          orchestrateur : local d'abord, cloud si nécessaire
  contacts/      répertoire natif
    contactService.ts création / mise à jour, permissions
    duplicates.ts     détection des doublons
  database/      SQLite : source de vérité locale
  storage/       images des cartes (dossier privé de l'app)
  services/      supabase, auth, synchronisation, exports
  store/         état global (zustand)
  screens/       accueil, scan, vérification, cartes, fiche, historique, réglages, compte
  components/    composants d'interface partagés
  navigation/    pile de navigation et types de routes
  theme/         couleurs, espacements, typographie
supabase/
  schema.sql            tables, RLS, bucket, purge des données
  functions/extract-card    extraction IA (Claude vision, sortie structurée)
  functions/delete-account  droit à l'effacement
tests/           tests du moteur d'extraction (node:test)
```

### Décisions techniques

**Hors ligne d'abord.** SQLite est la source de vérité ; le cloud n'est qu'une
réplication. Une carte scannée sans réseau est immédiatement utilisable, et
repart en synchronisation dès le retour de la connexion.

**OCR à deux étages.** ML Kit tourne sur l'appareil : instantané, gratuit, sans
réseau — mais son modèle latin ne lit pas l'arabe. L'IA cloud n'est appelée que
lorsqu'elle apporte quelque chose (lecture pauvre, écriture arabe, champs
manquants), puis les deux résultats sont fusionnés en gardant, champ par champ,
la valeur la plus sûre.

**Détection des contours déléguée au système.** ML Kit Document Scanner
(Android) et VisionKit (iOS) analysent le flux vidéo natif, déclenchent la
capture et redressent la perspective. Aucune boucle JavaScript n'atteint ce
niveau de fluidité. L'écran caméra intégré prend le relais si le module est
absent.

**Sécurité appliquée par le serveur.** Les règles RLS de PostgreSQL garantissent
qu'un utilisateur ne lit que ses propres cartes, même si le client est modifié.
La clé publique de l'application n'ouvre aucun accès par elle-même.

---

## Le moteur d'extraction

Le cœur de l'application n'est pas l'OCR mais ce qui vient après : comprendre la
structure d'une carte. Le moteur croise plusieurs signaux — étiquettes imprimées
(« Tél », « Mob »), formes juridiques (SARL, Ltd…), domaine de l'adresse e-mail,
position sur la carte, taille du texte, indicatif téléphonique — et attribue
chaque ligne à un champ, une seule fois.

Quelques comportements couverts par les tests :

- `j.dupont@abc.com` tranche l'ordre prénom / nom sur une ligne « DUPONT Jean » ;
- un numéro de RCCM, de TVA ou d'ID. NAT n'est jamais pris pour un téléphone ;
- le mobile devient le téléphone principal et alimente WhatsApp ;
- `+243 8l 0OO 12 34` est corrigé en `+243810001234` ;
- une adresse Gmail ne devient pas un nom d'entreprise ;
- le pays se déduit de la ville, de l'indicatif ou du domaine national.

```bash
npm test     # 22 tests
```

---

## Évolutions prévues

Le découpage en modules a été pensé pour ces ajouts : reconnaissance par lots
(plusieurs cartes sur une même photo), synchronisation Google Contacts et
Outlook, classement automatique des contacts, recherche sémantique, traduction
des cartes, reconnaissance des logos d'entreprise, statistiques, version web.

---

## Licence

Propriétaire — © 2026. Tous droits réservés.
