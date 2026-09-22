/**
 * Synchronisation hors ligne d'abord.
 *
 * Principe : la base SQLite locale accepte toujours l'écriture ; chaque carte
 * modifiée est marquée `pending`. Quand le réseau revient et qu'un compte est
 * connecté, on pousse les cartes en attente, on téléverse les images manquantes,
 * puis on récupère les modifications distantes. En cas de conflit, la version la
 * plus récemment modifiée gagne — suffisant pour des fiches de contact, et sans
 * la complexité d'un CRDT.
 */
import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';

import {
  listCards,
  markSyncError,
  markSynced,
  mergeRemoteCard,
  pendingSyncCards,
  hardDeleteCard,
} from '../database/cardRepository';
import type { BusinessCard, ExtraItem } from '../types';
import { errorMessage, log } from '../utils';
import { getCurrentSession } from './auth';
import { CARDS_BUCKET, CARDS_TABLE, getSupabase } from './supabase';

export interface SyncReport {
  pushed: number;
  pulled: number;
  images: number;
  skipped: boolean;
  reason?: string;
}

let running = false;

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

/** Lance une synchronisation complète ; ne fait rien si les conditions manquent. */
export async function syncNow(): Promise<SyncReport> {
  const empty: SyncReport = { pushed: 0, pulled: 0, images: 0, skipped: true };
  const supabase = getSupabase();
  if (!supabase) return { ...empty, reason: 'Cloud non configuré' };
  if (running) return { ...empty, reason: 'Synchronisation déjà en cours' };
  if (!(await isOnline())) return { ...empty, reason: 'Hors ligne' };

  const { user } = await getCurrentSession();
  if (!user) return { ...empty, reason: 'Aucun compte connecté' };

  running = true;
  const report: SyncReport = { pushed: 0, pulled: 0, images: 0, skipped: false };

  try {
    // 1. Envoi des cartes locales en attente.
    const pending = await pendingSyncCards();
    for (const card of pending) {
      try {
        const remotePath = await uploadImage(card, user.id);
        if (remotePath && remotePath !== card.remoteImagePath) report.images += 1;

        const { error } = await supabase
          .from(CARDS_TABLE)
          .upsert(toRemoteRow(card, user.id, remotePath));
        if (error) throw new Error(error.message);

        if (card.deletedAt) {
          // L'effacement a été propagé : la ligne locale peut vraiment partir.
          await hardDeleteCard(card.id);
        } else {
          await markSynced(card.id, remotePath);
        }
        report.pushed += 1;
      } catch (e) {
        await markSyncError(card.id, errorMessage(e));
      }
    }

    // 2. Récupération des cartes distantes modifiées depuis la dernière synchro.
    const since = await latestLocalTimestamp();
    const { data, error } = await supabase
      .from(CARDS_TABLE)
      .select('*')
      .eq('owner_id', user.id)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const card = fromRemoteRow(row as RemoteRow);
      const outcome = await mergeRemoteCard(card);
      if (outcome !== 'skipped') report.pulled += 1;
    }

    return report;
  } catch (e) {
    log.warn('Synchronisation interrompue', errorMessage(e));
    return { ...report, reason: errorMessage(e) };
  } finally {
    running = false;
  }
}

/** Téléverse l'image de la carte si elle ne l'est pas déjà ; renvoie son chemin distant. */
async function uploadImage(card: BusinessCard, userId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase || !card.imageUri || card.deletedAt) return card.remoteImagePath;
  if (card.remoteImagePath) return card.remoteImagePath;

  const file = new File(card.imageUri);
  if (!file.exists) return null;

  // Le chemin commence par l'identifiant du propriétaire : la règle de sécurité
  // du bucket s'appuie dessus pour cloisonner les fichiers entre comptes.
  const path = `${userId}/${card.id}.jpg`;
  const bytes = await file.bytes();
  const { error } = await supabase.storage
    .from(CARDS_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

async function latestLocalTimestamp(): Promise<string> {
  const cards = await listCards({ limit: 1 });
  return cards[0]?.updatedAt ?? new Date(0).toISOString();
}

/* ---------------- Correspondance entre le modèle local et la table ---------------- */

interface RemoteRow {
  id: string;
  owner_id: string;
  first_name: string;
  last_name: string;
  job_title: string;
  company: string;
  phone: string;
  secondary_phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
  city: string;
  country: string;
  linkedin: string;
  notes: string;
  raw_text: string;
  extras: unknown;
  confidence: Record<string, number> | null;
  status: BusinessCard['status'];
  contact_id: string | null;
  source: BusinessCard['source'];
  ocr_engine: BusinessCard['ocrEngine'];
  languages: string[] | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function toRemoteRow(card: BusinessCard, ownerId: string, imagePath: string | null): RemoteRow {
  return {
    id: card.id,
    owner_id: ownerId,
    first_name: card.firstName,
    last_name: card.lastName,
    job_title: card.jobTitle,
    company: card.company,
    phone: card.phone,
    secondary_phone: card.secondaryPhone,
    whatsapp: card.whatsapp,
    email: card.email,
    website: card.website,
    address: card.address,
    city: card.city,
    country: card.country,
    linkedin: card.linkedin,
    notes: card.notes,
    raw_text: card.rawText,
    extras: card.extras ?? [],
    confidence: card.confidence as Record<string, number>,
    status: card.status,
    contact_id: card.contactId,
    source: card.source,
    ocr_engine: card.ocrEngine,
    languages: card.languages,
    image_path: imagePath,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
    deleted_at: card.deletedAt,
  };
}

function fromRemoteRow(row: RemoteRow): BusinessCard {
  return {
    id: row.id,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    jobTitle: row.job_title ?? '',
    company: row.company ?? '',
    phone: row.phone ?? '',
    secondaryPhone: row.secondary_phone ?? '',
    whatsapp: row.whatsapp ?? '',
    email: row.email ?? '',
    website: row.website ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    country: row.country ?? '',
    linkedin: row.linkedin ?? '',
    notes: row.notes ?? '',
    imageUri: null,
    backImageUri: null,
    rawText: row.raw_text ?? '',
    extras: Array.isArray(row.extras) ? (row.extras as ExtraItem[]) : [],
    confidence: row.confidence ?? {},
    status: row.status ?? 'validated',
    contactId: row.contact_id,
    source: row.source ?? 'camera',
    ocrEngine: row.ocr_engine ?? 'mlkit',
    languages: row.languages ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncState: 'synced',
    ownerId: row.owner_id,
    remoteImagePath: row.image_path,
  };
}

/** Déclenche une synchronisation dès que la connexion revient. */
export function watchConnectivity(onSynced: (report: SyncReport) => void): () => void {
  let wasOffline = false;
  const unsubscribe = NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable !== false);
    if (online && wasOffline) {
      syncNow().then(onSynced).catch((e) => log.warn('Synchro auto', errorMessage(e)));
    }
    wasOffline = !online;
  });
  return unsubscribe;
}
