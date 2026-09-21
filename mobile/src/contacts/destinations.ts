/**
 * Destinations d'un contact : où le numéro doit finir pour être trouvable
 * partout où on le cherche.
 *
 * Deux chemins, complémentaires :
 *
 * 1. **Le téléphone** — `contactService` écrit directement dans le répertoire.
 *    C'est immédiat et hors ligne, mais la fiche est créée *sur l'appareil* :
 *    elle n'est pas recopiée dans un compte, donc elle ne suit pas l'utilisateur
 *    s'il change de téléphone.
 * 2. **Un compte synchronisé** (Google, iCloud, Outlook, Exchange) — la fiche
 *    est remise à l'application Contacts du système sous forme de vCard ;
 *    celle-ci demande dans quel compte l'enregistrer. Une fois dans le compte,
 *    le numéro apparaît dans Google Contacts, dans Gmail, sur le web, sur les
 *    autres appareils, et dans toutes les applications qui lisent le répertoire
 *    (téléphone, WhatsApp, messagerie…).
 *
 * Le système ne laisse pas une application choisir le compte d'enregistrement
 * sans passer par cette interface : c'est une protection d'Android et d'iOS.
 * Android regroupe automatiquement les fiches portant le même nom, donc écrire
 * aux deux endroits n'affiche pas deux contacts.
 */
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { VCARD_MIME, vcfBookFileFor, vcfFileFor } from '../services/export';
import type { BusinessCard } from '../types';
import { errorMessage, log } from '../utils';

/** Accorde au destinataire de l'intention le droit de lire le fichier partagé. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Résultat d'un envoi : l'utilisateur peut annuler, ce n'est pas une erreur. */
export type HandoffResult = 'opened' | 'cancelled' | 'unavailable';

/**
 * Le passage par l'application Contacts est-il possible sur cet appareil ?
 * Faux en environnement web ou si le module natif n'est pas embarqué.
 */
export function isAccountHandoffAvailable(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

/**
 * Remet une carte à l'application Contacts du système pour qu'elle soit
 * enregistrée dans un compte synchronisé.
 */
export async function sendToSyncedAccount(card: BusinessCard): Promise<HandoffResult> {
  return handoff(vcfFileFor(card));
}

/**
 * Même chose pour l'ensemble du répertoire : un seul fichier, un seul import.
 * Utile après une série de scans, ou pour reprendre un téléphone à neuf.
 */
export async function sendAllToSyncedAccount(cards: BusinessCard[]): Promise<HandoffResult> {
  if (!cards.length) return 'unavailable';
  return handoff(vcfBookFileFor(cards, 'scancard-repertoire.vcf'));
}

async function handoff(fileUri: string): Promise<HandoffResult> {
  if (Platform.OS === 'android') {
    try {
      // `content://` + droit de lecture : sans cela, l'application Contacts
      // reçoit une URI qu'elle n'a pas le droit d'ouvrir.
      const contentUri = await getContentUriAsync(fileUri);
      const result = await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: VCARD_MIME,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
      return result.resultCode === IntentLauncher.ResultCode.Canceled ? 'cancelled' : 'opened';
    } catch (e) {
      // Certains téléphones n'exposent pas d'activité d'import : le partage
      // système reste alors le seul chemin vers l'application Contacts.
      log.warn('Import direct impossible, repli sur le partage', errorMessage(e));
    }
  }

  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    await Sharing.shareAsync(fileUri, {
      mimeType: VCARD_MIME,
      UTI: 'public.vcard',
      dialogTitle: 'Enregistrer dans Contacts',
    });
    return 'opened';
  } catch (e) {
    log.warn('Partage vers Contacts impossible', errorMessage(e));
    return 'unavailable';
  }
}
