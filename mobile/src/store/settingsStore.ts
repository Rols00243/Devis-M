/** État global des préférences, adossé à la table `settings` de SQLite. */
import { create } from 'zustand';

import { loadSettings, saveSetting } from '../database/settingsRepository';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await loadSettings();
    set({ settings, loaded: true });
  },

  set: async (key, value) => {
    // Écriture optimiste : l'interface répond immédiatement, la base suit.
    set({ settings: { ...get().settings, [key]: value } });
    await saveSetting(key, value);
  },
}));
