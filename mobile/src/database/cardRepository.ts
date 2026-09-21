/**
 * Accès aux cartes : seule couche autorisée à écrire dans la table `cards`.
 * La suppression est logique (`deletedAt`) pour que la synchronisation cloud
 * puisse propager l'effacement aux autres appareils.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  EMPTY_FIELDS,
  type BusinessCard,
  type CardFields,
  type CardSource,
  type CardStatus,
  type FieldConfidence,
  type OcrEngine,
  type SyncState,
} from '../types';
import { log, newId, nowIso } from '../utils';
import { getDb } from './db';

/** Ligne SQLite brute : les objets y sont stockés en JSON. */
interface CardRow extends CardFields {
  id: string;
  imageUri: string | null;
  backImageUri: string | null;
  rawText: string;
  confidence: string;
  status: CardStatus;
  contactId: string | null;
  source: CardSource;
  ocrEngine: OcrEngine;
  languages: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncState: SyncState;
  ownerId: string | null;
  remoteImagePath: string | null;
}

const COLUMNS = [
  'id',
  'firstName',
  'lastName',
  'jobTitle',
  'company',
  'phone',
  'secondaryPhone',
  'whatsapp',
  'email',
  'website',
  'address',
  'city',
  'country',
  'linkedin',
  'notes',
  'imageUri',
  'backImageUri',
  'rawText',
  'confidence',
  'status',
  'contactId',
  'source',
  'ocrEngine',
  'languages',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'syncState',
  'ownerId',
  'remoteImagePath',
] as const;

function toCard(row: CardRow): BusinessCard {
  return {
    ...row,
    confidence: safeParse<FieldConfidence>(row.confidence, {}),
    languages: safeParse<string[]>(row.languages, []),
  };
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRowValues(card: BusinessCard): unknown[] {
  return COLUMNS.map((col) => {
    if (col === 'confidence') return JSON.stringify(card.confidence ?? {});
    if (col === 'languages') return JSON.stringify(card.languages ?? []);
    return card[col as keyof BusinessCard] ?? (col in EMPTY_FIELDS ? '' : null);
  });
}

/** Construit une carte neuve à partir de champs extraits. */
export function buildCard(input: {
  fields: CardFields;
  confidence?: FieldConfidence;
  rawText?: string;
  imageUri?: string | null;
  backImageUri?: string | null;
  source?: CardSource;
  ocrEngine?: OcrEngine;
  languages?: string[];
}): BusinessCard {
  const at = nowIso();
  return {
    ...EMPTY_FIELDS,
    ...input.fields,
    id: newId(),
    imageUri: input.imageUri ?? null,
    backImageUri: input.backImageUri ?? null,
    rawText: input.rawText ?? '',
    confidence: input.confidence ?? {},
    status: 'draft',
    contactId: null,
    source: input.source ?? 'camera',
    ocrEngine: input.ocrEngine ?? 'manual',
    languages: input.languages ?? [],
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    syncState: 'local',
    ownerId: null,
    remoteImagePath: null,
  };
}

export async function saveCard(card: BusinessCard): Promise<BusinessCard> {
  const db = await getDb();
  const next: BusinessCard = { ...card, updatedAt: nowIso() };
  const placeholders = COLUMNS.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT OR REPLACE INTO cards (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    toRowValues(next) as never,
  );
  return next;
}

export async function updateCard(
  id: string,
  patch: Partial<BusinessCard>,
): Promise<BusinessCard | null> {
  const existing = await getCard(id);
  if (!existing) return null;
  return saveCard({ ...existing, ...patch, id: existing.id });
}

export async function getCard(id: string): Promise<BusinessCard | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CardRow>('SELECT * FROM cards WHERE id = ?', id);
  return row ? toCard(row) : null;
}

export interface ListOptions {
  /** Recherche libre : nom, entreprise, téléphone, e-mail, ville. */
  query?: string;
  status?: CardStatus;
  /** Cartes ayant (ou non) un contact créé dans le répertoire. */
  withContact?: boolean;
  limit?: number;
}

export async function listCards(options: ListOptions = {}): Promise<BusinessCard[]> {
  const db = await getDb();
  const where: string[] = ['deletedAt IS NULL'];
  const params: unknown[] = [];

  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  if (options.withContact === true) where.push('contactId IS NOT NULL');
  if (options.withContact === false) where.push('contactId IS NULL');

  const q = options.query?.trim();
  if (q) {
    // Recherche sur tous les champs utiles, y compris les chiffres d'un numéro.
    // Chaque `?` est positionnel : on empile les valeurs dans le même ordre,
    // sans mélanger avec des paramètres numérotés (source classique de bugs).
    const TEXT_COLUMNS = [
      'firstName',
      'lastName',
      'company',
      'jobTitle',
      'email',
      'city',
      'country',
      'notes',
    ];
    // Les colonnes de téléphone ne sont interrogées que si la recherche contient
    // des chiffres : sinon le motif « %% » ferait correspondre toutes les cartes.
    const digits = q.replace(/\D/g, '');
    const PHONE_COLUMNS = digits ? ['phone', 'secondaryPhone', 'whatsapp'] : [];
    const clauses = [
      ...TEXT_COLUMNS.map((c) => `${c} LIKE ?`),
      ...PHONE_COLUMNS.map((c) => `REPLACE(REPLACE(REPLACE(${c}, ' ', ''), '-', ''), '.', '') LIKE ?`),
    ];
    where.push(`(${clauses.join(' OR ')})`);

    TEXT_COLUMNS.forEach(() => params.push(`%${q}%`));
    PHONE_COLUMNS.forEach(() => params.push(`%${digits}%`));
  }

  const sql = `SELECT * FROM cards WHERE ${where.join(' AND ')} ORDER BY updatedAt DESC${
    options.limit ? ` LIMIT ${Math.max(1, Math.floor(options.limit))}` : ''
  }`;

  const rows = await db.getAllAsync<CardRow>(sql, params as never);
  return rows.map(toCard);
}

/** Suppression logique : la carte disparaît de l'app et part en file de synchro. */
export async function softDeleteCard(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE cards SET deletedAt = ?, syncState = 'pending', updatedAt = ? WHERE id = ?",
    nowIso(),
    nowIso(),
    id,
  );
}

/** Suppression définitive, une fois l'effacement propagé au cloud. */
export async function hardDeleteCard(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cards WHERE id = ?', id);
}

export async function countCards(): Promise<{
  total: number;
  withContact: number;
  last7days: number;
}> {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const row = await db.getFirstAsync<{ total: number; withContact: number; recent: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN contactId IS NOT NULL THEN 1 ELSE 0 END) AS withContact,
       SUM(CASE WHEN createdAt >= ? THEN 1 ELSE 0 END) AS recent
     FROM cards WHERE deletedAt IS NULL`,
    since,
  );
  return {
    total: row?.total ?? 0,
    withContact: row?.withContact ?? 0,
    last7days: row?.recent ?? 0,
  };
}

/** Cartes restant à pousser vers le cloud. */
export async function pendingSyncCards(): Promise<BusinessCard[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CardRow>(
    "SELECT * FROM cards WHERE syncState IN ('local', 'pending', 'error') ORDER BY updatedAt ASC",
  );
  return rows.map(toCard);
}

/** Toutes les images référencées : sert au nettoyage des fichiers orphelins. */
export async function referencedImages(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ imageUri: string | null; backImageUri: string | null }>(
    'SELECT imageUri, backImageUri FROM cards',
  );
  const set = new Set<string>();
  rows.forEach((r) => {
    if (r.imageUri) set.add(r.imageUri);
    if (r.backImageUri) set.add(r.backImageUri);
  });
  return set;
}

/** Insertion/mise à jour venant du cloud : on ne garde que la version la plus récente. */
export async function mergeRemoteCard(remote: BusinessCard): Promise<'inserted' | 'updated' | 'skipped'> {
  const local = await getCard(remote.id);
  if (!local) {
    await saveCard({ ...remote, syncState: 'synced' });
    return 'inserted';
  }
  if (new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
    // L'image locale reste prioritaire : elle est déjà sur l'appareil.
    await saveCard({
      ...remote,
      imageUri: local.imageUri ?? remote.imageUri,
      backImageUri: local.backImageUri ?? remote.backImageUri,
      syncState: 'synced',
    });
    return 'updated';
  }
  return 'skipped';
}

export async function markSynced(id: string, remoteImagePath?: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE cards SET syncState = 'synced', remoteImagePath = COALESCE(?, remoteImagePath) WHERE id = ?",
    remoteImagePath ?? null,
    id,
  );
}

export async function markSyncError(id: string, message: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE cards SET syncState = 'error' WHERE id = ?", id);
  log.warn('Échec de synchronisation', id, message);
}

/** Transaction utilitaire, exposée pour les imports en lot. */
export async function withTransaction(task: (db: SQLiteDatabase) => Promise<void>): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(() => task(db));
}
