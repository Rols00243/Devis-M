/**
 * Orchestrateur du pipeline « image → champs ».
 *
 * Stratégie : l'OCR local passe en premier (instantané, gratuit, hors ligne).
 * On ne sollicite l'IA cloud que lorsqu'elle apporte quelque chose — texte
 * illisible, carte en arabe, champs manquants — puis on fusionne les deux
 * résultats en gardant, champ par champ, la valeur la plus sûre.
 */
import { extractFields, needsCloudFallback } from '../ai/extractor';
import { mergeExtractions } from '../ai/merge';
import { EMPTY_FIELDS, type CardFields, type ScanOutcome } from '../types';
import { errorMessage, log } from '../utils';
import { extractInCloud, isCloudOcrAvailable } from './cloudOcr';
import { isLocalOcrAvailable, recognizeLocally } from './localOcr';

export type ScanStage =
  | 'preparing'
  | 'recognizing'
  | 'analyzing'
  | 'cloud'
  | 'done';

export interface ScanOptions {
  imageUri: string;
  /** Autorisation utilisateur d'envoyer l'image au service d'extraction IA. */
  cloudAiEnabled: boolean;
  defaultCountryCode?: string;
  onStage?: (stage: ScanStage) => void;
}

/** Résultat du pipeline, enrichi de ce qui s'est réellement passé. */
export interface ScanReport extends ScanOutcome {
  usedCloud: boolean;
  /** Renseigné quand une étape a échoué sans empêcher le reste d'aboutir. */
  warning?: string;
}

export async function scanCard(options: ScanOptions): Promise<ScanReport> {
  const { imageUri, cloudAiEnabled, defaultCountryCode, onStage } = options;
  let warning: string | undefined;

  onStage?.('recognizing');

  // 1. OCR embarqué.
  let localText = '';
  let localResult: ReturnType<typeof extractFields> | null = null;
  let localFailed = false;

  if (isLocalOcrAvailable()) {
    try {
      const ocr = await recognizeLocally(imageUri);
      localText = ocr.text;
      onStage?.('analyzing');
      localResult = extractFields({
        text: ocr.text,
        lines: ocr.lines,
        defaultCountryCode,
      });
    } catch (e) {
      localFailed = true;
      warning = errorMessage(e);
      log.warn('OCR local en échec', warning);
    }
  } else {
    localFailed = true;
  }

  // 2. Faut-il l'IA ? Oui si le local a échoué, ou si son résultat est trop pauvre.
  const wantsCloud = localFailed || !localResult || needsCloudFallback(localResult);
  const canUseCloud = cloudAiEnabled && isCloudOcrAvailable();

  if (wantsCloud && canUseCloud) {
    onStage?.('cloud');
    try {
      const cloud = await extractInCloud(imageUri);
      const cloudFields: CardFields = { ...EMPTY_FIELDS, ...(cloud.fields ?? {}) };
      const merged = mergeExtractions(
        localResult
          ? { fields: localResult.fields, confidence: localResult.confidence }
          : { fields: EMPTY_FIELDS, confidence: {} },
        { fields: cloudFields, confidence: cloud.confidence ?? {} },
      );
      onStage?.('done');
      return {
        fields: merged.fields,
        confidence: merged.confidence,
        rawText: cloud.text || localText,
        engine: 'cloud',
        languages: cloud.languages?.length ? cloud.languages : (localResult?.languages ?? []),
        imageUri,
        usedCloud: true,
        warning,
      };
    } catch (e) {
      warning = errorMessage(e);
      log.warn('Extraction cloud ignorée', warning);
    }
  }

  // 3. Aucun moteur n'a abouti : on rend la main pour une saisie manuelle.
  if (!localResult) {
    onStage?.('done');
    return {
      fields: { ...EMPTY_FIELDS },
      confidence: {},
      rawText: localText,
      engine: 'manual',
      languages: [],
      imageUri,
      usedCloud: false,
      warning:
        warning ??
        "Aucun moteur de reconnaissance n'est disponible. Saisissez les informations manuellement.",
    };
  }

  onStage?.('done');
  return {
    fields: localResult.fields,
    confidence: localResult.confidence,
    rawText: localText,
    engine: 'mlkit',
    languages: localResult.languages,
    imageUri,
    usedCloud: false,
    warning: wantsCloud && !canUseCloud ? 'Lecture partielle : vérifiez les champs.' : warning,
  };
}

/** Ré-extraction à partir du texte déjà mémorisé, sans repasser par la caméra. */
export function reExtractFromText(rawText: string, defaultCountryCode?: string): ScanOutcome {
  const result = extractFields({ text: rawText, defaultCountryCode });
  return {
    fields: result.fields,
    confidence: result.confidence,
    rawText,
    engine: 'mlkit',
    languages: result.languages,
    imageUri: null,
  };
}

export { isLocalOcrAvailable } from './localOcr';
export { isCloudOcrAvailable } from './cloudOcr';
