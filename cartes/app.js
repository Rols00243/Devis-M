"use strict";
/* =========================================================================
   CartePro — scanner de cartes de visite (PWA, 100 % client)
   Pipeline : photo → pré-traitement canvas → OCR (Tesseract.js) → analyse
   du texte → fiche contact → enregistrement dans le répertoire (IndexedDB)
   → export vCard vers le carnet d'adresses du téléphone.
   ========================================================================= */

/* ---------- Constantes ---------- */
const TESS_VER = "5.1.1";
const TESS_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VER}/dist/tesseract.min.js`;
const TESS_CORE = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1";
const TESS_LANG = "https://tessdata.projectnaptha.com/4.0.0";
const MAX_W = 1600;            // largeur max envoyée à l'OCR
const AVA = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#ec4899","#84cc16"];

const TEL_TYPES = [["mobile","Mobile"],["work","Bureau"],["home","Domicile"],["fax","Fax"],["other","Autre"]];
const MAIL_TYPES = [["work","Pro"],["home","Perso"],["other","Autre"]];

/* Mots-clés d'analyse (cartes francophones + anglophones) */
const FORMES = /\b(SARL|SARLU|SAS|SASU|EURL|SCI|SCOP|SNC|SPRL|S\.?A\.?R\.?L|S\.?A\.?S|S\.?A\b|GIE|GmbH|AG|Ltd|LLC|Inc|Corp|Co\.|BV|NV|Srl|Sté|Societe|Société|Groupe|Group|Entreprise|Etablissements|Ets|Cabinet|Agence|Bureau d'études|BTP|Holding|Consulting|Services|Immobilier|Construction|Travaux)\b/i;
const FONCTIONS = /\b(directeur|directrice|dirigeant|gérant|gerant|g[ée]rante|pr[ée]sident|pdg|dg|fondateur|fondatrice|co-?fondateur|chef de|chef d'|responsable|resp\.|charg[ée]|ing[ée]nieur|architecte|technicien|conducteur de travaux|m[ée]treur|[ée]conomiste|dessinateur|projeteur|commercial|attach[ée]|consultant|manager|assistant|secr[ée]taire|comptable|juriste|avocat|notaire|m[ée]decin|docteur|expert|g[ée]om[èe]tre|artisan|ma[çc]on|[ée]lectricien|plombier|peintre|chargé d'affaires|business|sales|marketing|head of|chief|officer|CEO|CTO|CFO|COO|CIO|founder|director|engineer|developer|d[ée]veloppeur)\b/i;
const VOIES = /\b(rue|avenue|av\.|bd|boulevard|impasse|chemin|route|rte|all[ée]e|place|quai|square|villa|r[ée]sidence|lotissement|zone|z\.?i\.?|z\.?a\.?|parc|immeuble|b[âa]timent|b[âa]t\.?|[ée]tage|bp|b\.p\.|cs\s?\d|lot|km|cit[ée]|quartier|carrefour|angle)\b/i;
const CIVILITE = /^(m\.|mr\.?|mme|mlle|dr\.?|me\.?|ing\.?|prof\.?)\s+/i;
const BRUIT = /\b(siret|siren|rcs|tva|n°\s?tva|ape|naf|capital|iban|bic|swift|r\.?c\.?s|registre|num[ée]ro|www|http|@|t[ée]l|tel|fax|mob|port|gsm|e-?mail|courriel|adresse|contact)\b/i;

/* ---------- Réglages ---------- */
const DEF_SET = { lang:"fra+eng", cc:"+33", autoSave:true, toPhone:true, keepPhoto:true };
let settings = { ...DEF_SET };

function loadSettings(){
  try{ const raw = localStorage.getItem("cartepro.set"); if(raw) settings = { ...DEF_SET, ...JSON.parse(raw) }; }
  catch(e){ /* stockage indisponible : on garde les valeurs par défaut */ }
}
function saveSettings(){
  try{ localStorage.setItem("cartepro.set", JSON.stringify(settings)); }catch(e){}
}

/* ---------- Utilitaires ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");

let toastT = null;
function toast(msg, ms){
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2600);
}

function fullName(c){
  const n = [c.prenom, c.nom].filter(Boolean).join(" ").trim();
  return n || c.societe || "Sans nom";
}
function initials(c){
  const n = fullName(c).split(/\s+/).filter(Boolean);
  return ((n[0]||"?")[0] + (n[1]? n[1][0] : "")).toUpperCase();
}
function avaColor(c){
  let h = 0; const s = c.id || fullName(c);
  for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return AVA[h % AVA.length];
}

/* ---------- Base de données (IndexedDB) ---------- */
const DB_NAME = "cartepro", DB_VER = 1, STORE = "contacts";
let _db = null;

function db(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if(!d.objectStoreNames.contains(STORE)){
        const st = d.createObjectStore(STORE, { keyPath:"id" });
        st.createIndex("createdAt", "createdAt");
      }
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}
function tx(mode){ return db().then(d => d.transaction(STORE, mode).objectStore(STORE)); }
function dbPut(c){ return tx("readwrite").then(st => new Promise((res,rej)=>{ const r=st.put(c); r.onsuccess=()=>res(c); r.onerror=()=>rej(r.error); })); }
function dbGet(id){ return tx("readonly").then(st => new Promise((res,rej)=>{ const r=st.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function dbDel(id){ return tx("readwrite").then(st => new Promise((res,rej)=>{ const r=st.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); })); }
function dbAll(){ return tx("readonly").then(st => new Promise((res,rej)=>{ const r=st.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); })); }
function dbClear(){ return tx("readwrite").then(st => new Promise((res,rej)=>{ const r=st.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); })); }

/* ---------- État applicatif ---------- */
const state = {
  screen: "scScan",
  shotBlob: null,     // photo d'origine (Blob)
  shotURL: null,      // URL d'aperçu
  rotation: 0,        // rotation appliquée avant OCR (0/90/180/270)
  raw: "",            // texte OCR brut
  current: null,      // fiche en cours d'édition
  contacts: [],       // cache du répertoire
  stream: null,       // flux caméra
  facing: "environment",
  worker: null,       // worker Tesseract
  workerLang: "",
  busy: false
};

/* ---------- Navigation ---------- */
function show(screen){
  state.screen = screen;
  $$(".screen").forEach(s => s.classList.toggle("on", s.id === screen));
  $$(".tab").forEach(t => t.classList.toggle("on", t.dataset.screen === screen));
  $("#main").scrollTop = 0;
  if(screen === "scRep") renderList();
}
$$(".tab").forEach(t => t.addEventListener("click", () => {
  // Revenir sur l'onglet Scanner après une fiche déjà enregistrée → nouvel écran de scan
  if(t.dataset.screen === "scScan" && !state.busy && !$("#formWrap").hidden
     && !$("#savedFlag").classList.contains("off")) resetScan();
  show(t.dataset.screen);
}));

/* =========================================================================
   1. CAPTURE DE LA CARTE
   ========================================================================= */

/* Entrées fichier (compatibles tous mobiles : ouvre l'appareil photo natif) */
$("#btnCam").addEventListener("click", () => {
  if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) openCamera();
  else $("#fileCam").click();
});
$("#btnGal").addEventListener("click", () => $("#fileGal").click());
$("#fileCam").addEventListener("change", e => { const f = e.target.files[0]; e.target.value=""; if(f) handleShot(f); });
$("#fileGal").addEventListener("change", e => { const f = e.target.files[0]; e.target.value=""; if(f) handleShot(f); });

/* Caméra live */
async function openCamera(){
  try{
    state.stream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ ideal: state.facing }, width:{ ideal:1920 }, height:{ ideal:1080 } }, audio:false
    });
  }catch(err){
    // Permission refusée ou pas de caméra → on retombe sur l'appareil photo natif
    $("#fileCam").click(); return;
  }
  const v = $("#video");
  v.srcObject = state.stream;
  $("#camWrap").hidden = false;
  try{ await v.play(); }catch(e){}
}
function closeCamera(){
  if(state.stream){ state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  $("#video").srcObject = null;
  $("#camWrap").hidden = true;
}
$("#btnCamClose").addEventListener("click", closeCamera);
$("#btnCamSwap").addEventListener("click", async () => {
  state.facing = state.facing === "environment" ? "user" : "environment";
  closeCamera(); openCamera();
});
$("#btnShot").addEventListener("click", () => {
  const v = $("#video");
  if(!v.videoWidth){ toast("Caméra non prête"); return; }
  const c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  c.toBlob(b => { closeCamera(); handleShot(b); }, "image/jpeg", 0.92);
});

/* Démarre le traitement d'une photo */
async function handleShot(blob){
  state.shotBlob = blob;
  state.rotation = 0;
  if(state.shotURL) URL.revokeObjectURL(state.shotURL);
  state.shotURL = URL.createObjectURL(blob);
  $("#shotImg").src = state.shotURL;
  $("#heroScan").hidden = true;
  $("#formWrap").hidden = true;
  $("#work").hidden = false;
  show("scScan");
  await runOCR();
}

$("#btnRotate").addEventListener("click", async () => {
  if(state.busy) return;
  state.rotation = (state.rotation + 90) % 360;
  $("#shotImg").style.transform = `rotate(${state.rotation}deg)`;
  await runOCR();
});
$("#btnRetry").addEventListener("click", () => { if(!state.busy) runOCR(); });
$("#btnCancelScan").addEventListener("click", resetScan);
$("#btnNext").addEventListener("click", resetScan);
$("#btnManual").addEventListener("click", () => {
  state.shotBlob = null; state.raw = "";
  state.current = emptyContact();
  $("#heroScan").hidden = true; $("#work").hidden = true;
  fillForm(state.current); $("#formWrap").hidden = false;
  $("#savedFlag").classList.add("off");
});

function resetScan(){
  $("#work").hidden = true;
  $("#formWrap").hidden = true;
  $("#heroScan").hidden = false;
  $("#shotImg").style.transform = "";
  state.current = null; state.raw = ""; state.shotBlob = null;
  show("scScan");
}

/* =========================================================================
   2. PRÉ-TRAITEMENT DE L'IMAGE (améliore nettement l'OCR)
   ========================================================================= */
function loadBitmap(blob){
  if(window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = URL.createObjectURL(blob);
  });
}

async function preprocess(blob, rotation){
  const bmp = await loadBitmap(blob);
  const bw = bmp.width, bh = bmp.height;
  const swap = rotation === 90 || rotation === 270;
  const scale = Math.min(1, MAX_W / (swap ? bh : bw));
  const w = Math.round((swap ? bh : bw) * scale), h = Math.round((swap ? bw : bh) * scale);

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently:true });
  x.save();
  x.translate(w/2, h/2);
  x.rotate(rotation * Math.PI / 180);
  x.drawImage(bmp, -bw*scale/2, -bh*scale/2, bw*scale, bh*scale);
  x.restore();
  if(bmp.close) bmp.close();

  // Niveaux de gris + étirement de contraste (percentiles 5 / 95)
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const hist = new Uint32Array(256);
  for(let i=0;i<d.length;i+=4){
    const g = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114) | 0;
    d[i] = d[i+1] = d[i+2] = g; hist[g]++;
  }
  const total = w*h;
  let lo = 0, hi = 255, acc = 0;
  for(let i=0;i<256;i++){ acc += hist[i]; if(acc > total*0.05){ lo = i; break; } }
  acc = 0;
  for(let i=255;i>=0;i--){ acc += hist[i]; if(acc > total*0.05){ hi = i; break; } }
  if(hi - lo < 25){ lo = 0; hi = 255; }
  const k = 255 / (hi - lo);
  for(let i=0;i<d.length;i+=4){
    let v = (d[i] - lo) * k;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i+1] = d[i+2] = v;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/* =========================================================================
   3. OCR (Tesseract.js, chargé à la demande)
   ========================================================================= */
function loadScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error("Chargement impossible : " + src));
    document.head.appendChild(s);
  });
}

const PROG_FR = {
  "loading tesseract core":"Chargement du moteur…",
  "initializing tesseract":"Initialisation…",
  "loading language traineddata":"Téléchargement des données de langue…",
  "initializing api":"Préparation…",
  "recognizing text":"Lecture de la carte…"
};
function prog(pct, txt){
  $("#progBar").style.width = Math.max(0, Math.min(100, pct)) + "%";
  $("#progTxt").textContent = txt;
}

async function getWorker(){
  if(state.worker && state.workerLang === settings.lang) return state.worker;
  if(state.worker){ try{ await state.worker.terminate(); }catch(e){} state.worker = null; }
  if(!window.Tesseract) await loadScript(TESS_URL);
  const langs = settings.lang.split("+");
  state.worker = await Tesseract.createWorker(langs, 1, {
    corePath: TESS_CORE,
    langPath: TESS_LANG,
    logger: m => {
      const label = PROG_FR[m.status] || "Analyse…";
      prog((m.progress || 0) * 100, label);
    }
  });
  state.workerLang = settings.lang;
  return state.worker;
}

async function runOCR(){
  if(!state.shotBlob) return;
  state.busy = true;
  $("#prog").hidden = false;
  prog(4, "Préparation de l'image…");
  try{
    const canvas = await preprocess(state.shotBlob, state.rotation);
    const worker = await getWorker();
    prog(30, "Lecture de la carte…");
    const { data } = await worker.recognize(canvas);
    state.raw = cleanOCR(data.text || "");
    prog(100, "Terminé");
    const parsed = parseCard(state.raw);
    parsed.photo = settings.keepPhoto ? state.shotBlob : null;
    parsed.raw = state.raw;
    await onParsed(parsed);
  }catch(err){
    console.error(err);
    prog(0, "Échec de la lecture");
    const offline = !navigator.onLine;
    toast(offline
      ? "Lecture impossible hors connexion (moteur OCR non téléchargé). Saisie manuelle."
      : "Lecture impossible : " + (err.message || err), 5000);
    const c = emptyContact();
    c.photo = settings.keepPhoto ? state.shotBlob : null;
    await onParsed(c);
  }finally{
    state.busy = false;
  }
}

/* Corrige les confusions fréquentes de l'OCR */
function cleanOCR(t){
  return t
    .replace(/\r/g, "")
    .replace(/[|¦]/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/ /g, " ")
    .replace(/(\S)\s?[(©@]\s?(\w+\.\w)/g, "$1@$2")   // « nom © societe.fr » → « nom@societe.fr »
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map(l => l.replace(/\s{2,}/g, " ").trim()).join("\n")
    .trim();
}

/* =========================================================================
   4. ANALYSE DU TEXTE → CHAMPS DE LA FICHE
   ========================================================================= */
const RE_MAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const TLD = "com|net|org|fr|be|ch|ca|lu|eu|io|dev|app|biz|info|pro|tech|shop|online|site|store|agency|ci|sn|ma|dz|tn|cm|bj|tg|bf|ml|ne|ga|cd|cg|mg|mu|rw|ke|ng|za|uk|de|es|it|pt|nl|us|co";
const RE_SITE = new RegExp("\\b((?:https?:\\/\\/)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:" + TLD + ")(?:\\/[^\\s,;]*)?)", "gi");
const RE_TEL = /(?:\+|00)?\d[\d\s.\-()\/]{6,}\d/g;
const RE_CP = /\b(\d{5})\b\s*[,–-]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\- ]{1,40})?/;
const PAYS = /\b(france|belgique|suisse|luxembourg|canada|maroc|alg[ée]rie|tunisie|s[ée]n[ée]gal|c[ôo]te d['’ ]?ivoire|cameroun|b[ée]nin|togo|burkina|mali|niger|gabon|congo|madagascar|espagne|italie|portugal|allemagne|belgium|switzerland|germany|spain|italy|usa|united states)\b/i;
const NO_TEL = /\b(siret|siren|rcs|tva|iban|bic|swift|capital|ape|naf)\b/i;

function emptyContact(){
  const now = Date.now();
  return { id:uid(), prenom:"", nom:"", societe:"", fonction:"", tels:[], emails:[], sites:[],
           rue:"", cp:"", ville:"", pays:"", notes:"", tags:[], raw:"", photo:null,
           createdAt:now, updatedAt:now };
}

/* Numéro → format international normalisé */
function normPhone(s, cc){
  let d = String(s).replace(/[^\d+]/g, "");
  if(d.startsWith("00")) d = "+" + d.slice(2);
  if(!d.startsWith("+")){
    const digits = d.replace(/\D/g, "");
    const code = (cc || settings.cc || "").replace(/[^\d+]/g, "");
    if(code && digits.startsWith("0")) d = (code.startsWith("+") ? code : "+" + code) + digits.slice(1);
    else d = digits;
  }
  return d;
}
/* Indicatifs pays à 1 et 2 chiffres (les autres en comptent 3) */
const CC1 = ["1","7"];
const CC2 = ["20","27","30","31","32","33","34","36","39","40","41","43","44","45","46","47","48","49",
             "51","52","53","54","55","56","57","58","60","61","62","63","64","65","66","81","82","84",
             "86","90","91","92","93","94","95","98"];
function ccLen(digits){
  const own = String(settings.cc || "").replace(/\D/g, "");
  if(own && digits.startsWith(own)) return own.length;
  if(CC2.indexOf(digits.slice(0,2)) > -1) return 2;
  if(CC1.indexOf(digits.slice(0,1)) > -1) return 1;
  return 3;
}
/* Affichage lisible : +33 6 12 34 56 78 */
function prettyPhone(s){
  const d = normPhone(s);
  if(!d.startsWith("+")) return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  const digits = d.slice(1);
  const n = ccLen(digits);
  const cc = digits.slice(0, n), rest = digits.slice(n);
  const head = rest.length % 2 ? rest.slice(0, 1) : "";
  const body = rest.slice(head.length).replace(/(\d{2})(?=\d)/g, "$1 ");
  return ("+" + cc + " " + head + " " + body).replace(/\s+/g, " ").trim();
}
function telDigits(s){ return normPhone(s).replace(/\D/g, ""); }

function telType(prefix, line, value){
  const ctx = (prefix || "") + " " + (line || "");
  if(/fax/i.test(prefix)) return "fax";
  if(/\b(mob|port|gsm|cell|cel)/i.test(prefix)) return "mobile";
  if(/\b(t[ée]l|tel|phone|bureau|office|std|standard|fixe|dir)/i.test(prefix)) return "work";
  if(/fax/i.test(ctx) && !/t[ée]l|mob|port|gsm/i.test(ctx)) return "fax";
  const d = normPhone(value);
  if(/^\+33[67]/.test(d) || /^\+21[026][67]/.test(d) || /^0[67]\d{8}$/.test(d)) return "mobile";
  if(/\b(mob|port|gsm|cell)/i.test(ctx)) return "mobile";
  return "work";
}

/* Analyse principale d'une carte de visite */
function parseCard(text){
  const c = emptyContact();
  const lines = String(text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const used = new Set();   // index des lignes déjà exploitées

  /* --- E-mails --- */
  lines.forEach((l, i) => {
    const found = l.match(RE_MAIL);
    if(found){
      found.forEach(m => {
        const v = m.toLowerCase().replace(/[.,;:]$/, "");
        if(!c.emails.some(e => e.value === v))
          c.emails.push({ type: /perso|priv|home|gmail|yahoo|hotmail|outlook/i.test(l + v) ? "home" : "work", value: v });
      });
      used.add(i);
    }
  });

  /* --- Sites web (après retrait des e-mails) --- */
  lines.forEach((l, i) => {
    const clean = l.replace(RE_MAIL, " ");
    const found = clean.match(RE_SITE);
    if(found){
      found.forEach(m => {
        let v = m.replace(/[.,;:]$/, "");
        if(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) && c.emails.some(e => e.value.endsWith("@" + v.toLowerCase().replace(/^www\./,"")))
           && !/^www\./i.test(v) && !/^https?:/i.test(v) && !/\//.test(v)){
          return; // simple domaine d'e-mail déjà capté
        }
        const url = /^https?:\/\//i.test(v) ? v : "https://" + v;
        if(!c.sites.includes(url)) c.sites.push(url);
      });
      if(!/@/.test(l)) used.add(i);
    }
  });

  /* --- Téléphones --- */
  lines.forEach((l, i) => {
    if(NO_TEL.test(l)) return;
    const clean = l.replace(RE_MAIL, " ").replace(RE_SITE, " ");
    let m, last = 0, hit = false;
    RE_TEL.lastIndex = 0;
    while((m = RE_TEL.exec(clean)) !== null){
      const digits = m[0].replace(/\D/g, "");
      if(digits.length < 8 || digits.length > 15) continue;
      const prefix = clean.slice(last, m.index);
      last = m.index + m[0].length;
      const value = prettyPhone(m[0]);
      const key = telDigits(m[0]);
      if(!c.tels.some(t => telDigits(t.value) === key)){
        c.tels.push({ type: telType(prefix, clean, m[0]), value });
      }
      hit = true;
    }
    if(hit) used.add(i);
  });

  /* --- Adresse --- */
  lines.forEach((l, i) => {
    if(used.has(i)) return;
    const cp = l.match(RE_CP);
    const voie = VOIES.test(l);
    if(cp){
      c.cp = cp[1];
      const ville = (cp[2] || "").trim().replace(/[,;.]$/, "");
      if(ville) c.ville = ville;
      const before = l.slice(0, cp.index).trim().replace(/[,;-]$/, "");
      if(before && VOIES.test(before) && !c.rue) c.rue = before;
      used.add(i);
    }else if(voie && !c.rue && /\d|\b(rue|avenue|boulevard|chemin|route|impasse|all[ée]e|place|quai|bp|lot|zone)\b/i.test(l)){
      c.rue = l.replace(/[,;]$/, "");
      used.add(i);
    }
    if(!c.pays){
      const p = l.match(PAYS);
      if(p && !used.has(i)){ c.pays = p[0].replace(/^\w/, ch => ch.toUpperCase()); used.add(i); }
      else if(p) c.pays = p[0].replace(/^\w/, ch => ch.toUpperCase());
    }
  });

  /* --- Indices tirés de l'adresse e-mail (prénom.nom@…) --- */
  const mailTokens = [];
  if(c.emails.length){
    const local = c.emails[0].value.split("@")[0];
    local.split(/[._\-+0-9]+/).filter(t => t.length > 1).forEach(t => mailTokens.push(norm(t)));
  }

  /* --- Nom de la personne --- */
  const rest = lines.map((l, i) => ({ l, i })).filter(o => !used.has(o.i));
  let best = null;
  rest.forEach(o => {
    const l = o.l.replace(/[,;:]+$/, "");
    const words = l.replace(CIVILITE, "").split(/\s+/).filter(Boolean);
    const letters = (l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const digits = (l.match(/\d/g) || []).length;
    if(!letters || digits > 1 || words.length > 4 || words.length < 1) return;
    if(l.length > 42) return;
    if(BRUIT.test(l)) return;
    let s = 0;
    if(CIVILITE.test(o.l)) s += 4;
    if(words.length === 2) s += 3; else if(words.length === 3) s += 2;
    const caps = words.filter(w => /^[A-ZÀ-Ÿ][a-zà-ÿ'’\-]+$/.test(w) || /^[A-ZÀ-Ÿ.'’\-]{2,}$/.test(w)).length;
    s += caps >= words.length ? 2 : 0;
    const hit = words.filter(w => mailTokens.includes(norm(w))).length;
    s += hit * 4;
    if(FORMES.test(l)) s -= 5;
    if(FONCTIONS.test(l)) s -= 4;
    if(VOIES.test(l)) s -= 3;
    s += Math.max(0, 3 - o.i);             // en haut de la carte : plus probable
    if(s > 0 && (!best || s > best.s)) best = { s, l, i:o.i, words };
  });
  if(best){
    used.add(best.i);
    let w = best.l.replace(CIVILITE, "").split(/\s+/).filter(Boolean);
    let prenom = "", nom = "";
    const allCaps = w.filter(x => /^[A-ZÀ-Ÿ'’\-]{2,}$/.test(x));
    if(allCaps.length && allCaps.length < w.length){
      nom = allCaps.join(" ");
      prenom = w.filter(x => !allCaps.includes(x)).join(" ");
    }else if(w.length >= 2){
      prenom = w[0]; nom = w.slice(1).join(" ");
    }else{
      prenom = w[0] || "";
    }
    // L'adresse e-mail tranche l'ordre prénom / nom (ex. nom.prenom@…)
    if(mailTokens.length >= 2 && prenom && nom){
      const ip = mailTokens.indexOf(norm(prenom)), iN = mailTokens.indexOf(norm(nom.split(" ")[0]));
      if(ip > -1 && iN > -1 && iN < ip){ const t = prenom; prenom = nom; nom = t; }
    }
    c.prenom = tidyName(prenom); c.nom = tidyName(nom);
  }

  /* --- Société --- */
  let soc = rest.find(o => !used.has(o.i) && FORMES.test(o.l) && !VOIES.test(o.l));
  if(!soc){
    soc = rest.filter(o => !used.has(o.i) && !FONCTIONS.test(o.l) && !VOIES.test(o.l) && !BRUIT.test(o.l))
              .map(o => {
                const L = (o.l.match(/[A-ZÀ-Ÿ]/g) || []).length, tot = (o.l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
                return { o, r: tot ? L / tot : 0 };
              })
              .filter(x => x.r > 0.6 && x.o.l.length >= 3)
              .sort((a,b) => b.r - a.r || a.o.i - b.o.i)
              .map(x => x.o)[0];
  }
  if(soc){ c.societe = tidyCompany(soc.l); used.add(soc.i); }
  else if(c.sites.length || c.emails.length){
    const host = (c.sites[0] || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
              || (c.emails[0] || {}).value.split("@")[1] || "";
    const base = host.split(".")[0];
    if(base && !/gmail|yahoo|hotmail|outlook|orange|free|wanadoo|laposte|icloud|live|msn/i.test(base))
      c.societe = base.charAt(0).toUpperCase() + base.slice(1);
  }

  /* --- Fonction --- */
  const fn = rest.find(o => !used.has(o.i) && FONCTIONS.test(o.l) && o.l.length < 60);
  if(fn){
    const txt = fn.l.replace(/[,;:]+$/, "");
    // On ne reformate que les intitulés tout en majuscules : « Conducteur de travaux » reste tel quel
    c.fonction = txt === txt.toUpperCase() ? tidyName(txt) : txt;
    used.add(fn.i);
  }

  /* --- Reste → notes --- */
  const notes = rest.filter(o => !used.has(o.i)).map(o => o.l)
                    .filter(l => l.length > 2 && !/^[^A-Za-zÀ-ÿ0-9]+$/.test(l));
  if(notes.length) c.notes = notes.join("\n");

  return c;
}

/* Remet en forme « JEAN dupont » → « Jean Dupont » (mots de liaison en minuscules) */
const PETITS_MOTS = ["de","du","des","le","la","les","d'","l'","et","en","à","au","aux","of","and","the","for"];
function tidyName(s){
  return String(s || "").trim().split(/\s+/).map((w, i) => {
    if(/^[A-ZÀ-Ÿ]\.$/.test(w)) return w;
    if(i > 0 && PETITS_MOTS.indexOf(w.toLowerCase()) > -1) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + (w.length > 3 && w === w.toUpperCase() ? w.slice(1).toLowerCase() : w.slice(1));
  }).join(" ");
}
function tidyCompany(s){
  const t = String(s || "").trim().replace(/[,;:]+$/, "");
  if(t === t.toUpperCase() && t.length > 5 && /\s/.test(t))
    return t.split(/\s+/).map(w => w.length > 4 ? w.charAt(0) + w.slice(1).toLowerCase() : w).join(" ");
  return t;
}

/* =========================================================================
   5. FORMULAIRE DE LA FICHE
   ========================================================================= */
function rowHTML(kind, type, value){
  const opts = kind === "tel" ? TEL_TYPES : MAIL_TYPES;
  const sel = kind === "site" ? "" :
    `<select data-k="type">${opts.map(([v,l]) => `<option value="${v}"${v===type?" selected":""}>${l}</option>`).join("")}</select>`;
  const ph = kind === "tel" ? "+33 6 12 34 56 78" : kind === "email" ? "nom@societe.fr" : "https://…";
  const im = kind === "tel" ? "tel" : kind === "email" ? "email" : "url";
  return `<div class="row">${sel}<input data-k="value" inputmode="${im}" placeholder="${ph}" value="${esc(value)}">
          <button class="del" type="button" aria-label="Supprimer">✕</button></div>`;
}
function renderMulti(){
  const c = state.current || emptyContact();
  $("#listTel").innerHTML = (c.tels.length ? c.tels : [{type:"mobile",value:""}]).map(t => rowHTML("tel", t.type, t.value)).join("");
  $("#listEmail").innerHTML = (c.emails.length ? c.emails : [{type:"work",value:""}]).map(e => rowHTML("email", e.type, e.value)).join("");
  $("#listSite").innerHTML = (c.sites.length ? c.sites : [""]).map(s => rowHTML("site", "", s)).join("");
}
$$(".addbtn").forEach(b => b.addEventListener("click", () => {
  const kind = b.dataset.add;
  const box = kind === "tel" ? $("#listTel") : kind === "email" ? $("#listEmail") : $("#listSite");
  box.insertAdjacentHTML("beforeend", rowHTML(kind, kind === "tel" ? "mobile" : "work", ""));
}));
["#listTel","#listEmail","#listSite"].forEach(sel => $(sel).addEventListener("click", e => {
  if(e.target.classList.contains("del")) e.target.closest(".row").remove();
}));

function readMulti(sel, withType){
  return $$(sel + " .row").map(r => {
    const value = r.querySelector('[data-k="value"]').value.trim();
    if(!value) return null;
    if(!withType) return value;
    const t = r.querySelector('[data-k="type"]');
    return { type: t ? t.value : "work", value };
  }).filter(Boolean);
}

function fillForm(c){
  const shot = $("#formShot"), url = state.shotURL;
  if(url && state.shotBlob){ $("#formShotImg").src = url; shot.hidden = false; }
  else shot.hidden = true;
  $("#fPrenom").value = c.prenom || "";
  $("#fNom").value = c.nom || "";
  $("#fSociete").value = c.societe || "";
  $("#fFonction").value = c.fonction || "";
  $("#fRue").value = c.rue || "";
  $("#fCp").value = c.cp || "";
  $("#fVille").value = c.ville || "";
  $("#fPays").value = c.pays || "";
  $("#fNotes").value = c.notes || "";
  $("#fTags").value = (c.tags || []).join(", ");
  $("#fRaw").textContent = c.raw || "(pas de texte OCR)";
  renderMulti();
}
function readForm(){
  const c = state.current || emptyContact();
  c.prenom = $("#fPrenom").value.trim();
  c.nom = $("#fNom").value.trim();
  c.societe = $("#fSociete").value.trim();
  c.fonction = $("#fFonction").value.trim();
  c.rue = $("#fRue").value.trim();
  c.cp = $("#fCp").value.trim();
  c.ville = $("#fVille").value.trim();
  c.pays = $("#fPays").value.trim();
  c.notes = $("#fNotes").value.trim();
  c.tags = $("#fTags").value.split(",").map(t => t.trim()).filter(Boolean);
  c.tels = readMulti("#listTel", true).map(t => ({ type:t.type, value: prettyPhone(t.value) }));
  c.emails = readMulti("#listEmail", true).map(e => ({ type:e.type, value:e.value.toLowerCase() }));
  c.sites = readMulti("#listSite", false).map(s => /^https?:\/\//i.test(s) ? s : "https://" + s);
  c.updatedAt = Date.now();
  return c;
}

/* Fiche analysée → formulaire (+ enregistrement automatique) */
async function onParsed(c){
  state.current = c;
  fillForm(c);
  $("#work").hidden = true;
  $("#formWrap").hidden = false;
  $("#savedFlag").classList.add("off");
  if(settings.autoSave && (c.prenom || c.nom || c.societe || c.tels.length || c.emails.length)){
    await persist(true);
  }
}

/* Enregistre la fiche courante dans le répertoire */
async function persist(silent){
  const c = readForm();
  if(!c.prenom && !c.nom && !c.societe && !c.tels.length && !c.emails.length){
    if(!silent) toast("Fiche vide : renseignez au moins un nom ou un contact");
    return null;
  }
  const dup = await findDuplicate(c);
  if(dup && dup.id !== c.id){
    const ok = silent ? true : confirm(`« ${fullName(dup)} » existe déjà dans le répertoire.\nMettre à jour cette fiche ?`);
    if(ok){ mergeInto(dup, c); state.current = dup; await dbPut(strip(dup)); await refresh();
      $("#savedFlag").textContent = "✔ Fiche existante mise à jour"; $("#savedFlag").classList.remove("off");
      if(!silent) toast("Contact mis à jour"); return dup; }
  }
  await dbPut(strip(c));
  await refresh();
  $("#savedFlag").textContent = "✔ Enregistré dans le répertoire";
  $("#savedFlag").classList.remove("off");
  if(!silent) toast("Contact enregistré");
  return c;
}
/* Copie sérialisable (le Blob photo est conservé tel quel par IndexedDB) */
function strip(c){ return Object.assign({}, c); }

async function findDuplicate(c){
  const all = state.contacts.length ? state.contacts : await dbAll();
  const mails = c.emails.map(e => e.value.toLowerCase());
  const tels = c.tels.map(t => telDigits(t.value));
  return all.find(o => o.id !== c.id && (
    (mails.length && (o.emails || []).some(e => mails.includes(e.value.toLowerCase()))) ||
    (tels.length && (o.tels || []).some(t => tels.includes(telDigits(t.value)))) ||
    (c.nom && c.prenom && norm(o.nom) === norm(c.nom) && norm(o.prenom) === norm(c.prenom))
  ));
}
function mergeInto(dst, src){
  ["prenom","nom","societe","fonction","rue","cp","ville","pays"].forEach(k => { if(src[k]) dst[k] = src[k]; });
  const key = t => telDigits(t.value);
  (src.tels || []).forEach(t => { if(!(dst.tels||[]).some(x => key(x) === key(t))) (dst.tels = dst.tels || []).push(t); });
  (src.emails || []).forEach(e => { if(!(dst.emails||[]).some(x => x.value.toLowerCase() === e.value.toLowerCase())) (dst.emails = dst.emails || []).push(e); });
  (src.sites || []).forEach(s => { if(!(dst.sites||[]).includes(s)) (dst.sites = dst.sites || []).push(s); });
  (src.tags || []).forEach(t => { if(!(dst.tags||[]).includes(t)) (dst.tags = dst.tags || []).push(t); });
  if(src.notes && src.notes !== dst.notes) dst.notes = [dst.notes, src.notes].filter(Boolean).join("\n");
  if(src.photo) dst.photo = src.photo;
  if(src.raw) dst.raw = src.raw;
  dst.updatedAt = Date.now();
  return dst;
}

$("#btnSaveForm").addEventListener("click", () => persist(false));
$("#btnPhone").addEventListener("click", async () => {
  const c = await persist(true);
  if(c) toPhonebook([c]);
});

/* =========================================================================
   6. RÉPERTOIRE
   ========================================================================= */
async function refresh(){ state.contacts = await dbAll(); if(state.screen === "scRep") renderList(); }

function matches(c, q){
  if(!q) return true;
  const hay = norm([fullName(c), c.societe, c.fonction, c.ville, (c.tags||[]).join(" "),
                    (c.emails||[]).map(e=>e.value).join(" "),
                    (c.tels||[]).map(t=>t.value + " " + telDigits(t.value)).join(" ")].join(" "));
  return norm(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function renderList(){
  const q = $("#q").value.trim();
  $("#btnClearQ").hidden = !q;
  const sort = $("#sortSel").value;
  let list = state.contacts.filter(c => matches(c, q));
  list.sort((a,b) =>
    sort === "nom" ? norm(fullName(a)).localeCompare(norm(fullName(b))) :
    sort === "societe" ? norm(a.societe||"zzz").localeCompare(norm(b.societe||"zzz")) :
    (b.createdAt||0) - (a.createdAt||0));

  $("#repCount").textContent = `${list.length} contact${list.length > 1 ? "s" : ""}` +
    (q && state.contacts.length !== list.length ? ` sur ${state.contacts.length}` : "");
  $("#emptyRep").style.display = state.contacts.length ? "none" : "block";
  $("#repList").innerHTML = list.map(c => {
    const sub = [c.fonction, c.societe].filter(Boolean).join(" · ") ||
                (c.tels[0] ? c.tels[0].value : (c.emails[0] ? c.emails[0].value : ""));
    const tags = (c.tags || []).map(t => `<i class="tag">${esc(t)}</i>`).join("");
    return `<button class="item" data-id="${c.id}">
      <span class="ava" style="background:${avaColor(c)}">${esc(initials(c))}</span>
      <span class="it"><b>${esc(fullName(c))}</b><span>${esc(sub)}</span>
      ${tags ? `<span class="tagline">${tags}</span>` : ""}</span></button>`;
  }).join("");
}
$("#repList").addEventListener("click", e => {
  const b = e.target.closest(".item");
  if(b) openSheet(b.dataset.id);
});
$("#q").addEventListener("input", renderList);
$("#sortSel").addEventListener("change", renderList);
$("#btnClearQ").addEventListener("click", () => { $("#q").value = ""; renderList(); });
$("#btnGoScan").addEventListener("click", () => show("scScan"));

/* ---------- Fiche plein écran ---------- */
let sheetId = null, sheetURL = null;
async function openSheet(id){
  const c = await dbGet(id);
  if(!c) return;
  sheetId = id;
  $("#sheetTitle").textContent = fullName(c);
  const dl = [];
  (c.tels || []).forEach(t => dl.push(`<div class="dl"><span>${esc((TEL_TYPES.find(x=>x[0]===t.type)||["","Tél"])[1])}</span>
      <a href="tel:${esc(normPhone(t.value))}">${esc(t.value)}</a></div>`));
  (c.emails || []).forEach(e => dl.push(`<div class="dl"><span>E-mail</span><a href="mailto:${esc(e.value)}">${esc(e.value)}</a></div>`));
  (c.sites || []).forEach(s => dl.push(`<div class="dl"><span>Site</span><a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\//,""))}</a></div>`));
  const adr = [c.rue, [c.cp, c.ville].filter(Boolean).join(" "), c.pays].filter(Boolean).join(", ");
  if(adr) dl.push(`<div class="dl"><span>Adresse</span><a href="https://maps.google.com/?q=${encodeURIComponent(adr)}" target="_blank" rel="noopener">${esc(adr)}</a></div>`);
  if(c.notes) dl.push(`<div class="dl"><span>Notes</span><div>${esc(c.notes).replace(/\n/g,"<br>")}</div></div>`);
  if((c.tags||[]).length) dl.push(`<div class="dl"><span>Étiquettes</span><div>${c.tags.map(t=>`<i class="tag">${esc(t)}</i>`).join(" ")}</div></div>`);
  dl.push(`<div class="dl"><span>Ajouté le</span><div>${new Date(c.createdAt).toLocaleString("fr-FR")}</div></div>`);

  const tel = (c.tels[0] || {}).value, mail = (c.emails[0] || {}).value;
  if(sheetURL){ URL.revokeObjectURL(sheetURL); sheetURL = null; }
  let shot = "";
  if(c.photo){ sheetURL = URL.createObjectURL(c.photo); shot = `<div class="cardShot"><img src="${sheetURL}" alt="Carte de visite"></div>`; }

  $("#sheetBody").innerHTML = `
    <div class="fiche">
      <div class="ava" style="background:${avaColor(c)}">${esc(initials(c))}</div>
      <h2>${esc(fullName(c))}</h2>
      <p>${esc([c.fonction, c.societe].filter(Boolean).join(" · "))}</p>
    </div>
    <div class="acts">
      ${tel ? `<a class="act" href="tel:${esc(normPhone(tel))}"><b>📞</b>Appeler</a>
               <a class="act" href="sms:${esc(normPhone(tel))}"><b>💬</b>SMS</a>` : ""}
      ${mail ? `<a class="act" href="mailto:${esc(mail)}"><b>✉️</b>E-mail</a>` : ""}
      <button class="act" id="btnSheetPhone"><b>📇</b>Au téléphone</button>
      <button class="act" id="btnSheetShare"><b>🔗</b>Partager</button>
    </div>
    ${dl.join("")}
    ${shot}`;
  $("#sheet").hidden = false;
  $("#btnSheetPhone").addEventListener("click", () => toPhonebook([c]));
  $("#btnSheetShare").addEventListener("click", () => shareContact(c));
}
function closeSheet(){
  $("#sheet").hidden = true;
  if(sheetURL){ URL.revokeObjectURL(sheetURL); sheetURL = null; }
  sheetId = null;
}
$("#btnSheetClose").addEventListener("click", closeSheet);
$("#btnSheetDel").addEventListener("click", async () => {
  if(!sheetId) return;
  const c = await dbGet(sheetId);
  if(confirm(`Supprimer « ${fullName(c)} » du répertoire ?`)){
    await dbDel(sheetId); closeSheet(); await refresh(); toast("Contact supprimé");
  }
});
$("#btnSheetEdit").addEventListener("click", async () => {
  const c = await dbGet(sheetId);
  if(!c) return;
  closeSheet();
  state.current = c; state.shotBlob = null;
  $("#heroScan").hidden = true; $("#work").hidden = true;
  fillForm(c); $("#formWrap").hidden = false;
  $("#savedFlag").classList.add("off");
  show("scScan");
});

/* =========================================================================
   7. vCARD — envoi vers le carnet d'adresses du téléphone
   ========================================================================= */
const VC_TEL = { mobile:"CELL", work:"WORK,VOICE", home:"HOME,VOICE", fax:"WORK,FAX", other:"VOICE" };
const VC_MAIL = { work:"INTERNET,WORK", home:"INTERNET,HOME", other:"INTERNET" };

function vEsc(s){ return String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\;").replace(/,/g,"\\,").replace(/\n/g,"\\n"); }
/* Repli des lignes à 75 caractères (RFC 2426) */
function fold(l){
  if(l.length <= 75) return l;
  let out = l.slice(0, 75), r = l.slice(75);
  while(r.length > 74){ out += "\r\n " + r.slice(0, 74); r = r.slice(74); }
  return out + (r ? "\r\n " + r : "");
}
function vcard(c){
  const L = ["BEGIN:VCARD", "VERSION:3.0"];
  L.push(`N:${vEsc(c.nom)};${vEsc(c.prenom)};;;`);
  L.push(`FN:${vEsc(fullName(c))}`);
  if(c.societe) L.push(`ORG:${vEsc(c.societe)}`);
  if(c.fonction) L.push(`TITLE:${vEsc(c.fonction)}`);
  (c.tels || []).forEach(t => L.push(`TEL;TYPE=${VC_TEL[t.type] || "VOICE"}:${vEsc(normPhone(t.value))}`));
  (c.emails || []).forEach(e => L.push(`EMAIL;TYPE=${VC_MAIL[e.type] || "INTERNET"}:${vEsc(e.value)}`));
  (c.sites || []).forEach(s => L.push(`URL:${vEsc(s)}`));
  if(c.rue || c.cp || c.ville || c.pays)
    L.push(`ADR;TYPE=WORK:;;${vEsc(c.rue)};${vEsc(c.ville)};;${vEsc(c.cp)};${vEsc(c.pays)}`);
  if(c.notes) L.push(`NOTE:${vEsc(c.notes)}`);
  if((c.tags || []).length) L.push(`CATEGORIES:${c.tags.map(vEsc).join(",")}`);
  L.push(`REV:${new Date(c.updatedAt || Date.now()).toISOString().replace(/\.\d+Z$/, "Z")}`);
  L.push("END:VCARD");
  return L.map(fold).join("\r\n") + "\r\n";
}

function download(name, text, mime){
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* Ouvre la fiche dans l'app Contacts (partage natif) ou télécharge le .vcf */
async function toPhonebook(list){
  const text = list.map(vcard).join("");
  const name = list.length === 1
    ? (fullName(list[0]).replace(/[^\w\- ]+/g, "_") + ".vcf")
    : `repertoire-${new Date().toISOString().slice(0,10)}.vcf`;
  const file = new File([text], name, { type: "text/vcard" });
  if(navigator.canShare && navigator.canShare({ files:[file] })){
    try{
      await navigator.share({ files:[file], title: list.length === 1 ? fullName(list[0]) : "Répertoire CartePro" });
      return;
    }catch(err){ if(err && err.name === "AbortError") return; }
  }
  download(name, text, "text/vcard;charset=utf-8");
  toast("Fichier .vcf créé — ouvrez-le pour l'ajouter à vos contacts", 4200);
}
async function shareContact(c){
  const txt = [fullName(c), c.fonction, c.societe,
               ...(c.tels||[]).map(t => t.value), ...(c.emails||[]).map(e => e.value),
               ...(c.sites||[])].filter(Boolean).join("\n");
  if(navigator.share){
    try{ await navigator.share({ title: fullName(c), text: txt }); return; }catch(err){ if(err.name === "AbortError") return; }
  }
  try{ await navigator.clipboard.writeText(txt); toast("Coordonnées copiées"); }
  catch(e){ toPhonebook([c]); }
}

/* ---------- Export / import du répertoire ---------- */
async function exportVcf(){
  const all = await dbAll();
  if(!all.length){ toast("Répertoire vide"); return; }
  toPhonebook(all);
}
async function exportCsv(){
  const all = await dbAll();
  if(!all.length){ toast("Répertoire vide"); return; }
  const head = ["Prénom","Nom","Société","Fonction","Téléphones","E-mails","Sites","Rue","CP","Ville","Pays","Étiquettes","Notes","Ajouté le"];
  const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const rows = all.map(c => [
    c.prenom, c.nom, c.societe, c.fonction,
    (c.tels||[]).map(t => t.value).join(" / "),
    (c.emails||[]).map(e => e.value).join(" / "),
    (c.sites||[]).join(" / "),
    c.rue, c.cp, c.ville, c.pays, (c.tags||[]).join(" / "), c.notes,
    new Date(c.createdAt).toLocaleString("fr-FR")
  ].map(q).join(";"));
  download(`repertoire-${new Date().toISOString().slice(0,10)}.csv`,
           "\ufeff" + [head.map(q).join(";"), ...rows].join("\r\n"), "text/csv;charset=utf-8");
}

/* Import d'un fichier .vcf (vCard 2.1 / 3.0 / 4.0, champs courants) */
function parseVcf(text){
  const out = [];
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  unfolded.split(/BEGIN:VCARD/i).slice(1).forEach(block => {
    const c = emptyContact();
    block.split("\n").forEach(line => {
      const i = line.indexOf(":");
      if(i < 0) return;
      const left = line.slice(0, i), val = line.slice(i + 1).trim();
      const prop = left.split(";")[0].toUpperCase().replace(/^ITEM\d+\./, "");
      const params = left.toUpperCase();
      const un = s => s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
      if(prop === "N"){ const p = val.split(";"); c.nom = un(p[0] || ""); c.prenom = un(p[1] || ""); }
      else if(prop === "FN" && !c.nom && !c.prenom){ const p = un(val).split(" "); c.prenom = p[0] || ""; c.nom = p.slice(1).join(" "); }
      else if(prop === "ORG") c.societe = un(val.split(";")[0]);
      else if(prop === "TITLE") c.fonction = un(val);
      else if(prop === "TEL") c.tels.push({ type: /CELL|MOBILE/.test(params) ? "mobile" : /FAX/.test(params) ? "fax" : /HOME/.test(params) ? "home" : "work", value: prettyPhone(val) });
      else if(prop === "EMAIL") c.emails.push({ type: /HOME/.test(params) ? "home" : "work", value: val.toLowerCase() });
      else if(prop === "URL") c.sites.push(/^https?:/i.test(val) ? val : "https://" + val);
      else if(prop === "ADR"){ const p = val.split(";").map(un); c.rue = p[2] || ""; c.ville = p[3] || ""; c.cp = p[5] || ""; c.pays = p[6] || ""; }
      else if(prop === "NOTE") c.notes = un(val);
      else if(prop === "CATEGORIES") c.tags = un(val).split(",").map(s => s.trim()).filter(Boolean);
    });
    if(c.prenom || c.nom || c.societe || c.tels.length || c.emails.length) out.push(c);
  });
  return out;
}
$("#btnImportVcf").addEventListener("click", () => $("#fileVcf").click());
$("#fileVcf").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if(!f) return;
  const list = parseVcf(await f.text());
  let n = 0;
  for(const c of list){
    const dup = await findDuplicate(c);
    if(dup){ mergeInto(dup, c); await dbPut(strip(dup)); }
    else { await dbPut(strip(c)); n++; }
    state.contacts = await dbAll();
  }
  await refresh();
  toast(`${list.length} fiche(s) lue(s), ${n} ajoutée(s)`);
});

$("#btnExport").addEventListener("click", exportVcf);
$("#btnExport2").addEventListener("click", exportVcf);
$("#btnExportCsv").addEventListener("click", exportCsv);
$("#btnWipe").addEventListener("click", async () => {
  if(confirm("Supprimer TOUS les contacts du répertoire ? Cette action est irréversible.")){
    await dbClear(); await refresh(); toast("Répertoire vidé");
  }
});

/* =========================================================================
   8. RÉGLAGES, AIDE, DÉMARRAGE
   ========================================================================= */
function bindSettings(){
  $("#setLang").value = settings.lang;
  $("#setCc").value = settings.cc;
  $("#setAuto").checked = settings.autoSave;
  $("#setPhone").checked = settings.toPhone;
  $("#setPhoto").checked = settings.keepPhoto;
  $("#setLang").addEventListener("change", e => { settings.lang = e.target.value; saveSettings(); });
  $("#setCc").addEventListener("change", e => { settings.cc = e.target.value.trim() || "+33"; saveSettings(); });
  $("#setAuto").addEventListener("change", e => { settings.autoSave = e.target.checked; saveSettings(); });
  $("#setPhone").addEventListener("change", e => { settings.toPhone = e.target.checked; saveSettings(); });
  $("#setPhoto").addEventListener("change", e => { settings.keepPhoto = e.target.checked; saveSettings(); });
}
async function showUsage(){
  if(!navigator.storage || !navigator.storage.estimate) return;
  try{
    const { usage } = await navigator.storage.estimate();
    $("#usage").textContent = `Espace utilisé par le répertoire : ${(usage/1048576).toFixed(1)} Mo.`;
  }catch(e){}
}
$("#btnHelp").addEventListener("click", () => {
  alert("CartePro — mode d'emploi\n\n"
      + "1. « Prendre une photo » : cadrez la carte bien à plat, sans ombre.\n"
      + "2. Le texte est lu automatiquement et la fiche est enregistrée dans le répertoire.\n"
      + "3. Corrigez si besoin, puis « Ajouter au téléphone » pour l'envoyer dans le carnet d'adresses.\n\n"
      + "Astuce : si la lecture est mauvaise, utilisez « Pivoter » puis « Relancer la lecture ».\n"
      + "Tout reste sur votre appareil : aucune photo n'est envoyée sur un serveur.");
});

/* Le formulaire est enregistré automatiquement quand on quitte l'écran */
window.addEventListener("beforeunload", () => { if(state.stream) closeCamera(); });

async function init(){
  loadSettings();
  bindSettings();
  await refresh();
  showUsage();
  if(!window.isSecureContext && location.protocol !== "file:")
    $("#tipOffline").textContent = "⚠ La caméra nécessite une connexion HTTPS.";
  // Service worker (mode hors-ligne) — indisponible en file://
  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    try{ await navigator.serviceWorker.register("sw.js"); }catch(e){}
  }
}
init();

/* Points d'entrée pour les tests automatisés (Playwright) */
window.CartePro = { parseCard, vcard, parseVcf, normPhone, prettyPhone, telType, state, settings,
                    dbAll, dbPut, dbClear, emptyContact, fullName, refresh, handleShot, preprocess, runOCR };
