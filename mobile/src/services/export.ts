/**
 * Exports : vCard (.vcf) pour le répertoire et les messageries, CSV pour Excel.
 * Les fichiers sont écrits dans le cache puis proposés au partage système.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

import { normalizePhone } from '../ai/patterns';
import type { BusinessCard } from '../types';
import { displayName } from '../utils';

/* --------------------------------- vCard --------------------------------- */

const escapeVcf = (s: string): string =>
  (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fiche vCard 3.0 — format lu nativement par Android, iOS, Outlook et Gmail. */
export function toVCard(card: BusinessCard): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVcf(card.lastName)};${escapeVcf(card.firstName)};;;`);
  lines.push(`FN:${escapeVcf(displayName(card))}`);
  if (card.company) lines.push(`ORG:${escapeVcf(card.company)}`);
  if (card.jobTitle) lines.push(`TITLE:${escapeVcf(card.jobTitle)}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${normalizePhone(card.phone).e164}`);
  if (card.secondaryPhone) lines.push(`TEL;TYPE=WORK,VOICE:${normalizePhone(card.secondaryPhone).e164}`);
  if (card.whatsapp) lines.push(`TEL;TYPE=CELL,WhatsApp:${normalizePhone(card.whatsapp).e164}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${card.email}`);
  if (card.website) lines.push(`URL:${withScheme(card.website)}`);
  if (card.linkedin) lines.push(`URL;TYPE=LinkedIn:${withScheme(card.linkedin)}`);
  if (card.address || card.city || card.country) {
    lines.push(
      `ADR;TYPE=WORK:;;${escapeVcf(card.address)};${escapeVcf(card.city)};;;${escapeVcf(card.country)}`,
    );
  }
  if (card.notes) lines.push(`NOTE:${escapeVcf(card.notes)}`);
  lines.push(`REV:${card.updatedAt}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

const withScheme = (url: string): string => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/* ---------------------------------- CSV ---------------------------------- */

const CSV_COLUMNS: [keyof BusinessCard, string][] = [
  ['firstName', 'Prénom'],
  ['lastName', 'Nom'],
  ['jobTitle', 'Fonction'],
  ['company', 'Entreprise'],
  ['phone', 'Téléphone'],
  ['secondaryPhone', 'Téléphone secondaire'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'E-mail'],
  ['website', 'Site web'],
  ['linkedin', 'LinkedIn'],
  ['address', 'Adresse'],
  ['city', 'Ville'],
  ['country', 'Pays'],
  ['notes', 'Notes'],
];

export function toCsv(cards: BusinessCard[]): string {
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [...CSV_COLUMNS.map(([, label]) => escape(label)), escape('Scannée le')].join(';');
  const rows = cards.map((card) =>
    [
      ...CSV_COLUMNS.map(([key]) => escape(card[key])),
      escape(new Date(card.createdAt).toLocaleDateString('fr-FR')),
    ].join(';'),
  );
  // Le BOM force Excel à lire l'UTF-8 : sans lui, les accents sont illisibles.
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/* -------------------------------- Partage -------------------------------- */

function writeTemp(name: string, content: string): File {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file;
}

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'contact';

/** Partage une carte au format vCard (message, e-mail, AirDrop…). */
export async function shareCard(card: BusinessCard): Promise<void> {
  const file = writeTemp(`${slug(displayName(card))}.vcf`, toVCard(card));
  await Share.share({
    url: file.uri, // iOS
    message: toVCard(card), // Android : le texte est le vecteur le plus sûr
    title: displayName(card),
  });
}

/** Exporte plusieurs cartes en un seul fichier vCard. */
export async function shareAllVcf(cards: BusinessCard[]): Promise<void> {
  const file = writeTemp('contacts-scancard.vcf', cards.map(toVCard).join('\r\n'));
  await Share.share({ url: file.uri, message: `Export de ${cards.length} contacts`, title: 'Contacts' });
}

/** Exporte le répertoire au format CSV (Excel, LibreOffice, CRM). */
export async function shareCsv(cards: BusinessCard[]): Promise<void> {
  const file = writeTemp('contacts-scancard.csv', toCsv(cards));
  await Share.share({ url: file.uri, message: `Export CSV de ${cards.length} contacts`, title: 'Export CSV' });
}
