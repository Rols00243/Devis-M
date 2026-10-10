/**
 * Historique des scans, groupé par jour, avec le statut de chaque carte :
 * contact créé, enregistrée seulement, ou brouillon à finir de vérifier.
 */
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import { AppButton, Badge, EmptyState, Screen } from '../components';
import { listCards } from '../database/cardRepository';
import type { RootStackParamList } from '../navigation/types';
import { TOUCH_TARGET, makeStyles, radius, spacing, useTheme } from '../theme';
import type { BusinessCard, CardStatus } from '../types';
import { displayName, formatDateTime, initials } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

const STATUS: Record<CardStatus, { label: string; tone: 'success' | 'warning' | 'neutral' | 'info' }> = {
  contact_created: { label: 'contact créé', tone: 'success' },
  validated: { label: 'enregistrée', tone: 'info' },
  draft: { label: 'à vérifier', tone: 'warning' },
  archived: { label: 'archivée', tone: 'neutral' },
};

export default function HistoryScreen({ navigation }: Props) {
  const styles = useStyles();
  const [cards, setCards] = useState<BusinessCard[]>([]);

  useFocusEffect(
    useCallback(() => {
      listCards().then(setCards);
    }, []),
  );

  // Regroupement par jour : l'historique se lit comme un journal.
  const sections = useMemo(() => {
    const groups = new Map<string, BusinessCard[]>();
    cards.forEach((card) => {
      const day = new Date(card.createdAt).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      groups.set(day, [...(groups.get(day) ?? []), card]);
    });
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [cards]);

  return (
    <Screen edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={cards.length ? styles.list : styles.listEmpty}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={displayName(item)}
            onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Text style={styles.thumbText}>{initials(item)}</Text>
              </View>
            )}
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName(item)}
              </Text>
              {item.company ? (
                <Text style={styles.company} numberOfLines={1}>
                  {item.company}
                </Text>
              ) : null}
              <Text style={styles.date}>{formatDateTime(item.createdAt)}</Text>
            </View>
            <Badge label={STATUS[item.status].label} tone={STATUS[item.status].tone} />
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="🕓"
            title="Aucun scan pour le moment"
            message="Chaque carte scannée apparaîtra ici, avec sa photo et son statut."
            action={<AppButton label="Scanner une carte" icon="📇" onPress={() => navigation.navigate('Scan')} />}
          />
        }
      />
    </Screen>
  );
}

const useStyles = makeStyles(({ colors, typography, elevation }) => ({
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  listEmpty: { flexGrow: 1 },
  sectionHeader: {
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: TOUCH_TARGET + 16,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.75 },
  thumb: { width: 56, height: 38, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbText: { color: colors.primary, fontWeight: '700' },
  body: { flex: 1, gap: 2 },
  name: { ...typography.h2 },
  company: { ...typography.caption },
  date: { fontSize: 11, color: colors.textFaint },
}));
