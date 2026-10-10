/**
 * Point d'entrée : prépare la base locale, charge les préférences, restaure la
 * session, puis surveille le réseau pour relancer la synchronisation.
 */
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Loader } from './components';
import { getDb } from './database/db';
import RootNavigator from './navigation/RootNavigator';
import { watchConnectivity } from './services/sync';
import { useAuthStore } from './store/authStore';
import { useCardsStore } from './store/cardsStore';
import { useSettingsStore } from './store/settingsStore';
import { makeStyles, spacing, ThemeProvider, useTheme } from './theme';
import { errorMessage, log } from './utils';

/**
 * L'enveloppe : elle fournit le thème avant tout rendu, pour qu'aucun écran ne
 * s'affiche dans la mauvaise teinte, même le temps d'une image.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const styles = useStyles();
  const { scheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeAuth: (() => void) | undefined;
    let unsubscribeNet: (() => void) | undefined;

    (async () => {
      try {
        await getDb();
        await useSettingsStore.getState().load();
        await useCardsStore.getState().refresh();
        unsubscribeAuth = await useAuthStore.getState().init();
        unsubscribeNet = watchConnectivity((report) =>
          log.info('Synchronisation automatique', report),
        );
      } catch (e) {
        log.error('Démarrage', e);
        setFatal(errorMessage(e));
      } finally {
        setReady(true);
      }
    })();

    return () => {
      unsubscribeAuth?.();
      unsubscribeNet?.();
    };
  }, []);

  if (fatal) {
    return (
      <View style={styles.fatal}>
        <Text style={styles.fatalTitle}>Démarrage impossible</Text>
        <Text style={styles.fatalText}>{fatal}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Loader label="Préparation du répertoire…" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </>
  );
}

const useStyles = makeStyles(({ colors, typography }) => ({
  splash: { flex: 1, backgroundColor: colors.bg },
  fatal: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  fatalTitle: { ...typography.h1 },
  fatalText: { ...typography.caption, textAlign: 'center' },
}));
