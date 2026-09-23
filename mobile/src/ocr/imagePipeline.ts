/**
 * Préparation de l'image avant OCR.
 *
 * Sur une carte de visite, l'information la plus fine — les numéros de
 * téléphone — est imprimée en petits caractères. Une image trop réduite les
 * rend illisibles : c'est la première cause de champs manquants. On prépare
 * donc deux tailles, lues l'une après l'autre (voir `localOcr.ts`) :
 * une vue d'ensemble, et une vue fine pour les petits caractères.
 *
 * La correction de perspective est faite en amont par le scanner de document
 * natif (ML Kit Document Scanner / VisionKit), qui détecte les contours.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Première passe : la carte entière, à une taille que ML Kit traite vite. */
const OCR_WIDTH = 2000;
/** Seconde passe : plus grande, pour les mentions imprimées en petit. */
const OCR_FINE_WIDTH = 3200;
/** Largeur d'archive : ce qu'on conserve comme photo de la carte. */
const ARCHIVE_WIDTH = 1280;
/**
 * Largeur envoyée au cloud. Assez grande pour que le modèle lise les petits
 * caractères, assez petite pour rester sous la limite de taille de la requête.
 */
const CLOUD_WIDTH = 1600;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

async function resize(uri: string, width: number, compress: number): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
  return { uri: result.uri, width: result.width, height: result.height };
}

/** Image optimisée pour la reconnaissance de texte : vue d'ensemble. */
export function prepareForOcr(uri: string): Promise<PreparedImage> {
  // Compression quasi nulle : un artefact JPEG sur un chiffre fin coûte un numéro.
  return resize(uri, OCR_WIDTH, 0.95);
}

/** Même image, agrandie : c'est elle qui fait sortir les petits caractères. */
export function prepareForOcrFine(uri: string): Promise<PreparedImage> {
  return resize(uri, OCR_FINE_WIDTH, 0.95);
}

/** Image conservée dans l'historique et affichée dans la fiche. */
export function prepareForArchive(uri: string): Promise<PreparedImage> {
  return resize(uri, ARCHIVE_WIDTH, 0.8);
}

/** Image transmise à l'extraction IA, avec son contenu base64. */
export async function prepareForCloud(uri: string): Promise<PreparedImage & { base64: string }> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: CLOUD_WIDTH });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    base64: result.base64 ?? '',
  };
}

/** Rotation manuelle depuis l'écran de vérification, quand la carte est de travers. */
export async function rotate(uri: string, degrees: number): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  context.rotate(degrees);
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return { uri: result.uri, width: result.width, height: result.height };
}
