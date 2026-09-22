/**
 * Extraction intelligente des champs d'une carte de visite à partir du texte OCR.
 *
 * Fonctionne sans réseau : on ne fait pas que lire le texte, on modélise la
 * structure d'une carte (qui est le nom, qui est l'entreprise, quel numéro est
 * un mobile) à l'aide de signaux croisés — étiquettes, formes juridiques,
 * domaine de l'e-mail, position sur la carte, taille du texte.
 *
 * Fonctions pures, sans dépendance React Native : testables directement en Node.
 */
import {
  ADDRESS_HINTS,
  ADMIN_IDS,
  CITIES,
  COUNTRIES,
  GENERIC_MAIL_DOMAINS,
  JOB_TITLES,
  LABEL_FAX,
  LABEL_MOBILE,
  LABEL_PHONE,
  LABEL_WHATSAPP,
  LEGAL_FORMS,
  SOCIAL_NETWORKS,
  TLD_COUNTRIES,
} from './dictionaries';
import {
  BARE_DOMAIN_RE,
  EMAIL_RE,
  PHONE_CANDIDATE_RE,
  URL_RE,
  cleanEmail,
  cleanUrl,
  digitsOnly,
  extractLinkedIn,
  fixDigits,
  hasArabic,
  isPlausiblePhone,
  lower,
  normalizePhone,
  samePhone,
  titleCase,
  toLines,
} from './patterns';
import {
  EMPTY_FIELDS,
  type CardFields,
  type ExtraItem,
  type ExtraKind,
  type FieldConfidence,
  type OcrLine,
} from '../types';

export interface ExtractionInput {
  text: string;
  /** Lignes géométriques de l'OCR : améliorent la détection du nom (taille, position). */
  lines?: OcrLine[];
  /** Indicatif pays par défaut pour normaliser les numéros locaux (ex. « +243 »). */
  defaultCountryCode?: string;
}

export interface ExtractionResult {
  fields: CardFields;
  confidence: FieldConfidence;
  languages: string[];
  /** Lignes retenues, dans l'ordre : utile au débogage et à l'écran « texte brut ». */
  lines: string[];
  /**
   * Tout ce que la carte porte en plus des 14 champs. Une carte n'a pas de
   * format imposé : troisième numéro, deuxième e-mail, fax, RCCM, page
   * Facebook, slogan, seconde agence… Ces lignes sont conservées ici plutôt
   * que perdues, et l'utilisateur les voit à la vérification.
   */
  extras: ExtraItem[];
}

interface Claim {
  index: number;
  by: string;
}

/** Suit quelles lignes ont déjà été attribuées à un champ, pour ne pas les réutiliser. */
class LineLedger {
  private claims = new Map<number, string>();

  claim(index: number, by: string): void {
    if (index >= 0 && !this.claims.has(index)) this.claims.set(index, by);
  }

  isClaimed(index: number): boolean {
    return this.claims.has(index);
  }

  all(): Claim[] {
    return [...this.claims.entries()].map(([index, by]) => ({ index, by }));
  }

  /** Lignes qu'aucun champ n'a revendiquées : le reste de la carte. */
  unclaimed(lines: string[]): { index: number; text: string }[] {
    return lines
      .map((text, index) => ({ index, text }))
      .filter(({ index }) => !this.claims.has(index));
  }
}

/** Accumule les informations supplémentaires sans jamais écraser les précédentes. */
class Extras {
  private items: ExtraItem[] = [];

  add(label: string, value: string, kind: ExtraKind): void {
    const clean = value.trim();
    if (!clean) return;
    if (this.items.some((i) => lower(i.value) === lower(clean))) return;
    this.items.push({ label, value: clean, kind });
  }

  list(): ExtraItem[] {
    return this.items;
  }
}

/* ------------------------------------------------------------------ */
/* Extraction principale                                               */
/* ------------------------------------------------------------------ */

export function extractFields(input: ExtractionInput): ExtractionResult {
  const lines = toLines(input.text);
  const geo = input.lines ?? [];
  const ledger = new LineLedger();
  const extras = new Extras();
  const fields: CardFields = { ...EMPTY_FIELDS };
  const confidence: FieldConfidence = {};

  // 1. E-mail — le signal le plus fiable, et il renseigne aussi le nom et la société.
  const emails = findEmails(lines, ledger);
  if (emails.length) {
    fields.email = emails[0].value;
    confidence.email = 1;
  }
  const emailDomain = emails.length ? emails[0].value.split('@')[1] : '';
  const corporateDomain = emailDomain && !GENERIC_MAIL_DOMAINS.test(emailDomain) ? emailDomain : '';

  // 2. LinkedIn, avant les sites web : linkedin.com serait sinon pris pour le site.
  const linkedin = findLinkedIn(lines, ledger);
  if (linkedin) {
    fields.linkedin = linkedin;
    confidence.linkedin = 1;
  }

  // 3. Sites web : le premier occupe le champ, les autres sont conservés.
  const sites = findWebsites(lines, ledger, corporateDomain);
  if (sites.length) {
    fields.website = sites[0].value;
    confidence.website = sites[0].inferred ? 0.5 : 1;
    sites.slice(1).forEach((s) => extras.add('Autre site', s.value, 'website'));
  }

  // 4. Téléphones : classés par étiquette puis par numérotation.
  const phones = findPhones(lines, ledger, input.defaultCountryCode ?? '');
  assignPhones(phones, fields, confidence, extras);

  // 5. Fonction : sert ensuite d'ancre pour retrouver le nom (souvent juste au-dessus).
  const job = findJobTitle(lines, ledger);
  if (job) {
    fields.jobTitle = job.value;
    confidence.jobTitle = job.exact ? 1 : 0.75;
  }

  // 6. Entreprise.
  const company = findCompany(lines, ledger, corporateDomain);
  if (company) {
    fields.company = company.value;
    confidence.company = company.score;
  }

  // 7. Adresse, ville, pays.
  const place = findPlace(lines, ledger);
  if (place.address) {
    fields.address = place.address;
    confidence.address = 0.8;
  }
  if (place.city) {
    fields.city = place.city;
    confidence.city = place.cityConfidence;
  }
  if (place.country) {
    fields.country = place.country;
    confidence.country = place.countryConfidence;
  }
  // À défaut, l'indicatif téléphonique donne le pays.
  if (!fields.country) {
    const fromDial = phones.find((p) => p.country)?.country;
    if (fromDial) {
      fields.country = fromDial;
      confidence.country = 0.6;
    }
  }
  // Ultime recours : le domaine national de l'e-mail ou du site (.cd, .be…).
  if (!fields.country) {
    const fromTld = countryFromTld(fields.email || fields.website);
    if (fromTld) {
      fields.country = fromTld;
      confidence.country = 0.5;
    }
  }
  if (fields.city && !fields.country) {
    const known = CITIES.find((c) => lower(c.name) === lower(fields.city));
    if (known) {
      fields.country = known.country;
      confidence.country = 0.7;
    }
  }

  // 8. Nom et prénom : dernier, pour profiter de tout ce qui a déjà été attribué.
  const person = findPerson(lines, geo, ledger, emails[0]?.value ?? '', job?.index ?? -1);
  if (person) {
    fields.firstName = person.firstName;
    fields.lastName = person.lastName;
    confidence.firstName = person.confidence;
    confidence.lastName = person.confidence;
  }

  // 9. E-mails supplémentaires.
  emails.slice(1).forEach((e) => extras.add('Autre e-mail', e.value, 'email'));

  // 10. Tout le reste de la carte : ce qui n'a été revendiqué par aucun champ.
  //     C'est ce qui distingue « lire les champs connus » de « tout prendre ».
  collectRemainingLines(lines, ledger, extras);

  return {
    fields,
    confidence,
    languages: detectLanguages(input.text),
    lines,
    extras: extras.list(),
  };
}

/**
 * Range les lignes restantes : réseaux sociaux, identifiants administratifs,
 * adresses secondaires, et à défaut le texte tel qu'il a été lu.
 *
 * Aucune ligne n'est écartée pour cause de « non reconnue » : une mention que
 * le moteur ne comprend pas reste une information de la carte.
 */
function collectRemainingLines(lines: string[], ledger: LineLedger, extras: Extras): void {
  for (const { text } of ledger.unclaimed(lines)) {
    const line = text.trim();
    // Les fragments d'un seul caractère sont du bruit d'OCR, pas de l'information.
    if (line.length < 2) continue;

    const social = SOCIAL_NETWORKS.find((n) => n.pattern.test(line));
    if (social) {
      extras.add(social.name, line, 'social');
      continue;
    }
    if (ADMIN_IDS.test(line)) {
      extras.add(adminLabel(line), line, 'id');
      continue;
    }
    if (ADDRESS_HINTS.test(line)) {
      extras.add('Autre adresse', line, 'address');
      continue;
    }
    extras.add('Sur la carte', line, 'text');
  }
}

/** Libellé d'un identifiant administratif, tiré du mot-clé présent sur la ligne. */
function adminLabel(line: string): string {
  const match = line.match(ADMIN_IDS);
  if (!match) return 'Référence';
  return match[0].toUpperCase().replace(/\./g, '').trim();
}

/* ------------------------------------------------------------------ */
/* E-mail / web / LinkedIn                                             */
/* ------------------------------------------------------------------ */

function findEmails(lines: string[], ledger: LineLedger): { value: string; index: number }[] {
  const out: { value: string; index: number }[] = [];
  lines.forEach((line, index) => {
    const matches = line.match(EMAIL_RE);
    if (!matches) return;
    matches.forEach((m) => {
      const email = cleanEmail(m);
      if (email && !out.some((o) => o.value === email)) {
        out.push({ value: email, index });
        ledger.claim(index, 'email');
      }
    });
  });
  return out;
}

function findLinkedIn(lines: string[], ledger: LineLedger): string | null {
  for (let i = 0; i < lines.length; i++) {
    const found = extractLinkedIn(lines[i]);
    if (found) {
      ledger.claim(i, 'linkedin');
      return found;
    }
  }
  return null;
}

/**
 * Tous les sites imprimés sur la carte, dans l'ordre de lecture. Une entreprise
 * en affiche parfois deux (site institutionnel et boutique) : le premier prend
 * le champ, les autres sont conservés en informations supplémentaires.
 */
function findWebsites(
  lines: string[],
  ledger: LineLedger,
  corporateDomain: string,
): { value: string; inferred: boolean }[] {
  const found: { value: string; inferred: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ledger.isClaimed(i)) continue;
    const line = lines[i];
    if (EMAIL_RE.test(line)) {
      EMAIL_RE.lastIndex = 0;
      continue;
    }
    // Un réseau social n'est pas le site de l'entreprise : il a son propre rangement.
    if (SOCIAL_NETWORKS.some((n) => n.pattern.test(line))) continue;
    const urls = line.match(URL_RE);
    const candidate = urls ? urls[0] : (line.match(BARE_DOMAIN_RE) || [])[0];
    if (!candidate) continue;
    const url = cleanUrl(candidate);
    if (url.length < 5 || /linkedin\./i.test(url)) continue;
    if (found.some((f) => lower(f.value) === lower(url))) continue;
    ledger.claim(i, 'website');
    found.push({ value: url, inferred: false });
  }
  // Pas de site imprimé : le domaine professionnel de l'e-mail est une bonne approximation.
  if (!found.length && corporateDomain) found.push({ value: `www.${corporateDomain}`, inferred: true });
  return found;
}

/* ------------------------------------------------------------------ */
/* Téléphones                                                          */
/* ------------------------------------------------------------------ */

type PhoneKind = 'mobile' | 'phone' | 'fax' | 'whatsapp';

interface FoundPhone {
  kind: PhoneKind;
  e164: string;
  display: string;
  country: string | null;
  index: number;
  /** true quand le type vient d'une étiquette imprimée, et non d'une déduction. */
  labelled: boolean;
}

function findPhones(lines: string[], ledger: LineLedger, defaultCode: string): FoundPhone[] {
  const found: FoundPhone[] = [];

  lines.forEach((line, index) => {
    if (ADMIN_IDS.test(line)) return; // RCCM, TVA, ID. NAT… ne sont pas des numéros
    if (EMAIL_RE.test(line)) {
      EMAIL_RE.lastIndex = 0;
      return;
    }
    const candidates = line.match(PHONE_CANDIDATE_RE);
    if (!candidates) return;

    candidates.forEach((candidate) => {
      const repaired = fixDigits(candidate.replace(/[()/]/g, ' ')).trim();
      if (!isPlausiblePhone(repaired)) return;

      const parts = normalizePhone(repaired, defaultCode);
      let kind: PhoneKind = 'phone';
      let labelled = true;
      if (LABEL_WHATSAPP.test(line)) kind = 'whatsapp';
      else if (LABEL_FAX.test(line)) kind = 'fax';
      else if (LABEL_MOBILE.test(line)) kind = 'mobile';
      else if (LABEL_PHONE.test(line)) kind = 'phone';
      else {
        labelled = false;
        kind = looksMobile(parts.e164) ? 'mobile' : 'phone';
      }

      if (found.some((p) => samePhone(p.e164, parts.e164))) return;
      found.push({ kind, ...parts, index, labelled });
      ledger.claim(index, 'phone');
    });
  });

  return found;
}

/**
 * Heuristique « mobile » : la France (06/07) et la plupart des pays d'Afrique
 * subsaharienne réservent des préfixes distincts aux lignes mobiles.
 */
function looksMobile(e164: string): boolean {
  if (/^\+33[67]/.test(e164)) return true;
  if (/^0[67]\d{8}$/.test(e164)) return true;
  if (/^\+243[89]/.test(e164)) return true; // RDC : 81-85, 89, 9x
  if (/^\+2439/.test(e164)) return true;
  if (/^\+2[1-9]\d[5-9]/.test(e164)) return true; // Afrique : préfixes hauts = mobile
  return false;
}

function assignPhones(
  phones: FoundPhone[],
  fields: CardFields,
  confidence: FieldConfidence,
  extras: Extras,
): void {
  const whatsapp = phones.find((p) => p.kind === 'whatsapp');
  const mobiles = phones.filter((p) => p.kind === 'mobile');
  const landlines = phones.filter((p) => p.kind === 'phone');
  const faxes = phones.filter((p) => p.kind === 'fax');

  // Le téléphone principal est le mobile s'il existe : c'est celui qu'on appelle.
  // Un fax n'entre jamais dans ce classement, même s'il est le seul numéro de
  // la carte : on n'appelle pas un télécopieur. Il est conservé en extras.
  const callable = [...mobiles, ...landlines, ...(whatsapp ? [whatsapp] : [])];
  const ordered = [...callable, ...faxes];
  const primary = callable[0];
  const secondary = callable[1];

  if (primary) {
    fields.phone = primary.display;
    confidence.phone = primary.labelled ? 1 : 0.85;
  }
  if (secondary) {
    fields.secondaryPhone = secondary.display;
    confidence.secondaryPhone = secondary.labelled ? 0.9 : 0.7;
  }

  if (whatsapp) {
    fields.whatsapp = whatsapp.display;
    confidence.whatsapp = 1;
  } else if (mobiles.length) {
    // Un mobile est joignable sur WhatsApp dans la très grande majorité des cas :
    // on le propose, avec une confiance basse pour que l'utilisateur vérifie.
    fields.whatsapp = mobiles[0].display;
    confidence.whatsapp = 0.4;
  }

  // Tous les autres numéros sont conservés : une carte porte souvent trois
  // lignes (direct, standard, fax) et aucune ne doit disparaître.
  const kept = [primary, secondary, whatsapp].filter(Boolean) as FoundPhone[];
  ordered
    .filter((p) => !kept.some((k) => samePhone(k.e164, p.e164)))
    .forEach((p) => extras.add(PHONE_LABELS[p.kind], p.display, 'phone'));
}

const PHONE_LABELS: Record<PhoneKind, string> = {
  mobile: 'Autre mobile',
  phone: 'Autre téléphone',
  fax: 'Fax',
  whatsapp: 'Autre WhatsApp',
};

/* ------------------------------------------------------------------ */
/* Fonction / entreprise                                               */
/* ------------------------------------------------------------------ */

function findJobTitle(
  lines: string[],
  ledger: LineLedger,
): { value: string; index: number; exact: boolean } | null {
  let best: { value: string; index: number; exact: boolean; score: number } | null = null;

  lines.forEach((line, index) => {
    if (ledger.isClaimed(index) || line.length > 70) return;
    const normalized = lower(line);
    JOB_TITLES.forEach((title) => {
      const t = lower(title);
      if (!normalized.includes(t)) return;
      const exact = normalized === t || normalized.replace(/[^a-z؀-ۿ ]/g, '').trim() === t;
      const score = t.length + (exact ? 20 : 0);
      if (!best || score > best.score) {
        best = { value: line.replace(/^[-•*·\s]+/, '').trim(), index, exact, score };
      }
    });
  });

  if (best) {
    const found = best as { value: string; index: number; exact: boolean; score: number };
    ledger.claim(found.index, 'jobTitle');
    return { value: found.value, index: found.index, exact: found.exact };
  }
  return null;
}

function isJobTitle(line: string): boolean {
  const normalized = lower(line);
  return JOB_TITLES.some((t) => {
    const lt = lower(t);
    return normalized === lt || normalized.includes(lt);
  });
}

function findCompany(
  lines: string[],
  ledger: LineLedger,
  corporateDomain: string,
): { value: string; score: number } | null {
  // a) Forme juridique explicite — le signal le plus sûr.
  for (let i = 0; i < lines.length; i++) {
    if (ledger.isClaimed(i)) continue;
    if (LEGAL_FORMS.test(lines[i]) && lines[i].length < 70) {
      ledger.claim(i, 'company');
      return { value: cleanCompany(lines[i]), score: 1 };
    }
  }

  // b) Ligne qui reprend le domaine professionnel de l'e-mail.
  if (corporateDomain) {
    const root = lower(corporateDomain.split('.')[0]).replace(/[^a-z0-9]/g, '');
    if (root.length > 3) {
      for (let i = 0; i < lines.length; i++) {
        if (ledger.isClaimed(i)) continue;
        const normalized = lower(lines[i]).replace(/[^a-z0-9]/g, '');
        if (normalized.includes(root) || root.includes(normalized)) {
          ledger.claim(i, 'company');
          return { value: cleanCompany(lines[i]), score: 0.9 };
        }
      }
    }
  }

  // c) Ligne en capitales dans le haut de la carte (logo transcrit par l'OCR).
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (ledger.isClaimed(i)) continue;
    const line = lines[i];
    const isUpper = line === line.toUpperCase() && /[\p{Lu}]{2,}/u.test(line);
    if (isUpper && line.length > 2 && line.length < 50 && !isJobTitle(line)) {
      ledger.claim(i, 'company');
      return { value: cleanCompany(line), score: 0.6 };
    }
  }

  // d) Repli : le domaine professionnel lui-même.
  if (corporateDomain) {
    return { value: titleCase(corporateDomain.split('.')[0].replace(/[-_]/g, ' ')), score: 0.4 };
  }
  return null;
}

function cleanCompany(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s.,;:-]+$/, '').trim();
}

/* ------------------------------------------------------------------ */
/* Adresse / ville / pays                                              */
/* ------------------------------------------------------------------ */

interface Place {
  address: string;
  city: string;
  country: string;
  cityConfidence: number;
  countryConfidence: number;
}

function findPlace(lines: string[], ledger: LineLedger): Place {
  const place: Place = { address: '', city: '', country: '', cityConfidence: 0, countryConfidence: 0 };

  // Pays : recherché dans tout le texte, il n'occupe pas forcément sa propre ligne.
  for (const country of COUNTRIES) {
    const hit = lines.findIndex((l) => country.patterns.test(l));
    if (hit >= 0) {
      place.country = country.name;
      place.countryConfidence = 1;
      break;
    }
  }

  // Ville connue (« Kinshasa, RDC ») : n'exige pas de code postal.
  for (const city of CITIES) {
    const re = new RegExp(`(^|[\\s,;])${city.name.replace(/[-]/g, '[- ]')}($|[\\s,;.])`, 'i');
    const hit = lines.findIndex((l) => re.test(l));
    if (hit >= 0) {
      place.city = city.name;
      place.cityConfidence = 1;
      if (!place.country) {
        place.country = city.country;
        place.countryConfidence = 0.8;
      }
      break;
    }
  }

  // Lignes d'adresse : mots-clés de voirie, ou code postal suivi d'une ville.
  const addressIdx: number[] = [];
  lines.forEach((line, index) => {
    if (ledger.isClaimed(index)) return;
    const postal = line.match(/\b(\d{4,6})\b\s+(\p{Lu}[\p{L}'’\- ]{2,})/u);
    if (ADDRESS_HINTS.test(line) || postal) {
      addressIdx.push(index);
      if (postal && !place.city) {
        place.city = postal[2].trim();
        place.cityConfidence = 0.8;
      }
    }
  });

  if (addressIdx.length) {
    // On agrège les lignes d'adresse contiguës, qui forment un bloc sur la carte.
    const block: string[] = [];
    for (let i = addressIdx[0]; i < lines.length; i++) {
      if (!addressIdx.includes(i)) {
        if (block.length) break;
        continue;
      }
      block.push(lines[i]);
      ledger.claim(i, 'address');
    }
    place.address = block.join(', ').replace(/\s*,\s*,/g, ',');
  }

  // Ville isolée sur sa propre ligne, à côté de l'adresse (« Kinshasa/Gombe »).
  if (!place.city && place.address) {
    const parts = place.address.split(',').map((p) => p.trim());
    const last = parts[parts.length - 1];
    if (last && last.length < 30 && !/\d/.test(last)) {
      place.city = last;
      place.cityConfidence = 0.5;
    }
  }

  return place;
}

/* ------------------------------------------------------------------ */
/* Identité                                                            */
/* ------------------------------------------------------------------ */

interface Person {
  firstName: string;
  lastName: string;
  confidence: number;
}

const HONORIFIC = /^(m\.|mr\.?|mme|mlle|dr\.?|ing\.?|me\b|pr\.?|eng\.?|arch\.?)\s+/i;

function findPerson(
  lines: string[],
  geo: OcrLine[],
  ledger: LineLedger,
  email: string,
  jobIndex: number,
): Person | null {
  // Jetons du login de l'e-mail : « jean.dupont » confirme un nom sur la carte.
  const loginTokens = email
    ? lower(email.split('@')[0])
        .split(/[._\-0-9]+/)
        .filter((t) => t.length > 2)
    : [];

  let best: { words: string[]; index: number; score: number; text: string } | null = null;

  lines.forEach((line, index) => {
    if (ledger.isClaimed(index)) return;
    const stripped = line.replace(HONORIFIC, '').trim();
    // Un nom ne contient ni chiffre ni symbole.
    if (!/^[\p{L}][\p{L}'’\-. ]{2,39}$/u.test(stripped)) return;
    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return;
    if (LEGAL_FORMS.test(stripped) || isJobTitle(stripped)) return;

    let score = 0;
    if (index < 4) score += 2; // les cartes mettent le nom en haut
    if (words.every((w) => /^[\p{Lu}]/u.test(w))) score += 3; // chaque mot capitalisé
    if (/^[\p{Lu}][\p{Ll}]/u.test(words[0])) score += 1; // « Jean » plutôt que « JEAN »
    if (jobIndex >= 0 && Math.abs(index - jobIndex) === 1) score += 4; // collé à la fonction
    if (loginTokens.length && loginTokens.some((t) => lower(stripped).includes(t))) score += 6;
    if (line !== line.toUpperCase()) score += 1;

    // Le nom est souvent la ligne écrite le plus gros : on exploite la géométrie OCR.
    const g = geo[index];
    if (g?.height && geo.length > 2) {
      const heights = geo.map((l) => l.height ?? 0).filter(Boolean);
      const max = Math.max(...heights);
      if (max > 0 && g.height >= max * 0.9) score += 3;
    }

    if (!best || score > best.score) best = { words, index, score, text: stripped };
  });

  if (!best) return null;
  const chosen = best as { words: string[]; index: number; score: number; text: string };
  ledger.claim(chosen.index, 'person');

  const { firstName, lastName } = splitName(chosen.words, loginTokens);
  return { firstName, lastName, confidence: Math.min(1, chosen.score / 10) };
}

/**
 * Sépare prénom et nom. Trois indices, du plus fiable au moins fiable :
 * l'ordre dans le login de l'e-mail, les mots écrits en capitales (le nom de
 * famille, par convention typographique), sinon « premier mot = prénom ».
 */
export function splitName(words: string[], loginTokens: string[]): { firstName: string; lastName: string } {
  if (loginTokens.length >= 2) {
    const first = words.find((w) => lower(w) === loginTokens[0]);
    const last = words.find((w) => lower(w) === loginTokens[1]);
    if (first && last) {
      return {
        firstName: titleCase(first),
        lastName: words
          .filter((w) => w !== first)
          .map(titleCase)
          .join(' '),
      };
    }
  }

  const upper = words.filter((w) => w.length > 1 && w === w.toUpperCase());
  if (upper.length && upper.length < words.length) {
    return {
      firstName: words.filter((w) => !upper.includes(w)).map(titleCase).join(' '),
      lastName: upper.map(titleCase).join(' '),
    };
  }

  return {
    firstName: titleCase(words[0]),
    lastName: words.slice(1).map(titleCase).join(' '),
  };
}

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */

/** Pays déduit du domaine national d'une adresse e-mail ou d'un site web. */
export function countryFromTld(emailOrUrl: string): string | null {
  if (!emailOrUrl) return null;
  const host = emailOrUrl.includes('@') ? emailOrUrl.split('@')[1] : emailOrUrl;
  const tld = lower(host).split('.').pop() ?? '';
  return TLD_COUNTRIES[tld] ?? null;
}

/** Détection sommaire des langues présentes (sert à router vers l'OCR adapté). */
export function detectLanguages(text: string): string[] {
  const langs: string[] = [];
  if (hasArabic(text)) langs.push('ar');
  if (/[éèêàçùôîïœ]/i.test(text) || /\b(rue|avenue|société|directeur|gérant|tél)\b/i.test(text)) {
    langs.push('fr');
  }
  if (/\b(street|manager|director|phone|company|sales)\b/i.test(text)) langs.push('en');
  return langs.length ? langs : ['fr'];
}

/** Score global : indique si la carte mérite un second passage (IA cloud). */
export function overallConfidence(fields: CardFields, confidence: FieldConfidence): number {
  const key: (keyof CardFields)[] = ['firstName', 'lastName', 'company', 'phone', 'email'];
  const scores = key.map((k) => (fields[k] ? (confidence[k] ?? 0.5) : 0));
  return scores.reduce((a, b) => a + b, 0) / key.length;
}

/** true quand l'extraction locale est trop pauvre pour être proposée telle quelle. */
export function needsCloudFallback(result: ExtractionResult): boolean {
  if (result.languages.includes('ar')) return true; // ML Kit ne lit pas l'arabe
  const filled = [
    result.fields.firstName || result.fields.lastName,
    result.fields.company,
    result.fields.phone,
    result.fields.email,
  ].filter(Boolean).length;
  return filled < 2 || overallConfidence(result.fields, result.confidence) < 0.45;
}

/** Nombre de chiffres d'un numéro, exporté pour les tests de non-régression. */
export const phoneDigits = digitsOnly;
