# Scan Card — enregistreur de cartes de visite

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
| Rien n'est jeté : tout le reste de la carte est conservé et modifiable | ✅ |
| Extraction IA cloud (Claude vision) en renfort, dont l'arabe | ✅ |
| Écran de vérification, champs peu sûrs signalés | ✅ |
| Détection des doublons (numéro, e-mail, nom + entreprise) | ✅ |
| Création / mise à jour du contact natif (avec la photo de la carte) | ✅ |
| Dépôt du contact dans un compte synchronisé (Google, iCloud, Outlook) | ✅ |
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
    destinations.ts   dépôt de la fiche dans un compte synchronisé
    duplicates.ts     détection des doublons
  database/      SQLite : source de vérité locale
  storage/       images des cartes (dossier privé de l'app)
  services/      supabase, auth, synchronisation, exports
    vcard.ts          vCard 3.0 et CSV (pur, testé)
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

**Deux passes de lecture.** Sur une carte, la plus petite ligne est presque
toujours un numéro de téléphone. Le détecteur de ML Kit a une échelle de
prédilection : l'image est donc lue deux fois, en vue d'ensemble puis agrandie,
et les lignes des deux passes sont réunies. La seconde passe ne peut qu'ajouter
du texte. C'est aussi pourquoi la capture vise la qualité maximale, attend une
immobilité franche — un léger flou efface les petits caractères — et invite à
remplir le cadre avec la carte.

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

**Une carte ne tient pas dans un formulaire.** Le formulaire a 14 cases ; une
carte imprime ce qu'elle veut — un troisième numéro, un fax, un deuxième
e-mail, une page Facebook, un RCCM, une seconde agence, un slogan. Le moteur
attribue chaque ligne au champ qui lui convient, puis **conserve tout le reste**
sous forme d'informations supplémentaires, libellées et modifiables à la
vérification. Une ligne que le moteur ne comprend pas n'est pas du bruit : c'est
une information de la carte, et elle est gardée telle quelle. À
l'enregistrement, chacune rejoint le champ natif qui lui correspond — un numéro
dans les numéros, un e-mail dans les e-mails, un réseau social dans les profils
— et ce qui n'a pas de champ dédié est écrit dans les notes du contact. Le texte
OCR intégral reste par ailleurs attaché à la carte.

**Le numéro doit être trouvable partout.** Un contact écrit par une
application atterrit *sur l'appareil* : il s'affiche dans le répertoire, donc
dans le téléphone, dans WhatsApp et dans toute application qui lit les
contacts — mais il n'est recopié dans aucun compte, et il ne suit pas
l'utilisateur qui change de téléphone. L'application propose donc, juste après
la création, de déposer la même fiche dans un compte synchronisé : elle est
remise à l'application Contacts du système sous forme de vCard, et celle-ci
demande le compte (Google, iCloud, Outlook). Le numéro apparaît alors aussi
dans Google Contacts, dans la messagerie, sur le web et sur les autres
appareils. Ni Android ni iOS ne laissent une application choisir ce compte
elle-même ; Android regroupe les fiches de même nom, donc écrire aux deux
endroits n'affiche pas deux contacts.

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
- « Tél : 081 000 0000 / 099 111 1111 » donne bien deux numéros, pas zéro ;
- « +243 (0)81 … » perd le zéro national au lieu de l'inclure dans le numéro ;
- le mobile devient le téléphone principal et alimente WhatsApp ;
- `+243 8l 0OO 12 34` est corrigé en `+243810001234` ;
- une adresse Gmail ne devient pas un nom d'entreprise ;
- le pays se déduit de la ville, de l'indicatif ou du domaine national ;
- un fax ne devient jamais le téléphone principal, même seul sur la carte ;
- un troisième numéro, un second e-mail, un RCCM ou un slogan sont conservés.

```bash
npm test     # 47 tests
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
