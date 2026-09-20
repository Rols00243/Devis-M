/* Utilitaires de test : petit serveur statique + lancement de Chromium (Playwright) */
const http = require("http"), fs = require("fs"), path = require("path");

const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png",
               ".svg":"image/svg+xml", ".webmanifest":"application/manifest+json", ".json":"application/json" };

function serve(root, port){
  const srv = http.createServer((rq, rs) => {
    const rel = decodeURIComponent(rq.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(root, rel);
    fs.readFile(file, (err, data) => {
      if(err){ rs.writeHead(404); rs.end("not found"); return; }
      rs.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      rs.end(data);
    });
  });
  return new Promise(res => srv.listen(port, () => res(srv)));
}

function playwright(){
  try{ return require("playwright"); }
  catch(e){ return require("/opt/node22/lib/node_modules/playwright"); }
}

async function browser(){
  const { chromium } = playwright();
  const opts = { args:["--no-sandbox"] };
  try{ return await chromium.launch(opts); }
  catch(e){
    // Chromium pré-installé de l'environnement (variable PLAYWRIGHT_BROWSERS_PATH)
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    const dir = fs.readdirSync(base).find(d => /^chromium-\d+$/.test(d));
    return chromium.launch({ ...opts, executablePath: path.join(base, dir, "chrome-linux", "chrome") });
  }
}

/* Mini-harnais d'assertions */
function reporter(){
  const r = { pass:0, fail:0 };
  r.ok = (name, cond, detail) => {
    if(cond){ r.pass++; console.log("  ✔ " + name); }
    else { r.fail++; console.log("  ✘ " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
  };
  r.title = t => console.log("\n" + t);
  r.end = () => {
    console.log(`\n=== ${r.pass} réussis, ${r.fail} échoués ===`);
    return r.fail ? 1 : 0;
  };
  return r;
}

module.exports = { serve, browser, reporter };
