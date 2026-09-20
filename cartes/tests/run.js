/* Lance toutes les suites de test de CartePro les unes après les autres. */
const { spawnSync } = require("child_process");
const path = require("path");
let code = 0;
for(const f of ["app.test.js", "ocr.test.js"]){
  console.log("\n────────── " + f + " ──────────");
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio:"inherit" });
  code = code || r.status || 0;
}
process.exit(code);
