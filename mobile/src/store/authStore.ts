/** État d'authentification, partagé par l'écran de compte et la synchronisation. */
import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getCurrentSession, onAuthChange, signIn, signOut, signUp } from '../services/auth';
import { isCloudConfigured } from '../services/supabase';
import { errorMessage } from '../utils';

interface AuthStoreState {
  user: User | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  cloudConfigured: boolean;
  init: () => Promise<() => void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  user: null,
  ready: false,
  busy: false,
  error: null,
  cloudConfigured: isCloudConfigured(),

  init: async () => {
    const { user } = await getCurrentSession();
    set({ user, ready: true });
    return onAuthChange(({ user: next }) => set({ user: next }));
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const { user } = await signIn(email, password);
      set({ user, busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: errorMessage(e) });
      return false;
    }
  },

  register: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const { user } = await signUp(email, password);
      set({ user, busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: errorMessage(e) });
      return false;
    }
  },

  logout: async () => {
    set({ busy: true });
    try {
      await signOut();
      set({ user: null, busy: false });
    } catch (e) {
      set({ busy: false, error: errorMessage(e) });
    }
  },

  clearError: () => set({ error: null }),
}));
