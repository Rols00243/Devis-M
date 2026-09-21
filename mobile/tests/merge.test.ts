/** Tests de la fusion entre extraction locale et extraction IA. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lowConfidenceFields, mergeExtractions } from '../src/ai/merge.ts';
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
