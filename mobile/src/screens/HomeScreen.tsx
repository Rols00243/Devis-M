/**
 * Accueil : le scan est l'action principale, tout le reste passe après.
 * Les compteurs donnent en un regard l'état du répertoire.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/authStore';
import { useCardsStore } from '../store/cardsStore';
import { TOUCH_TARGET, makeStyles, radius, spacing, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const styles = useStyles();
  const { stats, refresh } = useCardsStore();
  const { user, cloudConfigured } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.brand}>
          Scan <Text style={styles.brandAccent}>Card</Text>
        </Text>
        <Text style={styles.tagline}>
          Scannez une carte de visite, le contact part dans le répertoire.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scanner une carte de visite"
        onPress={() => navigation.navigate('Scan')}
        style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}>
        <Text style={styles.scanIcon}>📇</Text>
        <Text style={styles.scanLabel}>Scanner une carte</Text>
        <Text style={styles.scanHint}>Cadrez la carte, le reste est automatique</Text>
      </Pressable>

      <View style={styles.statsRow}>
        <Stat value={stats.total} label="cartes" />
        <Stat value={stats.last7days} label="cette semaine" highlight />
        <Stat value={stats.withContact} label="dans le répertoire" />
      </View>

      <View style={styles.menu}>
        <MenuItem
          icon="🪪"
          title="Ma carte de visite"
          subtitle="Créez la vôtre, avec QR code, et partagez-la"
          onPress={() => navigation.navigate('MyCard')}
        />
        <MenuItem
          icon="🗂"
          title="Mes cartes"
          subtitle="Toutes les cartes scannées"
          onPress={() => navigation.navigate('Cards', { filter: 'all' })}
        />
        <MenuItem
          icon="👥"
          title="Contacts enregistrés"
          subtitle={`${stats.withContact} contact${stats.withContact > 1 ? 's' : ''} créé${
            stats.withContact > 1 ? 's' : ''
          } dans le téléphone`}
          onPress={() => navigation.navigate('Cards', { filter: 'withContact' })}
        />
        <MenuItem
          icon="🕓"
          title="Historique"
          subtitle="Tous les scans, du plus récent au plus ancien"
          onPress={() => navigation.navigate('History')}
        />
        <MenuItem
          icon="⚙️"
          title="Paramètres"
          subtitle="Scan, IA, sauvegarde et confidentialité"
          onPress={() => navigation.navigate('Settings')}
        />
        {cloudConfigured ? (
          <MenuItem
            icon={user ? '☁️' : '🔒'}
            title={user ? 'Compte et sauvegarde' : 'Se connecter'}
            subtitle={user?.email ?? 'Sauvegardez vos cartes et retrouvez-les sur tout appareil'}
            onPress={() => navigation.navigate('Account')}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function Stat({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <View style={styles.menuText}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.menuChevron}>›</Text>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, typography, elevation }) => ({
  header: { gap: spacing.xs, marginBottom: spacing.xs, marginTop: spacing.sm },
  brand: { ...typography.display },
  brandAccent: { color: colors.primary },
  tagline: { ...typography.caption, lineHeight: 20 },

  scanButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
    // L'action principale se détache franchement du reste de l'écran.
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  scanIcon: { fontSize: 42 },
  scanLabel: { fontSize: 21, fontWeight: '800', color: colors.onPrimary, letterSpacing: -0.2 },
  scanHint: { fontSize: 13, color: 'rgba(255,255,255,0.88)' },
  pressed: { opacity: 0.75 },

  statsRow: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
    ...elevation,
  },
  statValue: { fontSize: 23, fontWeight: '800', color: colors.text },
  statValueHighlight: { color: colors.success },
  statLabel: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },

  menu: { gap: spacing.sm, marginTop: spacing.sm },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: TOUCH_TARGET + 8,
    ...elevation,
  },
  menuIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  menuText: { flex: 1, gap: 2 },
  menuTitle: { ...typography.h2 },
  menuSubtitle: { ...typography.caption },
  menuChevron: { fontSize: 26, color: colors.textFaint },
}));
