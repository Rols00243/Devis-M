/**
 * OCR sur l'appareil, via Google ML Kit Text Recognition.
 *
 * Choix technique : ML Kit tourne hors ligne, gratuitement, avec une latence de
 * l'ordre de la demi-seconde — c'est ce qui permet à l'application de rester
 * utilisable sans réseau, sur un chantier par exemple. Sa limite est l'alphabet :
 * le modèle latin ne lit pas l'arabe, d'où le relais cloud (voir cloudOcr.ts).
 *
 * Le module est chargé paresseusement : l'application reste démarrable dans
 * Expo Go, où le module natif est absent, en signalant clairement le cas.
 */
import type { OcrLine, OcrResult } from '../types';
import { log } from '../utils';
import { prepareForOcr } from './imagePipeline';

interface MlKitFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface MlKitLine {
  text: string;
  frame?: MlKitFrame;
}

interface MlKitBlock {
  text: string;
  frame?: MlKitFrame;
  lines: MlKitLine[];
  recognizedLanguages?: { languageCode: string }[];
}

interface MlKitResult {
  text: string;
  blocks: MlKitBlock[];
}

interface MlKitModule {
  recognize: (uri: string, script?: string) => Promise<MlKitResult>;
}

let moduleRef: MlKitModule | null = null;
let moduleMissing = false;

function loadModule(): MlKitModule | null {
  if (moduleRef || moduleMissing) return moduleRef;
  try {
    // require() et non import : l'absence du module natif ne doit pas casser le bundle.
    const mod = require('@react-native-ml-kit/text-recognition');
    moduleRef = (mod.default ?? mod) as MlKitModule;
  } catch (e) {
    moduleMissing = true;
    log.warn('ML Kit indisponible (build de développement requis)', e);
  }
  return moduleRef;
}

export function isLocalOcrAvailable(): boolean {
  return loadModule() !== null;
}

export class LocalOcrUnavailableError extends Error {
  constructor() {
    super(
      "La reconnaissance hors ligne n'est pas disponible dans cette version de l'application " +
        '(build de développement requis). Activez l’extraction cloud dans les paramètres.',
    );
    this.name = 'LocalOcrUnavailableError';
  }
}

/**
 * Reconnaît le texte d'une carte. Les lignes sont renvoyées ordonnées de haut en
 * bas avec leur hauteur : l'extracteur s'en sert pour repérer le nom, qui est
 * presque toujours la ligne écrite le plus gros.
 */
export async function recognizeLocally(imageUri: string): Promise<OcrResult> {
  const mlkit = loadModule();
  if (!mlkit) throw new LocalOcrUnavailableError();

  const prepared = await prepareForOcr(imageUri);
  const result = await mlkit.recognize(prepared.uri);

  const lines: OcrLine[] = [];
  const languages = new Set<string>();

  result.blocks.forEach((block) => {
    block.recognizedLanguages?.forEach((l) => l.languageCode && languages.add(l.languageCode));
    block.lines.forEach((line) => {
      lines.push({
        text: line.text,
        y: line.frame?.top,
        height: line.frame?.height,
      });
    });
  });

  // ML Kit renvoie les blocs dans l'ordre de lecture ; on retrie par position
  // verticale pour les cartes en colonnes, où l'ordre des blocs mélange les lignes.
  const ordered = lines.every((l) => typeof l.y === 'number')
    ? [...lines].sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    : lines;

  return {
    text: ordered.map((l) => l.text).join('\n') || result.text,
    engine: 'mlkit',
    lines: ordered,
    languages: [...languages],
  };
}
