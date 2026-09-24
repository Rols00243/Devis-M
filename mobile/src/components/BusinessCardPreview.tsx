/**
 * Aperçu de la carte de visite, aux proportions réelles (85 × 55 mm).
 *
 * Il se met à jour à chaque frappe : l'utilisateur voit ce qu'il fabrique, et
 * n'a pas à imprimer pour découvrir que son nom déborde. Le rendu reprend les
 * trois modèles de la version imprimée, afin que l'écran ne mente pas.
 */
import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { contactLines, myCardVCard } from '../mycard/model';
import { qrMatrix } from '../mycard/qr';
import { radius, spacing } from '../theme';
import type { MyCard } from '../types';
import { displayName } from '../utils';

/** Rapport largeur / hauteur d'une carte de visite normalisée. */
export const CARD_RATIO = 85 / 55;

export function BusinessCardPreview({
  card,
  defaultCountryCode,
}: {
  card: MyCard;
  defaultCountryCode?: string;
}) {
  const accent = /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent : '#2563EB';
  const bold = card.template === 'bold';

  const ink = bold ? '#FFFFFF' : '#111827';
  const inkSoft = bold ? 'rgba(255,255,255,0.92)' : '#4B5563';
  const background = bold ? accent : '#FFFFFF';

  const lines = useMemo(
    () => contactLines(card, defaultCountryCode).slice(0, 5),
    [card, defaultCountryCode],
  );

  const matrix = useMemo(
    () => (card.showQrCode ? qrMatrix(myCardVCard(card, defaultCountryCode)) : null),
    [card, defaultCountryCode],
  );

  return (
    <View style={[styles.card, { backgroundColor: background }]}>
      {card.template === 'classic' ? (
        <View style={[styles.stripe, { backgroundColor: accent }]} />
      ) : null}

      <View style={[styles.body, card.template === 'classic' && styles.bodyWithStripe]}>
        {card.logoUri ? (
          <Image source={{ uri: card.logoUri }} style={styles.logo} resizeMode="contain" />
        ) : null}

        <Text style={[styles.name, { color: ink }, card.template === 'minimal' && { borderBottomColor: accent, borderBottomWidth: 2 }]} numberOfLines={1}>
          {displayName(card)}
        </Text>
        {card.jobTitle ? (
          <Text style={[styles.job, { color: bold ? inkSoft : accent }]} numberOfLines={1}>
            {card.jobTitle}
          </Text>
        ) : null}
        {card.company ? (
          <Text style={[styles.company, { color: ink }]} numberOfLines={1}>
            {card.company}
          </Text>
        ) : null}
        {card.slogan ? (
          <Text style={[styles.slogan, { color: inkSoft }]} numberOfLines={1}>
            {card.slogan}
          </Text>
        ) : null}

        <View style={styles.contacts}>
          {lines.map((line) => (
            <Text key={line.text} style={[styles.line, { color: inkSoft }]} numberOfLines={1}>
              {line.icon}  {line.text}
            </Text>
          ))}
        </View>
      </View>

      {matrix ? <QrBlock matrix={matrix} /> : null}
    </View>
  );
}

/**
 * Le QR dessiné ligne par ligne : les modules noirs contigus forment un seul
 * bloc, ce qui divise par dix le nombre de vues à afficher.
 */
function QrBlock({ matrix }: { matrix: { size: number; modules: boolean[][] } }) {
  return (
    <View style={styles.qr}>
      <View style={styles.qrInner}>
        {matrix.modules.map((row, y) => (
          <View key={y} style={styles.qrRow}>
            {runs(row).map((run, i) => (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(run.start / matrix.size) * 100}%`,
                  width: `${(run.length / matrix.size) * 100}%`,
                  top: `${(y / matrix.size) * 100}%`,
                  height: `${(1 / matrix.size) * 100}%`,
                  backgroundColor: '#111827',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Suites de modules noirs d'une ligne. */
function runs(row: boolean[]): { start: number; length: number }[] {
  const out: { start: number; length: number }[] = [];
  let start = -1;
  for (let x = 0; x <= row.length; x++) {
    const dark = x < row.length && row[x];
    if (dark && start < 0) start = x;
    if (!dark && start >= 0) {
      out.push({ start, length: x - start });
      start = -1;
    }
  }
  return out;
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: CARD_RATIO,
    borderRadius: radius.md,
    overflow: 'hidden',
    flexDirection: 'row',
    padding: spacing.md,
    // L'aperçu a sa propre ombre : la carte doit se détacher du fond de l'écran.
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 10 },
  body: { flex: 1, justifyContent: 'center', gap: 2 },
  bodyWithStripe: { paddingLeft: spacing.sm },
  logo: { height: 22, width: 64, alignSelf: 'flex-start', marginBottom: 2 },
  name: { fontSize: 17, fontWeight: '800', alignSelf: 'flex-start' },
  job: { fontSize: 11, fontWeight: '600' },
  company: { fontSize: 11.5, fontWeight: '700' },
  slogan: { fontSize: 9.5, fontStyle: 'italic' },
  contacts: { marginTop: 5, gap: 1 },
  line: { fontSize: 9.5 },
  qr: { width: 62, alignItems: 'flex-end', justifyContent: 'flex-end' },
  qrInner: {
    width: 58,
    height: 58,
    backgroundColor: '#FFFFFF',
    padding: 3,
  },
  // Chaque ligne couvre tout le carré : ses blocs sont placés en pourcentage.
  qrRow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
});
