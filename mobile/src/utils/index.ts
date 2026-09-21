/** Petits utilitaires partagés, sans dépendance à l'UI. */
import * as Crypto from 'expo-crypto';

export function newId(): string {
  return Crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Date lisible en français : « 21 sept. 2026, 14:03 ». */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Date relative courte pour les listes : « aujourd'hui », « hier », « 12 mars ». */
export function formatRelativeDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(d)) / 86_400_000);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Nom affiché d'une carte, avec repli sur l'entreprise puis sur « Sans nom ». */
export function displayName(card: { firstName: string; lastName: string; company: string }): string {
  const full = `${card.firstName} ${card.lastName}`.trim();
  return full || card.company || 'Sans nom';
}

/** Initiales pour l'avatar de la liste. */
export function initials(card: { firstName: string; lastName: string; company: string }): string {
  const first = card.firstName.trim()[0] ?? '';
  const last = card.lastName.trim()[0] ?? '';
  const pair = `${first}${last}`.toUpperCase();
  if (pair) return pair;
  return (card.company.trim()[0] ?? '?').toUpperCase();
}

/** Attente simple, utilisée par les reprises de la synchronisation. */
export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Journalisation centralisée : un seul endroit à brancher sur Sentry plus tard. */
export const log = {
  info: (...args: unknown[]) => console.log('[ScanCard]', ...args),
  warn: (...args: unknown[]) => console.warn('[ScanCard]', ...args),
  error: (...args: unknown[]) => console.error('[ScanCard]', ...args),
};

/** Message d'erreur lisible, quelle que soit la forme de l'exception. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Erreur inconnue';
}
