/**
 * Rendu imprimable de la carte, en HTML puis en PDF.
 *
 * Pourquoi du HTML : la page est mesurée en millimètres, aux dimensions
 * normalisées d'une carte de visite (85 × 55 mm). Le PDF qui en sort part tel
 * quel chez l'imprimeur, ou s'envoie par messagerie — là où une capture
 * d'écran sortirait floue et à la mauvaise taille.
 *
 * Module pur : il ne produit qu'une chaîne, et se teste comme tel.
 */
import { contactLines, myCardVCard } from './model';
import { qrMatrix, qrToSvg } from './qr';
import type { MyCard } from '../types';
import { displayName } from '../utils/pure';

/** Dimensions normalisées d'une carte de visite, en millimètres. */
export const CARD_WIDTH_MM = 85;
export const CARD_HEIGHT_MM = 55;

const escapeHtml = (s: string): string =>
  (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface CardHtmlOptions {
  defaultCountryCode?: string;
  /** Image encodée en `data:` ; un chemin de fichier n'est pas lisible par le moteur de rendu. */
  logoDataUri?: string | null;
}

/**
 * Page HTML d'une carte, prête pour `expo-print`.
 *
 * Le texte est en points et la page en millimètres : à l'impression comme à
 * l'écran, la carte garde ses proportions réelles.
 */
export function cardHtml(card: MyCard, options: CardHtmlOptions = {}): string {
  const accent = /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent : '#2563EB';
  const lines = contactLines(card, options.defaultCountryCode);
  const name = escapeHtml(displayName(card));

  const qr = card.showQrCode ? qrMatrix(myCardVCard(card, options.defaultCountryCode)) : null;
  const qrSvg = qr ? qrToSvg(qr, { size: 78, color: '#111827' }) : '';

  const logo = options.logoDataUri
    ? `<img class="logo" src="${escapeHtml(options.logoDataUri)}" alt="" />`
    : '';

  const contacts = lines
    .map(
      (l) =>
        `<div class="line"><span class="ico">${escapeHtml(l.icon)}</span>${escapeHtml(l.text)}</div>`,
    )
    .join('');

  const identity = `
    ${logo}
    <div class="name">${name}</div>
    ${card.jobTitle ? `<div class="job">${escapeHtml(card.jobTitle)}</div>` : ''}
    ${card.company ? `<div class="company">${escapeHtml(card.company)}</div>` : ''}
    ${card.slogan ? `<div class="slogan">${escapeHtml(card.slogan)}</div>` : ''}
  `;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<style>
  @page { size: ${CARD_WIDTH_MM}mm ${CARD_HEIGHT_MM}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${CARD_WIDTH_MM}mm; height: ${CARD_HEIGHT_MM}mm;
    font-family: Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .card { width: 100%; height: 100%; position: relative; overflow: hidden; display: flex; }
  .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 1.2mm; }
  .logo { max-height: 9mm; max-width: 26mm; object-fit: contain; margin-bottom: 1mm; }
  .name { font-size: 12pt; font-weight: 700; letter-spacing: -0.2pt; }
  .job { font-size: 7.5pt; font-weight: 600; }
  .company { font-size: 8pt; font-weight: 700; }
  .slogan { font-size: 6.5pt; font-style: italic; opacity: 0.75; }
  .contacts { margin-top: 1.6mm; display: flex; flex-direction: column; gap: 0.7mm; }
  .line { font-size: 6.6pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ico { display: inline-block; width: 4mm; }
  .qr { width: 21mm; display: flex; align-items: flex-end; justify-content: flex-end; }
  .qr svg { width: 20mm; height: 20mm; }

  /* Classique : bandeau coloré à gauche, texte sombre sur fond blanc. */
  .classic { background: #FFFFFF; color: #111827; padding: 5mm 5mm 5mm 8mm; }
  .classic::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3.5mm; background: ${accent}; }
  .classic .job { color: ${accent}; }
  .classic .contacts { color: #374151; }

  /* Affirmé : fond plein, contraste maximal, lisible de loin. */
  .bold { background: ${accent}; color: #FFFFFF; padding: 5mm; }
  .bold .company { opacity: 0.92; }
  .bold .contacts { color: rgba(255,255,255,0.95); }
  .bold .slogan { opacity: 0.85; }

  /* Épuré : blanc, un simple filet sous le nom. */
  .minimal { background: #FFFFFF; color: #111827; padding: 6mm; }
  .minimal .name { border-bottom: 0.6mm solid ${accent}; padding-bottom: 1.2mm; display: inline-block; }
  .minimal .job { color: #6B7280; }
  .minimal .contacts { color: #4B5563; }
</style></head>
<body>
  <div class="card ${escapeHtml(card.template)}">
    <div class="body">
      ${identity}
      <div class="contacts">${contacts}</div>
    </div>
    ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
  </div>
</body></html>`;
}
