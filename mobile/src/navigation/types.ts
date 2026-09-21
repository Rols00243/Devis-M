import type { CardFields, FieldConfidence, OcrEngine } from '../types';

/** Données transmises de l'écran de scan à l'écran de vérification. */
export interface ReviewPayload {
  fields: CardFields;
  confidence: FieldConfidence;
  rawText: string;
  engine: OcrEngine;
  languages: string[];
  imageUri: string | null;
  backImageUri?: string | null;
  warning?: string;
}

export type RootStackParamList = {
  Home: undefined;
  Scan: { mode?: 'single' | 'batch' } | undefined;
  /** `cardId` pour reprendre une carte existante, `payload` pour un nouveau scan. */
  Review: { payload?: ReviewPayload; cardId?: string };
  Cards: { filter?: 'all' | 'withContact' | 'withoutContact' } | undefined;
  CardDetail: { cardId: string };
  History: undefined;
  Settings: undefined;
  Account: undefined;
};
