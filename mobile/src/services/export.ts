/**
 * Sortie des cartes vers l'extérieur : écriture d'un fichier vCard ou CSV dans
 * le cache, puis passage au partage système.
 *
 * Le fichier est toujours un vrai fichier (et non du texte collé dans le
 * partage) : c'est ce qui permet à l'application Contacts, à Google Contacts,
 * à Outlook ou à Drive de le reconnaître et de l'importer.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { useSettingsStore } from '../store/settingsStore';
import type { BusinessCard } from '../types';
import { displayName, errorMessage, log, slug } from '../utils';
import { toCsv, toVCard, toVCardBook } from './vcard';

export { toCsv, toVCard, toVCardBook } from './vcard';

/**
 * Les numéros sortent toujours au format international : c'est ce qui permet à
 * WhatsApp, à Google Contacts et au téléphone de reconnaître un même numéro.
 * L'indicatif par défaut complète ceux qui ont été saisis en local.
 */
const vcardOptions = () => ({
  defaultCountryCode: useSettingsStore.getState().settings.defaultCountryCode,
});

/** Type MIME des vCard ; `text/x-vcard` reste le mieux reconnu sur Android. */
export const VCARD_MIME = 'text/x-vcard';

/** Écrit un fichier dans le cache de l'application et renvoie son URI locale. */
export function writeTempFile(name: string, content: string): string {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file.uri;
}

/** Fichier vCard d'une carte, prêt à être partagé ou importé. */
export function vcfFileFor(card: BusinessCard): string {
  return writeTempFile(`${slug(displayName(card))}.vcf`, toVCard(card, vcardOptions()));
}

/** Fichier vCard regroupant plusieurs cartes (un seul import à faire). */
export function vcfBookFileFor(cards: BusinessCard[], name = 'contacts-scancard.vcf'): string {
  return writeTempFile(name, toVCardBook(cards, vcardOptions()));
}

/**
 * Partage un fichier. `expo-sharing` gère l'URI `content://` et l'autorisation
 * de lecture attendues par Android ; `Share` sert de repli.
 */
async function shareFile(uri: string, mimeType: string, title: string): Promise<void> {
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: title, UTI: utiFor(mimeType) });
      return;
    }
  } catch (e) {
    log.warn('Partage de fichier indisponible', errorMessage(e));
  }
  await Share.share({ url: uri, title });
}

const utiFor = (mimeType: string): string =>
  mimeType === VCARD_MIME ? 'public.vcard' : 'public.comma-separated-values-text';

/** Partage une carte au format vCard (message, e-mail, AirDrop…). */
export async function shareCard(card: BusinessCard): Promise<void> {
  await shareFile(vcfFileFor(card), VCARD_MIME, displayName(card));
}

/** Exporte plusieurs cartes en un seul fichier vCard. */
export async function shareAllVcf(cards: BusinessCard[]): Promise<void> {
  const uri = vcfBookFileFor(cards);
  await shareFile(uri, VCARD_MIME, `${cards.length} contacts`);
}

/** Exporte le répertoire au format CSV (Excel, LibreOffice, CRM). */
export async function shareCsv(cards: BusinessCard[]): Promise<void> {
  const uri = writeTempFile('contacts-scancard.csv', toCsv(cards));
  await shareFile(uri, 'text/csv', `Export CSV de ${cards.length} contacts`);
}
