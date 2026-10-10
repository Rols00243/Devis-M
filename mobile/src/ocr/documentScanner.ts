/**
 * Scanner de document natif.
 *
 * Choix technique : la détection des contours, le cadrage automatique et la
 * correction de perspective sont assurés par les scanners du système
 * (ML Kit Document Scanner sur Android, VisionKit sur iOS) plutôt que
 * réimplémentés en JavaScript. Ils tournent sur le flux vidéo natif, déclenchent
 * la capture dès que la carte est bien positionnée, et restituent une image
 * redressée — ce qu'aucune boucle JS ne peut égaler en fluidité.
 *
 * Quand le module natif n'est pas présent (Expo Go, build sans le plugin),
 * l'application bascule sur son propre écran caméra avec cadre de visée.
 */
import { log } from '../utils';

interface ScanDocumentOptions {
  croppedImageQuality?: number;
  maxNumDocuments?: number;
  responseType?: string;
}

interface ScanDocumentResponse {
  scannedImages?: string[];
  status?: string;
}

interface DocumentScannerModule {
  scanDocument: (options: ScanDocumentOptions) => Promise<ScanDocumentResponse>;
}

let moduleRef: DocumentScannerModule | null = null;
let moduleMissing = false;

function loadModule(): DocumentScannerModule | null {
  if (moduleRef || moduleMissing) return moduleRef;
  try {
    const mod = require('react-native-document-scanner-plugin');
    const candidate = (mod.default ?? mod) as DocumentScannerModule;
    moduleRef = typeof candidate?.scanDocument === 'function' ? candidate : null;
    if (!moduleRef) moduleMissing = true;
  } catch (e) {
    moduleMissing = true;
    log.warn('Scanner de document natif indisponible', e);
  }
  return moduleRef;
}

export function isDocumentScannerAvailable(): boolean {
  return loadModule() !== null;
}

export interface DocumentScanResult {
  /** URI des pages scannées : une par page (recto, puis verso si demandé). */
  images: string[];
  cancelled: boolean;
}

/**
 * Ouvre le scanner système. `maxPages` vaut 2 pour un scan recto-verso :
 * l'utilisateur photographie les deux faces dans la même session.
 */
export async function scanDocument(maxPages = 1): Promise<DocumentScanResult> {
  const scanner = loadModule();
  if (!scanner) return { images: [], cancelled: true };

  const response = await scanner.scanDocument({
    croppedImageQuality: 100,
    maxNumDocuments: maxPages,
    responseType: 'imageFilePath',
  });

  const images = (response.scannedImages ?? []).filter(Boolean);
  return { images, cancelled: response.status === 'cancel' || images.length === 0 };
}
