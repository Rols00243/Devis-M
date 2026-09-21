/**
 * Vérification et correction avant enregistrement.
 *
 * C'est l'étape qui décide de la qualité du répertoire : les champs extraits
 * sont tous modifiables, ceux dont la confiance est faible sont signalés, et la
 * recherche de doublons a lieu avant l'écriture dans le téléphone.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, StyleSheet, Text, View } from 'react-native';

import { AppButton, Badge, Card, Field, Loader, Screen, SectionTitle } from '../components';
import { buildCard, getCard } from '../database/cardRepository';
import { createContact, ensureContactsPermission, updateContact } from '../contacts/contactService';
import { isAccountHandoffAvailable, sendToSyncedAccount } from '../contacts/destinations';
import { findDuplicates, reasonLabel } from '../contacts/duplicates';
import type { RootStackParamList } from '../navigation/types';
import { scanCard } from '../ocr';
import { captureCardImage } from '../ocr/captureSource';
import { prepareForArchive } from '../ocr/imagePipeline';
import { persistImage } from '../storage/images';
import { useCardsStore } from '../store/cardsStore';
import { useSettingsStore } from '../store/settingsStore';
import { colors, radius, spacing, typography } from '../theme';
import {
  EMPTY_FIELDS,
  FIELD_LABELS,
  type BusinessCard,
  type CardFieldKey,
  type CardFields,
  type DuplicateMatch,
} from '../types';
import { displayName, errorMessage, log } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

/** Ordre de saisie : identité, puis contact, puis localisation. */
const GROUPS: { title: string; keys: CardFieldKey[] }[] = [
  { title: 'Identité', keys: ['firstName', 'lastName', 'jobTitle', 'company'] },
  { title: 'Contact', keys: ['phone', 'secondaryPhone', 'whatsapp', 'email'] },
  { title: 'En ligne', keys: ['website', 'linkedin'] },
  { title: 'Localisation', keys: ['address', 'city', 'country'] },
  { title: 'Divers', keys: ['notes'] },
];

const KEYBOARD: Partial<Record<CardFieldKey, 'default' | 'phone-pad' | 'email-address' | 'url'>> = {
  phone: 'phone-pad',
  secondaryPhone: 'phone-pad',
  whatsapp: 'phone-pad',
  email: 'email-address',
  website: 'url',
  linkedin: 'url',
};

export default function ReviewScreen({ navigation, route }: Props) {
  const { payload, cardId } = route.params;
  const { settings } = useSettingsStore();
  const { upsert, patch } = useCardsStore();

  const [card, setCard] = useState<BusinessCard | null>(null);
  const [fields, setFields] = useState<CardFields>(payload?.fields ?? EMPTY_FIELDS);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(cardId));
  const [backImageUri, setBackImageUri] = useState<string | null>(payload?.backImageUri ?? null);
  const [scanningBack, setScanningBack] = useState(false);

  const confidence = useMemo(() => payload?.confidence ?? card?.confidence ?? {}, [payload, card]);

  /* Chargement d'une carte existante (modification depuis la fiche). */
  useEffect(() => {
    if (!cardId) {
      // Nouveau scan : on prépare la carte sans l'enregistrer tout de suite.
      setCard(
        buildCard({
          fields: payload?.fields ?? EMPTY_FIELDS,
          confidence: payload?.confidence,
          rawText: payload?.rawText,
          imageUri: payload?.imageUri ?? null,
          backImageUri: payload?.backImageUri ?? null,
          source: 'camera',
          ocrEngine: payload?.engine ?? 'manual',
          languages: payload?.languages,
        }),
      );
      return;
    }
    getCard(cardId).then((existing) => {
      if (existing) {
        setCard(existing);
        setFields(pickFields(existing));
        setBackImageUri(existing.backImageUri);
      }
      setLoading(false);
    });
  }, [cardId, payload]);

  /*
   * Recherche de doublons dès que le nom, le numéro ou l'e-mail sont connus.
   * Lire le répertoire coûte cher : on attend une pause dans la frappe, et on
   * ne relance que si l'un des champs discriminants a réellement changé.
   */
  const { phone, email, lastName, company } = fields;
  useEffect(() => {
    let cancelled = false;
    if (!phone && !email && !(lastName && company)) {
      setDuplicates([]);
      return;
    }
    const timer = setTimeout(() => {
      findDuplicates({ ...EMPTY_FIELDS, phone, email, lastName, company })
        .then((found) => {
          if (!cancelled) setDuplicates(found);
        })
        .catch((e) => log.warn('Recherche de doublons', errorMessage(e)));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phone, email, lastName, company]);

  const setField = useCallback((key: CardFieldKey, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  /*
   * Verso de la carte : beaucoup de cartes portent au dos la version anglaise,
   * une adresse ou un second numéro. On le lit avec le même pipeline, mais on
   * ne remplit que les champs restés vides — le recto reste la référence.
   */
  const scanBack = useCallback(async () => {
    setScanningBack(true);
    try {
      const uri = await captureCardImage('camera');
      if (!uri) return;

      const archive = await prepareForArchive(uri);
      const stored = await persistImage(archive.uri, 'back');
      setBackImageUri(stored);

      const report = await scanCard({
        imageUri: uri,
        cloudAiEnabled: settings.cloudAiEnabled,
        defaultCountryCode: settings.defaultCountryCode,
      });

      let added = 0;
      setFields((prev) => {
        const next = { ...prev };
        (Object.keys(EMPTY_FIELDS) as CardFieldKey[]).forEach((key) => {
          const value = report.fields[key]?.trim();
          if (value && !next[key].trim()) {
            next[key] = value;
            added += 1;
          }
        });
        return next;
      });

      Alert.alert(
        'Verso ajouté',
        added ? `${added} champ(s) complété(s) depuis le verso.` : 'Aucune information nouvelle au dos.',
      );
    } catch (e) {
      Alert.alert('Lecture du verso impossible', errorMessage(e));
    } finally {
      setScanningBack(false);
    }
  }, [settings.cloudAiEnabled, settings.defaultCountryCode]);

  /* ----------------------------- Actions ------------------------------ */

  const persist = useCallback(
    async (status: BusinessCard['status'], contactId?: string | null): Promise<BusinessCard | null> => {
      if (!card) return null;
      const next: BusinessCard = {
        ...card,
        ...fields,
        backImageUri,
        status,
        contactId: contactId ?? card.contactId,
      };
      return cardId ? patch(cardId, next) : upsert(next);
    },
    [backImageUri, card, cardId, fields, patch, upsert],
  );

  const saveOnly = useCallback(async () => {
    setSaving(true);
    try {
      await persist('validated');
      navigation.navigate('Home');
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [navigation, persist]);

  const writeToPhone = useCallback(
    async (mode: 'create' | 'update', existingContactId?: string) => {
      const saved = await persist('validated');
      if (!saved) return;
      const result =
        mode === 'update' && existingContactId
          ? await updateContact(existingContactId, saved, { rawTextInNotes: settings.rawTextInNotes })
          : await createContact(saved, { rawTextInNotes: settings.rawTextInNotes });

      await patch(saved.id, { status: 'contact_created', contactId: result.contactId });

      if (settings.batchMode) {
        navigation.replace('Scan', { mode: 'batch' });
        return;
      }

      // La fiche est sur l'appareil. Le dépôt dans un compte synchronisé la
      // rend visible sur les autres appareils et dans Google Contacts ; c'est
      // l'application Contacts du système qui demande le compte.
      const offerAccount = settings.offerSyncedAccount && isAccountHandoffAvailable();
      const buttons = [
        ...(offerAccount
          ? [
              {
                text: 'Aussi dans mon compte',
                onPress: () => void sendToSyncedAccount(saved),
              },
            ]
          : []),
        { text: 'Scanner une autre carte', onPress: () => navigation.replace('Scan') },
        { text: 'Terminer', style: 'cancel' as const, onPress: () => navigation.navigate('Home') },
      ];

      Alert.alert(
        mode === 'update' ? 'Contact mis à jour' : 'Contact créé',
        offerAccount
          ? `${displayName(saved)} est dans le répertoire de votre téléphone.\n\nPour le retrouver aussi sur vos autres appareils, dans Gmail et sur le web, ajoutez-le à un compte synchronisé (Google, iCloud, Outlook).`
          : `${displayName(saved)} est dans le répertoire de votre téléphone.`,
        buttons,
      );
    },
    [
      navigation,
      patch,
      persist,
      settings.batchMode,
      settings.offerSyncedAccount,
      settings.rawTextInNotes,
    ],
  );

  const handleSaveToPhone = useCallback(async () => {
    if (!fields.firstName && !fields.lastName && !fields.company) {
      Alert.alert('Informations insuffisantes', 'Renseignez au moins un nom ou une entreprise.');
      return;
    }

    setSaving(true);
    try {
      const permission = await ensureContactsPermission();
      if (permission === 'blocked') {
        Alert.alert(
          'Accès au répertoire refusé',
          "Autorisez l'accès aux contacts dans les réglages du téléphone pour créer la fiche.",
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      if (permission === 'denied') {
        Alert.alert(
          'Autorisation requise',
          "La carte a été enregistrée dans l'application, mais le contact n'a pas pu être créé.",
        );
        await persist('validated');
        return;
      }

      // Le doublon se traite avant l'écriture, comme demandé dans le parcours.
      if (duplicates.length) {
        const match = duplicates[0];
        Alert.alert(
          'Ce contact semble déjà exister',
          `${match.name}${match.company ? ` — ${match.company}` : ''}\n(${reasonLabel(match.reason)})`,
          [
            {
              text: 'Mettre à jour le contact existant',
              onPress: () => void runGuarded(() => writeToPhone('update', match.contactId)),
            },
            {
              text: 'Créer quand même',
              onPress: () => void runGuarded(() => writeToPhone('create')),
            },
            { text: 'Annuler', style: 'cancel' },
          ],
        );
        return;
      }

      await writeToPhone('create');
    } catch (e) {
      Alert.alert('Création du contact impossible', errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [duplicates, fields, persist, writeToPhone]);

  const runGuarded = useCallback(async (task: () => Promise<void>) => {
    setSaving(true);
    try {
      await task();
    } catch (e) {
      Alert.alert('Opération impossible', errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, []);

  /* ------------------------------ Rendu ------------------------------- */

  if (loading || !card) return <Screen><Loader label="Chargement de la carte…" /></Screen>;

  return (
    <Screen scroll>
      <View style={styles.previews}>
        {payload?.imageUri ?? card.imageUri ? (
          <Image
            source={{ uri: (payload?.imageUri ?? card.imageUri) as string }}
            style={styles.preview}
            resizeMode="cover"
          />
        ) : null}
        {backImageUri ? (
          <Image source={{ uri: backImageUri }} style={styles.preview} resizeMode="cover" />
        ) : null}
      </View>

      <View style={styles.badges}>
        <Badge
          label={engineLabel(payload?.engine ?? card.ocrEngine)}
          tone={(payload?.engine ?? card.ocrEngine) === 'cloud' ? 'info' : 'neutral'}
        />
        {duplicates.length ? <Badge label="Doublon possible" tone="warning" /> : null}
      </View>

      {payload?.warning ? <Text style={styles.warning}>{payload.warning}</Text> : null}

      {duplicates.length ? (
        <Card style={styles.dupCard}>
          <Text style={styles.dupTitle}>Ce contact semble déjà exister</Text>
          {duplicates.slice(0, 3).map((d) => (
            <Text key={d.contactId} style={styles.dupLine}>
              • {d.name}
              {d.company ? ` — ${d.company}` : ''} ({reasonLabel(d.reason)})
            </Text>
          ))}
          <Text style={styles.dupHint}>
            Au moment d'enregistrer, vous pourrez mettre à jour la fiche existante ou en créer une
            nouvelle.
          </Text>
        </Card>
      ) : null}

      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <SectionTitle>{group.title}</SectionTitle>
          {group.keys.map((key) => (
            <Field
              key={key}
              label={FIELD_LABELS[key]}
              value={fields[key]}
              onChangeText={(v) => setField(key, v)}
              confidence={confidence[key]}
              keyboardType={KEYBOARD[key] ?? 'default'}
              autoCapitalize={KEYBOARD[key] === 'email-address' || KEYBOARD[key] === 'url' ? 'none' : 'sentences'}
              multiline={key === 'notes' || key === 'address'}
              placeholder={key === 'notes' ? 'Contexte, salon, affaire en cours…' : undefined}
            />
          ))}
        </View>
      ))}

      <View style={styles.actions}>
        <AppButton
          label={backImageUri ? 'Rephotographier le verso' : 'Ajouter le verso de la carte'}
          icon="🔄"
          variant="secondary"
          busy={scanningBack}
          onPress={scanBack}
        />
        <AppButton
          label="Enregistrer dans le répertoire"
          icon="✅"
          variant="success"
          busy={saving}
          onPress={handleSaveToPhone}
        />
        <AppButton
          label="Enregistrer sans créer le contact"
          variant="secondary"
          disabled={saving}
          onPress={saveOnly}
        />
        <AppButton label="Annuler" variant="ghost" disabled={saving} onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

function pickFields(card: BusinessCard): CardFields {
  const out = { ...EMPTY_FIELDS };
  (Object.keys(EMPTY_FIELDS) as CardFieldKey[]).forEach((key) => {
    out[key] = card[key] ?? '';
  });
  return out;
}

function engineLabel(engine: BusinessCard['ocrEngine']): string {
  if (engine === 'cloud') return 'Lecture IA (cloud)';
  if (engine === 'mlkit') return 'Lecture hors ligne';
  return 'Saisie manuelle';
}

const styles = StyleSheet.create({
  previews: { gap: spacing.sm },
  preview: {
    width: '100%',
    aspectRatio: 85 / 55,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  badges: { flexDirection: 'row', gap: spacing.sm },
  warning: {
    ...typography.caption,
    color: colors.warning,
    backgroundColor: 'rgba(245,158,11,0.12)',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  dupCard: { borderColor: colors.warning, gap: spacing.xs },
  dupTitle: { ...typography.h2, color: colors.warning },
  dupLine: { ...typography.caption, color: colors.text },
  dupHint: { ...typography.caption, marginTop: spacing.xs },
  group: { gap: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});
