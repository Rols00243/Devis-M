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
