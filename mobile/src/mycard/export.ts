/**
 * Sortie de la carte de visite : PDF à l'échelle réelle, et vCard.
 *
 * Le PDF fait exactement 85 × 55 mm. C'est le format que réclame un imprimeur,
 * et celui qui s'affiche correctement quand on l'envoie par messagerie — une
 * capture d'écran, elle, arrive floue et à une taille arbitraire.
 */
import { File } from 'expo-file-system';
import * as Print from 'expo-print';

import { cardFileName, myCardVCard } from './model';
import { CARD_HEIGHT_MM, CARD_WIDTH_MM, cardHtml } from './html';
import { shareFileForUser, writeTempFile } from '../services/export';
import type { MyCard } from '../types';
import { errorMessage, log } from '../utils';

/** Millimètres → points PostScript (72 par pouce), unité attendue par `expo-print`. */
const mmToPt = (mm: number): number => Math.round((mm / 25.4) * 72);

/** Encode le logo pour le moteur de rendu, qui ne sait pas lire un chemin de fichier. */
async function logoDataUri(uri: string | null): Promise<string | null> {
  if (!uri) return null;
  try {
    const file = new File(uri);
    if (!file.exists) return null;
    return `data:image/jpeg;base64,${await file.base64()}`;
  } catch (e) {
    log.warn('Logo illisible, carte imprimée sans logo', errorMessage(e));
    return null;
  }
}

/** Fabrique le PDF de la carte et renvoie son chemin local. */
export async function buildCardPdf(card: MyCard, defaultCountryCode = ''): Promise<string> {
  const html = cardHtml(card, {
    defaultCountryCode,
    logoDataUri: await logoDataUri(card.logoUri),
  });
  const { uri } = await Print.printToFileAsync({
    html,
    width: mmToPt(CARD_WIDTH_MM),
    height: mmToPt(CARD_HEIGHT_MM),
  });
  return uri;
}

/** Fabrique le PDF puis le propose au partage ou à l'enregistrement. */
export async function shareCardPdf(card: MyCard, defaultCountryCode = ''): Promise<void> {
  const uri = await buildCardPdf(card, defaultCountryCode);
  await shareFileForUser(uri, 'application/pdf', cardFileName(card, 'pdf'));
}

/** Envoie sa fiche au format vCard : le destinataire l'ajoute à son répertoire d'un geste. */
export async function shareMyVCard(card: MyCard, defaultCountryCode = ''): Promise<void> {
  const uri = writeTempFile(cardFileName(card, 'vcf'), myCardVCard(card, defaultCountryCode));
  await shareFileForUser(uri, 'text/x-vcard', cardFileName(card, 'vcf'));
}

/** Impression directe, quand une imprimante est accessible depuis le téléphone. */
export async function printCard(card: MyCard, defaultCountryCode = ''): Promise<void> {
  const html = cardHtml(card, {
    defaultCountryCode,
    logoDataUri: await logoDataUri(card.logoUri),
  });
  await Print.printAsync({ html, width: mmToPt(CARD_WIDTH_MM), height: mmToPt(CARD_HEIGHT_MM) });
}
