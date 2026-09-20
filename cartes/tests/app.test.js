/* CartePro — analyse des cartes, vCard, parcours répertoire.
   Lancement : node cartes/tests/app.test.js                                  */
const path = require("path");
const { serve, browser, reporter } = require("./helpers");
const ROOT = path.join(__dirname, ".."), PORT = 3123;

const CARD_FR = `BÂTI CONSTRUCT SARL
Jean DUPONT
Conducteur de travaux
12 rue des Acacias
69003 LYON
Tél. 04 72 11 22 33 - Mob. 06 12 34 56 78
Fax 04 72 11 22 34
jean.dupont@baticonstruct.fr
www.baticonstruct.fr`;

const CARD_EN = `ACME Engineering Ltd
Sarah Miller
Sales Director
Mobile: +44 7700 900123
sarah.miller@acme-eng.co.uk
acme-eng.co.uk`;

const CARD_INV = `DUPONT Marie
Architecte DPLG
marie.dupont@atelier-md.com
06.11.22.33.44`;

const CARD_NOISE = `SARL TOITURE PLUS
SIRET 812 345 678 00019 - TVA FR32812345678
Contact : 01 45 67 89 10
contact@toitureplus.fr`;

(async () => {
  const r = reporter();
  const srv = await serve(ROOT, PORT);
  const b = await browser();
  const pg = await (await b.newContext({ viewport:{width:390,height:844}, locale:"fr-FR" })).newPage();
  const errs = [];
  pg.on("pageerror", e => errs.push("pageerror: " + e.message));
  pg.on("console", m => { if(m.type() === "error" && !/favicon|sw\.js|ServiceWorker/i.test(m.text())) errs.push("console: " + m.text()); });
  await pg.goto(`http://localhost:${PORT}/index.html`);
  await pg.waitForFunction(() => !!window.CartePro);

  r.title("[1] Analyse d'une carte française");
  const a = await pg.evaluate(t => CartePro.parseCard(t), CARD_FR);
  r.ok("prénom", a.prenom === "Jean", a.prenom);
  r.ok("nom", a.nom === "Dupont", a.nom);
  r.ok("société", /bâti construct/i.test(a.societe), a.societe);
  r.ok("fonction", /conducteur/i.test(a.fonction), a.fonction);
  r.ok("3 numéros extraits", a.tels.length === 3, a.tels);
  r.ok("mobile normalisé", a.tels.some(t => t.type === "mobile" && t.value === "+33 6 12 34 56 78"), a.tels);
  r.ok("fax typé", a.tels.some(t => t.type === "fax"), a.tels);
  r.ok("e-mail", a.emails[0] && a.emails[0].value === "jean.dupont@baticonstruct.fr", a.emails);
  r.ok("site web", a.sites.some(s => /baticonstruct\.fr/.test(s)), a.sites);
  r.ok("rue", /12 rue des Acacias/i.test(a.rue), a.rue);
  r.ok("code postal", a.cp === "69003", a.cp);
  r.ok("ville", /LYON/i.test(a.ville), a.ville);

  r.title("[2] Carte anglophone");
  const e2 = await pg.evaluate(t => CartePro.parseCard(t), CARD_EN);
  r.ok("prénom / nom", e2.prenom === "Sarah" && e2.nom === "Miller", [e2.prenom, e2.nom]);
  r.ok("société", /acme/i.test(e2.societe), e2.societe);
  r.ok("numéro international conservé", e2.tels[0] && e2.tels[0].value.startsWith("+44"), e2.tels);
  r.ok("fonction", /sales director/i.test(e2.fonction), e2.fonction);

  r.title("[3] Cas particuliers");
  const e3 = await pg.evaluate(t => CartePro.parseCard(t), CARD_INV);
  r.ok("ordre NOM Prénom redressé", e3.prenom === "Marie" && e3.nom === "Dupont", [e3.prenom, e3.nom]);
  r.ok("numéro séparé par des points", e3.tels[0] && e3.tels[0].value === "+33 6 11 22 33 44", e3.tels);
  const e4 = await pg.evaluate(t => CartePro.parseCard(t), CARD_NOISE);
  r.ok("SIRET / TVA ignorés", e4.tels.length === 1 && e4.tels[0].value === "+33 1 45 67 89 10", e4.tels);

  r.title("[4] Numéros de téléphone");
  const ph = await pg.evaluate(() => [
    CartePro.normPhone("06 12 34 56 78"), CartePro.normPhone("0033612345678"),
    CartePro.normPhone("+225 07 08 09 10 11"), CartePro.prettyPhone("+33612345678")]);
  r.ok("0X → indicatif par défaut", ph[0] === "+33612345678", ph[0]);
  r.ok("00 → +", ph[1] === "+33612345678", ph[1]);
  r.ok("numéro étranger conservé", ph[2] === "+2250708091011", ph[2]);
  r.ok("affichage groupé", ph[3] === "+33 6 12 34 56 78", ph[3]);

  r.title("[5] vCard");
  const v = await pg.evaluate(t => CartePro.vcard(CartePro.parseCard(t)), CARD_FR);
  r.ok("en-tête vCard 3.0", /BEGIN:VCARD\r\nVERSION:3.0/.test(v));
  r.ok("N: nom;prénom", /N:Dupont;Jean;;;/.test(v));
  r.ok("TEL CELL", /TEL;TYPE=CELL:\+33612345678/.test(v));
  r.ok("TEL FAX", /TEL;TYPE=WORK,FAX:/.test(v));
  r.ok("EMAIL", /EMAIL;TYPE=INTERNET,WORK:jean\.dupont@baticonstruct\.fr/.test(v));
  r.ok("ADR", /ADR;TYPE=WORK:;;12 rue des Acacias;LYON;;69003;/.test(v));
  r.ok("fin de fiche", /END:VCARD\r\n$/.test(v));
  const rt = await pg.evaluate(t => CartePro.parseVcf(CartePro.vcard(CartePro.parseCard(t))), CARD_FR);
  r.ok("aller-retour vCard", rt.length === 1 && rt[0].nom === "Dupont" && rt[0].tels.length === 3, rt[0] && rt[0].tels);

  r.title("[6] Parcours : saisie → répertoire → fiche");
  await pg.click("#btnManual");
  await pg.fill("#fPrenom", "Claire"); await pg.fill("#fNom", "Martin");
  await pg.fill("#fSociete", "Béton Sud"); await pg.fill("#fFonction", "Métreur");
  await pg.fill('#listTel input[data-k="value"]', "06 55 44 33 22");
  await pg.fill('#listEmail input[data-k="value"]', "claire.martin@betonsud.fr");
  await pg.fill("#fTags", "client, lyon");
  await pg.click("#btnSaveForm");
  await pg.waitForTimeout(350);
  r.ok("bandeau d'enregistrement", await pg.isVisible("#savedFlag"));
  await pg.click('.tab[data-screen="scRep"]');
  await pg.waitForTimeout(250);
  r.ok("1 contact listé", (await pg.locator(".item").count()) === 1);
  r.ok("nom affiché", /Claire Martin/.test(await pg.textContent("#repList")));
  r.ok("étiquettes affichées", /client/.test(await pg.textContent("#repList")));
  await pg.fill("#q", "beton"); await pg.waitForTimeout(150);
  r.ok("recherche insensible aux accents", (await pg.locator(".item").count()) === 1);
  await pg.fill("#q", "zzz"); await pg.waitForTimeout(150);
  r.ok("recherche sans résultat", (await pg.locator(".item").count()) === 0);
  await pg.fill("#q", ""); await pg.waitForTimeout(150);
  await pg.click(".item"); await pg.waitForTimeout(250);
  r.ok("fiche ouverte", await pg.isVisible("#sheet"));
  const body = await pg.innerHTML("#sheetBody");
  r.ok("lien d'appel", /tel:\+33655443322/.test(body));
  r.ok("lien e-mail", /mailto:claire\.martin@betonsud\.fr/.test(body));

  r.title("[7] Doublons et persistance");
  await pg.click("#btnSheetClose");
  await pg.click('.tab[data-screen="scScan"]');
  await pg.click("#btnManual");
  await pg.fill("#fPrenom", "Claire"); await pg.fill("#fNom", "Martin");
  await pg.fill('#listEmail input[data-k="value"]', "claire.martin@betonsud.fr");
  await pg.fill('#listTel input[data-k="value"]', "04 78 00 11 22");
  pg.once("dialog", d => d.accept());
  await pg.click("#btnSaveForm");
  await pg.waitForTimeout(400);
  const n1 = await pg.evaluate(async () => (await CartePro.dbAll()).length);
  r.ok("doublon fusionné", n1 === 1, n1);
  const tels = await pg.evaluate(async () => (await CartePro.dbAll())[0].tels.length);
  r.ok("numéro ajouté à la fiche existante", tels === 2, tels);
  await pg.reload();
  await pg.waitForFunction(() => !!window.CartePro);
  await pg.click('.tab[data-screen="scRep"]');
  await pg.waitForTimeout(350);
  r.ok("contact conservé après rechargement", (await pg.locator(".item").count()) === 1);
  r.ok("société persistée", (await pg.evaluate(async () => (await CartePro.dbAll())[0].societe)) === "Béton Sud");

  r.ok("aucune erreur JS", errs.length === 0, errs);
  await b.close(); srv.close();
  process.exit(r.end());
})().catch(e => { console.error(e); process.exit(2); });
