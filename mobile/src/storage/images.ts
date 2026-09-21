/**
 * Stockage des images de cartes dans le dossier privé de l'application.
 * Les fichiers de la caméra vivent dans le cache (effaçable par le système) :
 * on les déplace ici dès qu'une carte est enregistrée, pour ne jamais les perdre.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { log, newId } from '../utils';

const FOLDER = 'cards';

function cardsDirectory(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Copie une image temporaire vers le stockage durable et renvoie son URI.
 * `side` distingue le recto du verso dans le nom de fichier.
 */
export async function persistImage(sourceUri: string, side: 'front' | 'back' = 'front'): Promise<string> {
  const dir = cardsDirectory();
  const target = new File(dir, `${newId()}-${side}.jpg`);
  const source = new File(sourceUri);
  if (!source.exists) throw new Error("L'image capturée est introuvable.");
  await source.copy(target);
  return target.uri;
}

/** Supprime une image de carte ; l'absence de fichier n'est pas une erreur. */
export function deleteImage(uri: string | null): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('Suppression image impossible', uri, e);
  }
}

/** Contenu base64 d'une image, pour l'envoi à l'extraction cloud. */
export async function imageToBase64(uri: string): Promise<string> {
  const file = new File(uri);
  if (!file.exists) throw new Error('Image introuvable.');
  return file.base64();
}

/** Taille totale occupée par les images, affichée dans les paramètres. */
export function imagesFootprint(): { count: number; bytes: number } {
  try {
    const dir = cardsDirectory();
    const entries = dir.list();
    let bytes = 0;
    let count = 0;
    for (const entry of entries) {
      if (entry instanceof File) {
        count += 1;
        bytes += entry.size ?? 0;
      }
    }
    return { count, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Supprime toutes les images orphelines (non référencées par une carte). */
export function pruneOrphanImages(referenced: Set<string>): number {
  let removed = 0;
  try {
    for (const entry of cardsDirectory().list()) {
      if (entry instanceof File && !referenced.has(entry.uri)) {
        entry.delete();
        removed += 1;
      }
    }
  } catch (e) {
    log.warn('Nettoyage des images interrompu', e);
  }
  return removed;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
