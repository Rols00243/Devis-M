/**
 * Compte et sauvegarde en ligne. Facultatif : l'application fonctionne sans.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton, Card, Field, Row, Screen, SectionTitle } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { syncNow } from '../services/sync';
import { useAuthStore } from '../store/authStore';
import { colors, spacing, typography } from '../theme';
import { errorMessage } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'Account'>;

export default function AccountScreen({ navigation }: Props) {
  const { user, busy, error, login, register, logout, clearError, cloudConfigured } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');

  const submit = useCallback(async () => {
    clearError();
    const ok = mode === 'login' ? await login(email, password) : await register(email, password);
    if (ok) {
      setPassword('');
      const report = await syncNow();
      if (!report.skipped) {
        Alert.alert('Connecté', `${report.pulled} carte(s) récupérée(s), ${report.pushed} envoyée(s).`);
      }
    }
  }, [clearError, email, login, mode, password, register]);

  const confirmLogout = useCallback(() => {
    Alert.alert('Se déconnecter ?', 'Vos cartes restent sur ce téléphone.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void logout() },
    ]);
  }, [logout]);

  if (!cloudConfigured) {
    return (
      <Screen scroll>
        <SectionTitle>Sauvegarde en ligne</SectionTitle>
        <Card>
          <Text style={styles.text}>
            Cette installation n'est pas reliée à un espace cloud. Renseignez
            EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY dans le fichier `.env`, puis
            relancez l'application.
          </Text>
        </Card>
        <AppButton label="Retour" variant="ghost" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  if (user) {
    return (
      <Screen scroll>
        <SectionTitle>Compte</SectionTitle>
        <Card>
          <Row label="Connecté en tant que" value={user.email ?? '—'} />
          <Text style={styles.text}>
            Vos cartes sont sauvegardées dans un espace privé : personne d'autre que vous n'y a
            accès. La synchronisation reprend automatiquement dès que le réseau revient.
          </Text>
        </Card>
        <AppButton label="Synchroniser maintenant" icon="☁️" variant="secondary" onPress={() => void syncNow()} />
        <AppButton label="Se déconnecter" variant="danger" busy={busy} onPress={confirmLogout} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <SectionTitle>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</SectionTitle>
      <Card>
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="vous@entreprise.com"
        />
        <Field
          label="Mot de passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="6 caractères minimum"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <AppButton
          label={mode === 'login' ? 'Se connecter' : 'Créer le compte'}
          busy={busy}
          onPress={submit}
        />
        <AppButton
          label={mode === 'login' ? "Je n'ai pas encore de compte" : "J'ai déjà un compte"}
          variant="ghost"
          onPress={() => {
            clearError();
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        />
      </Card>
      <View>
        <Text style={styles.text}>
          Le compte sert uniquement à sauvegarder vos cartes et à les retrouver sur un autre
          appareil. Sans compte, l'application fonctionne normalement, en local.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { ...typography.caption, lineHeight: 19 },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
});
