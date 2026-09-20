/* CartePro — chaîne photo → pré-traitement → OCR → fiche enregistrée.
   Le moteur OCR (Tesseract.js) est chargé depuis un CDN : il est simulé ici
   pour que le test tourne hors connexion.
   Lancement : node cartes/tests/ocr.test.js                                   */
const path = require("path");
const { serve, browser, reporter } = require("./helpers");
const ROOT = path.join(__dirname, ".."), PORT = 3124;

(async () => {
  const r = reporter();
  const srv = await serve(ROOT, PORT);
  const b = await browser();
  const pg = await (await b.newContext({ viewport:{width:390,height:844}, locale:"fr-FR" })).newPage();
  const errs = [];
  pg.on("pageerror", e => errs.push(e.message));
  await pg.goto(`http://localhost:${PORT}/index.html`);
  await pg.waitForFunction(() => !!window.CartePro);

  r.title("[1] Photo → OCR (simulé) → fiche enregistrée automatiquement");
  const res = await pg.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 1000; c.height = 600;
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, 1000, 600); x.fillStyle = "#111";
    x.font = "bold 52px sans-serif"; x.fillText("SOGEBAT SARL", 60, 110);
    x.font = "44px sans-serif"; x.fillText("Paul LEROY", 60, 200);
    x.font = "32px sans-serif"; x.fillText("Ingénieur structure", 60, 255);
    x.fillText("06 98 76 54 32", 60, 340); x.fillText("p.leroy@sogebat.fr", 60, 395);
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.9));
    window.Tesseract = { createWorker: async (langs, oem, opt) => {
      opt.logger({ status:"recognizing text", progress:0.5 });
      return { recognize: async () => ({ data:{ text:
        "SOGEBAT SARL\nPaul LEROY\nIngénieur structure\n06 98 76 54 32\np.leroy@sogebat.fr" } }),
        terminate: async () => {} };
    }};
    await CartePro.handleShot(blob);
    await new Promise(r => setTimeout(r, 400));
    const all = await CartePro.dbAll();
    return { n:all.length, c:all[0], photo:(all[0].photo instanceof Blob) && all[0].photo.size,
             form:!document.getElementById("formWrap").hidden,
             flag:!document.getElementById("savedFlag").classList.contains("off"),
             prenom:document.getElementById("fPrenom").value,
             tel:document.querySelector('#listTel input[data-k="value"]').value };
  });
  r.ok("fiche enregistrée sans action de l'utilisateur", res.n === 1, res.n);
  r.ok("bandeau « enregistré » affiché", res.flag && res.form);
  r.ok("prénom pré-rempli", res.prenom === "Paul", res.prenom);
  r.ok("téléphone normalisé", res.tel === "+33 6 98 76 54 32", res.tel);
  r.ok("société lue", /sogebat/i.test(res.c.societe), res.c.societe);
  r.ok("fonction lue", /ing/i.test(res.c.fonction), res.c.fonction);
  r.ok("photo de la carte conservée", res.photo > 0, res.photo);
  r.ok("texte OCR mémorisé", /SOGEBAT/.test(res.c.raw || ""));

  r.title("[2] Pré-traitement de l'image");
  const pre = await pg.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 2400; c.height = 1500;
    const x = c.getContext("2d");
    x.fillStyle = "#fafafa"; x.fillRect(0, 0, 2400, 1500);
    x.fillStyle = "#282828"; x.fillRect(100, 100, 1200, 700);
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.9));
    const a = await CartePro.preprocess(blob, 0), b = await CartePro.preprocess(blob, 90);
    const dark = a.getContext("2d").getImageData(400, 300, 1, 1).data;
    const light = a.getContext("2d").getImageData(1500, 900, 1, 1).data;
    return { aw:a.width, ah:a.height, bw:b.width, bh:b.height,
             gray: dark[0] === dark[1] && dark[1] === dark[2], dark:dark[0], light:light[0] };
  });
  r.ok("image réduite à 1600 px de large", pre.aw === 1600 && pre.ah === 1000, [pre.aw, pre.ah]);
  r.ok("rotation 90° (sans agrandissement)", pre.bw === 1500 && pre.bh === 2400, [pre.bw, pre.bh]);
  r.ok("niveaux de gris", pre.gray);
  r.ok("contraste étiré", pre.dark < 12 && pre.light > 243, [pre.dark, pre.light]);

  r.title("[3] Moteur OCR indisponible → saisie manuelle");
  const fb = await pg.evaluate(async () => {
    await CartePro.dbClear(); await CartePro.refresh();
    const c = document.createElement("canvas"); c.width = 400; c.height = 250;
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.9));
    window.Tesseract = { createWorker: async () => { throw new Error("réseau indisponible"); } };
    CartePro.state.worker = null;
    await CartePro.handleShot(blob);
    await new Promise(r => setTimeout(r, 300));
    return { form:!document.getElementById("formWrap").hidden,
             toast:(document.getElementById("toast").textContent || ""),
             n:(await CartePro.dbAll()).length };
  });
  r.ok("formulaire vierge proposé", fb.form);
  r.ok("message d'erreur explicite", /impossible/i.test(fb.toast), fb.toast);
  r.ok("aucune fiche vide enregistrée", fb.n === 0, fb.n);

  r.ok("aucune erreur JS", errs.length === 0, errs);
  await b.close(); srv.close();
  process.exit(r.end());
})().catch(e => { console.error(e); process.exit(2); });
