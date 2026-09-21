/**
 * Point d'entrée : prépare la base locale, charge les préférences, restaure la
 * session, puis surveille le réseau pour relancer la synchronisation.
 */
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Loader } from './components';
import { getDb } from './database/db';
import RootNavigator from './navigation/RootNavigator';
import { watchConnectivity } from './services/sync';
import { useAuthStore } from './store/authStore';
import { useCardsStore } from './store/cardsStore';
import { useSettingsStore } from './store/settingsStore';
import { colors, spacing, typography } from './theme';
import { errorMessage, log } from './utils';

export default function App() {
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
      <SafeAreaProvider>
        <View style={styles.fatal}>
          <Text style={styles.fatalTitle}>Démarrage impossible</Text>
          <Text style={styles.fatalText}>{fatal}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <Loader label="Préparation du répertoire…" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
});
