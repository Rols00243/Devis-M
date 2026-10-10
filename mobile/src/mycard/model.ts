/**
 * La carte de visite de l'utilisateur : ce qu'elle contient, et ce qu'elle
 * devient une fois partagée.
 *
 * Elle réutilise les 14 champs d'une carte scannée. C'est le même objet métier
 * vu de l'autre côté : ce que l'application sait lire, elle sait l'écrire.
 *
 * Module pur, testable sous `node:test`.
 */
import { normalizePhone } from '../ai/patterns';
import { toVCard } from '../services/vcard';
import { EMPTY_MY_CARD, type MyCard } from '../types';
import { displayName } from '../utils/pure';

/** Complète une carte partielle : une carte lue d'une ancienne version reste valable. */
export function normalizeMyCard(raw: Partial<MyCard> | null | undefined): MyCard {
  if (!raw) return { ...EMPTY_MY_CARD };
  const out: MyCard = { ...EMPTY_MY_CARD };
  (Object.keys(EMPTY_MY_CARD) as (keyof MyCard)[]).forEach((key) => {
    const value = raw[key];
    if (value !== undefined && value !== null) (out as unknown as Record<string, unknown>)[key] = value;
  });
  return out;
}

/** Une carte vide ne s'imprime pas : il faut au moins de quoi identifier quelqu'un. */
export function isPrintable(card: MyCard): boolean {
  return Boolean(card.firstName.trim() || card.lastName.trim() || card.company.trim());
}

/** Ce que porte le QR code : la fiche entière, au format que tous les téléphones lisent. */
export function myCardVCard(card: MyCard, defaultCountryCode = ''): string {
  return toVCard(
    { ...card, notes: [card.notes, card.slogan].filter(Boolean).join(' — ') },
    { defaultCountryCode },
  );
}

/** Lignes de contact imprimées sur la carte, dans l'ordre, sans doublon ni vide. */
export function contactLines(card: MyCard, defaultCountryCode = ''): { icon: string; text: string }[] {
  const lines: { icon: string; text: string }[] = [];
  const seen = new Set<string>();

  const push = (icon: string, text: string) => {
    const clean = text.trim();
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    lines.push({ icon, text: clean });
  };

  const phone = (raw: string) => {
    if (!raw.trim()) return '';
    // Le format international est celui qu'on compose depuis n'importe où.
    return normalizePhone(raw, defaultCountryCode).display || raw.trim();
  };

  push('☎', phone(card.phone));
  push('☎', phone(card.secondaryPhone));
  push('✆', phone(card.whatsapp));
  push('✉', card.email);
  push('🌐', card.website);
  push('in', card.linkedin);
  push('📍', [card.address, card.city, card.country].filter(Boolean).join(', '));
  return lines;
}

/** Nom de fichier proposé à l'export. */
export function cardFileName(card: MyCard, extension: string): string {
  const base = displayName(card)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `carte-${base || 'visite'}.${extension}`;
}
