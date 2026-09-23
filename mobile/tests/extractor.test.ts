/**
 * Tests du moteur d'extraction (aucune dépendance React Native).
 * Exécution : npm test  →  node --experimental-strip-types --test tests/
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractFields, needsCloudFallback, splitName } from '../src/ai/extractor.ts';
import { formatPhone, normalizePhone, samePhone } from '../src/ai/patterns.ts';

/* ------------------------------------------------------------------ */
/* Cas de référence du cahier des charges                              */
/* ------------------------------------------------------------------ */

test('carte RDC : extrait tous les champs de l’exemple de référence', () => {
  const texte = [
    'Jean Dupont',
    'Directeur Général',
    'ABC Construction SARL',
    '+243 81 000 0000',
    'jean@abc.com',
    'www.abc.com',
    'Kinshasa, RDC',
  ].join('\n');

  const { fields, confidence } = extractFields({ text: texte });

  assert.equal(fields.firstName, 'Jean');
  assert.equal(fields.lastName, 'Dupont');
  assert.equal(fields.jobTitle, 'Directeur Général');
  assert.equal(fields.company, 'ABC Construction SARL');
  assert.equal(fields.email, 'jean@abc.com');
  assert.equal(fields.website, 'www.abc.com');
  assert.equal(fields.city, 'Kinshasa');
  assert.equal(fields.country, 'RD Congo');
  assert.equal(normalizePhone(fields.phone).e164, '+243810000000');
  assert.ok((confidence.email ?? 0) === 1);
});

test('le mobile devient le téléphone principal et alimente WhatsApp', () => {
  const texte = [
    'SOCIETE MINIERE DU KATANGA',
    'Marie KABILA',
    'Responsable commercial',
    'Tél : +243 99 123 4567',
    'Mob : +243 81 765 4321',
    'marie.kabila@smk.cd',
  ].join('\n');

  const { fields } = extractFields({ text: texte });

  assert.equal(fields.firstName, 'Marie');
  assert.equal(fields.lastName, 'Kabila');
  assert.equal(normalizePhone(fields.phone).e164, '+243817654321', 'le mobile passe en principal');
  assert.equal(normalizePhone(fields.secondaryPhone).e164, '+243991234567');
  assert.equal(normalizePhone(fields.whatsapp).e164, '+243817654321');
  assert.equal(fields.country, 'RD Congo');
});

test('le login de l’e-mail tranche l’ordre prénom / nom', () => {
  const texte = ['DUPONT Jean-Marc', 'Ingénieur structure', 'jean-marc.dupont@bet-structure.fr'].join('\n');

  const { fields } = extractFields({ text: texte });

  assert.equal(fields.firstName, 'Jean-Marc');
  assert.equal(fields.lastName, 'Dupont');
});

test('carte française : adresse, code postal et ville', () => {
  const texte = [
    'CABINET MARTIN & ASSOCIÉS',
    'Sophie MARTIN',
    'Architecte DPLG',
    '12 rue des Bâtisseurs',
    '69003 Lyon',
    'Tél. 04 72 00 11 22',
    'Port. 06 12 34 56 78',
    'contact@cabinet-martin.fr',
  ].join('\n');

  const { fields } = extractFields({ text: texte, defaultCountryCode: '+33' });

  assert.equal(fields.firstName, 'Sophie');
  assert.equal(fields.lastName, 'Martin');
  assert.equal(fields.jobTitle, 'Architecte DPLG');
  assert.match(fields.company, /CABINET MARTIN/);
  assert.match(fields.address, /12 rue des Bâtisseurs/);
  assert.equal(fields.city, 'Lyon');
  assert.equal(normalizePhone(fields.phone).e164, '+33612345678', 'le portable prime');
  assert.equal(normalizePhone(fields.secondaryPhone).e164, '+33472001122');
});

test('un numéro de RCCM ou de TVA n’est jamais pris pour un téléphone', () => {
  const texte = [
    'ETS BATIR SARL',
    'RCCM : CD/KIN/RCCM/14-B-3344',
    'ID. NAT : 01-93-N38756M',
    'TVA : FR 32 123456789',
    'Tél : +243 82 111 2222',
  ].join('\n');

  const { fields } = extractFields({ text: texte });

  assert.equal(normalizePhone(fields.phone).e164, '+243821112222');
  assert.equal(fields.secondaryPhone, '', 'aucun identifiant administratif retenu');
});

test('LinkedIn est reconnu sans être confondu avec le site web', () => {
  const texte = [
    'Paul NGOY',
    'Chef de chantier',
    'BUILDCO SARL',
    'www.buildco.cd',
    'linkedin.com/in/paulngoy',
    'paul@buildco.cd',
  ].join('\n');

  const { fields } = extractFields({ text: texte });

  assert.equal(fields.linkedin, 'linkedin.com/in/paulngoy');
  assert.equal(fields.website, 'www.buildco.cd');
});

test('le site est déduit du domaine professionnel quand il n’est pas imprimé', () => {
  const { fields } = extractFields({ text: 'Alice DUBOIS\nGérante\nalice@dubois-immo.be' });
  assert.equal(fields.website, 'www.dubois-immo.be');
  assert.equal(fields.country, 'Belgique', 'déduit du domaine national .be');
});

test('une adresse Gmail ne devient pas un nom d’entreprise', () => {
  const { fields } = extractFields({ text: 'Luc PERRIN\nConsultant\nluc.perrin@gmail.com' });
  assert.equal(fields.company, '');
  assert.equal(fields.website, '');
});

/* ------------------------------------------------------------------ */
/* Robustesse OCR                                                      */
/* ------------------------------------------------------------------ */

test('les confusions OCR dans les chiffres sont corrigées', () => {
  const { fields } = extractFields({ text: 'Tél : +243 8l 0OO 12 34' });
  assert.equal(normalizePhone(fields.phone).e164, '+243810001234');
});

test('le même numéro écrit deux fois n’est pas dupliqué', () => {
  const { fields } = extractFields({ text: 'Tel: 081 000 0000\nMobile: +243 81 000 0000' });
  assert.equal(fields.secondaryPhone, '', 'un seul numéro retenu');
});

test('une carte arabe déclenche le repli vers l’extraction cloud', () => {
  const result = extractFields({ text: 'شركة البناء\nمدير عام\n+212 6 12 34 56 78' });
  assert.ok(result.languages.includes('ar'));
  assert.ok(needsCloudFallback(result));
});

test('un texte OCR trop pauvre déclenche le repli cloud', () => {
  const result = extractFields({ text: 'BTP\n---\n???' });
  assert.ok(needsCloudFallback(result));
});

test('une extraction complète ne déclenche pas le repli cloud', () => {
  const result = extractFields({
    text: 'Jean Dupont\nDirecteur Général\nABC Construction SARL\n+243 81 000 0000\njean@abc.com',
  });
  assert.equal(needsCloudFallback(result), false);
});

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

test('normalisation E.164 depuis un numéro local', () => {
  assert.equal(normalizePhone('081 000 0000', '+243').e164, '+243810000000');
  assert.equal(normalizePhone('00243810000000').e164, '+243810000000');
  assert.equal(normalizePhone('+243 81 000 0000').country, 'RD Congo');
});

test('deux écritures du même numéro sont reconnues comme identiques', () => {
  assert.ok(samePhone('+243 81 000 0000', '081 000 0000'));
  assert.equal(samePhone('+243 81 000 0000', '+243 82 000 0000'), false);
});

test('mise en forme lisible des numéros', () => {
  assert.equal(formatPhone('+243810000000'), '+243 810 000 000');
  assert.equal(formatPhone('0612345678'), '06 12 34 56 78');
});

test('séparation prénom / nom', () => {
  assert.deepEqual(splitName(['Jean', 'DUPONT'], []), { firstName: 'Jean', lastName: 'Dupont' });
  assert.deepEqual(splitName(['DUPONT', 'Jean'], []), { firstName: 'Jean', lastName: 'Dupont' });
  assert.deepEqual(splitName(['Jean', 'Dupont'], []), { firstName: 'Jean', lastName: 'Dupont' });
});

/* ------------------------------------------------------------------ */
/* Rien de ce qui est imprimé sur la carte ne doit être perdu          */
/* ------------------------------------------------------------------ */

/** Valeurs des informations supplémentaires, pour des assertions lisibles. */
const extraValues = (extras: { value: string }[]) => extras.map((e) => e.value);

/** Retrouve une information supplémentaire par un fragment de sa valeur. */
const findExtra = (extras: { label: string; value: string; kind: string }[], part: string) =>
  extras.find((e) => e.value.toLowerCase().includes(part.toLowerCase()));

test('un troisième numéro est conservé au lieu d’être jeté', () => {
  const texte = [
    'Jean Dupont',
    'Mob : +243 81 000 0000',
    'Tél : +243 99 111 1111',
    'Fax : +243 99 222 2222',
  ].join('\n');

  const { fields, extras } = extractFields({ text: texte });

  assert.ok(fields.phone, 'le principal est rempli');
  assert.ok(fields.secondaryPhone, 'le secondaire est rempli');
  const fax = findExtra(extras, '222');
  assert.ok(fax, `fax attendu dans les extras, reçu : ${extraValues(extras).join(' | ')}`);
  assert.equal(fax?.label, 'Fax');
  assert.equal(fax?.kind, 'phone');
});

test('le deuxième e-mail n’écrase plus le fax', () => {
  // Régression : les deux partageaient le champ « notes », le dernier gagnait.
  const texte = [
    'Jean Dupont',
    'jean@abc.com',
    'contact@abc.com',
    'Fax : +243 99 222 2222',
  ].join('\n');

  const { fields, extras } = extractFields({ text: texte });

  assert.equal(fields.email, 'jean@abc.com');
  assert.ok(findExtra(extras, 'contact@abc.com'), 'second e-mail conservé');
  assert.ok(findExtra(extras, '222'), 'fax conservé en même temps');
});

test('les mentions légales sont gardées avec leur libellé', () => {
  const texte = ['ABC Construction SARL', 'RCCM : CD/KIN/RCCM/22-B-1234', 'ID. NAT : 01-A5678'].join('\n');

  const { extras } = extractFields({ text: texte });

  const rccm = findExtra(extras, 'RCCM/22-B-1234');
  assert.ok(rccm, `RCCM attendu, reçu : ${extraValues(extras).join(' | ')}`);
  assert.equal(rccm?.kind, 'id');
  assert.ok(findExtra(extras, '01-A5678'), 'ID. NAT conservé');
});

test('une page Facebook est rangée comme réseau social, pas comme site', () => {
  const texte = ['ABC Construction SARL', 'www.abc.com', 'facebook.com/abcconstruction'].join('\n');

  const { fields, extras } = extractFields({ text: texte });

  assert.equal(fields.website, 'www.abc.com');
  const fb = findExtra(extras, 'facebook.com/abcconstruction');
  assert.ok(fb, `Facebook attendu, reçu : ${extraValues(extras).join(' | ')}`);
  assert.equal(fb?.kind, 'social');
  assert.equal(fb?.label, 'Facebook');
});

test('une ligne que le moteur ne comprend pas reste une information de la carte', () => {
  const texte = [
    'Jean Dupont',
    'Directeur Général',
    'ABC Construction SARL',
    '+243 81 000 0000',
    'Votre chantier, notre métier depuis 1998',
  ].join('\n');

  const { extras } = extractFields({ text: texte });

  assert.ok(
    findExtra(extras, 'notre métier depuis 1998'),
    `slogan attendu, reçu : ${extraValues(extras).join(' | ')}`,
  );
});

test('le deuxième site web est conservé', () => {
  const texte = ['ABC Construction SARL', 'www.abc.com', 'boutique.abc-shop.com'].join('\n');

  const { fields, extras } = extractFields({ text: texte });

  assert.equal(fields.website, 'www.abc.com');
  assert.ok(findExtra(extras, 'abc-shop.com'), 'second site conservé');
});

/* ------------------------------------------------------------------ */
/* Plusieurs numéros sur une même ligne                                */
/* ------------------------------------------------------------------ */

test('deux numéros séparés par une barre oblique sont tous les deux lus', () => {
  // Régression : la suite entière formait un seul candidat de 20 chiffres,
  // rejeté comme invraisemblable — les DEUX numéros disparaissaient.
  const { fields, extras } = extractFields({
    text: ['Jean Dupont', 'Tél : 081 000 0000 / 099 111 1111'].join('\n'),
    defaultCountryCode: '+243',
  });

  const tous = [fields.phone, fields.secondaryPhone, ...extras.map((e) => e.value)]
    .filter(Boolean)
    .map((v) => normalizePhone(v, '+243').e164);

  assert.ok(tous.includes('+243810000000'), `premier numéro attendu, reçu : ${tous.join(' | ')}`);
  assert.ok(tous.includes('+243991111111'), `second numéro attendu, reçu : ${tous.join(' | ')}`);
});

test('deux numéros séparés par un tiret sont tous les deux lus', () => {
  const { fields } = extractFields({
    text: ['ABC SARL', '081 000 0000 - 099 111 1111'].join('\n'),
    defaultCountryCode: '+243',
  });
  assert.equal(normalizePhone(fields.phone, '+243').e164, '+243810000000');
  assert.equal(normalizePhone(fields.secondaryPhone, '+243').e164, '+243991111111');
});

test('un numéro écrit avec des tirets internes n’est pas fragmenté', () => {
  const { fields } = extractFields({
    text: ['ABC SARL', 'Tél : 081 - 000 - 0000'].join('\n'),
    defaultCountryCode: '+243',
  });
  assert.equal(normalizePhone(fields.phone, '+243').e164, '+243810000000');
  assert.equal(fields.secondaryPhone, '', 'aucun numéro inventé par le découpage');
});

test('le zéro national entre parenthèses est retiré', () => {
  const { fields } = extractFields({ text: ['ABC SARL', '+243 (0)81 000 0000'].join('\n') });
  assert.equal(normalizePhone(fields.phone).e164, '+243810000000');
});

test('trois numéros collés sur une ligne sont tous conservés', () => {
  const { fields, extras } = extractFields({
    text: ['ABC SARL', '081 000 0000 099 111 1111 097 222 2222'].join('\n'),
    defaultCountryCode: '+243',
  });
  const tous = [fields.phone, fields.secondaryPhone, ...extras.map((e) => e.value)]
    .filter(Boolean)
    .map((v) => normalizePhone(v, '+243').e164);
  assert.equal(new Set(tous).size, 3, `trois numéros attendus, reçu : ${tous.join(' | ')}`);
});

test('la géométrie reste alignée quand l’OCR renvoie des fragments', () => {
  // `toLines` écarte les fragments d'un caractère : sans recalage, la hauteur
  // de la ligne « Jean Dupont » serait attribuée à la ligne suivante, et le
  // nom cherché au mauvais endroit.
  const { fields } = extractFields({
    text: ['*', 'Jean Dupont', 'Directeur Général', 'ABC Construction SARL'].join('\n'),
    lines: [
      { text: '*', y: 0.02, height: 0.02 },
      { text: 'Jean Dupont', y: 0.2, height: 0.2 },
      { text: 'Directeur Général', y: 0.5, height: 0.06 },
      { text: 'ABC Construction SARL', y: 0.8, height: 0.06 },
    ],
  });

  assert.equal(fields.firstName, 'Jean');
  assert.equal(fields.lastName, 'Dupont');
});
