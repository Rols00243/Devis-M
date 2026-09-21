import type { ExpoConfig } from 'expo/config';

/**
 * Configuration Expo. Les messages de permission sont rédigés pour expliquer
 * l'usage réel : les magasins d'applications les refusent quand ils sont vagues,
 * et l'utilisateur mérite de savoir pourquoi on lui demande l'accès.
 */
const config: ExpoConfig = {
  name: 'MétréCards',
  slug: 'metrecards',
  version: '1.0.0',
  orientation: 'default', // portrait et paysage : une carte se photographie dans les deux sens
  icon: './assets/icon.png',
  scheme: 'metrecards',
  userInterfaceStyle: 'dark',
  assetBundlePatterns: ['**/*'],

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.metrepro.metrecards',
    infoPlist: {
      NSCameraUsageDescription:
        'Pour photographier vos cartes de visite et en extraire automatiquement les coordonnées.',
      NSPhotoLibraryUsageDescription:
        'Pour importer la photo d’une carte de visite déjà présente dans votre galerie.',
      NSContactsUsageDescription:
        'Pour créer la fiche du contact dans votre répertoire et détecter les doublons avant de l’ajouter.',
      NSMotionUsageDescription:
        'Pour déclencher la photo automatiquement lorsque le téléphone est immobile.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'com.metrepro.metrecards',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#0F1622',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.READ_CONTACTS',
      'android.permission.WRITE_CONTACTS',
      'android.permission.INTERNET',
    ],
    predictiveBackGestureEnabled: false,
  },

  plugins: [
    [
      // Depuis le SDK 54, l'écran de démarrage se configure par ce plugin.
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#0F1622',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'Pour photographier vos cartes de visite et en extraire automatiquement les coordonnées.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-contacts',
      {
        contactsPermission:
          'Pour créer la fiche du contact dans votre répertoire et détecter les doublons.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Pour importer la photo d’une carte de visite déjà présente dans votre galerie.',
      },
    ],
    [
      'react-native-document-scanner-plugin',
      {
        cameraPermission:
          'Pour scanner vos cartes de visite avec détection automatique des bords.',
      },
    ],
    [
      'expo-build-properties',
      {
        // Valeurs alignées sur celles d'Expo SDK 57 ; ML Kit exige Android 7 (API 24) au minimum.
        android: { minSdkVersion: 24, compileSdkVersion: 36, targetSdkVersion: 36 },
        ios: { deploymentTarget: '16.4' },
      },
    ],
  ],

  extra: {
    eas: {
      // Renseigné automatiquement par `eas init` au premier build.
      projectId: process.env.EAS_PROJECT_ID,
    },
  },

  experiments: { typedRoutes: false },
};

export default config;
