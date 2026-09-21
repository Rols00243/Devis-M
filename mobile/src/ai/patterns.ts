/**
 * Primitives de reconnaissance : normalisation du texte OCR, e-mails, URL,
 * LinkedIn et numéros de téléphone (format international E.164 quand c'est possible).
 */
import { DIALING_CODES } from './dictionaries';

export const stripAccents = (s: string): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

export const lower = (s: string): string => stripAccents(s).toLowerCase();

export const digitsOnly = (s: string): string => (s || '').replace(/\D/g, '');

/** Détecte la présence d'écriture arabe : déclenche le recours à l'extraction cloud. */
export const hasArabic = (s: string): boolean => /[؀-ۿ]/.test(s || '');

/**
 * Découpe le texte OCR en lignes exploitables : supprime les artefacts de
 * reconnaissance (barres, guillemets typographiques isolés) et les lignes vides.
 */
export function toLines(text: string): string[] {
  return (text || '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/[|¬~`_]+/g, ' ')
        .replace(/[“”«»]/g, '"')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l.length > 1 && /[\p{L}\p{N}]/u.test(l));
}

/** Corrige les confusions OCR usuelles à l'intérieur d'une suite censée être numérique. */
export function fixDigits(s: string): string {
  return s
    .replace(/[OoDQ]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[gq]/g, '9')
    .replace(/[Zz]/g, '2')
    .replace(/[Tt]/g, '7');
}

/* ------------------------------ E-mail ------------------------------ */

export const EMAIL_RE =
  /[A-Za-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+)\s*[A-Za-z0-9.-]+\s*\.\s*[A-Za-z]{2,}/g;

/** Nettoie un e-mail lu par l'OCR ; renvoie null s'il reste invalide. */
export function cleanEmail(raw: string): string | null {
  const e = raw
    .replace(/\s+/g, '')
    .replace(/\(at\)|\[at\]/i, '@')
    .replace(/©/g, '@')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/[.;:,]+$/, '');
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e : null;
}

/* -------------------------------- URL -------------------------------- */

export const URL_RE =
  /(?:https?:\/\/)?(?:www\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s]*)?|(?:https?:\/\/)[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s]*)?/gi;

/** Domaine « nu » sans www ni protocole, ex. abc-construction.cd */
export const BARE_DOMAIN_RE =
  /\b[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.(?:com|net|org|fr|be|ch|ca|io|co|eu|info|biz|pro|app|dev|shop|online|site|agency|group|build|immo|cd|cg|cm|ga|sn|ci|ml|bf|ne|tg|bj|ng|gh|ke|ma|dz|tn|ly|eg|ae|sa)\b/i;

export function cleanUrl(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/[.,;:]+$/, '')
    .replace(/^https?:\/\//i, '')
    .toLowerCase();
}

export const LINKEDIN_RE = /(?:linkedin\.com\/(?:in|company)\/|linkedin\s*[:/]\s*)([A-Za-z0-9._%-]+)/i;

/** Renvoie l'URL LinkedIn canonique trouvée dans une ligne, sinon null. */
export function extractLinkedIn(line: string): string | null {
  const direct = line.match(/linkedin\.com\/(in|company)\/[A-Za-z0-9._%-]+/i);
  if (direct) return 'linkedin.com/' + direct[0].split('linkedin.com/')[1].toLowerCase();
  const labelled = line.match(LINKEDIN_RE);
  if (labelled && labelled[1] && labelled[1].length > 2) {
    return 'linkedin.com/in/' + labelled[1].toLowerCase();
  }
  return null;
}

/* ------------------------------ Téléphone ------------------------------ */

/** Suites de caractères pouvant constituer un numéro, tolérantes aux erreurs OCR. */
export const PHONE_CANDIDATE_RE = /(?:\+|00)?[\d][\d\s.\-()/OolISB]{6,}[\dOolISB]/g;

export interface PhoneParts {
  /** Forme E.164 quand l'indicatif est connu, sinon les chiffres tels quels. */
  e164: string;
  display: string;
  country: string | null;
}

/**
 * Normalise un numéro vers E.164.
 * `defaultCountryCode` sert quand le numéro est local (commence par 0 sans indicatif).
 */
export function normalizePhone(raw: string, defaultCountryCode = ''): PhoneParts {
  let s = (raw || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.indexOf('+') > 0) s = s.replace(/\+/g, '');

  if (!s.startsWith('+') && defaultCountryCode) {
    // Numéro national : on retire le 0 de service avant de coller l'indicatif.
    const national = s.replace(/^0+/, '');
    if (national.length >= 8) s = defaultCountryCode + national;
  }

  const country = s.startsWith('+') ? countryFromDialingCode(s) : null;
  return { e164: s, display: formatPhone(s), country };
}

/** Retrouve le pays depuis l'indicatif, en testant du plus long au plus court. */
export function countryFromDialingCode(e164: string): string | null {
  for (let len = 4; len >= 2; len--) {
    const prefix = e164.slice(0, len);
    if (DIALING_CODES[prefix]) return DIALING_CODES[prefix];
  }
  return null;
}

/** Mise en forme lisible, sans prétendre appliquer les règles locales de découpage. */
export function formatPhone(e164: string): string {
  const s = (e164 || '').trim();
  if (!s) return '';
  if (/^0\d{9}$/.test(s)) return (s.match(/\d{2}/g) || []).join(' '); // format FR national
  if (s.startsWith('+')) {
    let prefixLen = 0;
    for (let len = 4; len >= 2; len--) {
      if (DIALING_CODES[s.slice(0, len)]) {
        prefixLen = len;
        break;
      }
    }
    if (!prefixLen) prefixLen = 3;
    const code = s.slice(0, prefixLen);
    const rest = s.slice(prefixLen);
    const groups = rest.length % 3 === 0 ? rest.match(/\d{3}/g) : rest.match(/\d{2,3}/g);
    return `${code} ${(groups || [rest]).join(' ')}`;
  }
  return (s.match(/\d{2,3}/g) || [s]).join(' ');
}

/** Un numéro plausible compte 8 à 15 chiffres et n'est ni une année ni un identifiant. */
export function isPlausiblePhone(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length < 8 || d.length > 15) return false;
  if (/^(19|20)\d{2}$/.test(d)) return false;
  if (/^(\d)\1+$/.test(d)) return false; // 000000000
  return true;
}

/** Deux numéros désignent la même ligne s'ils partagent leurs 9 derniers chiffres. */
export function samePhone(a: string, b: string): boolean {
  const x = digitsOnly(a);
  const y = digitsOnly(b);
  if (x.length < 8 || y.length < 8) return false;
  const n = Math.min(9, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

/** Casse de titre respectant les traits d'union et apostrophes : JEAN-marc → Jean-Marc. */
export function titleCase(s: string): string {
  return s
    .split(/([ \-'’])/)
    .map((part) =>
      /[ \-'’]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}
