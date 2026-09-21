# Scan Card — contexte pour les agents

Application mobile de scan de cartes de visite (React Native + Expo SDK 57 +
TypeScript). Voir `README.md` pour l'architecture complète.

## Avant d'écrire du code Expo

Expo évolue vite. Vérifier la documentation versionnée avant d'utiliser une API :
<https://docs.expo.dev/versions/v57.0.0/>

Pièges déjà rencontrés sur ce SDK :

- `expo-file-system` utilise les classes `File` / `Directory` / `Paths`, plus
  l'ancienne API `FileSystem.documentDirectory`.
- `expo-image-manipulator` passe par `ImageManipulator.manipulate(uri)` puis
  `renderAsync()` et `saveAsync()` ; `manipulateAsync` est déprécié.
- `expo-contacts` expose la classe `Contact` (`Contact.create`,
  `Contact.getAllDetails`) ; les fonctions `addContactAsync` et consorts sont
  l'ancienne API. Un e-mail se note `{ label, address }`, pas `{ label, email }`.
- `app.config.ts` n'accepte plus `newArchEnabled`, `splash` ni
  `android.edgeToEdgeEnabled` : l'écran de démarrage passe par le plugin
  `expo-splash-screen`.

## Règles du projet

- **Le moteur d'extraction (`src/ai/`) reste pur** : aucun import React Native,
  pour qu'il tourne sous `node:test`. Toute modification s'accompagne d'un test.
  Même règle pour `src/services/vcard.ts` et `src/utils/pure.ts`.
- **Les numéros sortent en E.164.** Toute écriture vers l'extérieur (contact
  natif, vCard, CSV) passe par `normalizePhone` avec l'indicatif des réglages :
  c'est ce qui permet au téléphone, à WhatsApp et au compte synchronisé de
  reconnaître un même numéro.
- **Une seule couche écrit en base** : `src/database/cardRepository.ts`.
- **Aucune clé secrète dans l'application.** La clé du modèle d'IA vit dans la
  fonction Edge Supabase. L'app ne connaît que l'URL et la clé anon.
- **Hors ligne d'abord** : toute fonctionnalité doit se comporter correctement
  sans réseau et sans compte.
- Interface en français, thème sombre, zones tactiles d'au moins 48 px.

## Vérifier

```bash
npm run check     # tsc --noEmit puis les tests
```
