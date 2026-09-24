/** Préférences de l'application, stockées dans la même base SQLite. */
import { DEFAULT_SETTINGS, type AppSettings } from '../types';
import { getDb } from './db';

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored: Record<string, unknown> = {};
  rows.forEach((r) => {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      stored[r.key] = r.value;
    }
  });
  // On repart des valeurs par défaut : une clé inconnue ou corrompue est ignorée.
  const merged = { ...DEFAULT_SETTINGS };
  (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]).forEach((key) => {
    const value = stored[key];
    if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      (merged as Record<string, unknown>)[key] = value;
    }
  });
  return merged;
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    key,
    JSON.stringify(value),
  );
}
