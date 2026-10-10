/**
 * Écriture dans le répertoire natif du téléphone (Android / iOS) via expo-contacts.
 *
 * C'est l'aboutissement du parcours : une fois la carte vérifiée, les champs
 * sont répartis dans les champs natifs du contact — prénom, nom, société,
 * fonction, numéros, e-mail, site, profil LinkedIn, adresse, notes et photo de
 * la carte — pour que le contact se comporte exactement comme un contact saisi
 * à la main, et soit repris tel quel par tout ce qui lit le répertoire.
 *
 * Cette écriture crée une fiche *sur l'appareil*. Pour la déposer en plus dans
 * un compte synchronisé (Google, iCloud, Outlook), voir `destinations.ts`.
 */
import * as Contacts from 'expo-contacts';

import { normalizePhone } from '../ai/patterns';
import { imageExists } from '../storage/images';
import { useSettingsStore } from '../store/settingsStore';
import type { BusinessCard, CardFields, ExtraItem } from '../types';
import { displayName, errorMessage, log, withScheme } from '../utils';

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
  options: {
    includeRawText?: string;
    imageUri?: string | null;
    /** Indicatif appliqué aux numéros notés sans préfixe international. */
    defaultCountryCode?: string;
    /** Informations lues sur la carte hors des 14 champs ; aucune n'est perdue. */
    extras?: ExtraItem[];
  } = {},
): Contacts.CreateContactRecord {
  const dial = options.defaultCountryCode ?? '';
  const phones: Contacts.NewPhone[] = [];
  const pushPhone = (value: string, label: string) => {
    // Le format international est ce qui permet au téléphone, à WhatsApp et au
    // compte synchronisé de reconnaître un même numéro d'un appareil à l'autre.
    const number = normalizePhone(value, dial).e164 || value.trim();
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
  const lowerEq = (a: string | undefined, b: string) =>
    (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

  const urls: Contacts.NewUrlAddress[] = [];
  if (card.website) urls.push({ label: 'work', url: withScheme(card.website) });
  if (card.linkedin) urls.push({ label: 'LinkedIn', url: withScheme(card.linkedin) });

  // Profil social : reconnu par le répertoire et recopié par Google Contacts,
  // là où une simple URL reste une ligne de texte.
  const socialProfiles: Contacts.NewSocialProfile[] = card.linkedin
    ? [{ label: 'LinkedIn', service: 'LinkedIn', url: withScheme(card.linkedin) }]
    : [];

  // Adresse de messagerie instantanée : iOS affiche le bouton WhatsApp à partir
  // de cette entrée. Android l'ignore, d'où le numéro étiqueté ci-dessus.
  const imAddresses: Contacts.NewImAddress[] = card.whatsapp
    ? [
        {
          label: 'WhatsApp',
          service: 'WhatsApp',
          username: normalizePhone(card.whatsapp, dial).e164 || card.whatsapp,
        },
      ]
    : [];

  const addresses: Contacts.NewAddress[] = [];
  if (card.address || card.city || card.country) {
    addresses.push({
      label: 'work',
      street: card.address,
      city: card.city,
      region: card.country,
    });
  }

  // Les informations supplémentaires rejoignent le champ natif qui leur
  // correspond ; celles qui n'en ont pas sont écrites en notes, texte lisible.
  const noteExtras: string[] = [];
  (options.extras ?? []).forEach((extra) => {
    const value = extra.value.trim();
    if (!value) return;
    const label = extra.label.trim() || 'Sur la carte';
    switch (extra.kind) {
      case 'phone':
        pushPhone(value, label);
        return;
      case 'email':
        if (!emails.some((e) => lowerEq(e.address, value))) emails.push({ label, address: value });
        return;
      case 'website':
        urls.push({ label, url: withScheme(value) });
        return;
      case 'social':
        urls.push({ label, url: withScheme(stripLabel(value)) });
        socialProfiles.push({ label, service: label, url: withScheme(stripLabel(value)) });
        return;
      default:
        noteExtras.push(`${label} : ${value}`);
    }
  });

  const noteParts = [
    card.notes.trim(),
    noteExtras.join('\n'),
    options.includeRawText?.trim(),
  ].filter(Boolean);

  return {
    givenName: card.firstName || undefined,
    familyName: card.lastName || undefined,
    company: card.company || undefined,
    jobTitle: card.jobTitle || undefined,
    note: noteParts.length ? noteParts.join('\n\n') : undefined,
    // La photo de la carte devient la photo du contact : on reconnaît la
    // personne dans le répertoire et lors d'un appel entrant.
    image: options.imageUri ?? undefined,
    phones,
    emails,
    urlAddresses: urls,
    socialProfiles,
    imAddresses,
    addresses,
  };
}

/** Indicatif choisi dans les réglages, appliqué par défaut à l'écriture. */
const currentDialingCode = (): string => useSettingsStore.getState().settings.defaultCountryCode;

/**
 * Isole l'adresse dans une ligne de réseau social : la carte imprime souvent
 * « Facebook : /ma-page » ou « f  fb.com/ma-page », et le contact attend une URL.
 */
function stripLabel(value: string): string {
  const withoutLabel = value.replace(/^[^:]{0,20}:\s*/, '').trim();
  const domain = withoutLabel.match(/[\w-]+\.[\w.-]+\/?\S*/);
  return (domain ? domain[0] : withoutLabel).replace(/^\/+/, '');
}

export interface ContactWriteResult {
  contactId: string;
  created: boolean;
}

/** Crée le contact dans le répertoire et renvoie son identifiant natif. */
export async function createContact(
  card: BusinessCard,
  options: { rawTextInNotes?: boolean; defaultCountryCode?: string } = {},
): Promise<ContactWriteResult> {
  const record = toContactRecord(card, {
    includeRawText: options.rawTextInNotes ? card.rawText : undefined,
    imageUri: imageExists(card.imageUri) ? card.imageUri : null,
    defaultCountryCode: options.defaultCountryCode ?? currentDialingCode(),
    extras: card.extras,
  });
  const contact = await Contacts.Contact.create(record);
  log.info('Contact créé', displayName(card), contact.id);
  return { contactId: contact.id, created: true };
}

/** Met à jour un contact existant repéré comme doublon. */
export async function updateContact(
  contactId: string,
  card: BusinessCard,
  options: { rawTextInNotes?: boolean; defaultCountryCode?: string } = {},
): Promise<ContactWriteResult> {
  const record = toContactRecord(card, {
    includeRawText: options.rawTextInNotes ? card.rawText : undefined,
    imageUri: imageExists(card.imageUri) ? card.imageUri : null,
    defaultCountryCode: options.defaultCountryCode ?? currentDialingCode(),
    extras: card.extras,
  });
  const contact = new Contacts.Contact(contactId);
  await contact.update(record);
  return { contactId, created: false };
}

/** Ouvre la fiche du contact dans l'application Contacts du téléphone. */
export async function openContactForm(card: BusinessCard): Promise<boolean> {
  try {
    return await Contacts.Contact.presentCreateForm(
      toContactRecord(card, {
        imageUri: imageExists(card.imageUri) ? card.imageUri : null,
        defaultCountryCode: currentDialingCode(),
        extras: card.extras,
      }),
    );
  } catch (e) {
    log.warn('Formulaire contact indisponible', errorMessage(e));
    return false;
  }
}
