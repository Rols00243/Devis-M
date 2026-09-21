/**
 * Formats d'échange : vCard 3.0 et CSV.
 *
 * La vCard est le langage commun de tous les endroits où l'on cherche un
 * numéro : répertoire Android et iOS, Google Contacts, Outlook, Gmail,
 * WhatsApp, CRM. C'est donc elle qui porte la carte hors de l'application.
 *
 * Module pur (aucun import React Native / Expo) pour rester testable.
 */
import { normalizePhone } from '../ai/patterns';
import type { BusinessCard, CardFields } from '../types';
import { displayName, withScheme } from '../utils/pure';

/* --------------------------------- vCard --------------------------------- */

const escapeVcf = (s: string): string =>
  (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Options de rendu ; l'indicatif sert à remonter un numéro local en E.164. */
export interface VCardOptions {
  /** Indicatif appliqué aux numéros saisis sans préfixe international. */
  defaultCountryCode?: string;
}

/** Numéro au format international quand c'est possible, sinon tel qu'il a été lu. */
const telValue = (raw: string, defaultCountryCode: string): string =>
  normalizePhone(raw, defaultCountryCode).e164 || raw.trim();

/**
 * Fiche vCard 3.0.
 *
 * Les numéros secondaires et WhatsApp ne sont émis que s'ils diffèrent
 * réellement du numéro principal : un doublon dans la vCard se transforme en
 * doublon dans le répertoire.
 */
export function toVCard(
  card: CardFields & Partial<Pick<BusinessCard, 'updatedAt'>>,
  options: VCardOptions = {},
): string {
  const dial = options.defaultCountryCode ?? '';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVcf(card.lastName)};${escapeVcf(card.firstName)};;;`);
  lines.push(`FN:${escapeVcf(displayName(card))}`);
  if (card.company) lines.push(`ORG:${escapeVcf(card.company)}`);
  if (card.jobTitle) lines.push(`TITLE:${escapeVcf(card.jobTitle)}`);

  const seen = new Set<string>();
  const pushTel = (raw: string, types: string, label?: string) => {
    const value = telValue(raw, dial);
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (label) {
      // Groupe d'items : seule syntaxe vCard 3.0 qui conserve un libellé
      // personnalisé (« WhatsApp ») à l'import sur iOS comme sur Android.
      const group = `item${seen.size}`;
      lines.push(`${group}.TEL;TYPE=${types}:${value}`);
      lines.push(`${group}.X-ABLabel:${escapeVcf(label)}`);
    } else {
      lines.push(`TEL;TYPE=${types}:${value}`);
    }
  };
  pushTel(card.phone, 'CELL,VOICE');
  pushTel(card.secondaryPhone, 'WORK,VOICE');
  pushTel(card.whatsapp, 'CELL,VOICE', 'WhatsApp');

  if (card.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeVcf(card.email)}`);
  if (card.website) lines.push(`URL:${escapeVcf(withScheme(card.website))}`);
  if (card.linkedin) {
    lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${escapeVcf(withScheme(card.linkedin))}`);
    lines.push(`URL;TYPE=LinkedIn:${escapeVcf(withScheme(card.linkedin))}`);
  }
  if (card.address || card.city || card.country) {
    lines.push(
      `ADR;TYPE=WORK:;;${escapeVcf(card.address)};${escapeVcf(card.city)};;;${escapeVcf(card.country)}`,
    );
  }
  if (card.notes) lines.push(`NOTE:${escapeVcf(card.notes)}`);
  // Étiquette d'origine : permet de retrouver, dans Google Contacts ou Outlook,
  // tout ce qui vient d'une carte scannée.
  lines.push('CATEGORIES:Scan Card');
  if (card.updatedAt) lines.push(`REV:${card.updatedAt}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** Plusieurs fiches dans un seul fichier, format accepté par tous les imports. */
export function toVCardBook(cards: BusinessCard[], options: VCardOptions = {}): string {
  return cards.map((c) => toVCard(c, options)).join('\r\n');
}

/* ---------------------------------- CSV ---------------------------------- */

const CSV_COLUMNS: [keyof CardFields, string][] = [
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
