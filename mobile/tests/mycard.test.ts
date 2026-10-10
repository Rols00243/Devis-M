/**
 * Tests de la carte de visite de l'utilisateur : QR code, contenu et rendu
 * imprimable. Tous ces modules sont purs, donc vérifiables sans téléphone.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardHtml, CARD_HEIGHT_MM, CARD_WIDTH_MM } from '../src/mycard/html.ts';
import { contactLines, isPrintable, myCardVCard, normalizeMyCard } from '../src/mycard/model.ts';
import { qrMatrix, qrToSvg } from '../src/mycard/qr.ts';
import { EMPTY_MY_CARD, type MyCard } from '../src/types/index.ts';

const card = (overrides: Partial<MyCard> = {}): MyCard => ({
  ...EMPTY_MY_CARD,
  firstName: 'Jean',
  lastName: 'Dupont',
  jobTitle: 'Directeur Général',
  company: 'ABC Construction SARL',
  phone: '+243810000000',
  email: 'jean@abc.com',
  ...overrides,
});

/* ------------------------------- QR code -------------------------------- */

test('le QR code encode la fiche entière', () => {
  const matrix = qrMatrix(myCardVCard(card()));
  assert.ok(matrix, 'une matrice est produite');
  // Un QR est carré, d'au moins 21 modules (version 1), et de taille impaire
  // selon la norme : 21, 25, 29…
  assert.equal(matrix!.modules.length, matrix!.size);
  assert.ok(matrix!.size >= 21, `taille inattendue : ${matrix!.size}`);
  assert.equal((matrix!.size - 21) % 4, 0, 'la taille suit les versions normalisées');
});

test('les trois repères de position sont présents', () => {
  // Sans eux, aucun téléphone ne sait lire le code : c'est le test qui
  // distingue un vrai QR d'un carré de pixels.
  const m = qrMatrix('https://exemple.test')!;
  const isFinder = (top: number, left: number) =>
    m.modules[top][left] && m.modules[top][left + 6] && m.modules[top + 6][left];
  assert.ok(isFinder(0, 0), 'repère haut-gauche');
  assert.ok(isFinder(0, m.size - 7), 'repère haut-droit');
  assert.ok(isFinder(m.size - 7, 0), 'repère bas-gauche');
});

test('un texte vide ne produit pas de QR', () => {
  assert.equal(qrMatrix('   '), null);
});

test('le SVG du QR porte une marge blanche et des modules noirs', () => {
  const svg = qrToSvg(qrMatrix('test')!, { size: 100 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('width="100"'));
  assert.ok(svg.includes('<rect'), 'des modules sont dessinés');
  // La zone de silence (2 modules) est indispensable à la lecture.
  const viewBox = svg.match(/viewBox="0 0 (\d+) /);
  const size = qrMatrix('test')!.size;
  assert.equal(Number(viewBox![1]), size + 4);
});

/* -------------------------------- Modèle -------------------------------- */

test('une carte sans nom ni entreprise ne s’imprime pas', () => {
  assert.equal(isPrintable(EMPTY_MY_CARD), false);
  assert.equal(isPrintable(card({ firstName: '', lastName: '', company: 'ABC' })), true);
});

test('les lignes de contact sont dédoublonnées et mises en forme', () => {
  const lines = contactLines(
    card({ phone: '+243810000000', whatsapp: '+243 81 000 00 00', email: 'jean@abc.com' }),
  );
  const values = lines.map((l) => l.text);
  // Le même numéro noté différemment ne doit apparaître qu'une fois.
  assert.equal(values.filter((v) => v.replace(/\D/g, '') === '243810000000').length, 1);
  assert.ok(values.includes('jean@abc.com'));
});

test('une carte ancienne, incomplète, reste exploitable', () => {
  const restored = normalizeMyCard({ firstName: 'Jean' } as Partial<MyCard>);
  assert.equal(restored.firstName, 'Jean');
  assert.equal(restored.template, EMPTY_MY_CARD.template, 'le modèle par défaut est rétabli');
  assert.equal(restored.accent, EMPTY_MY_CARD.accent);
});

/* ------------------------------ Impression ------------------------------ */

test('la page imprimée fait exactement la taille d’une carte de visite', () => {
  const html = cardHtml(card());
  assert.ok(html.includes(`size: ${CARD_WIDTH_MM}mm ${CARD_HEIGHT_MM}mm`));
  assert.equal(CARD_WIDTH_MM, 85);
  assert.equal(CARD_HEIGHT_MM, 55);
});

test('le HTML porte le nom, la fonction et le QR', () => {
  const html = cardHtml(card());
  assert.ok(html.includes('Jean Dupont'));
  assert.ok(html.includes('Directeur Général'));
  assert.ok(html.includes('<svg'), 'le QR est intégré');
});

test('le QR peut être retiré de la carte', () => {
  assert.ok(!cardHtml(card({ showQrCode: false })).includes('<svg'));
});

test('le texte de la carte est échappé', () => {
  // Une entreprise nommée « A & B <Ltd> » ne doit pas casser la page.
  const html = cardHtml(card({ company: 'A & B <Ltd>' }));
  assert.ok(html.includes('A &amp; B &lt;Ltd&gt;'));
  assert.ok(!html.includes('<Ltd>'));
});

test('une couleur d’accent invalide retombe sur la couleur par défaut', () => {
  const html = cardHtml(card({ accent: 'javascript:alert(1)' }));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('#2563EB'));
});
