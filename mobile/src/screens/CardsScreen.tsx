/**
 * Liste des cartes, avec recherche multi-critères (nom, entreprise, téléphone,
 * e-mail, ville) et filtres. Sert aussi bien à « Mes cartes » qu'à
 * « Contacts enregistrés », qui n'est qu'un filtre sur la même liste.
 */
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton, Badge, EmptyState, Screen } from '../components';
import { listCards } from '../database/cardRepository';
import type { RootStackParamList } from '../navigation/types';
import { shareAllVcf, shareCsv } from '../services/export';
import { TOUCH_TARGET, makeStyles, radius, spacing, useTheme } from '../theme';
import type { BusinessCard } from '../types';
import { displayName, formatRelativeDay, initials } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'Cards'>;

type Filter = 'all' | 'withContact' | 'withoutContact';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Toutes',
  withContact: 'Dans le répertoire',
  withoutContact: 'À enregistrer',
};

export default function CardsScreen({ navigation, route }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>(route.params?.filter ?? 'all');
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<BusinessCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listCards({
      query,
      withContact: filter === 'all' ? undefined : filter === 'withContact',
    });
    setCards(result);
    setLoading(false);
  }, [filter, query]);

  // La recherche se déclenche après une courte pause de frappe, pour ne pas
  // interroger la base à chaque caractère.
  useEffect(() => {
    const timer = setTimeout(load, query ? 220 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const title = useMemo(
    () => `${cards.length} carte${cards.length > 1 ? 's' : ''}`,
    [cards.length],
  );

  return (
    <Screen edges={['bottom']}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un nom, une entreprise, un numéro…"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Rechercher dans les cartes"
        />
        <View style={styles.filters}>
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f }}
              onPress={() => setFilter(f)}
              style={[styles.chip, filter === f && styles.chipOn]}>
              <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>
                {FILTER_LABELS[f]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.count}>{loading ? 'Chargement…' : title}</Text>
      </View>

      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={cards.length ? styles.list : styles.listEmpty}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <CardRow card={item} onPress={() => navigation.navigate('CardDetail', { cardId: item.id })} />
        )}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="📇"
              title={query ? 'Aucun résultat' : 'Aucune carte'}
              message={
                query
                  ? 'Aucune carte ne correspond à cette recherche.'
                  : 'Scannez votre première carte de visite : les informations seront extraites automatiquement.'
              }
              action={
                query ? null : (
                  <AppButton
                    label="Scanner une carte"
                    icon="📇"
                    onPress={() => navigation.navigate('Scan')}
                  />
                )
              }
            />
          )
        }
      />

      {cards.length ? (
        <View style={styles.exportBar}>
          <AppButton
            label="Export vCard"
            icon="⬇"
            variant="secondary"
            style={styles.exportButton}
            onPress={() => shareAllVcf(cards)}
          />
          <AppButton
            label="Export CSV"
            icon="⬇"
            variant="secondary"
            style={styles.exportButton}
            onPress={() => shareCsv(cards)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function CardRow({ card, onPress }: { card: BusinessCard; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName(card)}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(card)}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {displayName(card)}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[card.jobTitle, card.company].filter(Boolean).join(' · ') || card.phone || card.email || '—'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {card.contactId ? <Badge label="✓ répertoire" tone="success" /> : null}
        <Text style={styles.rowDate}>{formatRelativeDay(card.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, typography, elevation }) => ({
  header: { padding: spacing.lg, gap: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH_TARGET,
    color: colors.text,
    fontSize: 15,
  },
  filters: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12.5, color: colors.textMuted },
  chipTextOn: { color: colors.white, fontWeight: '600' },
  count: { ...typography.caption },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  listEmpty: { flexGrow: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: TOUCH_TARGET + 12,
  },
  pressed: { opacity: 0.75 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...typography.h2 },
  rowMeta: { ...typography.caption },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  rowDate: { fontSize: 11, color: colors.textFaint },

  exportBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  exportButton: { flex: 1 },
}));
