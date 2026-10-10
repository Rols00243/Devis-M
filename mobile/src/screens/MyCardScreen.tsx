/**
 * « Ma carte de visite » : l'utilisateur fabrique la sienne.
 *
 * Le pendant naturel du scanner. L'application sait lire une carte ; elle sait
 * donc aussi en écrire une, avec les mêmes champs. La carte produite porte un
 * QR code : celui d'en face n'a plus rien à recopier, son téléphone reçoit la
 * fiche exacte — y compris depuis une carte imprimée sur papier.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';

import { AppButton, BusinessCardPreview, Card, Field, Loader, Screen, SectionTitle } from '../components';
import { loadMyCard, saveMyCard } from '../database/myCardRepository';
import { printCard, shareCardPdf, shareMyVCard } from '../mycard/export';
import { isPrintable } from '../mycard/model';
import type { RootStackParamList } from '../navigation/types';
import { persistImage } from '../storage/images';
import { useSettingsStore } from '../store/settingsStore';
import { makeStyles, radius, spacing, TOUCH_TARGET, useTheme } from '../theme';
import {
  CARD_ACCENTS,
  CARD_TEMPLATES,
  EMPTY_MY_CARD,
  type CardTemplate,
  type MyCard,
} from '../types';
import { errorMessage } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'MyCard'>;

/**
 * Le formulaire, dans l'ordre où l'on remplit une carte : qui vous êtes, où
 * l'on vous joint, où l'on vous trouve, puis l'allure de la carte.
 */
const GROUPS: { title: string; fields: { key: keyof MyCard; label: string; hint?: string }[] }[] = [
  {
    title: 'Qui vous êtes',
    fields: [
      { key: 'firstName', label: 'Prénom' },
      { key: 'lastName', label: 'Nom' },
      { key: 'jobTitle', label: 'Fonction' },
      { key: 'company', label: 'Entreprise' },
      { key: 'slogan', label: 'Accroche', hint: 'Une ligne, facultative' },
    ],
  },
  {
    title: 'Où l’on vous joint',
    fields: [
      { key: 'phone', label: 'Téléphone principal' },
      { key: 'secondaryPhone', label: 'Téléphone secondaire' },
      { key: 'whatsapp', label: 'WhatsApp' },
      { key: 'email', label: 'E-mail' },
      { key: 'website', label: 'Site web' },
      { key: 'linkedin', label: 'LinkedIn' },
    ],
  },
  {
    title: 'Où l’on vous trouve',
    fields: [
      { key: 'address', label: 'Adresse' },
      { key: 'city', label: 'Ville' },
      { key: 'country', label: 'Pays' },
    ],
  },
];

const KEYBOARD: Partial<Record<keyof MyCard, 'default' | 'phone-pad' | 'email-address' | 'url'>> = {
  phone: 'phone-pad',
  secondaryPhone: 'phone-pad',
  whatsapp: 'phone-pad',
  email: 'email-address',
  website: 'url',
  linkedin: 'url',
};

export default function MyCardScreen(_props: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { settings } = useSettingsStore();

  const [card, setCard] = useState<MyCard>(EMPTY_MY_CARD);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadMyCard()
      .then(setCard)
      .finally(() => setLoading(false));
  }, []);

  const set = useCallback(<K extends keyof MyCard>(key: K, value: MyCard[K]) => {
    setCard((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Enregistre avant toute sortie : un export porte toujours la dernière version. */
  const persist = useCallback(async (): Promise<MyCard> => {
    const saved = await saveMyCard(card);
    setCard(saved);
    return saved;
  }, [card]);

  const guarded = useCallback(
    async (label: string, task: () => Promise<void>) => {
      if (!isPrintable(card)) {
        Alert.alert('Carte incomplète', 'Renseignez au moins un nom ou une entreprise.');
        return;
      }
      setBusy(true);
      try {
        await task();
      } catch (e) {
        Alert.alert(label, errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [card],
  );

  const pickLogo = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    try {
      // Copié dans le dossier de l'application : l'image de la galerie peut disparaître.
      const stored = await persistImage(result.assets[0].uri, 'front');
      set('logoUri', stored);
    } catch (e) {
      Alert.alert('Logo non ajouté', errorMessage(e));
    }
  }, [set]);

  if (loading) {
    return (
      <Screen>
        <Loader label="Chargement de votre carte…" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.previewWrap}>
        <BusinessCardPreview card={card} defaultCountryCode={settings.defaultCountryCode} />
        <Text style={styles.previewHint}>
          Aperçu à la taille réelle d'une carte (85 × 55 mm). Il se met à jour pendant que vous
          écrivez.
        </Text>
      </View>

      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          {group.fields.map((f) => (
            <Field
              key={String(f.key)}
              label={f.label}
              value={String(card[f.key] ?? '')}
              onChangeText={(v) => set(f.key, v as MyCard[typeof f.key])}
              placeholder={f.hint}
              keyboardType={KEYBOARD[f.key] ?? 'default'}
              autoCapitalize={
                KEYBOARD[f.key] === 'email-address' || KEYBOARD[f.key] === 'url' ? 'none' : 'sentences'
              }
              multiline={f.key === 'address'}
            />
          ))}
        </View>
      ))}

      <SectionTitle>Allure de la carte</SectionTitle>
      <Card>
        <Text style={styles.label}>MODÈLE</Text>
        <View style={styles.templates}>
          {CARD_TEMPLATES.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityState={{ selected: card.template === t.id }}
              onPress={() => set('template', t.id as CardTemplate)}
              style={[styles.template, card.template === t.id && styles.templateOn]}>
              <Text style={[styles.templateLabel, card.template === t.id && styles.templateLabelOn]}>
                {t.label}
              </Text>
              <Text style={styles.templateHint}>{t.hint}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>COULEUR</Text>
        <View style={styles.accents}>
          {CARD_ACCENTS.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`Couleur ${c}`}
              accessibilityState={{ selected: card.accent === c }}
              onPress={() => set('accent', c)}
              style={[
                styles.accent,
                { backgroundColor: c },
                card.accent === c && { borderColor: colors.text, borderWidth: 3 },
              ]}
            />
          ))}
        </View>

        <View style={styles.toggle}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>QR code de contact</Text>
            <Text style={styles.toggleHint}>
              Scanné par n'importe quel téléphone, il transmet votre fiche complète, sans faute de
              frappe. C'est le moyen le plus sûr de donner ses coordonnées.
            </Text>
          </View>
          <Switch
            value={card.showQrCode}
            onValueChange={(v) => set('showQrCode', v)}
            accessibilityLabel="QR code de contact"
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.white}
          />
        </View>

        <AppButton
          label={card.logoUri ? 'Changer le logo' : 'Ajouter un logo'}
          icon="🖼"
          variant="secondary"
          onPress={pickLogo}
        />
        {card.logoUri ? (
          <AppButton label="Retirer le logo" variant="ghost" onPress={() => set('logoUri', null)} />
        ) : null}
      </Card>

      <View style={styles.actions}>
        <AppButton
          label="Enregistrer ma carte"
          icon="✅"
          variant="success"
          busy={busy}
          onPress={() => void guarded('Enregistrement impossible', async () => {
            await persist();
            Alert.alert('Carte enregistrée', 'Elle est prête à être partagée ou imprimée.');
          })}
        />
        <AppButton
          label="Partager en PDF"
          icon="📄"
          variant="secondary"
          disabled={busy}
          onPress={() => void guarded('Export impossible', async () => {
            const saved = await persist();
            await shareCardPdf(saved, settings.defaultCountryCode);
          })}
        />
        <AppButton
          label="Envoyer ma fiche de contact"
          icon="↗"
          variant="secondary"
          disabled={busy}
          onPress={() => void guarded('Envoi impossible', async () => {
            const saved = await persist();
            await shareMyVCard(saved, settings.defaultCountryCode);
          })}
        />
        <AppButton
          label="Imprimer"
          icon="🖨"
          variant="ghost"
          disabled={busy}
          onPress={() => void guarded('Impression impossible', async () => {
            const saved = await persist();
            await printCard(saved, settings.defaultCountryCode);
          })}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(({ colors, typography, elevation }) => ({
  previewWrap: { gap: spacing.sm },
  previewHint: { ...typography.caption, textAlign: 'center', lineHeight: 17 },
  group: { gap: spacing.md },
  label: { ...typography.label, marginTop: spacing.xs },

  templates: { flexDirection: 'row', gap: spacing.sm },
  template: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
    minHeight: TOUCH_TARGET + 12,
    justifyContent: 'center',
  },
  templateOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  templateLabel: { ...typography.h2, fontSize: 14 },
  templateLabelOn: { color: colors.primary },
  templateHint: { fontSize: 10.5, color: colors.textMuted, lineHeight: 14 },

  accents: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  accent: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation,
  },

  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { ...typography.h2 },
  toggleHint: { ...typography.caption, lineHeight: 18 },

  actions: { gap: spacing.sm, marginTop: spacing.lg },
}));
