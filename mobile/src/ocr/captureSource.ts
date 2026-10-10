/**
 * Obtenir une image de carte depuis n'importe quel écran, sans repasser par
 * l'écran de scan : scanner natif si disponible, appareil photo sinon, et
 * galerie en dernier recours. Utilisé notamment pour photographier le verso.
 */
import * as ImagePicker from 'expo-image-picker';

import { isDocumentScannerAvailable, scanDocument } from './documentScanner';

export type CaptureMode = 'camera' | 'gallery';

/** Renvoie l'URI de l'image choisie, ou null si l'utilisateur a renoncé. */
export async function captureCardImage(mode: CaptureMode = 'camera'): Promise<string | null> {
  if (mode === 'camera' && isDocumentScannerAvailable()) {
    const result = await scanDocument(1);
    return result.cancelled ? null : (result.images[0] ?? null);
  }

  if (mode === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true });
    return shot.canceled ? null : (shot.assets[0]?.uri ?? null);
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
  });
  return picked.canceled ? null : (picked.assets[0]?.uri ?? null);
}
