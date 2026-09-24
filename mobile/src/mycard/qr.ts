/**
 * Génération du QR code de la carte.
 *
 * Un QR sur sa propre carte règle le problème à la source : celui d'en face
 * n'a plus rien à lire ni à corriger, son téléphone reçoit la fiche complète,
 * exacte, d'un seul geste — et n'importe quel appareil sait le faire, sans
 * installer quoi que ce soit.
 *
 * Module pur : `qrcode-generator` n'a aucune dépendance et tourne sous
 * `node:test` comme dans l'application.
 */
import qrcode from 'qrcode-generator';

/** Matrice du QR : `true` = module noir. */
export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

/**
 * Construit la matrice d'un texte.
 *
 * Correction d'erreur « M » : une carte de visite se froisse et se salit ;
 * ce niveau tolère environ 15 % de dégradation, sans trop densifier le motif.
 */
export function qrMatrix(text: string): QrMatrix | null {
  const content = (text ?? '').trim();
  if (!content) return null;
  try {
    // Type 0 : la bibliothèque choisit la plus petite version qui contient
    // le texte. Une vCard complète tient largement.
    const qr = qrcode(0, 'M');
    qr.addData(content, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    const modules: boolean[][] = [];
    for (let row = 0; row < size; row++) {
      const line: boolean[] = [];
      for (let col = 0; col < size; col++) line.push(qr.isDark(row, col));
      modules.push(line);
    }
    return { size, modules };
  } catch {
    // Texte trop long pour le plus grand QR : mieux vaut pas de QR qu'un plantage.
    return null;
  }
}

/**
 * Rend la matrice en SVG, pour l'impression comme pour l'aperçu web.
 * Les modules contigus d'une même ligne sont fusionnés en un seul rectangle :
 * le fichier reste petit et le rendu net à toute taille.
 */
export function qrToSvg(matrix: QrMatrix, options: { size: number; color?: string } = { size: 120 }): string {
  const color = options.color ?? '#000000';
  const quiet = 2; // marge blanche exigée par la norme, en modules
  const total = matrix.size + quiet * 2;
  const rects: string[] = [];

  matrix.modules.forEach((row, y) => {
    let runStart = -1;
    for (let x = 0; x <= matrix.size; x++) {
      const dark = x < matrix.size && row[x];
      if (dark && runStart < 0) runStart = x;
      if (!dark && runStart >= 0) {
        rects.push(
          `<rect x="${runStart + quiet}" y="${y + quiet}" width="${x - runStart}" height="1"/>`,
        );
        runStart = -1;
      }
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#FFFFFF"/>` +
    `<g fill="${color}">${rects.join('')}</g>` +
    `</svg>`
  );
}
