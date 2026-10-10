/**
 * Le format vCard est le seul point de passage vers l'extérieur : répertoire
 * du téléphone, compte Google, Outlook, WhatsApp. Une erreur ici se traduit
 * par un contact importé sans numéro — d'où ces vérifications.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toCsv, toVCard, toVCardBook } from '../src/services/vcard.ts';
import { EMPTY_FIELDS, type BusinessCard } from '../src/types/index.ts';

function card(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    ...EMPTY_FIELDS,
    id: 'c1',
    imageUri: null,
    backImageUri: null,
    rawText: '',
    extras: [],
    confidence: {},
    status: 'validated',
    contactId: null,
    source: 'scanner',
    ocrEngine: 'mlkit',
    languages: ['fr'],
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    deletedAt: null,
    syncState: 'local',
    ownerId: null,
    remoteImagePath: null,
    ...overrides,
  };
}

const lines = (vcf: string) => vcf.split('\r\n');

/** Indicatif du marché visé : les cartes y portent des numéros locaux. */
const RDC = { defaultCountryCode: '+243' };

test('les numéros sont exportés au format international', () => {
  const vcf = toVCard(card({ firstName: 'Jean', lastName: 'Dupont', phone: '081 000 12 34' }), RDC);
  assert.ok(lines(vcf).includes('TEL;TYPE=CELL,VOICE:+243810001234'));
});

test('un numéro identique n’est pas répété dans la fiche', () => {
  // La carte porte le même numéro comme mobile et comme WhatsApp : un doublon
  // ici devient un doublon dans le répertoire après import.
  const vcf = toVCard(card({ phone: '+243810001234', whatsapp: '0810001234', company: 'ABC' }), RDC);
  const tels = lines(vcf).filter((l) => l.includes('TEL'));
  assert.equal(tels.length, 1);
});

test('le numéro WhatsApp distinct garde son libellé', () => {
  const vcf = toVCard(card({ phone: '+243810001234', whatsapp: '+243990009999' }));
  const tel = lines(vcf).find((l) => l.endsWith(':+243990009999'));
  assert.ok(tel?.startsWith('item'), `libellé attendu, reçu : ${tel}`);
  const group = tel!.split('.')[0];
  assert.ok(lines(vcf).includes(`${group}.X-ABLabel:WhatsApp`));
});

test('le nom affiché retombe sur l’entreprise quand la personne est inconnue', () => {
  const vcf = toVCard(card({ company: 'ABC Construction SARL' }));
  assert.ok(lines(vcf).includes('FN:ABC Construction SARL'));
  assert.ok(lines(vcf).includes('ORG:ABC Construction SARL'));
});

test('les séparateurs vCard présents dans les valeurs sont échappés', () => {
  const vcf = toVCard(card({ lastName: 'Dupont;Martin', address: '12, avenue du Port' }));
  assert.ok(lines(vcf).includes('N:Dupont\;Martin;;;;'));
  assert.ok(vcf.includes('12\\, avenue du Port'));
});

test('le site web reçoit un protocole', () => {
  const vcf = toVCard(card({ website: 'www.abc.com' }));
  assert.ok(lines(vcf).includes('URL:https://www.abc.com'));
});

test('un carnet regroupe toutes les fiches', () => {
  const book = toVCardBook([card({ firstName: 'A' }), card({ firstName: 'B' })]);
  assert.equal(book.match(/BEGIN:VCARD/g)?.length, 2);
  assert.equal(book.match(/END:VCARD/g)?.length, 2);
});

test('le CSV commence par un BOM et une ligne d’en-tête', () => {
  const csv = toCsv([card({ firstName: 'Jean', lastName: 'Dupont' })]);
  assert.ok(csv.startsWith('﻿"Prénom"'));
  assert.equal(csv.split('\r\n').length, 2);
});

test('les informations supplémentaires partent dans la vCard', () => {
  const vcf = toVCard(card({ firstName: 'Jean', lastName: 'Dupont', notes: 'Rencontré au salon' }), {
    ...RDC,
    extras: [
      { label: 'Fax', value: '+243992222222', kind: 'phone' },
      { label: 'Autre e-mail', value: 'contact@abc.com', kind: 'email' },
      { label: 'Facebook', value: 'facebook.com/abc', kind: 'social' },
      { label: 'RCCM', value: 'CD/KIN/RCCM/22-B-1234', kind: 'id' },
    ],
  });

  assert.ok(vcf.includes('+243992222222'), 'le fax est un numéro de la fiche');
  assert.ok(vcf.includes('EMAIL;TYPE=INTERNET:contact@abc.com'));
  assert.ok(vcf.includes('X-SOCIALPROFILE;TYPE=facebook:facebook.com/abc'));
  // Ce qui n'a pas de champ dédié rejoint la note, avec son libellé.
  const note = lines(vcf).find((l) => l.startsWith('NOTE:'));
  assert.ok(note?.includes('Rencontré au salon'), `note attendue, reçu : ${note}`);
  assert.ok(note?.includes('RCCM : CD/KIN/RCCM/22-B-1234'), `RCCM attendu, reçu : ${note}`);
});

test('le CSV porte aussi les informations supplémentaires', () => {
  const csv = toCsv([
    card({
      firstName: 'Jean',
      extras: [{ label: 'RCCM', value: 'CD/KIN/RCCM/22-B-1234', kind: 'id' }],
    }),
  ]);
  assert.ok(csv.includes('"Autres informations"'), 'colonne présente dans l’en-tête');
  assert.ok(csv.includes('RCCM : CD/KIN/RCCM/22-B-1234'), 'valeur exportée');
});
