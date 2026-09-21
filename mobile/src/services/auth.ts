/**
 * Authentification (e-mail + mot de passe) pour la synchronisation cloud.
 * L'application reste utilisable sans compte : se connecter n'active que la
 * sauvegarde en ligne et le partage entre appareils.
 */
import type { Session, User } from '@supabase/supabase-js';

import { errorMessage } from '../utils';
import { getSupabase } from './supabase';

export interface AuthState {
  user: User | null;
  session: Session | null;
}

export async function getCurrentSession(): Promise<AuthState> {
  const supabase = getSupabase();
  if (!supabase) return { user: null, session: null };
  const { data } = await supabase.auth.getSession();
  return { user: data.session?.user ?? null, session: data.session ?? null };
}

export function onAuthChange(callback: (state: AuthState) => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback({ user: session?.user ?? null, session });
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<AuthState> {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(translateAuthError(error.message));
  return { user: data.user, session: data.session };
}

export async function signUp(email: string, password: string): Promise<AuthState> {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(translateAuthError(error.message));
  return { user: data.user, session: data.session };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(errorMessage(error));
}

/** Suppression du compte et de toutes ses données, exigée par le RGPD. */
export async function deleteAccount(): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw new Error("La suppression du compte a échoué. Réessayez plus tard.");
  await supabase.auth.signOut();
}

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error(
      "La synchronisation cloud n'est pas configurée sur cette installation (voir .env.example).",
    );
  }
  return supabase;
}

/** Messages d'erreur en français, plus utiles que ceux de l'API. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('already registered')) return 'Un compte existe déjà avec cet e-mail.';
  if (m.includes('password')) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (m.includes('email')) return "L'adresse e-mail n'est pas valide.";
  if (m.includes('network')) return 'Connexion impossible. Vérifiez votre réseau.';
  return message;
}
