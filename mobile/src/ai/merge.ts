/**
 * Fusion de deux extractions (locale et cloud).
 *
 * Règle : champ par champ, on retient la valeur dont la confiance est la plus
 * élevée. À confiance égale, le cloud l'emporte — il voit la mise en page, là
 * où l'extraction locale ne voit qu'un texte à plat. Un champ vide ne remplace
 * jamais un champ rempli.
 */
import { EMPTY_FIELDS, type CardFields, type ExtraItem, type FieldConfidence } from '../types';

export interface Extraction {
  fields: CardFields;
  confidence: FieldConfidence;
  /** Informations hors des 14 champs ; les deux moteurs peuvent en trouver. */
  extras?: ExtraItem[];
}

export function mergeExtractions(local: Extraction, cloud: Extraction): Extraction {
  const fields: CardFields = { ...EMPTY_FIELDS };
  const confidence: FieldConfidence = {};

  (Object.keys(EMPTY_FIELDS) as (keyof CardFields)[]).forEach((key) => {
    const localValue = (local.fields[key] ?? '').trim();
    const cloudValue = (cloud.fields[key] ?? '').trim();
    const localScore = localValue ? (local.confidence[key] ?? 0.5) : -1;
    // Le cloud part avec une confiance par défaut plus haute, méritée par ses
    // meilleurs résultats sur les cartes difficiles.
    const cloudScore = cloudValue ? (cloud.confidence[key] ?? 0.8) : -1;

    if (cloudScore >= localScore && cloudValue) {
      fields[key] = cloudValue;
      confidence[key] = cloud.confidence[key] ?? 0.8;
    } else if (localValue) {
      fields[key] = localValue;
      confidence[key] = local.confidence[key] ?? 0.5;
    }
  });

  return { fields, confidence, extras: mergeExtras(local.extras, cloud.extras, fields) };
}

/**
 * Réunit les informations supplémentaires des deux moteurs.
 *
 * Deux filtres seulement : les doublons entre eux, et les valeurs déjà placées
 * dans un champ du formulaire — les répéter en « autres informations » ne
 * servirait qu'à alourdir la fiche. Tout le reste est conservé.
 */
export function mergeExtras(
  local: ExtraItem[] = [],
  cloud: ExtraItem[] = [],
  fields: CardFields = EMPTY_FIELDS,
): ExtraItem[] {
  const placed = new Set(
    Object.values(fields)
      .map((v) => normalizeForCompare(v))
      .filter(Boolean),
  );
  const out: ExtraItem[] = [];
  [...cloud, ...local].forEach((item) => {
    const value = (item?.value ?? '').trim();
    if (!value) return;
    const key = normalizeForCompare(value);
    if (placed.has(key)) return;
    if (out.some((o) => normalizeForCompare(o.value) === key)) return;
    out.push({ label: item.label?.trim() || 'Sur la carte', value, kind: item.kind ?? 'text' });
  });
  return out;
}

/** Comparaison indulgente : casse, espaces et ponctuation de numéro ignorés. */
const normalizeForCompare = (v: string): string =>
  (v ?? '').toLowerCase().replace(/[\s.\-()]/g, '');

/** Champs sous le seuil : ceux que l'écran de vérification met en évidence. */
export function lowConfidenceFields(
  fields: CardFields,
  confidence: FieldConfidence,
  threshold = 0.6,
): (keyof CardFields)[] {
  return (Object.keys(EMPTY_FIELDS) as (keyof CardFields)[]).filter(
    (key) => (fields[key] ?? '').trim() !== '' && (confidence[key] ?? 0) < threshold,
  );
}
