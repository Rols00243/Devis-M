/**
 * Préparation de l'image avant OCR.
 *
 * ML Kit lit mieux une image nette de taille modérée qu'une photo de 12 Mpx :
 * on redimensionne sur le grand côté et on recompresse en JPEG. La correction
 * de perspective, elle, est faite en amont par le scanner de document natif
 * (ML Kit Document Scanner / VisionKit), qui dispose de la détection de contours.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Largeur cible : compromis mesuré entre précision OCR et temps de traitement. */
const OCR_WIDTH = 1600;
/** Largeur d'archive : ce qu'on conserve comme photo de la carte. */
const ARCHIVE_WIDTH = 1280;
/** Largeur envoyée au cloud : l'IA n'a pas besoin de plus, et ça réduit le coût. */
const CLOUD_WIDTH = 1100;

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

/** Image optimisée pour la reconnaissance de texte. */
export function prepareForOcr(uri: string): Promise<PreparedImage> {
  return resize(uri, OCR_WIDTH, 0.9);
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
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
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
