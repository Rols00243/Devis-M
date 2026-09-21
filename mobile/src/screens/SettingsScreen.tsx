/**
 * Paramètres : comportement du scan, confidentialité, stockage et exports.
 * Chaque réglage est expliqué en une phrase : l'utilisateur doit comprendre ce
 * qui sort de son téléphone, et ce qui n'en sort pas.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton, Card, Row, Screen, SectionTitle } from '../components';
import { listCards, referencedImages } from '../database/cardRepository';
import { DIALING_CODES } from '../ai/dictionaries';
import type { RootStackParamList } from '../navigation/types';
import { isCloudOcrAvailable, isLocalOcrAvailable } from '../ocr';
import { isDocumentScannerAvailable } from '../ocr/documentScanner';
import { shareAllVcf, shareCsv } from '../services/export';
import { syncNow } from '../services/sync';
import { formatBytes, imagesFootprint, pruneOrphanImages } from '../storage/images';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { colors, spacing, typography } from '../theme';
import type { AppSettings } from '../types';
import { errorMessage } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { settings, set } = useSettingsStore();
  const { user, cloudConfigured } = useAuthStore();
  const [footprint, setFootprint] = useState({ count: 0, bytes: 0 });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setFootprint(imagesFootprint());
  }, []);

  const toggle = useCallback(
    (key: keyof AppSettings) => (value: boolean) => {
      void set(key, value as never);
    },
    [set],
  );

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const report = await syncNow();
      Alert.alert(
        'Synchronisation',
        report.skipped
          ? (report.reason ?? 'Rien à synchroniser.')
          : `${report.pushed} envoyée(s), ${report.pulled} reçue(s), ${report.images} image(s).`,
      );
    } catch (e) {
      Alert.alert('Synchronisation impossible', errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }, []);

  const cleanImages = useCallback(async () => {
    const referenced = await referencedImages();
    const removed = pruneOrphanImages(referenced);
    setFootprint(imagesFootprint());
    Alert.alert('Nettoyage terminé', `${removed} image(s) inutilisée(s) supprimée(s).`);
  }, []);

  const exportAll = useCallback(
    async (format: 'vcf' | 'csv') => {
      const cards = await listCards();
      if (!cards.length) {
        Alert.alert('Rien à exporter', "Aucune carte n'est enregistrée.");
        return;
      }
      if (format === 'vcf') await shareAllVcf(cards);
      else await shareCsv(cards);
    },
    [],
  );

  const nextCountryCode = useCallback(() => {
    // Rotation sur les indicatifs les plus utilisés du marché visé.
    const codes = ['+243', '+242', '+237', '+221', '+225', '+33', '+32', '+212', '+1'];
    const index = codes.indexOf(settings.defaultCountryCode);
    void set('defaultCountryCode', codes[(index + 1) % codes.length]);
  }, [set, settings.defaultCountryCode]);

  return (
    <Screen scroll>
      <SectionTitle>Scan</SectionTitle>
      <Card>
        <Toggle
          label="Enchaîner les scans"
          hint="Après chaque enregistrement, la caméra se rouvre pour la carte suivante."
          value={settings.batchMode}
          onChange={toggle('batchMode')}
        />
        <Toggle
          label="Extraction IA (cloud)"
          hint="Quand la lecture hors ligne est insuffisante, l'image est envoyée au service d'extraction pour être analysée. Désactivez pour rester à 100 % hors ligne."
          value={settings.cloudAiEnabled}
          onChange={toggle('cloudAiEnabled')}
        />
        <Toggle
          label="Texte brut dans les notes du contact"
          hint="Ajoute le texte lu sur la carte dans la fiche du répertoire."
          value={settings.rawTextInNotes}
          onChange={toggle('rawTextInNotes')}
        />
        <Row
          icon="🌍"
          label="Indicatif par défaut"
          value={`${settings.defaultCountryCode} · ${DIALING_CODES[settings.defaultCountryCode] ?? ''}`}
          onPress={nextCountryCode}
        />
      </Card>

      <SectionTitle>Moteurs disponibles</SectionTitle>
      <Card>
        <Row
          label="Reconnaissance hors ligne"
          value={isLocalOcrAvailable() ? 'active' : 'build de développement requis'}
        />
        <Row label="Scanner à détection de bords" value={isDocumentScannerAvailable() ? 'actif' : 'non disponible'} />
        <Row label="Extraction IA" value={isCloudOcrAvailable() ? 'configurée' : 'non configurée'} />
      </Card>

      <SectionTitle>Sauvegarde</SectionTitle>
      <Card>
        {cloudConfigured ? (
          <>
            <Row label="Compte" value={user?.email ?? 'non connecté'} onPress={() => navigation.navigate('Account')} />
            <Toggle
              label="Synchroniser mes cartes"
              hint="Les cartes et leurs images sont sauvegardées sur votre espace privé et retrouvées sur vos autres appareils."
              value={settings.cloudSyncEnabled}
              onChange={toggle('cloudSyncEnabled')}
            />
            <AppButton
              label="Synchroniser maintenant"
              icon="☁️"
              variant="secondary"
              busy={syncing}
              disabled={!user}
              onPress={runSync}
            />
          </>
        ) : (
          <Text style={styles.hint}>
            La sauvegarde en ligne n'est pas configurée sur cette installation. Tout reste stocké
            sur ce téléphone. Voir `.env.example` pour l'activer.
          </Text>
        )}
      </Card>

      <SectionTitle>Exporter</SectionTitle>
      <Card>
        <AppButton label="Exporter en vCard (.vcf)" icon="⬇" variant="secondary" onPress={() => exportAll('vcf')} />
        <AppButton label="Exporter en CSV (Excel)" icon="⬇" variant="secondary" onPress={() => exportAll('csv')} />
      </Card>

      <SectionTitle>Stockage</SectionTitle>
      <Card>
        <Row label="Images de cartes" value={`${footprint.count} · ${formatBytes(footprint.bytes)}`} />
        <AppButton label="Nettoyer les images inutilisées" variant="ghost" onPress={cleanImages} />
      </Card>

      <SectionTitle>Confidentialité</SectionTitle>
      <Card>
        <Text style={styles.hint}>
          Les cartes et leurs photos sont stockées dans l'espace privé de l'application. Sans compte,
          rien ne quitte le téléphone — sauf l'image envoyée à l'extraction IA lorsque vous l'activez.
          Avec un compte, vos données ne sont lisibles que par vous : le serveur applique une règle
          d'accès par utilisateur.
        </Text>
      </Card>

      <View style={styles.footer}>
        <Text style={styles.version}>MétréCards · version 1.0.0</Text>
      </View>
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { ...typography.h2 },
  toggleHint: { ...typography.caption, lineHeight: 18 },
  hint: { ...typography.caption, lineHeight: 19 },
  footer: { alignItems: 'center', marginTop: spacing.xl },
  version: { fontSize: 11, color: colors.textFaint },
});
