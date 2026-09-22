/** Tests de la fusion entre extraction locale et extraction IA. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lowConfidenceFields, mergeExtractions, mergeExtras } from '../src/ai/merge.ts';
import { EMPTY_FIELDS, type CardFields } from '../src/types/index.ts';

const fields = (partial: Partial<CardFields>): CardFields => ({ ...EMPTY_FIELDS, ...partial });

test('la valeur la plus sûre gagne, champ par champ', () => {
  const merged = mergeExtractions(
    { fields: fields({ company: 'ABC', phone: '+243810000000' }), confidence: { company: 0.4, phone: 1 } },
    { fields: fields({ company: 'ABC Construction SARL', phone: '+243999999999' }), confidence: { company: 0.95, phone: 0.5 } },
  );

  assert.equal(merged.fields.company, 'ABC Construction SARL', 'le cloud était plus sûr');
  assert.equal(merged.fields.phone, '+243810000000', 'le local était plus sûr');
});

test('un champ vide ne remplace jamais un champ rempli', () => {
  const merged = mergeExtractions(
    { fields: fields({ email: 'jean@abc.com' }), confidence: { email: 1 } },
    { fields: fields({ email: '' }), confidence: {} },
  );
  assert.equal(merged.fields.email, 'jean@abc.com');
});

test('le cloud complète les champs que le local n’a pas vus', () => {
  const merged = mergeExtractions(
    { fields: fields({ lastName: 'Dupont' }), confidence: { lastName: 0.8 } },
    { fields: fields({ lastName: 'Dupont', city: 'Kinshasa', country: 'RD Congo' }), confidence: {} },
  );
  assert.equal(merged.fields.city, 'Kinshasa');
  assert.equal(merged.fields.country, 'RD Congo');
});

test('à confiance égale, le cloud l’emporte', () => {
  const merged = mergeExtractions(
    { fields: fields({ jobTitle: 'Directeur' }), confidence: { jobTitle: 0.8 } },
    { fields: fields({ jobTitle: 'Directeur Général' }), confidence: { jobTitle: 0.8 } },
  );
  assert.equal(merged.fields.jobTitle, 'Directeur Général');
});

test('les champs peu sûrs sont signalés à l’utilisateur', () => {
  const flagged = lowConfidenceFields(
    fields({ firstName: 'Jean', company: 'ABC', email: '' }),
    { firstName: 0.9, company: 0.3, email: 0 },
  );
  assert.deepEqual(flagged, ['company'], 'seul un champ rempli et incertain est signalé');
});

/* ------------------------------------------------------------------ */
/* Fusion des informations supplémentaires                             */
/* ------------------------------------------------------------------ */

test('les extras des deux moteurs sont réunis sans doublon', () => {
  const local = [{ label: 'Fax', value: '+243 99 222 2222', kind: 'phone' as const }];
  const cloud = [
    { label: 'Fax', value: '+243992222222', kind: 'phone' as const },
    { label: 'RCCM', value: 'CD/KIN/RCCM/22-B-1234', kind: 'id' as const },
  ];

  const merged = mergeExtras(local, cloud, EMPTY_FIELDS);

  assert.equal(merged.length, 2, `doublon de fax attendu fusionné : ${JSON.stringify(merged)}`);
  assert.ok(merged.some((e) => e.value.includes('RCCM/22-B-1234')));
});

test('une valeur déjà placée dans un champ ne se répète pas en extras', () => {
  const fields = { ...EMPTY_FIELDS, phone: '+243 81 000 0000' };
  const merged = mergeExtras(
    [{ label: 'Autre téléphone', value: '+243810000000', kind: 'phone' }],
    [],
    fields,
  );
  assert.deepEqual(merged, []);
});

test('un extra sans libellé reçoit un libellé par défaut', () => {
  const merged = mergeExtras([{ label: '', value: 'Slogan de la carte', kind: 'text' }], [], EMPTY_FIELDS);
  assert.equal(merged[0]?.label, 'Sur la carte');
});
