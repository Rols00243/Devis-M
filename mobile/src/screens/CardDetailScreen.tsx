/**
 * Fiche d'une carte : consultation, actions directes (appeler, WhatsApp,
 * e-mail, partager) et reprise en main (modifier, recréer le contact, supprimer).
 */
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { Alert, Image, Linking, StyleSheet, Text, View } from 'react-native';

import { normalizePhone } from '../ai/patterns';
import { AppButton, Badge, Card, Loader, Row, Screen, SectionTitle } from '../components';
import { createContact, ensureContactsPermission } from '../contacts/contactService';
import { getCard } from '../database/cardRepository';
import type { RootStackParamList } from '../navigation/types';
import { shareCard } from '../services/export';
import { useCardsStore } from '../store/cardsStore';
import { useSettingsStore } from '../store/settingsStore';
import { colors, radius, spacing, typography } from '../theme';
import type { BusinessCard } from '../types';
import { displayName, errorMessage, formatDateTime } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

export default function CardDetailScreen({ navigation, route }: Props) {
  const { cardId } = route.params;
  const { remove, patch } = useCardsStore();
  const { settings } = useSettingsStore();
  const [card, setCard] = useState<BusinessCard | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getCard(cardId).then(setCard);
    }, [cardId]),
  );

  const openUrl = useCallback(async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
    else Alert.alert('Action indisponible', "Aucune application ne peut ouvrir ce lien.");
  }, []);

  const addToPhone = useCallback(async () => {
    if (!card) return;
    setBusy(true);
    try {
      const permission = await ensureContactsPermission();
      if (permission !== 'granted') {
        Alert.alert('Autorisation requise', "L'accès au répertoire a été refusé.");
        return;
      }
      const result = await createContact(card, { rawTextInNotes: settings.rawTextInNotes });
      const updated = await patch(card.id, {
        contactId: result.contactId,
        status: 'contact_created',
      });
      if (updated) setCard(updated);
      Alert.alert('Contact créé', `${displayName(card)} est dans le répertoire du téléphone.`);
    } catch (e) {
      Alert.alert('Création impossible', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [card, patch, settings.rawTextInNotes]);

  const confirmDelete = useCallback(() => {
    if (!card) return;
    Alert.alert(
      'Supprimer cette carte ?',
      "La carte et sa photo seront effacées de l'application. Le contact déjà créé dans le téléphone n'est pas supprimé.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await remove(card.id);
            navigation.goBack();
          },
        },
      ],
    );
  }, [card, navigation, remove]);

  if (!card) return <Screen><Loader /></Screen>;

  const phoneE164 = card.phone ? normalizePhone(card.phone).e164 : '';
  const whatsappE164 = card.whatsapp ? normalizePhone(card.whatsapp).e164.replace('+', '') : '';

  return (
    <Screen scroll>
      {card.imageUri ? (
        <Image source={{ uri: card.imageUri }} style={styles.image} resizeMode="cover" />
      ) : null}

      <View style={styles.identity}>
        <Text style={styles.name}>{displayName(card)}</Text>
        {card.jobTitle ? <Text style={styles.job}>{card.jobTitle}</Text> : null}
        {card.company ? <Text style={styles.company}>{card.company}</Text> : null}
        <View style={styles.badges}>
          {card.contactId ? (
            <Badge label="✓ dans le répertoire" tone="success" />
          ) : (
            <Badge label="pas encore enregistré" tone="warning" />
          )}
          {card.syncState === 'synced' ? <Badge label="sauvegardé" tone="info" /> : null}
        </View>
      </View>

      <View style={styles.quickActions}>
        {phoneE164 ? (
          <AppButton
            label="Appeler"
            icon="📞"
            style={styles.quickButton}
            onPress={() => openUrl(`tel:${phoneE164}`)}
          />
        ) : null}
        {whatsappE164 ? (
          <AppButton
            label="WhatsApp"
            icon="💬"
            variant="success"
            style={styles.quickButton}
            onPress={() => openUrl(`https://wa.me/${whatsappE164}`)}
          />
        ) : null}
        {card.email ? (
          <AppButton
            label="E-mail"
            icon="✉️"
            variant="secondary"
            style={styles.quickButton}
            onPress={() => openUrl(`mailto:${card.email}`)}
          />
        ) : null}
      </View>

      <Card>
        <SectionTitle>Coordonnées</SectionTitle>
        {card.phone ? <Row icon="📱" label="Téléphone" value={card.phone} onPress={() => openUrl(`tel:${phoneE164}`)} /> : null}
        {card.secondaryPhone ? <Row icon="☎️" label="Secondaire" value={card.secondaryPhone} /> : null}
        {card.email ? <Row icon="✉️" label="E-mail" value={card.email} onPress={() => openUrl(`mailto:${card.email}`)} /> : null}
        {card.website ? (
          <Row icon="🌐" label="Site" value={card.website} onPress={() => openUrl(`https://${card.website.replace(/^https?:\/\//, '')}`)} />
        ) : null}
        {card.linkedin ? (
          <Row icon="in" label="LinkedIn" value={card.linkedin} onPress={() => openUrl(`https://${card.linkedin.replace(/^https?:\/\//, '')}`)} />
        ) : null}
        {card.address || card.city || card.country ? (
          <Row
            icon="📍"
            label="Adresse"
            value={[card.address, card.city, card.country].filter(Boolean).join(', ')}
          />
        ) : null}
        {card.notes ? <Row icon="📝" label="Notes" value={card.notes} /> : null}
      </Card>

      <Card>
        <SectionTitle>Scan</SectionTitle>
        <Row label="Scannée le" value={formatDateTime(card.createdAt)} />
        <Row label="Dernière modification" value={formatDateTime(card.updatedAt)} />
        <Row label="Moteur" value={engineLabel(card.ocrEngine)} />
        {card.languages.length ? <Row label="Langues" value={card.languages.join(', ')} /> : null}
      </Card>

      <View style={styles.actions}>
        {!card.contactId ? (
          <AppButton
            label="Enregistrer dans le répertoire"
            icon="✅"
            variant="success"
            busy={busy}
            onPress={addToPhone}
          />
        ) : null}
        <AppButton
          label="Modifier les informations"
          icon="✎"
          variant="secondary"
          onPress={() => navigation.navigate('Review', { cardId: card.id })}
        />
        <AppButton label="Partager la fiche" icon="↗" variant="secondary" onPress={() => shareCard(card)} />
        <AppButton label="Rescanner cette carte" icon="🔄" variant="ghost" onPress={() => navigation.navigate('Scan')} />
        <AppButton label="Supprimer" icon="🗑" variant="danger" onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

function engineLabel(engine: BusinessCard['ocrEngine']): string {
  if (engine === 'cloud') return 'Lecture IA (cloud)';
  if (engine === 'mlkit') return 'Reconnaissance hors ligne';
  return 'Saisie manuelle';
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 85 / 55, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  identity: { gap: spacing.xs },
  name: { ...typography.title },
  job: { ...typography.body, color: colors.primary },
  company: { ...typography.caption },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  quickActions: { flexDirection: 'row', gap: spacing.sm },
  quickButton: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
