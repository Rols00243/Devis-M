/**
 * Client Supabase : base Postgres, stockage des images, authentification.
 *
 * Choix technique : Supabase apporte d'un bloc la base, le stockage de fichiers,
 * l'authentification et surtout la sécurité au niveau des lignes (RLS), qui
 * garantit qu'un utilisateur ne peut lire que ses propres cartes — exigence du
 * cahier des charges sur la confidentialité, appliquée par le serveur et non
 * par l'application.
 *
 * Le cloud est facultatif : sans variables d'environnement, `getSupabase()`
 * renvoie null et toute l'application continue de fonctionner en local.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { log } from '../utils';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
// Clé « anon » : publique par conception, sans pouvoir propre — ce sont les
// règles RLS qui autorisent ou refusent chaque lecture et chaque écriture.
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

export function isCloudConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured()) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Pas de session dans l'URL : on n'est pas dans un navigateur.
        detectSessionInUrl: false,
      },
    });
    log.info('Client cloud initialisé');
  }
  return client;
}

/** Nom de la table et du bucket, centralisés pour éviter les fautes de frappe. */
export const CARDS_TABLE = 'business_cards';
export const CARDS_BUCKET = 'card-images';
