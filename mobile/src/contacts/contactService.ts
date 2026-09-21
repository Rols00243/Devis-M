/**
 * Écriture dans le répertoire natif du téléphone (Android / iOS) via expo-contacts.
 *
 * C'est l'aboutissement du parcours : une fois la carte vérifiée, les champs
 * sont répartis dans les champs natifs du contact — prénom, nom, société,
 * fonction, numéros, e-mail, site, adresse, notes — pour que le contact se
 * comporte exactement comme un contact saisi à la main.
 */
import * as Contacts from 'expo-contacts';

import { normalizePhone } from '../ai/patterns';
import type { BusinessCard, CardFields } from '../types';
import { displayName, errorMessage, log } from '../utils';

export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

/**
 * Demande l'accès au répertoire. `blocked` signale un refus définitif :
 * l'interface doit alors renvoyer l'utilisateur vers les réglages système.
 */
export async function ensureContactsPermission(): Promise<PermissionOutcome> {
  const current = await Contacts.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'blocked';

  const asked = await Contacts.requestPermissionsAsync();
  if (asked.granted) return 'granted';
  return asked.canAskAgain ? 'denied' : 'blocked';
}

/** Transforme une carte en enregistrement de contact natif. */
export function toContactRecord(
  card: CardFields,
  options: { includeRawText?: string } = {},
): Contacts.CreateContactRecord {
  const phones: Contacts.NewPhone[] = [];
  const pushPhone = (value: string, label: string) => {
    const number = normalizePhone(value).e164 || value.trim();
    if (!number) return;
    if (phones.some((p) => p.number === number)) return;
    phones.push({ label, number });
  };

  pushPhone(card.phone, 'mobile');
  pushPhone(card.secondaryPhone, 'work');
  // WhatsApp n'a pas de champ natif : on l'ajoute comme numéro étiqueté,
  // sauf s'il fait doublon avec un numéro déjà présent.
  pushPhone(card.whatsapp, 'WhatsApp');

  const emails: Contacts.NewEmail[] = card.email ? [{ label: 'work', address: card.email }] : [];

  const urls: Contacts.NewUrlAddress[] = [];
  if (card.website) urls.push({ label: 'work', url: withScheme(card.website) });
  if (card.linkedin) urls.push({ label: 'LinkedIn', url: withScheme(card.linkedin) });

  const addresses: Contacts.NewAddress[] = [];
  if (card.address || card.city || card.country) {
    addresses.push({
      label: 'work',
      street: card.address,
      city: card.city,
      region: card.country,
    });
  }

  const noteParts = [card.notes.trim(), options.includeRawText?.trim()].filter(Boolean);

  return {
    givenName: card.firstName || undefined,
    familyName: card.lastName || undefined,
    company: card.company || undefined,
    jobTitle: card.jobTitle || undefined,
    note: noteParts.length ? noteParts.join('\n\n') : undefined,
    phones,
    emails,
    urlAddresses: urls,
    addresses,
  };
}

function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export interface ContactWriteResult {
  contactId: string;
  created: boolean;
}

/** Crée le contact dans le répertoire et renvoie son identifiant natif. */
export async function createContact(
  card: BusinessCard,
  options: { rawTextInNotes?: boolean } = {},
): Promise<ContactWriteResult> {
  const record = toContactRecord(card, {
    includeRawText: options.rawTextInNotes ? card.rawText : undefined,
  });
  const contact = await Contacts.Contact.create(record);
  log.info('Contact créé', displayName(card), contact.id);
  return { contactId: contact.id, created: true };
}

/** Met à jour un contact existant repéré comme doublon. */
export async function updateContact(
  contactId: string,
  card: BusinessCard,
  options: { rawTextInNotes?: boolean } = {},
): Promise<ContactWriteResult> {
  const record = toContactRecord(card, {
    includeRawText: options.rawTextInNotes ? card.rawText : undefined,
  });
  const contact = new Contacts.Contact(contactId);
  await contact.update(record);
  return { contactId, created: false };
}

/** Ouvre la fiche du contact dans l'application Contacts du téléphone. */
export async function openContactForm(card: BusinessCard): Promise<boolean> {
  try {
    return await Contacts.Contact.presentCreateForm(toContactRecord(card));
  } catch (e) {
    log.warn('Formulaire contact indisponible', errorMessage(e));
    return false;
  }
}
