/**
 * Extraction assistée par IA, côté serveur.
 *
 * L'image part vers une Edge Function Supabase qui interroge Claude en vision et
 * renvoie directement les champs structurés. Deux raisons à ce détour :
 *   1. la clé API du modèle ne doit jamais se trouver dans le binaire mobile,
 *      qui est décompilable — elle reste un secret de la fonction ;
 *   2. le modèle lit l'arabe et les mises en page atypiques que ML Kit rate.
 *
 * Cette voie est facultative : sans configuration cloud, l'application
 * fonctionne entièrement hors ligne avec l'OCR local.
 */
import { EMPTY_FIELDS, type CardFields, type FieldConfidence, type OcrResult } from '../types';
import { errorMessage, log } from '../utils';
import { getSupabase, isCloudConfigured } from '../services/supabase';
import { prepareForCloud } from './imagePipeline';

/** Réponse attendue de la fonction `extract-card`. */
interface CloudExtractionResponse {
  fields: Partial<CardFields>;
  confidence?: FieldConfidence;
  rawText?: string;
  languages?: string[];
}

export class CloudExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudExtractionError';
  }
}

export function isCloudOcrAvailable(): boolean {
  return isCloudConfigured();
}

/**
 * Envoie la carte à l'extraction IA et renvoie des champs déjà structurés.
 * Les valeurs sont filtrées sur les clés connues : la réponse d'un service
 * externe n'est jamais recopiée telle quelle dans la base.
 */
export async function extractInCloud(imageUri: string): Promise<OcrResult> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new CloudExtractionError(
      "Le cloud n'est pas configuré. Renseignez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const prepared = await prepareForCloud(imageUri);
  if (!prepared.base64) throw new CloudExtractionError("L'image n'a pas pu être encodée.");

  const { data, error } = await supabase.functions.invoke<CloudExtractionResponse>('extract-card', {
    body: { imageBase64: prepared.base64, mimeType: 'image/jpeg' },
  });

  if (error) {
    log.warn('Extraction cloud en échec', errorMessage(error));
    throw new CloudExtractionError(
      "L'extraction IA a échoué. Le résultat hors ligne est conservé.",
    );
  }
  if (!data?.fields) throw new CloudExtractionError('Réponse inattendue du service d’extraction.');

  return {
    text: data.rawText ?? '',
    engine: 'cloud',
    lines: (data.rawText ?? '').split('\n').map((text) => ({ text })),
    fields: sanitizeFields(data.fields),
    confidence: sanitizeConfidence(data.confidence),
    languages: Array.isArray(data.languages) ? data.languages.slice(0, 5).map(String) : [],
  };
}

function sanitizeFields(raw: Partial<CardFields>): Partial<CardFields> {
  const out: Partial<CardFields> = {};
  (Object.keys(EMPTY_FIELDS) as (keyof CardFields)[]).forEach((key) => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 500);
  });
  return out;
}

function sanitizeConfidence(raw: FieldConfidence | undefined): FieldConfidence {
  const out: FieldConfidence = {};
  if (!raw) return out;
  (Object.keys(EMPTY_FIELDS) as (keyof CardFields)[]).forEach((key) => {
    const value = raw[key];
    if (typeof value === 'number' && value >= 0 && value <= 1) out[key] = value;
  });
  return out;
}
