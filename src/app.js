"use strict";
if(window.pdfjsLib){ pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; }

/* ---------- Constantes ---------- */
const PALETTE=["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#ec4899","#84cc16"];
const UNIT_LABEL={ml:"ml",m2:"m²",m3:"m³",u:"u",kg:"kg"};
const STEEL_MASS={6:0.222,8:0.395,10:0.617,12:0.888,14:1.208,16:1.578,20:2.466,25:3.854,32:6.313};
const DIAS=[6,8,10,12,14,16,20,25,32];
const ST_LABEL={semelle:"Semelle",longrine:"Longrine",radier:"Radier",poteau:"Poteau",poutre:"Poutre",dalle:"Dalle",voile:"Voile"};
const ST_SHORT={semelle:"S",longrine:"LG",radier:"RAD",poteau:"P",poutre:"PT",dalle:"DL",voile:"V"};
const TYPE_PHASE={semelle:"fondation",longrine:"fondation",radier:"fondation",poteau:"elevation",poutre:"elevation",dalle:"elevation",voile:"elevation"};
const DIMLABELS={semelle:["Longueur (m)","Largeur (m)","Épaisseur (m)"],longrine:["Longueur (m)","Largeur (m)","Hauteur (m)"],radier:["Longueur (m)","Largeur (m)","Épaisseur (m)"],poteau:["Section a (m)","Section b (m)","Hauteur (m)"],poutre:["Longueur (m)","Largeur (m)","Hauteur (m)"],dalle:["Longueur (m)","Largeur (m)","Épaisseur (m)"],voile:["Longueur (m)","Épaisseur (m)","Hauteur (m)"]};
const PHASES=[{id:"fondation",label:"Fondations",types:["semelle","longrine","radier"]},{id:"elevation",label:"Élévation",types:["poteau","poutre","dalle","voile"]},{id:"second",label:"Second œuvre",types:[]}];
const PHASE_LABEL={fondation:"Fondations",elevation:"Élévation",second:"Second œuvre"};
let _seq=0; function id(){ return "x"+(_seq++).toString(36)+Math.floor(performance.now()).toString(36); }

/* ---------- État ---------- */
const state={
  img:null,imgW:0,imgH:0,zoom:1,offX:0,offY:0,pxPerMeter:null,
  tool:"select",draft:[],shapes:[],calibPts:null,pendingPt:null,autoEntities:[],
  phase:"fondation",activeType:"semelle",quickMode:false,
  modalMode:"create",editingId:null,editingStdId:null,
  library:[
    {id:"BETON",name:"Béton armé (fourni/coulé)",unit:"m3",price:160,coef:0.02,color:"#64748b",height:0,
      comp:[{mat:"Ciment",unit:"kg",q:350},{mat:"Sable",unit:"m³",q:0.42},{mat:"Gravier",unit:"m³",q:0.83},{mat:"Eau",unit:"L",q:175}]},
    {id:"ACIER",name:"Acier HA (façonné/posé)",unit:"kg",price:1.6,coef:0.08,color:"#f97316",height:0,
      comp:[{mat:"Acier HA (barres)",unit:"kg",q:1},{mat:"Fil de ligature",unit:"kg",q:0.015}]},
    {id:id(),name:"Cloison placo 72mm",unit:"m2",price:38,coef:0.10,color:PALETTE[0],height:2.5,
      comp:[{mat:"Plaque de plâtre BA13",unit:"m²",q:2.1},{mat:"Ossature métallique",unit:"ml",q:2.4},{mat:"Laine minérale",unit:"m²",q:1},{mat:"Vis",unit:"u",q:25}]},
    {id:id(),name:"Peinture murs",unit:"m2",price:26,coef:0.08,color:PALETTE[1],height:2.5,
      comp:[{mat:"Peinture",unit:"L",q:0.25},{mat:"Sous-couche",unit:"L",q:0.12}]},
    {id:id(),name:"Plinthe",unit:"ml",price:9.5,coef:0.05,color:PALETTE[2],height:0,
      comp:[{mat:"Plinthe (fourniture)",unit:"ml",q:1.05},{mat:"Colle / fixation",unit:"u",q:0.1}]},
    {id:id(),name:"Point électrique",unit:"u",price:65,coef:0,color:PALETTE[3],height:0,
      comp:[{mat:"Boîtier électrique",unit:"u",q:1},{mat:"Câble électrique",unit:"ml",q:8},{mat:"Appareillage",unit:"u",q:1}]},
  ],
  matPrices:{"Ciment":0.12,"Sable":18,"Gravier":22,"Eau":0.002,"Acier HA (barres)":1.5,"Fil de ligature":2,"Plaque de plâtre BA13":4,"Ossature métallique":2.5,"Laine minérale":5,"Vis":0.02,"Peinture":6,"Sous-couche":4,"Plinthe (fourniture)":3,"Colle / fixation":1,"Boîtier électrique":1.5,"Câble électrique":0.8,"Appareillage":8},
  dockView:"ouvrages",
  activeOuvrage:null,tva:0.10,currency:{code:"EUR",sym:"€",pos:"after"},
  defaults:{
    semelle:{L:1.5,l:1.5,H:0.4,nb:1,barN:6,barDia:12,barLen:1.4,stirDia:8,stirSp:0},
    longrine:{L:4,l:0.2,H:0.4,nb:1,barN:4,barDia:12,barLen:4.2,stirDia:8,stirSp:0.2},
    radier:{L:5,l:4,H:0.25,nb:1,barN:0,barDia:12,barLen:0,stirDia:8,stirSp:0},
    poteau:{L:0.25,l:0.25,H:3,nb:1,barN:4,barDia:12,barLen:3.2,stirDia:8,stirSp:0.2},
    poutre:{L:4,l:0.2,H:0.4,nb:1,barN:4,barDia:12,barLen:4.2,stirDia:8,stirSp:0.2},
    dalle:{L:5,l:4,H:0.2,nb:1,barN:0,barDia:12,barLen:0,stirDia:8,stirSp:0},
    voile:{L:4,l:0.2,H:3,nb:1,barN:0,barDia:12,barLen:0,stirDia:8,stirSp:0},
  }
};
state.activeOuvrage=state.library[2].id;

/* ---------- Canvas ---------- */
const stage=document.getElementById("stage");
const planC=document.getElementById("plan"),planX=planC.getContext("2d");
const ovC=document.getElementById("overlay"),ovX=ovC.getContext("2d");
function resize(){ const r=stage.getBoundingClientRect(); [planC,ovC].forEach(c=>{c.width=r.width;c.height=r.height;}); render(); }
window.addEventListener("resize",resize);
function fitView(){ if(!state.img)return; const r=stage.getBoundingClientRect(); const z=Math.min(r.width/state.imgW,r.height/state.imgH)*0.92;
  state.zoom=z; state.offX=(r.width-state.imgW*z)/2; state.offY=(r.height-state.imgH*z)/2; render(); }
function toScreen(p){ return {x:p.x*state.zoom+state.offX,y:p.y*state.zoom+state.offY}; }
function toImg(sx,sy){ return {x:(sx-state.offX)/state.zoom,y:(sy-state.offY)/state.zoom}; }

/* ---------- Géométrie ---------- */
function segLenPx(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function polyLenPx(pts){ let s=0; for(let i=1;i<pts.length;i++)s+=segLenPx(pts[i-1],pts[i]); return s; }
function areaPx(pts){ let s=0; for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=a.x*b.y-b.x*a.y;} return Math.abs(s)/2; }
function px2m(px){ return state.pxPerMeter? px/state.pxPerMeter:0; }
function libById(i){ return state.library.find(o=>o.id===i); }
function rawStd(sh){ const ov=libById(sh.ouvrageId); if(!ov)return 0;
  if(ov.unit==="u")return sh.points.length;
  if(ov.unit==="ml")return px2m(polyLenPx(sh.points));
  if(ov.unit==="m2")return Math.pow(px2m(1),2)*areaPx(sh.points);
  if(ov.unit==="m3")return Math.pow(px2m(1),2)*areaPx(sh.points)*(sh.height||ov.height||0);
  return 0; }
function qtyStd(sh){ const ov=libById(sh.ouvrageId); if(!ov)return 0;
  if(sh.manualQty!=null&&sh.manualQty!==""&&!isNaN(sh.manualQty))return +sh.manualQty;
  return rawStd(sh)*(1+(ov.coef||0)); }

/* ---------- Calcul structure ---------- */
function computeStruct(s){
  const vol=(s.L||0)*(s.l||0)*(s.H||0)*(s.nb||1);
  const mainLen=(s.barN||0)*(s.barLen||0)*(s.nb||1);
  const steelMain=mainLen*(STEEL_MASS[s.barDia]||0);
  let stirCount=0,stirLen=0,steelStir=0;
  if(s.stirSp>0){
    let princ,per;
    if(s.type==="poteau"){ princ=s.H; per=2*((s.L||0)+(s.l||0)); }
    else if(s.type==="poutre"||s.type==="longrine"){ princ=s.L; per=2*((s.l||0)+(s.H||0)); }
    else { princ=Math.max(s.L||0,s.l||0); per=2*((s.L||0)+(s.l||0)); }
    stirCount=(Math.floor((princ||0)/s.stirSp)+1)*(s.nb||1); stirLen=per; steelStir=stirCount*stirLen*(STEEL_MASS[s.stirDia]||0);
  }
  return {vol,steel:steelMain+steelStir,mainLen,stirCount,stirLen};
}
function structDimText(s){
  if(s.type==="poteau")return `sect. ${nf(s.L)}×${nf(s.l)} m · H ${nf(s.H)} m · ${s.nb}×`;
  if(s.type==="dalle"||s.type==="radier")return `${nf(s.L)}×${nf(s.l)} m · ép ${nf(s.H)} m · ${s.nb}×`;
  if(s.type==="voile")return `L ${nf(s.L)} · ép ${nf(s.l)} · H ${nf(s.H)} m · ${s.nb}×`;
  return `${nf(s.L)}×${nf(s.l)}×${nf(s.H)} m · ${s.nb}×`;
}
function structSteelText(s,c){ let t=(s.barN>0)?`${s.barN}×HA${s.barDia} L=${nf(s.barLen)}m`:"—";
  if(s.stirSp>0)t+=` · cadres HA${s.stirDia}/${nf(s.stirSp)}m (${c.stirCount})`; return t; }

/* ---------- Lignes tableau ---------- */
function tableRows(){ const rows=[];
  state.shapes.forEach(sh=>{
    if(sh.kind==="struct"){
      const s=sh.struct,c=computeStruct(s),beton=libById("BETON"),acier=libById("ACIER"),ph=TYPE_PHASE[s.type];
      const vq=c.vol*(1+(beton?beton.coef:0)),sq=c.steel*(1+(acier?acier.coef:0));
      rows.push({gid:sh.id,phase:ph,first:true,cls:"beton",struct:true,desig:s.tag+" — Béton "+ST_LABEL[s.type].toLowerCase(),typ:"Béton",details:structDimText(s),qty:vq,unit:"m3",pu:beton?beton.price:0,total:vq*(beton?beton.price:0)});
      rows.push({gid:sh.id,phase:ph,first:false,cls:"acier",struct:true,desig:s.tag+" — Acier HA",typ:"Acier",details:structSteelText(s,c),qty:sq,unit:"kg",pu:acier?acier.price:0,total:sq*(acier?acier.price:0)});
    } else {
      const ov=libById(sh.ouvrageId); if(!ov)return; const q=qtyStd(sh);
      rows.push({gid:sh.id,phase:sh.phase||"second",first:true,cls:"std",struct:false,desig:ov.name,typ:UNIT_LABEL[ov.unit],details:stdDetails(sh,ov),qty:q,unit:ov.unit,pu:ov.price,total:q*ov.price});
    }
  }); return rows;
}
function stdDetails(sh,ov){ if(sh.manualQty!=null&&sh.manualQty!=="") return sh.src||"saisie manuelle";
  if(ov.unit==="ml")return "L = "+nf(px2m(polyLenPx(sh.points)))+" m";
  if(ov.unit==="m2")return "S = "+nf(Math.pow(px2m(1),2)*areaPx(sh.points))+" m²";
  if(ov.unit==="m3")return "S="+nf(Math.pow(px2m(1),2)*areaPx(sh.points))+" m² × h="+nf(sh.height||ov.height)+" m";
  if(ov.unit==="u")return sh.points.length+" élément(s)"; return ""; }

/* ---------- Rendu ---------- */
function render(){ planX.clearRect(0,0,planC.width,planC.height);
  if(state.img){ planX.imageSmoothingQuality="high"; planX.drawImage(state.img,state.offX,state.offY,state.imgW*state.zoom,state.imgH*state.zoom); }
  ovX.clearRect(0,0,ovC.width,ovC.height);
  state.shapes.forEach(sh=> sh.kind==="struct"? drawStruct(sh):drawStd(sh));
  if(state.draft.length)drawDraft(); if(state.calibPts)drawCalib(); }
function drawStd(sh){ if(!sh.points.length)return; const ov=libById(sh.ouvrageId); const col=ov?ov.color:"#3b82f6"; const pts=sh.points.map(toScreen);
  ovX.lineWidth=2; ovX.strokeStyle=col; ovX.fillStyle=hexA(col,.18);
  if(ov&&ov.unit==="u"){ pts.forEach(p=>dot(p,col)); if(pts[0])labelAt(pts[0],ov.name+" ("+sh.points.length+")",col); return; }
  ovX.beginPath(); pts.forEach((p,i)=> i?ovX.lineTo(p.x,p.y):ovX.moveTo(p.x,p.y));
  const closed=ov&&(ov.unit==="m2"||ov.unit==="m3"); if(closed){ovX.closePath();ovX.fill();} ovX.stroke(); pts.forEach(p=>dot(p,col));
  labelAt(centroid(pts),(ov?ov.name:"?")+"  "+nf(qtyStd(sh))+" "+(ov?UNIT_LABEL[ov.unit]:""),col); }
function drawStruct(sh){ const p=toScreen(sh.points[0]);
  ovX.save(); ovX.translate(p.x,p.y); ovX.rotate(Math.PI/4);
  ovX.fillStyle="rgba(249,115,22,.85)"; ovX.strokeStyle="#0f1622"; ovX.lineWidth=2; ovX.fillRect(-8,-8,16,16); ovX.strokeRect(-8,-8,16,16); ovX.restore();
  labelAt({x:p.x,y:p.y-18},sh.struct.tag,"#f97316"); }
function drawDraft(){ const ov=libById(state.activeOuvrage); const col=ov?ov.color:"#3b82f6"; const pts=state.draft.map(toScreen);
  ovX.lineWidth=2; ovX.strokeStyle=col; ovX.setLineDash([6,4]); ovX.beginPath(); pts.forEach((p,i)=> i?ovX.lineTo(p.x,p.y):ovX.moveTo(p.x,p.y)); if(mouse)ovX.lineTo(mouse.x,mouse.y); ovX.stroke(); ovX.setLineDash([]); pts.forEach(p=>dot(p,col));
  if(state.tool!=="count"&&pts.length){ const live=[...state.draft]; if(mouseImg)live.push(mouseImg); let txt="";
    if(state.tool==="length")txt=nf(px2m(polyLenPx(live)))+" m"; else if(state.tool==="area"&&live.length>2)txt=nf(Math.pow(px2m(1),2)*areaPx(live))+" m²";
    if(txt)labelAt(mouse||pts[pts.length-1],txt,col); } }
function drawCalib(){ const a=toScreen(state.calibPts[0]); const b=state.calibPts[1]?toScreen(state.calibPts[1]):mouse; if(!b)return;
  ovX.strokeStyle="#22c55e"; ovX.lineWidth=2.5; ovX.setLineDash([4,3]); ovX.beginPath(); ovX.moveTo(a.x,a.y); ovX.lineTo(b.x,b.y); ovX.stroke(); ovX.setLineDash([]); dot(a,"#22c55e"); dot(b,"#22c55e"); }
function dot(p,c){ ovX.beginPath(); ovX.arc(p.x,p.y,4,0,7); ovX.fillStyle=c; ovX.fill(); ovX.lineWidth=1.5; ovX.strokeStyle="#0f1622"; ovX.stroke(); }
function labelAt(p,txt,col){ ovX.font="600 12px Segoe UI"; const w=ovX.measureText(txt).width; ovX.fillStyle="rgba(15,22,34,.9)"; roundRect(p.x-w/2-6,p.y-9,w+12,18,5); ovX.fill(); ovX.fillStyle="#fff"; ovX.textAlign="center"; ovX.textBaseline="middle"; ovX.fillText(txt,p.x,p.y); ovX.textAlign="start"; }
function roundRect(x,y,w,h,r){ ovX.beginPath(); ovX.moveTo(x+r,y); ovX.arcTo(x+w,y,x+w,y+h,r); ovX.arcTo(x+w,y+h,x,y+h,r); ovX.arcTo(x,y+h,x,y,r); ovX.arcTo(x,y,x+w,y,r); ovX.closePath(); }
function centroid(pts){ let x=0,y=0; pts.forEach(p=>{x+=p.x;y+=p.y;}); return {x:x/pts.length,y:y/pts.length}; }
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }

/* ---------- Interaction ---------- */
let mouse=null,mouseImg=null,panning=false,panStart=null;
ovC.addEventListener("mousemove",e=>{ const r=ovC.getBoundingClientRect(); mouse={x:e.clientX-r.left,y:e.clientY-r.top}; mouseImg=toImg(mouse.x,mouse.y);
  if(panning){ state.offX=panStart.ox+(e.clientX-panStart.x); state.offY=panStart.oy+(e.clientY-panStart.y); } if(state.draft.length||state.calibPts||panning)render(); });
ovC.addEventListener("mousedown",e=>{ const r=ovC.getBoundingClientRect(); const p=toImg(e.clientX-r.left,e.clientY-r.top);
  if(state.tool==="select"||e.button===1){ panning=true; panStart={x:e.clientX,y:e.clientY,ox:state.offX,oy:state.offY}; ovC.style.cursor="grabbing"; return; }
  if(!state.img)return;
  if(state.tool==="calib"){ if(!state.calibPts)state.calibPts=[p]; else {state.calibPts[1]=p; openScale();} render(); return; }
  if(state.tool==="struct"){ if(state.quickMode)placeQuick(p); else { state.pendingPt=p; openStruct("create"); } return; }
  if(state.pxPerMeter===null&&state.tool!=="count")flashHint("⚠️ Définissez d'abord l'échelle (📏)");
  if(state.tool==="count"){ addCountPoint(p); return; }
  state.draft.push(p); render(); });
window.addEventListener("mouseup",()=>{ if(panning){panning=false; ovC.style.cursor=state.tool==="select"?"grab":"crosshair";} });
ovC.addEventListener("dblclick",finishDraft);
window.addEventListener("keydown",e=>{ if(document.querySelector(".modal.show"))return;
  if(e.key==="Enter")finishDraft(); if(e.key==="Escape"){ state.draft=[]; state.calibPts=null; render(); }
  if((e.key==="z"&&(e.ctrlKey||e.metaKey))||e.key==="Backspace"){ if(state.draft.length)state.draft.pop(); else undoShape(); render(); } });
stage.addEventListener("wheel",e=>{ e.preventDefault(); if(!state.img)return; const r=stage.getBoundingClientRect(); const mx=e.clientX-r.left,my=e.clientY-r.top; const before=toImg(mx,my);
  const f=e.deltaY<0?1.12:1/1.12; state.zoom=Math.max(0.05,Math.min(20,state.zoom*f)); const after=toImg(mx,my); state.offX+=(after.x-before.x)*state.zoom; state.offY+=(after.y-before.y)*state.zoom; render(); },{passive:false});
function finishDraft(){ if(state.tool==="count"){state.draft=[];return;} const need=state.tool==="area"?3:2;
  if(state.draft.length>=need){ state.shapes.push({id:id(),kind:"std",phase:state.phase,ouvrageId:state.activeOuvrage,points:state.draft.slice(),height:(libById(state.activeOuvrage)||{}).height||0}); refreshAll(); }
  state.draft=[]; render(); }
function addCountPoint(p){ let sh=state.shapes.find(s=>s.kind==="std"&&s.ouvrageId===state.activeOuvrage&&libById(s.ouvrageId)?.unit==="u");
  if(!sh){ sh={id:id(),kind:"std",phase:state.phase,ouvrageId:state.activeOuvrage,points:[],height:0}; state.shapes.push(sh); } sh.points.push(p); refreshAll(); render(); }
function undoShape(){ if(state.shapes.length){ state.shapes.pop(); refreshAll(); } }
function placeQuick(pt){ const d=state.defaults[state.activeType]; const s=Object.assign({},d,{type:state.activeType});
  const n=state.shapes.filter(x=>x.kind==="struct"&&x.struct.type===s.type).length+1; s.tag=ST_SHORT[s.type]+n;
  state.shapes.push({id:id(),kind:"struct",points:[pt],struct:s}); refreshAll(); const c=computeStruct(s);
  flashHint("✅ "+s.tag+" placé : "+nf(c.vol)+" m³ béton, "+nf(c.steel)+" kg acier. (modifiable dans le tableau ✎)"); }

/* ---------- Outils ---------- */
document.querySelectorAll("[data-tool]").forEach(b=>b.addEventListener("click",()=>setTool(b.dataset.tool)));
function setTool(t){ state.tool=t; state.draft=[]; if(t!=="calib")state.calibPts=null;
  document.querySelectorAll("[data-tool]").forEach(x=>x.classList.toggle("active",x.dataset.tool===t)); ovC.style.cursor=t==="select"?"grab":"crosshair";
  if(t!=="struct")renderChips(); showHint(hintFor(t)); render(); }
function hintFor(t){ if(t==="struct"){ return state.quickMode? "Cliquez pour placer un "+ST_LABEL[state.activeType]+" (paramètres par défaut, ⚡).":"Cliquez pour placer un "+ST_LABEL[state.activeType]+" — le logiciel vous interroge sur ses dimensions et armatures."; }
  return {calib:"Cliquez deux points d'une distance connue.",length:"Cliquez pour tracer. Double-clic pour terminer.",area:"Cliquez les sommets. Double-clic pour fermer.",count:"Cliquez chaque élément à compter.",select:"Glissez pour déplacer. Molette pour zoomer."}[t]||""; }
function showHint(t){ const h=document.getElementById("hint"); if(!t){h.style.display="none";return;} h.style.display="block"; h.innerHTML="<b>"+t+"</b>"; }
let hintTimer=null; function flashHint(t){ const h=document.getElementById("hint"); h.style.display="block"; h.innerHTML=t; clearTimeout(hintTimer); hintTimer=setTimeout(()=>showHint(hintFor(state.tool)),3200); }

/* ---------- Étapes (phases) & chips ---------- */
document.querySelectorAll("[data-phase]").forEach(b=>b.onclick=()=>{ state.phase=b.dataset.phase;
  document.querySelectorAll("[data-phase]").forEach(x=>x.classList.toggle("on",x.dataset.phase===state.phase));
  const ph=PHASES.find(p=>p.id===state.phase); if(ph.types.length){ state.activeType=ph.types[0]; setTool("struct"); } else setTool("select"); renderChips(); });
function renderChips(){ const wrap=document.getElementById("typeChips"); const ph=PHASES.find(p=>p.id===state.phase);
  if(!ph.types.length){ wrap.innerHTML='<span class="chipnote">Utilisez les outils Longueur / Surface / Comptage en haut.</span>'; return; }
  wrap.innerHTML=ph.types.map(t=>`<button class="chip ${state.tool==="struct"&&state.activeType===t?"on":""}" data-type="${t}">${ST_LABEL[t]}</button>`).join("");
  wrap.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{ state.activeType=b.dataset.type; setTool("struct"); }); }
document.getElementById("quickToggle").onchange=e=>{ state.quickMode=e.target.checked; showHint(hintFor(state.tool));
  flashHint(state.quickMode?"⚡ Placement rapide : chaque clic pose un "+ST_LABEL[state.activeType]+" avec les paramètres par défaut.":"Placement normal : le logiciel vous interroge à chaque élément."); };
document.getElementById("btnDefaults").onclick=()=>openStruct("defaults");

/* ---------- Import ---------- */
const fileInput=document.getElementById("fileInput");
["btnImport","btnImport2"].forEach(i=>document.getElementById(i).addEventListener("click",()=>fileInput.click()));
document.getElementById("btnUndo").addEventListener("click",()=>{ if(state.draft.length)state.draft.pop(); else undoShape(); render(); });
fileInput.addEventListener("change",async e=>{ const f=e.target.files[0]; if(f)await routeFile(f); fileInput.value=""; });
const CAO_CONVERT={dwg:"DWG (AutoCAD)",dgn:"DGN (MicroStation)",ifc:"IFC (BIM)",rvt:"RVT (Revit)",rfa:"RFA (Revit)",skp:"SKP (SketchUp)","3dm":"3DM (Rhino)",pln:"PLN (ArchiCAD)"};
async function routeFile(f){ const name=(f.name||"").toLowerCase(); const ext=name.split(".").pop();
  if(f.type==="application/pdf"||ext==="pdf"){ await loadPDF(f); return; }
  if(ext==="dxf"){ await loadDXFfile(f); return; }
  if(ext==="csv"||ext==="txt"){ await loadScheduleFile(f); return; }
  if(CAO_CONVERT[ext]){ caoHelp(ext); return; }
  if(f.type.startsWith("image/")||/(png|jpe?g|gif|webp|bmp|svg)$/.test(ext)){ await loadImage(URL.createObjectURL(f)); return; }
  flashHint("Format non reconnu. Acceptés : DXF, PDF, images (BMP/JPG/PNG), nomenclatures Revit (TXT/CSV). DWG à convertir en DXF/PDF."); }
function caoHelp(ext){
  if(ext==="rvt"||ext==="rfa"){ showHint("⚠️ Le format "+CAO_CONVERT[ext]+" ne se lit pas dans un navigateur. Dans Revit : ouvrez une <b>nomenclature</b> (murs, sols, poteaux…) puis <b>Fichier › Exporter › Rapports › Nomenclature</b> (.txt) et importez ce fichier ici. Pour le plan : exportez en <b>DXF</b> ou <b>PDF</b>."); return; }
  showHint("⚠️ Le format "+CAO_CONVERT[ext]+" est propriétaire et ne se lit pas dans un navigateur. Exportez-le en <b>DXF</b> ou <b>PDF</b> puis réimportez-le. Convertisseur DWG gratuit : ODA File Converter."); }
function loadImage(src){ return new Promise(res=>{ const im=new Image(); im.onload=()=>{ setImage(im,im.naturalWidth,im.naturalHeight); res(); }; im.src=src; }); }
async function loadPDF(file){ const buf=await file.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data:buf}).promise; const page=await pdf.getPage(1);
  const vp=page.getViewport({scale:2.2}); const c=document.createElement("canvas"); c.width=vp.width; c.height=vp.height;
  await page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise; const im=new Image(); im.onload=()=>setImage(im,c.width,c.height); im.src=c.toDataURL(); }
function setImage(im,w,h){ state.img=im; state.imgW=w; state.imgH=h; state.autoEntities=[]; document.getElementById("emptyState").style.display="none"; document.getElementById("zoombar").style.display="flex"; fitView(); setTool("calib"); }
function loadDXFfile(f){ return f.text().then(renderDXF).catch(()=>flashHint("Lecture du DXF impossible.")); }
function renderDXF(txt){ const lines=txt.split(/\r\n|\r|\n/),tokens=[]; let idx=0;
  while(idx+1<lines.length){ const code=parseInt(lines[idx].trim(),10); if(isNaN(code)){idx++;continue;} tokens.push({code,val:(lines[idx+1]||"").trim()}); idx+=2; }
  let metersPerUnit=0.001,unitKnown=false; const uMap={1:0.0254,2:0.3048,4:0.001,5:0.01,6:1,14:0.1};
  for(let i=0;i<tokens.length-1;i++){ if(tokens[i].code===9&&tokens[i].val==="$INSUNITS"){ for(let j=i+1;j<Math.min(i+4,tokens.length);j++){ if(tokens[j].code===70){ const u=parseInt(tokens[j].val,10); if(uMap[u]){metersPerUnit=uMap[u];unitKnown=true;} break; } } break; } }
  const groups=[]; let cur=null; for(const t of tokens){ if(t.code===0){ if(cur)groups.push(cur); cur={type:t.val,c:[]}; } else if(cur)cur.c.push(t); } if(cur)groups.push(cur);
  const getVal=(g,code)=>{ const t=g.c.find(x=>x.code===code); return t?parseFloat(t.val):undefined; }; const polys=[];
  for(let gi=0;gi<groups.length;gi++){ const g=groups[gi],T=g.type;
    if(T==="LINE"){ const x1=getVal(g,10),y1=getVal(g,20),x2=getVal(g,11),y2=getVal(g,21); if([x1,y1,x2,y2].every(v=>v!==undefined))polys.push({pts:[{x:x1,y:y1},{x:x2,y:y2}],closed:false}); }
    else if(T==="LWPOLYLINE"){ const pts=[]; let cxv=null; for(const t of g.c){ if(t.code===10)cxv=parseFloat(t.val); else if(t.code===20&&cxv!==null){pts.push({x:cxv,y:parseFloat(t.val)});cxv=null;} } if(pts.length)polys.push({pts,closed:((getVal(g,70)||0)&1)===1}); }
    else if(T==="POLYLINE"){ const pts=[]; let gj=gi+1; while(gj<groups.length&&groups[gj].type==="VERTEX"){ const vx=getVal(groups[gj],10),vy=getVal(groups[gj],20); if(vx!==undefined&&vy!==undefined)pts.push({x:vx,y:vy}); gj++; } if(pts.length)polys.push({pts,closed:((getVal(g,70)||0)&1)===1}); gi=gj-1; }
    else if(T==="CIRCLE"){ const cx=getVal(g,10),cy=getVal(g,20),r=getVal(g,40); if(cx!==undefined&&r){ const pts=[]; for(let a=0;a<=36;a++){const t=a/36*6.2832; pts.push({x:cx+r*Math.cos(t),y:cy+r*Math.sin(t)});} polys.push({pts,closed:true}); } }
    else if(T==="ARC"){ const cx=getVal(g,10),cy=getVal(g,20),r=getVal(g,40); let a0=getVal(g,50),a1=getVal(g,51); if(cx!==undefined&&r){ a0=a0||0; a1=(a1===undefined?360:a1); if(a1<a0)a1+=360; const st=Math.max(6,Math.round((a1-a0)/10)),pts=[]; for(let k=0;k<=st;k++){const t=(a0+(a1-a0)*k/st)*Math.PI/180; pts.push({x:cx+r*Math.cos(t),y:cy+r*Math.sin(t)});} polys.push({pts,closed:false}); } }
  }
  if(!polys.length){ flashHint("Aucune entité géométrique lisible dans ce DXF."); return; }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  polys.forEach(pl=>pl.pts.forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}));
  const w=(maxX-minX)||1,h=(maxY-minY)||1,TARGET=1500,scale=TARGET/Math.max(w,h),m=40; const cw=Math.round(w*scale+m*2),ch=Math.round(h*scale+m*2);
  const cv=document.createElement("canvas"); cv.width=cw; cv.height=ch; const cx=cv.getContext("2d"); cx.fillStyle="#fff"; cx.fillRect(0,0,cw,ch); cx.strokeStyle="#1f2937"; cx.lineWidth=1.4; cx.lineJoin="round";
  const TX=x=>(x-minX)*scale+m,TY=y=>(maxY-y)*scale+m;
  polys.forEach(pl=>{ cx.beginPath(); pl.pts.forEach((p,i)=> i?cx.lineTo(TX(p.x),TY(p.y)):cx.moveTo(TX(p.x),TY(p.y))); if(pl.closed)cx.closePath(); cx.stroke(); });
  const entities=polys.map(pl=>({closed:pl.closed,pts:pl.pts.map(p=>({x:TX(p.x),y:TY(p.y)}))}));
  const im=new Image(); im.onload=()=>{ state.img=im; state.imgW=cw; state.imgH=ch; state.pxPerMeter=scale/metersPerUnit; state.autoEntities=entities;
    document.getElementById("emptyState").style.display="none"; document.getElementById("zoombar").style.display="flex"; fitView(); updateScaleTag(); refreshAll(); setTool("area");
    showHint("✅ DXF importé — "+polys.length+" entités. "+(unitKnown?"Échelle détectée. ":"")+"Cliquez <b>🤖 Analyser le plan</b> pour extraire automatiquement les mesures."); };
  im.src=cv.toDataURL(); }

/* ---------- Import nomenclature Revit (TXT/CSV) ---------- */
// Revit : Fichier › Exporter › Rapports › Nomenclature → texte délimité (tabulation, guillemets).
// Chaque ligne devient une mesure sans géométrie (quantité imposée via manualQty).
const SCHED_COLS={
  famtype:/^(famille et type|family and type)$/, fam:/^(famille|family)$/, type:/^(type|type de famille|family type)$/,
  name:/^(nom|name|description|designation|ouvrage|element|article)$/, cat:/^(categorie|category)$/,
  mat:/(materiau|material)/, vol:/^volume/, area:/^(surface|aire|area)/, len:/^(longueur|length)/, count:/^(nombre|count|quantite|quantity|qte)/
};
function normTxt(s){ return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\(.*?\)/g,"").trim(); }
function splitDelim(txt,d){ const rows=[]; let row=[],cell="",q=false;
  for(let i=0;i<txt.length;i++){ const ch=txt[i];
    if(q){ if(ch==='"'){ if(txt[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=ch; continue; }
    if(ch==='"')q=true; else if(ch===d){row.push(cell);cell="";} else if(ch==="\n"||ch==="\r"){ if(ch==="\r"&&txt[i+1]==="\n")i++; row.push(cell); rows.push(row); row=[]; cell=""; } else cell+=ch; }
  if(cell!==""||row.length){ row.push(cell); rows.push(row); } return rows.map(r=>r.map(c=>c.trim())); }
function parseQty(v){ if(v==null)return null; let s=String(v).replace(/[\s  ]/g,""); if(!s)return null;
  const unitM=/mm$/.test(s)?0.001:/cm$/.test(s)?0.01:1; const m=s.match(/-?[\d.,]+/); if(!m)return null; let n=m[0];
  if(n.includes(",")&&n.includes(".")) n=n.lastIndexOf(",")>n.lastIndexOf(".")? n.replace(/\./g,"").replace(",","."):n.replace(/,/g,"");
  else if(n.includes(",")) n=n.replace(",","."); // Revit FR : virgule décimale
  const x=parseFloat(n); return isNaN(x)?null:x*unitM; }
function parseSchedule(txt){ txt=txt.replace(/^﻿/,"");
  const first=txt.split(/\r?\n/).slice(0,10).join("\n"); const d=["\t",";",","].map(c=>({c,n:first.split(c).length})).sort((a,b)=>b.n-a.n)[0].c;
  const rows=splitDelim(txt,d); let hi=-1,cols=null;
  for(let i=0;i<Math.min(rows.length,15)&&hi<0;i++){ const c={}; rows[i].forEach((h,j)=>{ const k=normTxt(h); for(const key in SCHED_COLS){ if(c[key]===undefined&&SCHED_COLS[key].test(k)){ c[key]=j; break; } } });
    const hasName=["famtype","fam","type","name","cat"].some(k=>c[k]!==undefined), hasQty=["vol","area","len","count"].some(k=>c[k]!==undefined);
    if(hasName&&hasQty){ hi=i; cols=c; } }
  if(hi<0)return null;
  const cell=(r,k)=>cols[k]!==undefined?(r[cols[k]]||""):""; const items=[];
  rows.slice(hi+1).forEach(r=>{ if(!r.some(c=>c))return;
    const fam=cell(r,"fam"),typ=cell(r,"type"); let desig=cell(r,"famtype")||(fam&&typ?(typ.includes(fam)?typ:fam+" : "+typ):(typ||fam))||cell(r,"name")||cell(r,"cat");
    if(!desig||/^(total|grand total|totaux)/i.test(normTxt(desig)))return;
    const vol=parseQty(cell(r,"vol")),area=parseQty(cell(r,"area")),len=parseQty(cell(r,"len")),cnt=parseQty(cell(r,"count"));
    let unit,q; if(vol){unit="m3";q=vol;} else if(area){unit="m2";q=area;} else if(len){unit="ml";q=len;} else {unit="u";q=cnt||1;}
    items.push({desig,unit,q,cat:cell(r,"cat"),mat:cell(r,"mat")}); });
  return items; }
function schedPhase(it){ const t=normTxt(it.cat+" "+it.desig);
  if(/(fondation|foundation|semelle|radier|longrine)/.test(t))return "fondation";
  if(/(poteau|column|ossature|framing|poutre|beam|voile|dalle|structur)/.test(t)||(it.unit==="m3"&&/(beton|concrete)/.test(normTxt(it.mat+" "+it.desig))))return "elevation";
  return "second"; }
function importSchedule(txt,fname){ const items=parseSchedule(txt);
  if(!items||!items.length){ flashHint("⚠️ Nomenclature non reconnue : il faut une colonne de désignation (Famille et type, Type…) et une colonne de quantité (Volume, Surface, Longueur ou Nombre)."); return 0; }
  const groups={}; items.forEach(it=>{ const k=it.desig+"|"+it.unit; if(!groups[k])groups[k]=Object.assign({},it,{q:0,n:0}); groups[k].q+=it.q; groups[k].n++; });
  let newOv=0; Object.values(groups).forEach(g=>{ const ph=schedPhase(g); let ov;
    if(g.unit==="m3"&&ph!=="second"&&/(beton|concrete|^$)/.test(normTxt(g.mat))) ov=libById("BETON");
    const typeOnly=normTxt(g.desig.split(" : ").pop());
    if(!ov) ov=state.library.find(o=>o.unit===g.unit&&[normTxt(g.desig),typeOnly].includes(normTxt(o.name)));
    if(!ov){ ov={id:id(),name:g.desig,unit:g.unit,price:0,coef:0,color:PALETTE[state.library.length%PALETTE.length],height:0}; state.library.push(ov); newOv++; }
    state.shapes.push({id:id(),kind:"std",phase:ph,ouvrageId:ov.id,points:[],height:0,manualQty:Math.round(g.q*1000)/1000,src:"Revit — "+(g.desig!==ov.name?g.desig+" · ":"")+g.n+" élément(s)"}); });
  document.getElementById("viewOuvrages").click(); refreshAll();
  flashHint("✅ Nomenclature Revit importée ("+esc(fname||"")+") : "+Object.keys(groups).length+" ligne(s) ajoutée(s)"+(newOv?", "+newOv+" nouvel(s) ouvrage(s) à chiffrer (prix = 0)":"")+".");
  return Object.keys(groups).length; }
function loadScheduleFile(f){ return f.text().then(t=>importSchedule(t,f.name)).catch(()=>flashHint("Lecture de la nomenclature impossible.")); }
["dragenter","dragover"].forEach(ev=>stage.addEventListener(ev,e=>{e.preventDefault();stage.style.outline="2px dashed var(--accent)";}));
["dragleave","drop"].forEach(ev=>stage.addEventListener(ev,e=>{e.preventDefault();stage.style.outline="none";}));
stage.addEventListener("drop",async e=>{ const f=e.dataTransfer.files[0]; if(f)await routeFile(f); });
function demoSVG(){ return `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='540'><rect width='720' height='540' fill='#ffffff'/><g stroke='#1f2937' stroke-width='8' fill='none'><rect x='30' y='30' width='660' height='480'/><line x1='390' y1='30' x2='390' y2='320'/><line x1='390' y1='320' x2='690' y2='320'/><line x1='30' y1='320' x2='230' y2='320'/></g><g fill='#94a3b8' font-family='Segoe UI' font-size='20' font-weight='600'><text x='150' y='180'>Séjour</text><text x='500' y='180'>Chambre</text><text x='500' y='430'>Cuisine</text></g><g fill='#cbd5e1' font-family='Segoe UI' font-size='12'><text x='300' y='24'>Plan d'exemple — 1 m = 60 px</text></g></svg>`; }
function loadDemo(){ const im=new Image(); im.onload=()=>{ state.img=im; state.imgW=720; state.imgH=540; state.pxPerMeter=60;
  document.getElementById("emptyState").style.display="none"; document.getElementById("zoombar").style.display="flex";
  const peinture=state.library[3].id,plinthe=state.library[4].id,elec=state.library[5].id;
  state.shapes=[
    {id:id(),kind:"std",phase:"second",ouvrageId:peinture,points:[{x:40,y:40},{x:380,y:40},{x:380,y:500},{x:40,y:500}],height:0},
    {id:id(),kind:"std",phase:"second",ouvrageId:plinthe,points:[{x:40,y:40},{x:380,y:40},{x:380,y:500},{x:40,y:500},{x:40,y:40}],height:0},
    {id:id(),kind:"std",phase:"second",ouvrageId:elec,points:[{x:120,y:120},{x:300,y:120},{x:560,y:110},{x:560,y:420}],height:0},
    {id:id(),kind:"struct",points:[{x:450,y:380}],struct:{tag:"S1",type:"semelle",L:1.5,l:1.5,H:0.4,nb:6,barN:6,barDia:12,barLen:1.4,stirDia:8,stirSp:0}},
    {id:id(),kind:"struct",points:[{x:300,y:260}],struct:{tag:"P1",type:"poteau",L:0.25,l:0.25,H:3,nb:6,barN:4,barDia:12,barLen:3.2,stirDia:8,stirSp:0.2}},
  ];
  state.autoEntities=[
    {closed:true,pts:[{x:30,y:30},{x:390,y:30},{x:390,y:510},{x:30,y:510}]},
    {closed:true,pts:[{x:390,y:30},{x:690,y:30},{x:690,y:320},{x:390,y:320}]},
    {closed:true,pts:[{x:390,y:320},{x:690,y:320},{x:690,y:510},{x:390,y:510}]},
    {closed:false,pts:[{x:390,y:30},{x:390,y:510}]},
    {closed:false,pts:[{x:390,y:320},{x:690,y:320}]},
  ];
  state.activeOuvrage=peinture; fitView(); updateScaleTag(); refreshAll(); document.querySelector('[data-phase="fondation"]').click();
  flashHint("✅ Plan chargé. Essayez le bouton vert 🤖 Analyser le plan pour extraire les mesures automatiquement, ou tracez/placez à la main."); };
  im.onerror=()=>flashHint("⚠️ Impossible de charger le plan d'exemple."); im.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(demoSVG()); }
document.getElementById("btnDemo").addEventListener("click",loadDemo);
document.getElementById("zIn").onclick=()=>{state.zoom*=1.2;render();}; document.getElementById("zOut").onclick=()=>{state.zoom/=1.2;render();}; document.getElementById("zFit").onclick=fitView;

/* ---------- Échelle ---------- */
function openScale(){ document.getElementById("scaleModal").classList.add("show"); document.getElementById("realLen").focus(); }
document.getElementById("scaleCancel").onclick=()=>{ state.calibPts=null; document.getElementById("scaleModal").classList.remove("show"); render(); };
document.getElementById("scaleOk").onclick=()=>{ const real=parseFloat(document.getElementById("realLen").value)*parseFloat(document.getElementById("realUnit").value); const px=segLenPx(state.calibPts[0],state.calibPts[1]); if(real>0&&px>0)state.pxPerMeter=px/real;
  state.calibPts=null; document.getElementById("scaleModal").classList.remove("show"); updateScaleTag(); setTool("length"); refreshAll(); };
function updateScaleTag(){ const t=document.getElementById("scaleTag"); if(state.pxPerMeter){ t.style.display="block"; t.innerHTML="Échelle : <b>1 m = "+Math.round(state.pxPerMeter)+" px</b>"; } }

/* ---------- Modal structure ---------- */
const diaOpts=DIAS.map(d=>`<option value="${d}">HA${d}</option>`).join("");
document.getElementById("stBarDia").innerHTML=diaOpts; document.getElementById("stStirDia").innerHTML=diaOpts;
document.getElementById("stType").innerHTML=Object.keys(ST_LABEL).map(t=>`<option value="${t}">${ST_LABEL[t]}</option>`).join("");
const stEls=["stType","stL","stl","stH","stNb","stBarN","stBarDia","stBarLen","stStirDia","stStirSp"].reduce((o,k)=>{o[k]=document.getElementById(k);return o;},{});
function relabelStruct(){ const t=stEls.stType.value; const L=DIMLABELS[t]; document.getElementById("lblL").textContent=L[0]; document.getElementById("lbll").textContent=L[1]; document.getElementById("lblH").textContent=L[2]; document.getElementById("lblNb").textContent="Nombre de "+ST_LABEL[t].toLowerCase()+"s identiques"; }
function fillStructForm(s){ stEls.stType.value=s.type; stEls.stL.value=s.L; stEls.stl.value=s.l; stEls.stH.value=s.H; stEls.stNb.value=s.nb; stEls.stBarN.value=s.barN; stEls.stBarDia.value=s.barDia; stEls.stBarLen.value=s.barLen; stEls.stStirDia.value=s.stirDia; stEls.stStirSp.value=s.stirSp; }
function readStructForm(){ return {type:stEls.stType.value,L:+stEls.stL.value||0,l:+stEls.stl.value||0,H:+stEls.stH.value||0,nb:Math.max(1,+stEls.stNb.value||1),barN:+stEls.stBarN.value||0,barDia:+stEls.stBarDia.value,barLen:+stEls.stBarLen.value||0,stirDia:+stEls.stStirDia.value,stirSp:+stEls.stStirSp.value||0}; }
function updateStructPreview(){ const c=computeStruct(readStructForm()); document.getElementById("pvBeton").textContent=nf(c.vol)+" m³"; document.getElementById("pvAcier").textContent=nf(c.steel)+" kg"; }
Object.values(stEls).forEach(el=>el.addEventListener("input",updateStructPreview));
stEls.stType.addEventListener("change",()=>{ const t=stEls.stType.value; if(state.modalMode!=="edit")fillStructForm(Object.assign({type:t},state.defaults[t])); relabelStruct(); updateStructPreview(); });
function openStruct(mode){ state.modalMode=mode;
  const title=document.getElementById("structTitle"); const okb=document.getElementById("structOk"); const saveWrap=document.getElementById("saveDefWrap");
  if(mode==="edit"){ const sh=state.shapes.find(x=>x.id===state.editingId); fillStructForm(sh.struct); title.textContent="✎ Modifier "+sh.struct.tag; okb.textContent="Enregistrer"; saveWrap.style.display="flex"; }
  else if(mode==="defaults"){ fillStructForm(Object.assign({type:state.activeType},state.defaults[state.activeType])); title.textContent="⚙️ Paramètres par défaut — "+ST_LABEL[state.activeType]; okb.textContent="Enregistrer les défauts"; saveWrap.style.display="none"; }
  else { fillStructForm(Object.assign({type:state.activeType},state.defaults[state.activeType])); title.textContent="🏗️ Nouvel élément — "+ST_LABEL[state.activeType]; okb.textContent="Ajouter au tableau"; saveWrap.style.display="flex"; document.getElementById("stSaveDef").checked=false; }
  relabelStruct(); updateStructPreview(); document.getElementById("structModal").classList.add("show"); }
document.getElementById("structCancel").onclick=()=>{ state.pendingPt=null; state.editingId=null; document.getElementById("structModal").classList.remove("show"); };
document.getElementById("structOk").onclick=()=>{ const s=readStructForm(); const dv={L:s.L,l:s.l,H:s.H,nb:s.nb,barN:s.barN,barDia:s.barDia,barLen:s.barLen,stirDia:s.stirDia,stirSp:s.stirSp};
  if(state.modalMode==="defaults"){ state.defaults[s.type]=dv; document.getElementById("structModal").classList.remove("show"); flashHint("⚙️ Paramètres par défaut enregistrés pour "+ST_LABEL[s.type]+"."); return; }
  if(document.getElementById("stSaveDef").checked)state.defaults[s.type]=dv;
  if(state.modalMode==="edit"){ const sh=state.shapes.find(x=>x.id===state.editingId); const oldTag=sh.struct.tag; s.tag=(sh.struct.type===s.type)?oldTag:(ST_SHORT[s.type]+(state.shapes.filter(x=>x.kind==="struct"&&x.struct.type===s.type&&x.id!==sh.id).length+1)); sh.struct=s; state.editingId=null; }
  else { const n=state.shapes.filter(x=>x.kind==="struct"&&x.struct.type===s.type).length+1; s.tag=ST_SHORT[s.type]+n; state.shapes.push({id:id(),kind:"struct",points:[state.pendingPt||{x:state.imgW/2,y:state.imgH/2}],struct:s}); state.pendingPt=null; }
  document.getElementById("structModal").classList.remove("show"); refreshAll(); const c=computeStruct(s); flashHint("✅ "+s.tag+" : "+nf(c.vol)+" m³ béton, "+nf(c.steel)+" kg acier."); };

/* ---------- Modal std ---------- */
function openStd(gid){ const sh=state.shapes.find(x=>x.id===gid); if(!sh)return; state.editingStdId=gid;
  const sel=document.getElementById("edOuvrage"); sel.innerHTML=state.library.filter(o=>o.id!=="BETON"&&o.id!=="ACIER").map(o=>`<option value="${o.id}">${esc(o.name)} (${UNIT_LABEL[o.unit]})</option>`).join("");
  sel.value=sh.ouvrageId; const ov=libById(sh.ouvrageId);
  document.getElementById("edHeightWrap").style.display=(ov&&ov.unit==="m3")?"flex":"none"; document.getElementById("edHeight").value=sh.height||0;
  document.getElementById("edQty").value=(sh.manualQty!=null?sh.manualQty:""); document.getElementById("stdModal").classList.add("show"); }
document.getElementById("edOuvrage").onchange=e=>{ const ov=libById(e.target.value); document.getElementById("edHeightWrap").style.display=(ov&&ov.unit==="m3")?"flex":"none"; };
document.getElementById("stdCancel").onclick=()=>{ state.editingStdId=null; document.getElementById("stdModal").classList.remove("show"); };
document.getElementById("stdOk").onclick=()=>{ const sh=state.shapes.find(x=>x.id===state.editingStdId); if(sh){ sh.ouvrageId=document.getElementById("edOuvrage").value; sh.height=+document.getElementById("edHeight").value||0; const q=document.getElementById("edQty").value; sh.manualQty=(q===""?null:+q); }
  state.editingStdId=null; document.getElementById("stdModal").classList.remove("show"); refreshAll(); };

/* ---------- Bibliothèque ---------- */
const libList=document.getElementById("libList");
function renderLib(){ libList.innerHTML="";
  state.library.forEach(o=>{ const el=document.createElement("div"); el.className="lib-item"; const active=o.id===state.activeOuvrage; const special=(o.id==="BETON"||o.id==="ACIER"); el.style.borderColor=active?o.color:(special?o.color:"var(--line)");
    el.innerHTML=`<div class="top"><span class="swatch" style="background:${o.color}"></span><input class="name" value="${esc(o.name)}" data-f="name">${special?'<span class="tag '+(o.id==="BETON"?"beton":"acier")+'">auto</span>':'<button class="miniX">✕</button>'}</div>
      <div class="meta"><div class="fld"><label>Unité</label><select data-f="unit" ${special?"disabled":""}>${["ml","m2","m3","u","kg"].map(u=>`<option value="${u}" ${o.unit===u?"selected":""}>${UNIT_LABEL[u]}</option>`).join("")}</select></div>
        <div class="fld"><label>Prix U. ${state.currency.sym}</label><input type="number" step="0.01" value="${o.price}" data-f="price"></div>
        <div class="fld"><label>Perte %</label><input type="number" step="1" value="${Math.round(o.coef*100)}" data-f="coef"></div></div>
      ${(o.unit==="m3"&&!special)?`<div class="fld" style="margin-top:6px"><label>Hauteur/épaisseur (m)</label><input type="number" step="0.01" value="${o.height}" data-f="height"></div>`:""}
      ${special?'<div style="font-size:11px;color:var(--muted);margin-top:6px">Prix utilisé par le module Structure.</div>':`<button class="addbtn" style="margin-top:8px;padding:6px" data-use>${active?"● Ouvrage actif":"Utiliser cet ouvrage"}</button>`}`;
    el.querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("input",()=>{ const f=inp.dataset.f; if(f==="coef")o.coef=(parseFloat(inp.value)||0)/100; else if(f==="price"||f==="height")o[f]=parseFloat(inp.value)||0; else o[f]=inp.value; if(f==="unit")renderLib(); refreshAll(false); }));
    const useBtn=el.querySelector("[data-use]"); if(useBtn)useBtn.addEventListener("click",()=>{ state.activeOuvrage=o.id; renderLib(); render(); });
    const x=el.querySelector(".miniX"); if(x)x.addEventListener("click",()=>{ state.library=state.library.filter(z=>z.id!==o.id); state.shapes=state.shapes.filter(s=>s.ouvrageId!==o.id); if(state.activeOuvrage===o.id)state.activeOuvrage=(state.library.find(z=>z.id!=="BETON"&&z.id!=="ACIER")||{}).id||null; renderLib(); refreshAll(); });
    libList.appendChild(el); });
  document.getElementById("libCount").textContent=state.library.length; }
document.getElementById("btnAddLib").onclick=()=>{ const o={id:id(),name:"Nouvel ouvrage",unit:"m2",price:0,coef:0,color:PALETTE[state.library.length%PALETTE.length],height:2.5}; state.library.push(o); state.activeOuvrage=o.id; renderLib(); };

/* ---------- Tableau ---------- */
function renderTable(){ const rows=tableRows(); const wrap=document.getElementById("tableWrap");
  document.getElementById("rowCount").textContent=rows.length+(rows.length>1?" lignes":" ligne");
  if(!rows.length){ wrap.innerHTML='<div class="emptyTable">Le tableau se remplit au fur et à mesure de vos mesures.<br>Choisissez une étape et un type, puis cliquez sur le plan.</div>'; return; }
  let h=`<table class="metre"><thead><tr><th>#</th><th>Désignation</th><th>Type</th><th>Détails / dimensions</th><th style="text-align:right">Qté</th><th>Un.</th><th style="text-align:right">P.U.</th><th style="text-align:right">Total HT</th><th></th></tr></thead><tbody>`;
  let n=0,lastPhase=null;
  ["fondation","elevation","second"].forEach(ph=>{ const pr=rows.filter(r=>r.phase===ph); if(!pr.length)return;
    h+=`<tr class="phasehdr"><td colspan="9">▸ ${PHASE_LABEL[ph]}</td></tr>`;
    pr.forEach(r=>{ n++; h+=`<tr class="${r.first?"grouprow":""}"><td>${n}</td><td>${esc(r.desig)}</td><td><span class="tag ${r.cls}">${r.typ}</span></td><td style="color:var(--muted)">${esc(r.details)}</td><td class="num">${nf(r.qty)}</td><td>${UNIT_LABEL[r.unit]}</td><td class="num">${money(r.pu)}</td><td class="num"><b>${money(r.total)}</b></td><td style="white-space:nowrap">${r.first?`<button class="miniE" data-edit="${r.gid}" data-struct="${r.struct}" title="Modifier">✎</button><button class="miniX" data-del="${r.gid}" title="Supprimer">✕</button>`:""}</td></tr>`; }); });
  h+="</tbody></table>"; wrap.innerHTML=h;
  wrap.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{ state.shapes=state.shapes.filter(s=>s.id!==b.dataset.del); refreshAll(); });
  wrap.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{ if(b.dataset.struct==="true"){ state.editingId=b.dataset.edit; openStruct("edit"); } else openStd(b.dataset.edit); }); }
document.getElementById("dockToggle").onclick=()=>{ const d=document.getElementById("dock"); d.classList.toggle("collapsed"); document.getElementById("dockToggle").textContent=d.classList.contains("collapsed")?"Agrandir ▴":"Réduire ▾"; };

/* ---------- Quantitatif matériaux ---------- */
function materialsAgg(){ const agg={};
  function add(comp,mq){ if(!comp)return; comp.forEach(c=>{ if(!agg[c.mat])agg[c.mat]={mat:c.mat,unit:c.unit,qty:0}; agg[c.mat].qty+=c.q*mq; }); }
  state.shapes.forEach(sh=>{ if(sh.kind==="struct"){ const c=computeStruct(sh.struct),beton=libById("BETON"),acier=libById("ACIER");
      add(beton&&beton.comp,c.vol*(1+(beton?beton.coef:0))); add(acier&&acier.comp,c.steel*(1+(acier?acier.coef:0)));
    } else { const ov=libById(sh.ouvrageId); if(ov)add(ov.comp,qtyStd(sh)); } });
  return Object.values(agg); }
function renderMaterials(){ const mats=materialsAgg(); const wrap=document.getElementById("tableWrap");
  document.getElementById("rowCount").textContent=mats.length+(mats.length>1?" matériaux":" matériau");
  if(!mats.length){ wrap.innerHTML='<div class="emptyTable">Le quantitatif matériaux se déduit automatiquement de vos mesures.<br>Ajoutez des mesures (ou lancez 🤖 Analyser le plan).</div>'; return; }
  let tot=0; let h=`<table class="metre"><thead><tr><th>Matériau</th><th style="text-align:right">Quantité</th><th>Unité</th><th style="text-align:right">Prix U.</th><th style="text-align:right">Coût estimé</th></tr></thead><tbody>`;
  mats.forEach(m=>{ const pu=state.matPrices[m.mat]||0; const cost=m.qty*pu; tot+=cost;
    h+=`<tr><td>${esc(m.mat)}</td><td class="num">${nf(m.qty)}</td><td>${esc(m.unit)}</td>
      <td class="num"><input class="matprice" type="number" step="0.01" value="${pu}" data-mat="${esc(m.mat)}"></td>
      <td class="num"><b>${money(cost)}</b></td></tr>`; });
  h+=`<tr class="matfoot"><td colspan="4" style="text-align:right">Total matériaux estimé HT</td><td class="num">${money(tot)}</td></tr>`;
  h+="</tbody></table>"; wrap.innerHTML=h;
  wrap.querySelectorAll(".matprice").forEach(inp=>inp.onchange=()=>{ state.matPrices[inp.dataset.mat]=parseFloat(inp.value)||0; renderMaterials(); }); }
function renderDock(){ if(state.dockView==="materiaux")renderMaterials(); else renderTable(); }
document.getElementById("viewOuvrages").onclick=()=>{ state.dockView="ouvrages"; document.getElementById("viewOuvrages").classList.add("on"); document.getElementById("viewMateriaux").classList.remove("on"); renderDock(); };
document.getElementById("viewMateriaux").onclick=()=>{ state.dockView="materiaux"; document.getElementById("viewMateriaux").classList.add("on"); document.getElementById("viewOuvrages").classList.remove("on"); renderDock(); };

/* ---------- Totaux ---------- */
function totals(){ let sub=0; tableRows().forEach(r=>sub+=r.total); const tva=sub*state.tva; return {sub,tva,ttc:sub+tva}; }
function renderTotals(){ const t=totals(); document.getElementById("subtotal").textContent=money(t.sub); document.getElementById("tvaAmt").textContent=money(t.tva); document.getElementById("grandtotal").textContent=money(t.ttc); }
document.getElementById("tvaSel").onchange=e=>{ state.tva=parseFloat(e.target.value); renderTotals(); };
document.getElementById("curSel").onchange=e=>{ const [code,sym,pos]=e.target.value.split("|"); state.currency={code,sym,pos}; renderTotals(); renderDock(); renderLib(); };
function refreshAll(withRender=true){ renderLib(); renderDock(); renderTotals(); updateScaleTag(); if(withRender)render(); }

/* ---------- Export ---------- */
document.getElementById("btnCSV").onclick=()=>{ const sym=state.currency.sym;
  if(state.dockView==="materiaux"){ const mats=materialsAgg(); let out=[["Matériau","Quantité","Unité","Prix U ("+sym+")","Coût estimé ("+sym+")"]]; let tot=0;
    mats.forEach(m=>{ const pu=state.matPrices[m.mat]||0; tot+=m.qty*pu; out.push([m.mat,nf(m.qty),m.unit,fmt(pu),fmt(m.qty*pu)]); });
    out.push([]); out.push(["","","","Total matériaux HT",fmt(tot)]);
    const csv=out.map(r=>r.map(c=>`"${c}"`).join(";")).join("\n"); const blob=new Blob(["﻿"+csv],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="quantitatif-materiaux.csv"; a.click(); return; }
  const rows=tableRows(); let out=[["Étape","N°","Désignation","Type","Détails","Quantité","Unité","Prix U ("+sym+")","Total HT ("+sym+")"]]; let n=0;
  ["fondation","elevation","second"].forEach(ph=>{ rows.filter(r=>r.phase===ph).forEach(r=>{ n++; out.push([PHASE_LABEL[ph],n,r.desig,r.typ,r.details,nf(r.qty),UNIT_LABEL[r.unit],fmt(r.pu),fmt(r.total)]); }); });
  const t=totals(); out.push([]); out.push(["","","","","","","","Sous-total HT",fmt(t.sub)]); out.push(["","","","","","","","TVA",fmt(t.tva)]); out.push(["","","","","","","","Total TTC",fmt(t.ttc)]);
  const csv=out.map(r=>r.map(c=>`"${c}"`).join(";")).join("\n"); const blob=new Blob(["﻿"+csv],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="metre-devis.csv"; a.click(); };
document.getElementById("btnPrint").onclick=()=>{ const t=totals(); const rows=tableRows();
  let body=`<h1 style="margin:0 0 4px">Devis / Métré</h1><div style="color:#555;margin-bottom:18px">Édité le ${new Date().toLocaleDateString('fr-FR')} — MétréPro</div><table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr style="background:#f0f4f8"><th style="text-align:left;padding:7px;border:1px solid #ddd">Désignation</th><th style="text-align:left;padding:7px;border:1px solid #ddd">Détails</th><th style="padding:7px;border:1px solid #ddd">Qté</th><th style="padding:7px;border:1px solid #ddd">Un.</th><th style="padding:7px;border:1px solid #ddd">P.U.</th><th style="padding:7px;border:1px solid #ddd">Total HT</th></tr></thead><tbody>`;
  ["fondation","elevation","second"].forEach(ph=>{ const pr=rows.filter(r=>r.phase===ph); if(!pr.length)return; body+=`<tr><td colspan="6" style="padding:7px;border:1px solid #ddd;background:#eef4fb;font-weight:700">${PHASE_LABEL[ph]}</td></tr>`;
    pr.forEach(r=>{ body+=`<tr><td style="padding:7px;border:1px solid #ddd">${esc(r.desig)}</td><td style="padding:7px;border:1px solid #ddd;color:#555">${esc(r.details)}</td><td style="text-align:right;padding:7px;border:1px solid #ddd">${nf(r.qty)}</td><td style="text-align:center;padding:7px;border:1px solid #ddd">${UNIT_LABEL[r.unit]}</td><td style="text-align:right;padding:7px;border:1px solid #ddd">${money(r.pu)}</td><td style="text-align:right;padding:7px;border:1px solid #ddd">${money(r.total)}</td></tr>`; }); });
  body+=`</tbody></table><div style="margin-top:16px;margin-left:auto;width:280px;font-size:14px"><div style="display:flex;justify-content:space-between;padding:4px 0"><span>Sous-total HT</span><b>${money(t.sub)}</b></div><div style="display:flex;justify-content:space-between;padding:4px 0"><span>TVA (${Math.round(state.tva*1000)/10} %)</span><b>${money(t.tva)}</b></div><div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #333;font-size:17px"><span>Total TTC</span><b>${money(t.ttc)}</b></div></div>`;
  const pa=document.getElementById("printArea"); pa.innerHTML=body; pa.style.display="block"; window.print(); setTimeout(()=>pa.style.display="none",500); };

/* ---------- utils ---------- */
function fmt(n){ return (Math.round(n*100)/100).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function nf(n){ return (Math.round(n*1000)/1000).toLocaleString('fr-FR',{maximumFractionDigits:3}); }
function money(n){ const c=state.currency; const v=fmt(n); return c.pos==="before"? c.sym+" "+v : v+" "+c.sym; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- Analyse automatique ---------- */
function fillOuvSel(elid,unit){ const sel=document.getElementById(elid);
  const opts=state.library.filter(o=>o.unit===unit&&o.id!=="BETON"&&o.id!=="ACIER").map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join("");
  sel.innerHTML='<option value="">— Ignorer —</option>'+opts; }
document.getElementById("btnAuto").onclick=()=>{
  if(!state.img){ flashHint("Importez d'abord un plan (📂)."); return; }
  const ents=state.autoEntities||[];
  if(!ents.length){ showHint("🤖 L'analyse automatique lit la géométrie d'un plan <b>vectoriel DXF</b> (ou du plan d'exemple). Pour une image ou un PDF scanné, la détection des cotes n'est pas fiable : importez le <b>DXF</b> du plan, ou tracez les mesures à la main."); return; }
  const closed=ents.filter(e=>e.closed), open=ents.filter(e=>!e.closed);
  const surfA=closed.reduce((s,e)=>s+Math.pow(px2m(1),2)*areaPx(e.pts),0);
  const lenM=open.reduce((s,e)=>s+px2m(polyLenPx(e.pts)),0);
  fillOuvSel("autoSurf","m2"); fillOuvSel("autoLen","ml"); fillOuvSel("autoPerimSel","ml");
  document.getElementById("autoSummary").innerHTML=`Le logiciel a lu le plan et détecté <b>${closed.length} surface(s)</b> (${nf(surfA)} m²) et <b>${open.length} tracé(s) linéaire(s)</b> (${nf(lenM)} m). Attribuez un ouvrage — donc une unité — à chaque catégorie, puis générez le devis.`;
  document.getElementById("pvSurf").textContent=nf(surfA)+" m²"; document.getElementById("pvLen").textContent=nf(lenM)+" m";
  document.getElementById("autoModal").classList.add("show");
};
document.getElementById("autoPerim").onchange=e=>{ document.getElementById("autoPerimWrap").style.display=e.target.checked?"flex":"none"; };
document.getElementById("autoCancel").onclick=()=>document.getElementById("autoModal").classList.remove("show");
document.getElementById("autoOk").onclick=()=>{
  const surfOv=document.getElementById("autoSurf").value, lenOv=document.getElementById("autoLen").value;
  const perim=document.getElementById("autoPerim").checked, perimOv=document.getElementById("autoPerimSel").value;
  const ents=state.autoEntities||[]; let added=0;
  ents.filter(e=>e.closed).forEach(e=>{
    if(surfOv){ state.shapes.push({id:id(),kind:"std",phase:state.phase,ouvrageId:surfOv,points:e.pts.slice(),height:(libById(surfOv)||{}).height||0}); added++; }
    if(perim&&perimOv){ const pts=e.pts.slice(); pts.push(pts[0]); state.shapes.push({id:id(),kind:"std",phase:state.phase,ouvrageId:perimOv,points:pts,height:0}); added++; }
  });
  ents.filter(e=>!e.closed).forEach(e=>{ if(lenOv){ state.shapes.push({id:id(),kind:"std",phase:state.phase,ouvrageId:lenOv,points:e.pts.slice(),height:0}); added++; } });
  document.getElementById("autoModal").classList.remove("show"); refreshAll();
  flashHint(added? "✅ Analyse terminée : "+added+" mesure(s) ajoutée(s) au tableau, devis généré automatiquement.":"Aucun ouvrage attribué — rien n'a été ajouté.");
};

/* ---------- init ---------- */
renderLib(); renderChips(); renderDock(); renderTotals(); resize(); setTool("select");
