/** Petits utilitaires partagés, sans dépendance à l'UI. */
import * as Crypto from 'expo-crypto';

export * from './pure';

export function newId(): string {
  return Crypto.randomUUID();
}

/** Journalisation centralisée : un seul endroit à brancher sur Sentry plus tard. */
export const log = {
  info: (...args: unknown[]) => console.log('[ScanCard]', ...args),
  warn: (...args: unknown[]) => console.warn('[ScanCard]', ...args),
  error: (...args: unknown[]) => console.error('[ScanCard]', ...args),
};
