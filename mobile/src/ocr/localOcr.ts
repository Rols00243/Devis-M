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
 *
 * La lecture se fait en **deux passes**, à deux tailles d'image. Le détecteur
 * de ML Kit a une échelle de prédilection : une vue d'ensemble attrape les
 * grands caractères et la structure, une vue agrandie fait sortir les petits —
 * typiquement les numéros de téléphone, souvent la plus petite ligne de la
 * carte. Les résultats sont réunis, ce qui ne peut qu'ajouter du texte.
 */
import type { OcrLine, OcrResult } from '../types';
import { errorMessage, log } from '../utils';
import { prepareForOcr, prepareForOcrFine } from './imagePipeline';

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

  const collected: OcrLine[] = [];
  const languages = new Set<string>();
  let plainText = '';
  let firstError: unknown = null;

  for (const prepare of [prepareForOcr, prepareForOcrFine]) {
    try {
      const prepared = await prepare(imageUri);
      const result = await mlkit.recognize(prepared.uri);
      if (!plainText) plainText = result.text;
      collectBlocks(result, prepared.height, collected, languages);
    } catch (e) {
      // Une passe peut échouer sur un appareil à mémoire limitée : l'autre suffit.
      if (!firstError) firstError = e;
      log.warn('Passe de reconnaissance ignorée', errorMessage(e));
    }
  }

  if (!collected.length && !plainText) throw firstError ?? new Error('Aucun texte reconnu.');

  const lines = mergeLines(collected);
  return {
    text: lines.map((l) => l.text).join('\n') || plainText,
    engine: 'mlkit',
    lines,
    languages: [...languages],
  };
}

/**
 * Relève les lignes d'un passage. Les positions sont ramenées à une fraction de
 * la hauteur de l'image : les deux passes n'ont pas la même échelle en pixels,
 * et seule une mesure relative permet de les comparer et de les trier ensemble.
 */
function collectBlocks(
  result: MlKitResult,
  imageHeight: number,
  into: OcrLine[],
  languages: Set<string>,
): void {
  const scale = imageHeight > 0 ? 1 / imageHeight : 0;
  result.blocks.forEach((block) => {
    block.recognizedLanguages?.forEach((l) => l.languageCode && languages.add(l.languageCode));
    block.lines.forEach((line) => {
      const text = line.text.trim();
      if (!text) return;
      into.push({
        text,
        y: scale && line.frame ? line.frame.top * scale : undefined,
        height: scale && line.frame ? line.frame.height * scale : undefined,
      });
    });
  });
}

/** Clé de comparaison : deux lectures d'une même ligne ne diffèrent que par la mise en forme. */
const lineKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Réunit les lignes des deux passes, sans doublon.
 *
 * Une ligne déjà couverte par une autre — même texte, ou texte contenu dans une
 * lecture plus complète — est écartée ; la version la plus longue est gardée,
 * c'est celle qui porte le plus d'information (« Tél : 081 000 0000 » plutôt
 * que « 081 000 0000 »). Le tri final suit la position sur la carte.
 */
function mergeLines(lines: OcrLine[]): OcrLine[] {
  const kept: { line: OcrLine; key: string }[] = [];

  // Du plus long au plus court : la lecture la plus riche s'installe en premier.
  [...lines]
    .sort((a, b) => lineKey(b.text).length - lineKey(a.text).length)
    .forEach((line) => {
      const key = lineKey(line.text);
      if (!key) return;
      if (kept.some((k) => k.key.includes(key))) return;
      kept.push({ line, key });
    });

  const ordered = kept.map((k) => k.line);
  // ML Kit renvoie les blocs dans son ordre de lecture ; on retrie par position
  // verticale pour les cartes en colonnes, où l'ordre des blocs mélange tout.
  return ordered.every((l) => typeof l.y === 'number')
    ? ordered.sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    : ordered;
}
