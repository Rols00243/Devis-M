/**
 * Stockage de la carte de visite de l'utilisateur.
 *
 * Une seule carte, donc pas de table : elle vit dans la table `settings`, sous
 * une clé réservée. Aucune migration nécessaire, et elle part avec le reste des
 * préférences le jour où celles-ci seront sauvegardées en ligne.
 */
import { normalizeMyCard } from '../mycard/model';
import { EMPTY_MY_CARD, type MyCard } from '../types';
import { log, nowIso } from '../utils';
import { getDb } from './db';

const KEY = 'my_card';

export async function loadMyCard(): Promise<MyCard> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    KEY,
  );
  if (!row?.value) return { ...EMPTY_MY_CARD };
  try {
    return normalizeMyCard(JSON.parse(row.value) as Partial<MyCard>);
  } catch (e) {
    log.warn('Carte de visite illisible, remise à zéro', e);
    return { ...EMPTY_MY_CARD };
  }
}

export async function saveMyCard(card: MyCard): Promise<MyCard> {
  const db = await getDb();
  const next: MyCard = { ...card, updatedAt: nowIso() };
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    KEY,
    JSON.stringify(next),
  );
  return next;
}
