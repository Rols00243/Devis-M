/**
 * État global des cartes. Les écrans lisent ce cache mémoire ; toute écriture
 * passe par le dépôt SQLite, qui reste la source de vérité.
 */
import { create } from 'zustand';

import {
  countCards,
  listCards,
  saveCard,
  softDeleteCard,
  updateCard,
  type ListOptions,
} from '../database/cardRepository';
import { deleteImage } from '../storage/images';
import type { BusinessCard } from '../types';
import { errorMessage, log } from '../utils';

interface CardsState {
  cards: BusinessCard[];
  stats: { total: number; withContact: number; last7days: number };
  loading: boolean;
  error: string | null;
  refresh: (options?: ListOptions) => Promise<void>;
  upsert: (card: BusinessCard) => Promise<BusinessCard>;
  patch: (id: string, patch: Partial<BusinessCard>) => Promise<BusinessCard | null>;
  remove: (id: string) => Promise<void>;
  byId: (id: string) => BusinessCard | undefined;
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: [],
  stats: { total: 0, withContact: 0, last7days: 0 },
  loading: false,
  error: null,

  refresh: async (options) => {
    set({ loading: true, error: null });
    try {
      const [cards, stats] = await Promise.all([listCards(options), countCards()]);
      set({ cards, stats, loading: false });
    } catch (e) {
      log.error('Chargement des cartes', e);
      set({ loading: false, error: errorMessage(e) });
    }
  },

  upsert: async (card) => {
    const saved = await saveCard({ ...card, syncState: 'pending' });
    const others = get().cards.filter((c) => c.id !== saved.id);
    set({ cards: [saved, ...others] });
    countCards().then((stats) => set({ stats }));
    return saved;
  },

  patch: async (id, patch) => {
    const updated = await updateCard(id, { ...patch, syncState: 'pending' });
    if (!updated) return null;
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) });
    countCards().then((stats) => set({ stats }));
    return updated;
  },

  remove: async (id) => {
    const card = get().byId(id);
    await softDeleteCard(id);
    // Les fichiers image partent tout de suite : ils ne sont plus affichables.
    deleteImage(card?.imageUri ?? null);
    deleteImage(card?.backImageUri ?? null);
    set({ cards: get().cards.filter((c) => c.id !== id) });
    countCards().then((stats) => set({ stats }));
  },

  byId: (id) => get().cards.find((c) => c.id === id),
}));
