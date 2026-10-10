/**
 * Base locale SQLite : source de vérité de l'application.
 * Tout fonctionne hors ligne ; le cloud n'est qu'une réplication de cette base.
 */
import * as SQLite from 'expo-sqlite';

import { log } from '../utils';

const DB_NAME = 'metrecards.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Migrations successives ; `user_version` porte le numéro appliqué. */
const MIGRATIONS: ((db: SQLite.SQLiteDatabase) => Promise<void>)[] = [
  // v1 — schéma initial
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY NOT NULL,
        firstName TEXT NOT NULL DEFAULT '',
        lastName TEXT NOT NULL DEFAULT '',
        jobTitle TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        secondaryPhone TEXT NOT NULL DEFAULT '',
        whatsapp TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        linkedin TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        imageUri TEXT,
        backImageUri TEXT,
        rawText TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        contactId TEXT,
        source TEXT NOT NULL DEFAULT 'camera',
        ocrEngine TEXT NOT NULL DEFAULT 'mlkit',
        languages TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        syncState TEXT NOT NULL DEFAULT 'local',
        ownerId TEXT,
        remoteImagePath TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_cards_updatedAt ON cards (updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_cards_status ON cards (status);
      CREATE INDEX IF NOT EXISTS idx_cards_sync ON cards (syncState);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cardId TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_card ON sync_queue (cardId);
    `);
  },

  // v2 — « extras » : tout ce que la carte porte en plus des 14 champs
  //      (troisième numéro, deuxième e-mail, fax, RCCM, réseaux sociaux…).
  async (db) => {
    await db.execAsync(`ALTER TABLE cards ADD COLUMN extras TEXT NOT NULL DEFAULT '[]';`);
  },
];

/** Ouvre la base et applique les migrations manquantes. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    log.info(`Migration base v${version + 1}`);
    await MIGRATIONS[version](db);
    // PRAGMA n'accepte pas de paramètre lié : la valeur vient d'un index interne, jamais de l'utilisateur.
    await db.execAsync(`PRAGMA user_version = ${version + 1}`);
  }
}

/** Utilisé par les tests et la remise à zéro depuis les paramètres. */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM cards; DELETE FROM sync_queue;');
}
