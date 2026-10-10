/**
 * Détection des doublons avant création d'un contact.
 *
 * Trois critères, du plus décisif au plus faible : même numéro, même e-mail,
 * puis même nom associé à la même entreprise. Le numéro est comparé sur ses
 * chiffres significatifs, pour que « +243 81 000 0000 » et « 081 000 0000 »
 * soient reconnus comme une seule et même ligne.
 */
import * as Contacts from 'expo-contacts';

import { lower, samePhone } from '../ai/patterns';
import type { CardFields, DuplicateMatch } from '../types';
import { errorMessage, log } from '../utils';

const FIELDS = [
  Contacts.ContactField.GIVEN_NAME,
  Contacts.ContactField.FAMILY_NAME,
  Contacts.ContactField.COMPANY,
  Contacts.ContactField.PHONES,
  Contacts.ContactField.EMAILS,
] as const;

interface ContactSnapshot {
  id: string;
  givenName: string;
  familyName: string;
  company: string;
  phones: string[];
  emails: string[];
}

/**
 * Cherche des contacts ressemblant à la carte.
 * Nécessite la permission de lecture : sans elle, on renvoie une liste vide
 * plutôt que de bloquer la création.
 */
export async function findDuplicates(card: CardFields): Promise<DuplicateMatch[]> {
  let snapshots: ContactSnapshot[];
  try {
    snapshots = await loadContacts(card);
  } catch (e) {
    log.warn('Lecture du répertoire impossible', errorMessage(e));
    return [];
  }

  const matches: DuplicateMatch[] = [];
  const cardPhones = [card.phone, card.secondaryPhone, card.whatsapp].filter(Boolean);
  const cardEmail = lower(card.email);
  const cardName = lower(`${card.firstName} ${card.lastName}`).trim();
  const cardCompany = lower(card.company).trim();

  snapshots.forEach((c) => {
    const reason = matchReason(c, cardPhones, cardEmail, cardName, cardCompany);
    if (!reason) return;
    matches.push({
      contactId: c.id,
      name: `${c.givenName} ${c.familyName}`.trim() || c.company || 'Contact',
      company: c.company || undefined,
      reason,
      phones: c.phones,
      emails: c.emails,
    });
  });

  // Un même contact peut correspondre par plusieurs critères : on garde le plus fort.
  const priority = { phone: 0, email: 1, name_company: 2 } as const;
  return matches
    .sort((a, b) => priority[a.reason] - priority[b.reason])
    .filter((m, i, arr) => arr.findIndex((o) => o.contactId === m.contactId) === i);
}

function matchReason(
  contact: ContactSnapshot,
  cardPhones: string[],
  cardEmail: string,
  cardName: string,
  cardCompany: string,
): DuplicateMatch['reason'] | null {
  if (cardPhones.some((cp) => contact.phones.some((p) => samePhone(cp, p)))) return 'phone';
  if (cardEmail && contact.emails.some((e) => lower(e) === cardEmail)) return 'email';
  if (cardName && cardCompany) {
    const contactName = lower(`${contact.givenName} ${contact.familyName}`).trim();
    if (contactName === cardName && lower(contact.company).trim() === cardCompany) {
      return 'name_company';
    }
  }
  return null;
}

/**
 * Charge les contacts à comparer. On interroge d'abord par nom quand il est
 * connu — c'est bien plus rapide que de parcourir tout le répertoire — puis on
 * complète par un balayage borné, nécessaire pour retrouver les doublons dont
 * le nom a été saisi différemment.
 */
async function loadContacts(card: CardFields): Promise<ContactSnapshot[]> {
  const byName = card.lastName
    ? await Contacts.Contact.getAllDetails(FIELDS, { name: card.lastName, limit: 50 })
    : [];
  const recent = await Contacts.Contact.getAllDetails(FIELDS, { limit: 500 });

  const merged = new Map<string, ContactSnapshot>();
  [...byName, ...recent].forEach((raw) => {
    const snapshot = toSnapshot(raw);
    if (snapshot) merged.set(snapshot.id, snapshot);
  });
  return [...merged.values()];
}

function toSnapshot(raw: unknown): ContactSnapshot | null {
  const c = raw as {
    id?: string;
    givenName?: string | null;
    familyName?: string | null;
    company?: string | null;
    phones?: { number?: string | null }[] | null;
    emails?: { email?: string | null }[] | null;
  };
  if (!c?.id) return null;
  return {
    id: c.id,
    givenName: c.givenName ?? '',
    familyName: c.familyName ?? '',
    company: c.company ?? '',
    phones: (c.phones ?? []).map((p) => p.number ?? '').filter(Boolean),
    emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
  };
}

/** Libellé affiché dans la boîte de dialogue « ce contact semble déjà exister ». */
export function reasonLabel(reason: DuplicateMatch['reason']): string {
  switch (reason) {
    case 'phone':
      return 'même numéro de téléphone';
    case 'email':
      return 'même adresse e-mail';
    case 'name_company':
      return 'même nom et même entreprise';
  }
}
