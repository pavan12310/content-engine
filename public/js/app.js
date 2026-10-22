import { api as localApi, download } from "./api.js";
import * as LLM from "./llm.js";
import * as store from "./store.js";
import { check as liveCheck } from "./validators.js";
import { googleUpdates, updatesSource } from "./updates.js";
import { htmlToMarkdown } from "./md.js";
import * as SYNC from "./sync.js";
import * as AUTH from "./auth.js";
import * as WS from "./websearch.js";
import * as CMS from "./cms.js";
import * as GSCC from "./gscconn.js";
import * as SPEED from "./speed.js";
import * as INOW from "./indexnow.js";
import * as BING from "./bing.js";
import * as WB from "./wayback.js";
import * as QX from "./questions.js";
import * as WIKI from "./wiki.js";
import * as DECAY from "./decay.js";
import * as MIG from "./migration.js";
import * as SCHEMA from "./schema.js";
import * as GA4 from "./ga4.js";
import * as TD from "./trackdiff.js";
import * as RANKS from "./ranks.js";
import * as VOICE from "./voice.js";
import { BUSINESS_TYPES } from "./rules.js";
import { LANGS } from "./lang.js";
import { renderReport, SECTIONS as REPORT_SECTIONS } from "./report.js";

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const list=a=>Array.isArray(a)&&a.length?`<ul class="c">${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"";
let RULES=null, SITE_ID=null, pollTimer=null, CURRENT="home";


let READONLY=false, CURRENT_SITE=null;
async function api(path,opts={}){
  if(READONLY&&(opts.method||"GET").toUpperCase()!=="GET"&&!/\/chats?(\/|$)/.test(path)) throw new Error("Your role in this workspace is view-only, so you can't make changes here. Ask an owner or admin for editor access.");
  return localApi(path,opts); }
async function busy(btn,statusEl,msg,fn){
  btn.disabled=true;statusEl.classList.remove("err");statusEl.classList.add("spin");statusEl.textContent=msg;
  try{await fn();if(statusEl.textContent===msg||statusEl.dataset.progress)statusEl.textContent="";}catch(e){statusEl.textContent=(e.guardrail?"Not allowed: ":"")+e.message;statusEl.classList.add("err");}
  finally{btn.disabled=false;statusEl.classList.remove("spin");delete statusEl.dataset.progress;}
}
function needAI(statusEl){ if(LLM.isConfigured()) return true; statusEl.innerHTML='Connect an AI provider first. <button class="btn ghost small" data-go="settings">Open AI settings</button>'; statusEl.classList.add("err"); bindGo(statusEl.parentElement||document); return false; }
function needSite(statusEl,ai=false){ if(!SITE_ID){statusEl.textContent="Add and read a website first.";statusEl.classList.add("err");return false} if(ai&&!needAI(statusEl))return false; return true}

// ---------- charts (plain SVG/HTML, no libraries) ----------
const PAL=["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c6)","var(--c5)"];
const INTENT_LABEL={informational:"Learn",how_to:"How-to",commercial:"Compare",transactional:"Buy / use",navigational:"Brand / page lookup"};
const fmtN=v=>Math.round(v).toLocaleString();
function hbars(items,o={}){
  if(!items.length) return "";
  const max=o.max??Math.max(...items.map(i=>i.value),1), fmt=o.fmt||fmtN;
  return `<div class="hbar" role="img" aria-label="${esc(o.label||"bar chart")}">${items.map((i,k)=>`<span class="l" title="${esc(i.label)}">${esc(i.label)}</span>
    <span class="t"><i style="width:${i.value>0?Math.max(2,100*i.value/max):0}%;background:${i.color||o.color||PAL[0]}"></i></span><span class="v">${esc(fmt(i.value))}</span>`).join("")}</div>`;
}
function donut(items,o={}){
  const tot=items.reduce((a,i)=>a+i.value,0); if(!tot) return "";
  const r=52,C=2*Math.PI*r; let off=0;
  const arcs=items.map((i,k)=>{const len=C*i.value/tot;const el=`<circle cx="70" cy="70" r="${r}" fill="none" stroke="${i.color||PAL[k%PAL.length]}" stroke-width="18" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;off+=len;return el}).join("");
  return `<div class="donut-wrap chart"><svg viewBox="0 0 140 140" style="width:140px" role="img" aria-label="${esc(o.label||"donut chart")}">${arcs}
    <text x="70" y="68" text-anchor="middle" class="val" style="font-size:22px">${esc(o.center??fmtN(tot))}</text><text x="70" y="86" text-anchor="middle">${esc(o.sub||"total")}</text></svg>
    <div class="legend">${items.map((i,k)=>`<span><span class="dot" style="background:${i.color||PAL[k%PAL.length]}"></span>${esc(i.label)} · <b>${fmtN(i.value)}</b> (${Math.round(100*i.value/tot)}%)</span>`).join("")}</div></div>`;
}
function ring(v,o={}){
  const r=26,C=2*Math.PI*r,val=Math.max(0,Math.min(100,v||0));
  const col=o.color||(val>=80?"var(--good)":val>=60?"var(--warn)":"var(--bad)");
  return `<svg viewBox="0 0 64 64" style="width:64px;height:64px;flex:none" role="img" aria-label="${esc(o.label||"score")} ${val}"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/>
   <circle cx="32" cy="32" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C*val/100} ${C}" transform="rotate(-90 32 32)"/>
   <text x="32" y="37" text-anchor="middle" style="font:700 15px 'Bricolage Grotesque',system-ui,sans-serif;fill:var(--ink)">${o.text??val}</text></svg>`;
}
function columns(items,o={}){
  if(!items.length) return "";
  const W=560,H=190,pad=30,max=Math.max(...items.map(i=>i.value),1),bw=Math.min(56,(W-pad*2)/items.length*0.6),step=(W-pad*2)/items.length;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H+28}" role="img" aria-label="${esc(o.label||"column chart")}">
   <line x1="${pad}" y1="${H}" x2="${W-pad}" y2="${H}" stroke="var(--line)"/>
   ${items.map((i,k)=>{const h=(H-24)*i.value/max,x=pad+step*k+(step-bw)/2;return `<rect x="${x}" y="${H-h}" width="${bw}" height="${h}" rx="4" fill="${o.color||PAL[0]}"/>
     <text x="${x+bw/2}" y="${H-h-6}" text-anchor="middle" class="val">${esc((o.fmt||fmtN)(i.value))}</text>
     <text x="${x+bw/2}" y="${H+17}" text-anchor="middle">${esc(String(i.label).slice(0,16))}</text>`}).join("")}</svg></div>`;
}
const emptyBox=(title,text,view,btn)=>`<div class="empty"><b>${esc(title)}</b>${esc(text)}${view?`<br><button class="btn ghost small" data-go="${view}">${esc(btn)}</button>`:""}</div>`;
function bindGo(root){root.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>show(b.dataset.go));}
const card=(title,sub,body)=>`<div class="panel chart-card"><h3>${esc(title)}</h3>${sub?`<p class="sub">${esc(sub)}</p>`:'<div style="height:10px"></div>'}${body}</div>`;

// ---------- home dashboard ----------
// ---------- home ----------
const daysAgo=t=>t?Math.floor((Date.now()-t)/864e5):null;
function lastVisit(cur){ // remembers the previous visit (older than 6 hours) per website, in this browser
  const key=`ce-visit-${SITE_ID}`; let v={}; try{v=JSON.parse(localStorage.getItem(key)||"{}");}catch{}
  if(!v.current||Date.now()-v.current.at>6*36e5){ v.previous=v.current||null; v.current={...cur,at:Date.now()}; }
  else v.current={...v.current,...cur};
  try{localStorage.setItem(key,JSON.stringify(v));}catch{} return v.previous;
}
let ANN=[];
let ANN_ALL=[];
const annShown=()=>{ try{ return JSON.parse(localStorage.getItem("ce-ann-kinds")||"null")||{note:1,published:1,refreshed:1,competitor:1,migration:1}; }catch{ return {note:1,published:1,refreshed:1,competitor:1,migration:1}; } };
async function loadAnn(){ ANN_ALL=SITE_ID?await api(`/api/sites/${SITE_ID}/annotations`).catch(()=>[]):[]; const k=annShown(); ANN=ANN_ALL.filter(n=>k[n.kind]); return ANN; }
async function forYou(){ const me=myName(); if(!SITE_ID||!me) return ""; const f=await api(`/api/sites/${SITE_ID}/for-person`,{method:"POST",body:JSON.stringify({name:me})}).catch(()=>null);
  if(!f||(!f.mentions.length&&!f.signoffs.length)) return "";
  return `<div class="panel" style="margin-bottom:14px"><h2 style="margin-top:0">For you, ${esc(me.split(" ")[0])}</h2>
    ${f.signoffs.map(x=>`<div class="row" style="margin:4px 0"><span class="pill warn">Waiting for your sign-off</span> <b>${esc(x.title)}</b> <span class="status">(${esc(x.step)})</span> <button class="btn ghost small" data-fyopen="${x.cid}">Open</button></div>`).join("")}
    ${f.mentions.map(x=>`<div class="row" style="margin:4px 0"><span class="pill">@ mention</span> <b>${esc(x.by)}</b> on <b>${esc(x.title)}</b>: <span class="status">“${esc(x.text.slice(0,120))}”</span> <button class="btn ghost small" data-fyopen="${x.cid}">Open</button></div>`).join("")}</div>`; }
// Home, then the "For you" box once Home has finished drawing
async function loadHome(){ await loadHomeInner(); const FY=await forYou().catch(()=>""), out=$("#home-out");
  if(FY&&out&&!out.querySelector("[data-fy]")){ out.insertAdjacentHTML("afterbegin",`<div data-fy>${FY}</div>`); out.querySelectorAll("[data-fyopen]").forEach(b=>b.onclick=()=>openItem(+b.dataset.fyopen)); } }
async function loadHomeInner(){ await loadAnn();
  renderMonitorHome().catch(()=>{});
  const out=$("#home-out");
  if(!SITE_ID){
    out.innerHTML=`<div class="panel welcome"><h2>Welcome to Content Engine</h2><p class="lead">Plan, write and measure content that follows Google's rules and earns mentions in AI answers. Start by connecting an AI provider and adding your website: the engine reads your pages, so every suggestion fits what you already have.</p>
      <ol class="steps" style="max-width:560px;margin:14px 0 18px"><li><span class="n">1</span><span class="t">Connect Claude, ChatGPT or Gemini (or try Demo mode)</span></li><li><span class="n">2</span><span class="t">Add your website</span></li><li><span class="n">3</span><span class="t">See site health, then check keywords and write your first page</span></li></ol>
      <div class="row"><button class="btn" data-wizard>Start guided setup (about 10 minutes)</button><button class="btn ghost" data-go="site">Set up myself</button></div></div>`;
    out.querySelector("[data-wizard]").onclick=()=>{ wzSet({dismissed:false}); openWizard(); };
    bindGo(out); return;
  }
  out.innerHTML=`<div class="panel"><p class="status spin">Loading your dashboard…</p></div>`;
  const get=p=>api(p).catch(()=>null);
  const site=await get(`/api/sites/${SITE_ID}`);
  if(site&&site.status!=="ready"&&!site.page_count){out.innerHTML=`<div class="panel"><p class="status spin">Reading ${esc(site.url)}… (${esc(site.status)}). This page updates when it's done.</p></div>`;clearTimeout(window._homeT);window._homeT=setTimeout(()=>{if(CURRENT==="home")loadHome();},4000);return;}
  const [ta,gs,vis,kws,lib,allSites]=await Promise.all([get(`/api/sites/${SITE_ID}/technical-audit`),get(`/api/sites/${SITE_ID}/gsc`),get(`/api/sites/${SITE_ID}/visibility`),get(`/api/sites/${SITE_ID}/keywords`),get(`/api/sites/${SITE_ID}/contents`),get(`/api/sites`)]);
  let acts=await api(`/api/sites/${SITE_ID}/actions/generate`,{method:"POST"}).catch(()=>[]); acts=acts||[]; ACTIONS=acts;
  const open=acts.filter(a=>["open","in_progress"].includes(a.status)), urgent=open.filter(a=>a.priority==="P0"||a.priority==="P1"), overdue=open.filter(isOverdue);
  updateBadge(urgent.length);
  const g=gs&&gs.analysis, vs=vis&&vis.summary||{checks:0,trend:[]}, items=lib||[], K=kws||[];
  const clicks=g?(g.totals||{}).clicks:null, clickChange=g&&g.change?g.change.clicks:null;
  const lastAi=vs.trend&&vs.trend.length?vs.trend[vs.trend.length-1].at:null, aiPrev=vs.trend&&vs.trend.length>1?vs.trend[vs.trend.length-2].mention_rate:null;
  const approved=items.filter(c=>c.status==="approved").length, ready=items.filter(c=>c.status==="ready_for_human_review").length, drafts=items.filter(c=>["improve_before_publishing","do_not_publish"].includes(c.status)).length;
  const gaps=K.filter(k=>k.coverage&&k.coverage.status==="gap"&&k.action!=="skip").length;
  // since last visit
  const prev=lastVisit({health:ta?ta.health_score:null,clicks,mention:vs.checks?vs.mention_rate:null,open:open.length,approved,done:acts.filter(a=>a.status==="done").length});
  const changes=[]; if(prev){ const d=(a,b)=>a!=null&&b!=null&&a!==b;
    if(d(ta&&ta.health_score,prev.health)) changes.push(`Site health ${prev.health} → <b>${ta.health_score}</b>`);
    if(d(clicks,prev.clicks)) changes.push(`Google clicks ${fmtN(prev.clicks)} → <b>${fmtN(clicks)}</b>`);
    if(d(vs.checks?vs.mention_rate:null,prev.mention)) changes.push(`AI mentions ${prev.mention}% → <b>${vs.mention_rate}%</b>`);
    const doneNow=acts.filter(a=>a.status==="done").length; if(prev.done!=null&&doneNow>prev.done) changes.push(`<b>${doneNow-prev.done}</b> to-do${doneNow-prev.done>1?"s":""} done`);
    if(prev.approved!=null&&approved>prev.approved) changes.push(`<b>${approved-prev.approved}</b> page${approved-prev.approved>1?"s":""} approved`);
    if(d(open.length,prev.open)) changes.push(`Open to-dos ${prev.open} → <b>${open.length}</b>`); }
  // alerts
  const alerts=[], crawledAgo=daysAgo(site.summary&&site.summary.crawl_id);
  if(site.notice) alerts.push(["info",esc(site.notice),"site","Websites"]);
  const mlog=((await store.get("monitor-log",null))||[]).find(r=>r.site.id===site.id);
  if(mlog&&mlog.needs_attention&&Date.now()-mlog.at<8*864e5){ const n=mlog.issues.filter(i=>!i.minor).length, t=mlog.traffic;
    alerts.push(["bad",`<b>Weekly check (${esc(fmtDate(mlog.at))}):</b> ${[n?`${n} key page problem${n>1?"s":""}`:"",t&&t.change!=null&&t.change<=-20?`Google clicks ${t.change}% vs the week before`:"",mlog.overdue.length?`${mlog.overdue.length} overdue to-do${mlog.overdue.length>1?"s":""}`:"",mlog.updates.length?"a Google update":"",mlog.traffic_error?"Search Console needs reconnecting":""].filter(Boolean).join(", ")}.`,"settings","See details"]); }
  if(!LLM.isConfigured()) alerts.push(["warn","<b>Connect an AI provider</b> to write pages, check keywords and run AI answer checks.","settings","Connect AI"]);
  if(crawledAgo!=null&&crawledAgo>30) alerts.push(["warn",`Your website was last read <b>${crawledAgo} days ago</b>. Read it again so checks and suggestions reflect your current pages.`,"site","Read again"]);
  if(overdue.length) alerts.push(["bad",`<b>${overdue.length} to-do${overdue.length>1?"s are":" is"} overdue.</b>`,"actions","Open to-do list"]);
  if(g&&g.range){ const age=daysAgo(Date.parse(g.range.to+"T00:00:00Z")); if(age>45) alerts.push(["warn",`Your Google data ends <b>${age} days ago</b>. Upload a fresh Search Console export.`,"gsc","Upload"]); }
  else if(!g) alerts.push(["info","Upload your Google Search Console data to see clicks, trends and quick wins.","gsc","Upload"]);
  if(vs.checks&&lastAi&&daysAgo(lastAi)>30) alerts.push(["warn",`Your AI answer checks are <b>${daysAgo(lastAi)} days old</b>. Run them again to track the trend.`,"aivis","Run checks"]);
  const today=new Date().toISOString().slice(0,10), recentUpd=(await googleUpdates()).filter(u=>u.start<=today&&daysAgo(Date.parse(u.end+"T00:00:00Z"))<=21);
  for(const u of recentUpd) alerts.push(["info",`<b>${esc(u.name)}</b> ${u.ongoing||u.end>=today?"is rolling out":`finished ${daysAgo(Date.parse(u.end+"T00:00:00Z"))} days ago`}. Wait a week after it finishes, then compare your clicks before and after in Google search.`,"gsc","See impact"]);
  // getting started (only until done)
  const steps=[["Connect an AI provider",LLM.isConfigured(),"settings"],["Add your website",!!site,"site"],["Review site health",!!ta,"tech"],["Upload Google search data",!!g,"gsc"],["Check a keyword",K.some(k=>k.check),"keyword"],["Write your first page",items.length>0,"generate"],["Check how AI answers mention you",vs.checks>0,"aivis"]];
  const doneN=steps.filter(x=>x[1]).length;
  const kpiCard=(view,inner)=>`<button class="kpi-link" data-go="${view}">${inner}</button>`;
  const intents=Object.entries((site&&site.intent_counts)||{}).sort((a,b)=>b[1]-a[1]).map(([k,v],i)=>({label:INTENT_LABEL[k]||k,value:v,color:PAL[i%PAL.length]}));
  const otherSites=(allSites||[]).filter(x=>x.id!==SITE_ID);
  out.innerHTML=`
   ${alerts.length?`<div class="alerts">${alerts.map(([c,t,v,b])=>`<div class="alert ${c}"><span>${t}</span><button class="btn small ${c==="bad"?"":"ghost"}" data-go="${v}">${esc(b)}</button></div>`).join("")}</div>`:""}
   ${changes.length?`<div class="panel" style="padding:14px 18px"><div class="row"><b style="font-size:14px">Since your last visit</b> <span class="status">(${esc(fmtDate(prev.at))})</span></div><div class="changes" style="margin-top:8px">${changes.map(c=>`<span>${c}</span>`).join("")}</div></div>`:""}
   <div class="grid4">
     ${kpiCard("tech",`<div class="panel kpi">${ring(ta?ta.health_score:0,{label:"site health"})}<div><div style="font-weight:600">Site health</div><div class="lbl">${ta&&ta.progress?`${ta.progress.fixed} fixed · ${ta.progress.new} new since last read`:"Pages with no serious problems"}</div></div></div>`)}
     ${kpiCard("actions",`<div class="panel kpi"><div><div class="num">${open.length}</div><div class="lbl">Open to-dos${urgent.length?` · <span class="fail">${urgent.length} urgent</span>`:""}${overdue.length?` · <span class="fail">${overdue.length} overdue</span>`:""}</div></div></div>`)}
     ${kpiCard("gsc",`<div class="panel kpi"><div><div class="num">${clicks!=null?fmtN(clicks):"–"}</div><div class="lbl">Google clicks${gs&&gs.imports&&gs.imports[0]?` (${esc(gs.imports[0].label)})`:""} ${clickChange!=null?deltaHtml(clickChange):""}</div></div></div>`)}
     ${kpiCard("aivis",`<div class="panel kpi">${ring(vs.checks?vs.mention_rate:0,{label:"AI mention rate",text:vs.checks?vs.mention_rate+"%":"–",color:"var(--c2)"})}<div><div style="font-weight:600">AI answers</div><div class="lbl">${vs.checks?`mention you${aiPrev!=null?" "+deltaHtml(vs.mention_rate-aiPrev,{suffix:" pts"}):""}`:"No checks yet"}</div></div></div>`)}
   </div>
   <div class="grid2">
     ${card("Do these first",urgent.length?"Most important open to-dos":"Open to-dos",open.length?`<div style="display:grid;gap:2px">${(urgent.length?urgent:open).slice(0,6).map(a=>`<div class="row" style="flex-wrap:nowrap;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--soft-line)">${PRI(a.priority)}<span style="flex:1;min-width:0">${esc(a.title)}<br><span class="status">${esc(a.source)}${a.quick_win?' · <span class="qw">Quick win</span>':""}</span></span>${a.link?`<button class="btn small" data-hdoit="${a.id}">Do it</button>`:""}</div>`).join("")}</div><div style="margin-top:12px"><button class="btn ghost small" data-go="actions">See all ${open.length}</button></div>`:emptyBox("Nothing open","No open to-dos right now.","actions","Open to-do list"))}
     ${doneN<steps.length?card("Getting started",`${doneN} of ${steps.length} done`,`<ol class="steps">${steps.map((x,i)=>`<li class="${x[1]?"done":""}"><span class="n">${x[1]?"✓":i+1}</span><span class="t">${esc(x[0])}</span>${x[1]?"":`<button class="btn ghost small" data-go="${x[2]}">Start</button>`}</li>`).join("")}</ol>`)
       :card("Content pipeline","From keyword gaps to approved pages. Click a stage to open it.",`<div class="pipe">
         <button data-go="urlmap"><b>${gaps}</b><span>Keywords with no page</span></button><button data-go="library"><b>${drafts}</b><span>Drafts needing work</span></button>
         <button data-go="library"><b>${ready}</b><span>Ready for review</span></button><button data-go="library"><b class="pass">${approved}</b><span>Approved</span></button></div>
         ${items.length?`<h3 style="font-size:14px;margin:14px 0 4px">Recent pages</h3>${items.slice(0,4).map(c=>`<div class="row" style="justify-content:space-between;flex-wrap:nowrap;padding:6px 0;border-bottom:1px solid var(--soft-line)"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(c.title||c.keyword)}</span>${statusPill(c)}</div>`).join("")}`:""}`)}
   </div>
   <div class="grid2">
     ${card("Google clicks",g&&(g.daily||[]).length>1?`Per day · ${esc(gs.imports[0].label)} · shaded bands are Google updates`:"Upload Search Console data to see the trend",g&&(g.daily||[]).length>1?lineChart(g.daily.map(x=>({date:x.date,value:x.clicks})),{updates:g.impact||[],notes:ANN}):g?emptyBox("No daily data","Upload the full Search Console zip to see clicks per day.","gsc","Upload"):emptyBox("No Google data yet","See clicks, trends and quick wins.","gsc","Upload data"))}
     ${card("AI answers","Share of answers that mention you, per run",vs.trend&&vs.trend.length?columns(vs.trend.map(t=>({label:(t.date||"").slice(5),value:t.mention_rate})),{fmt:v=>v+"%",color:"var(--c2)"})+(vs.share_of_voice&&vs.share_of_voice.length?`<p class="status">Named most: ${esc(vs.share_of_voice.filter(e=>!e.ours).slice(0,3).map(e=>e.name).join(", "))}</p>`:""):emptyBox("No checks yet","See whether ChatGPT, Gemini or Claude recommend you.","aivis","Run a check"))}
   </div>
   <div class="grid2">
     ${card("Site health","Issues by severity",ta?hbars(["error","high","medium","low"].map(k=>({label:{error:"Errors",high:"High",medium:"Medium",low:"Low"}[k],value:ta.counts[k]||0,color:{error:"var(--c4)",high:"var(--c4)",medium:"var(--c3)",low:"var(--c5)"}[k]})))+(ta.history&&ta.history.length>1?`<p class="status">Health over your last reads: ${ta.history.slice(-5).map(h=>h.health).join(" → ")}</p>`:""):emptyBox("Not checked yet","","tech","Check site health"))}
     ${card("Best keyword opportunities","Search demand, business value and ease (0–100)",K.length?hbars(K.slice(0,7).map(k=>({label:k.keyword,value:k.opportunity})),{max:100}):emptyBox("No keywords yet","Check a keyword or import a list.","urlmap","Add keywords"))}
   </div>
   ${intents.length?card("Your pages by what searchers want","Search intent of the pages read from your site",donut(intents,{sub:"pages",label:"pages by search intent"})):""}
   ${otherSites.length?`<div class="panel"><h2>All your websites</h2><div class="tw" style="margin-top:10px"><table><tr><th>Website</th><th>Pages read</th><th>Last read</th><th><span class="sr-only">Actions</span></th></tr>${(allSites||[]).map(x=>`<tr><td><b>${esc(x.name||x.url)}</b><br><span class="url">${esc(x.url)}</span></td><td>${x.page_count}</td><td>${esc(x.crawled_at||x.status)}</td><td>${x.id===SITE_ID?'<span class="pill pass">Showing</span>':`<button class="btn ghost small" data-site-switch="${x.id}">Open</button>`}</td></tr>`).join("")}</table></div></div>`:""}`;
  bindGo(out);
  out.querySelectorAll("[data-hdoit]").forEach(b=>b.onclick=()=>goAction(acts.find(a=>a.id===+b.dataset.hdoit)));
  out.querySelectorAll("[data-site-switch]").forEach(b=>b.onclick=()=>{ $("#site-select").value=b.dataset.siteSwitch; $("#site-select").onchange({target:$("#site-select")}); });
}
function updateBadge(n){const b=$("#nav-badge");if(!b)return;b.textContent=n;b.classList.toggle("hidden",!n);}

// nav
document.querySelectorAll("nav button").forEach(b=>b.onclick=e=>{ show(b.dataset.v); if(e.detail===0){ const h=document.querySelector(`section[data-view="${b.dataset.v}"] .page-head h2`); if(h){ h.setAttribute("tabindex","-1"); h.focus({preventScroll:false}); } } });   // keyboard: move focus to the new screen's heading
// screens reached from inside another screen highlight that screen in the sidebar
const NAV_PARENT={keyword:"urlmap",audit:"library"};
function navGroups(){ const out=[]; let g=null; for(const el of document.querySelectorAll("nav > *")){ if(el.classList.contains("nav-group")){ g={head:el,items:[]}; out.push(g); } else if(g&&(el.dataset.v||el.classList.contains("nav-more"))) g.items.push(el); } return out; }
// "More tools": occasional tools, folded by default; opens by itself when you're on one of them
const MORE_TOOLS=["history","migration"];
function applyMore(){ const btn=document.getElementById("nav-more"); if(!btn) return; let on=false; try{ on=localStorage.getItem("ce-nav-more")==="1"; }catch{}
  on=on||MORE_TOOLS.includes(CURRENT); btn.setAttribute("aria-expanded",String(on)); document.querySelectorAll("nav .nav-sub").forEach(b=>b.classList.toggle("more-closed",!on)); }
function applyNav(){ let folded=[]; try{ folded=JSON.parse(localStorage.getItem("ce-nav-folded")||"[]"); }catch{}
  const cur=NAV_PARENT[CURRENT]||CURRENT;
  for(const g of navGroups()){ const open=!folded.includes(g.head.dataset.group);
    g.head.setAttribute("aria-expanded",String(open)); g.items.forEach(b=>b.classList.toggle("folded",!open&&b.dataset.v!==cur&&!(b.classList.contains("nav-more")&&MORE_TOOLS.includes(cur)))); } applyMore(); }
function show(v){const nv=NAV_PARENT[v]||v; document.querySelectorAll("nav button[data-v]").forEach(b=>b.setAttribute("aria-current",String(b.dataset.v===nv)));
  document.querySelectorAll("[data-view]").forEach(s=>s.classList.toggle("hidden",s.dataset.view!==v));
  window.scrollTo(0,0); CURRENT=v; applyNav();
  if(v==="home")loadHome().catch(()=>{});
  if(v==="settings"){ setTab(SET_TAB); setStatus().catch(()=>{}); renderChatAlerts().catch(()=>{}); $("#gk-key").value=LLM.getSettings().googleKey||""; $("#bk-key").value=LLM.getSettings().bingKey||""; renderSettings();renderUsage();renderStorage().catch(()=>{});renderSearch();renderHybrid();renderMonitoring().catch(()=>{});
    renderAccountPanel().then(ok=>{ if(!ok) renderSync(); });
    if(document.body.classList.contains("role-client")) document.querySelectorAll("section[data-view=settings] > .panel").forEach(p=>{ if(p.id!=="team-panel") p.classList.add("settings-ai"); }); }
  if(SITE_ID&&v==="keyword")loadRecent().catch(()=>{});
  if(SITE_ID&&v==="strategy")loadStrategy().catch(()=>{});
  if(v==="kb")loadKB().catch(e=>toast(e.message,"error"));
  if(v==="chat")loadChat().catch(e=>toast(e.message,"error"));
  if(v==="history")loadHistory().catch(()=>{});
  if(v==="competitors")loadCompetitors().catch(e=>toast(e.message,"error"));
  if(v==="migration")loadMigration().catch(e=>toast(e.message,"error"));
  if(v==="calendar")loadCalendar().catch(e=>toast(e.message,"error"));
  if(v==="aivis")renderAiReady().catch(()=>{});
  if(v==="reports")loadReports().catch(e=>toast(e.message,"error"));
  if(v==="gsc"){ renderGscConn().catch(()=>{}); renderGa4().catch(()=>{}); renderBing().catch(()=>{}); renderDecay().catch(()=>{}); }
  if(SITE_ID&&v==="audit"){loadReviews().catch(()=>{});loadAuthors().catch(()=>{});}
  if(SITE_ID&&v==="generate"){renderBank().catch(()=>{});checkResume().catch(()=>{});loadStyle().catch(()=>{});loadAuthors().catch(()=>{});kwInfo().catch(()=>{});}
  if(v==="library")loadLibrary(); if(v==="rules")renderRules();
  if(SITE_ID){ if(v==="actions")loadActions().catch(()=>{}); if(v==="gsc")loadGsc().catch(()=>{}); if(v==="aivis")loadVis().catch(()=>{}); if(v==="urlmap")kwTab([...document.querySelectorAll("#kw-tabs [data-kt]")].find(x=>x.getAttribute("aria-pressed")==="true").dataset.kt); if(v==="tech")runAudit().catch(e=>{$("#ta-status").textContent=e.message;}); if(v==="site")loadSite().catch(()=>{}); }}

// sites
async function loadSites(selectId){
  const sites=await api("/api/sites");
  const sel=$("#site-select");
  sel.innerHTML=sites.length?sites.map(s=>`<option value="${s.id}">${esc(s.name||s.url)} (${s.page_count} pages)</option>`).join(""):`<option value="">No website yet</option>`;
  if(selectId) sel.value=selectId; else if(sites.length && !SITE_ID) sel.value=sites[0].id;
  if(sel.value){SITE_ID=+sel.value; loadSite();}
}
$("#site-select").onchange=e=>{SITE_ID=+e.target.value||null;SITE_URLS=null;loadSite();show(CURRENT);};
$("#s-add").onclick=()=>busy($("#s-add"),$("#s-status"),"Starting…",async()=>{
  const url=$("#s-url").value.trim(); if(!url) throw new Error("Enter the website URL.");
  const s=await api("/api/sites",{method:"POST",body:JSON.stringify({url,name:$("#s-name").value,product:$("#s-product").value,audience:$("#s-aud").value,business_type:$("#s-type").value,max_pages:+$("#s-max").value||200})});
  SITE_ID=s.id; await loadSites(s.id);
});
async function loadSite(){
  if(!SITE_ID){$("#site-overview").classList.add("hidden");return}
  const s=await api(`/api/sites/${SITE_ID}`);window._siteUrl=s.url; const typeChanged=CURRENT_SITE?.business_type!==s.business_type; CURRENT_SITE=s; if(typeChanged) renderPageTypes();
  $("#site-state").textContent=s.status==="ready"?`Read ${s.crawled_at||""}`:s.status==="error"?`Error: ${s.error}`:s.status;
  clearTimeout(pollTimer);
  if(String(s.status).startsWith("crawling")||s.status==="new"){pollTimer=setTimeout(loadSite,3000)}
  else if(s.status==="ready"){ $("#site-select").querySelector(`option[value="${SITE_ID}"]`).textContent=`${s.name||s.url} (${s.page_count} pages)`; }
  const sm=s.summary||{}; const ov=$("#site-overview"); ov.classList.remove("hidden");
  const st=(v,l)=>`<div class="stat"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`;
  const crawling=String(s.status).startsWith("crawling")||s.status==="new";
  ov.innerHTML=`<h2>${esc(s.name||s.url)}</h2><div class="row" style="justify-content:space-between"><p class="status ${crawling?"spin":""}" style="margin:0">${esc(s.url)} · ${s.status==="ready"?"pages read":esc(s.status)}</p>${crawling?`<button class="btn ghost small" id="site-stop">Stop reading</button>`:""}</div>
   ${s.notice?`<div class="verdict related" style="margin-top:10px">${esc(s.notice)}</div>`:""}
   <details style="margin-top:12px" id="inow-box"><summary><b>Instant indexing (IndexNow)</b> <span class="status">(tell Bing and other search engines the moment pages change)</span></summary><div id="inow-form" style="margin-top:10px"></div></details>
   <details style="margin-top:12px" id="pub-box"><summary><b>Publishing</b> <span class="status">(send approved pages to WordPress as drafts)</span></summary><div id="pub-form" style="margin-top:10px"></div></details>
   <div class="row" style="margin-top:10px"><label for="site-type" class="status" style="margin:0">Type of website${s.business_type_guessed&&s.business_type?" (detected)":""}:</label>
     <select id="site-type" style="width:auto">${Object.entries(BUSINESS_TYPES).map(([k,v])=>`<option value="${k}" ${k===s.business_type?"selected":""}>${esc(v.label)}${v.ymyl?" (needs expert review)":""}</option>`).join("")}${s.business_type?"":`<option value="" selected>Not set yet</option>`}</select>
     <span class="status" id="site-type-msg"></span></div>${s.status==="error"&&s.error?`<div class="verdict exists" style="margin-top:10px">${esc(s.error)}</div>`:""}
   <div class="stats">${st(sm.urls_discovered??"–","URLs on the site")}${st(s.page_count,"pages read")}${st(sm.median_word_count??"–","median words")}
   ${st((sm.languages||[]).length||"–","languages")}${st((sm.thin_pages_under_300_words||[]).length,"thin pages")}${st(sm.pages_with_author_signal!=null?sm.pages_with_author_signal+"/"+s.page_count:"–","show an author")}</div>
   <div class="grid2"><div class="block"><h3>Pages by what searchers want</h3>${donut(Object.entries(s.intent_counts||{}).sort((a,b)=>b[1]-a[1]).map(([k,v],i)=>({label:INTENT_LABEL[k]||k,value:v,color:PAL[i%PAL.length]})),{sub:"pages"})||"<p class='status'>Not read yet.</p>"}</div>
   <div class="block"><h3>Largest sections of the site</h3>${hbars((sm.sections||[]).slice(0,8).map(x=>({label:x[0],value:x[1]})))||"<p class='status'>Not read yet.</p>"}</div></div>
   ${(sm.repeated_title_patterns||[]).length?`<div class="block"><h3>Repeated title patterns</h3>${list(sm.repeated_title_patterns.map(x=>`"${x[0]}…" × ${x[1]}`))}</div>`:""}
   <div class="row"><button class="btn ghost" id="recrawl">Read again</button><button class="btn ghost" id="site-del">Remove this website</button></div>`;
  renderPublishing(s); renderIndexNow(s).catch(()=>{});
  const stSel=$("#site-type"); if(stSel) stSel.onchange=async()=>{ await api(`/api/sites/${SITE_ID}`,{method:"PATCH",body:JSON.stringify({business_type:stSel.value})}); if(CURRENT_SITE) { CURRENT_SITE.business_type=stSel.value; renderPageTypes(); } $("#site-type-msg").textContent=BUSINESS_TYPES[stSel.value]?.ymyl?"Saved. Pages for this website will always be fact-checked and flagged for expert review.":"Saved. New pages will be written for this type of website."; };
  const stp=$("#site-stop"); if(stp) stp.onclick=async()=>{ stp.disabled=true; stp.textContent="Stopping…"; await api(`/api/sites/${SITE_ID}/stop-crawl`,{method:"POST"}); };
  $("#recrawl").onclick=async()=>{await api(`/api/sites/${SITE_ID}/recrawl`,{method:"POST"});loadSite();};
  let delArm=false; $("#site-del").onclick=async()=>{ if(!delArm){delArm=true;$("#site-del").textContent="Click again to remove it and all its data";return;} await api(`/api/sites/${SITE_ID}`,{method:"DELETE"}); SITE_ID=null; await loadSites(); show("site"); };
}

// strategy
// ---------- content ideas ----------
let STRAT=null, ST_TAB="ideas";
const EV_LABEL={google:"Google",keyword:"Keyword",ai:"AI answers",site:"Site",judgement:"Judgement"};
const FUNNEL_LABEL={awareness:"Awareness (learn)",consideration:"Consideration (compare, how-to)",decision:"Decision (buy)"};
const PLAN_STATUS=["planned","writing","review","approved","dropped"];
function stTab(t){ ST_TAB=t; document.querySelectorAll("#st-tabs [data-stt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.stt===t))); document.querySelectorAll("[data-stp]").forEach(p=>p.classList.toggle("hidden",p.dataset.stp!==t));
  if(t==="plan") loadPlan().catch(()=>{}); if(t==="review") renderReview(); }
document.querySelectorAll("#st-tabs [data-stt]").forEach(b=>b.onclick=()=>stTab(b.dataset.stt));
async function loadStrategy(){ if(!SITE_ID) return; STRAT=await api(`/api/sites/${SITE_ID}/strategy-v2`).catch(()=>null); renderStrategy(); if(ST_TAB!=="ideas") stTab(ST_TAB); }
function ideaNotes(it){ return [it.angle?`Angle: ${it.angle}`:"",it.information_gain?`Original material to include: ${it.information_gain}`:"",(it.evidence||[]).length?`Evidence: ${it.evidence.map(e=>e.detail).join("; ")}`:""].filter(Boolean).join("\n"); }
function writeIdea(it){ prefillWrite(it.keyword,it.intent); if(it.page_type&&$(`#g-type option[value="${it.page_type}"]`)) $("#g-type").value=it.page_type; $("#g-notes").value=ideaNotes(it); }
function renderStrategy(){
  const d=STRAT;
  if(!d){ $("#st-meta").textContent=""; $("#st-out").innerHTML=`<div class="panel">${emptyBox("No ideas yet","Click Find content ideas. The more data you've added (keywords, Google search data, AI answer checks), the better the ideas.")}</div>`; return; }
  const eu=d.evidence_used||{};
  $("#st-meta").innerHTML=`Last run ${esc(fmtDate(d.at))}${d.focus?` · focus: “${esc(d.focus)}”`:""} · Based on ${eu.keyword_gaps||0} keyword gaps, ${(eu.google_near_page_one||0)+(eu.google_searches_without_a_page||0)} Google searches and ${eu.ai_gaps||0} AI-answer gaps.${!(eu.google_near_page_one||eu.google_searches_without_a_page)?' <button class="linkbtn" data-go="gsc">Add Google data</button> for stronger ideas.':""}`;
  bindGo($("#st-meta"));
  const ideas=(d.clusters||[]).flatMap(c=>(c.ideas||[]).map(it=>({...it,cluster:c.name})));
  const funnel=["awareness","consideration","decision"].map((f,i)=>({label:FUNNEL_LABEL[f],value:ideas.filter(x=>x.funnel===f).length,color:PAL[i]}));
  const existing=Object.entries(d.existing_by_intent||{}).sort((a,b)=>b[1]-a[1]).map(([k,v],i)=>({label:INTENT_LABEL[k]||k,value:v,color:PAL[i%PAL.length]}));
  const covered=ideas.filter(x=>x.coverage&&x.coverage.status==="covered").length;
  $("#st-out").innerHTML=`<div class="grid2">
     ${card("Your pages today","What searchers want from the pages you already have",existing.length?hbars(existing):"<p class='status'>–</p>")}
     ${card("New ideas by funnel stage","Aim for a mix: people need to learn, compare and decide",hbars(funnel)+`<p class="status">${ideas.length} ideas in ${(d.clusters||[]).length} topic clusters${covered?` · ${covered} already covered by a page (shown greyed: improve those pages instead)`:""}.</p>`)}
   </div>
   <div class="panel"><div class="row" style="justify-content:space-between"><div class="row"><select id="st-f-funnel" style="width:auto" aria-label="Funnel stage"><option value="">All stages</option>${Object.entries(FUNNEL_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>
       <select id="st-f-pri" style="width:auto" aria-label="Priority"><option value="">All priorities</option><option>high</option><option>medium</option><option>low</option></select>
       <label class="check"><input type="checkbox" id="st-f-new" checked> Hide ideas you already have a page for</label></div>
       <div class="row"><button class="btn" id="st-add-plan">Add selected to plan</button><span class="status" id="st-sel-n"></span></div></div>
     <div id="st-clusters" style="margin-top:14px"></div></div>`;
  ["#st-f-funnel","#st-f-pri","#st-f-new"].forEach(id=>$(id).onchange=renderClusters); renderClusters();
  $("#st-add-plan").onclick=async()=>{ const sel=[...document.querySelectorAll("#st-clusters [data-isel]:checked")].map(c=>JSON.parse(c.dataset.isel));
    if(!sel.length){ $("#st-sel-n").textContent="Tick some ideas first."; return; }
    const r=await api(`/api/sites/${SITE_ID}/plan`,{method:"POST",body:JSON.stringify({items:sel})}); await loadStrategy(); $("#st-sel-n").textContent=`Added ${r.added} to your content plan.`; };
}
function renderClusters(){
  const d=STRAT, ff=$("#st-f-funnel").value, fp=$("#st-f-pri").value, hide=$("#st-f-new").checked;
  const evChip=e=>`<span class="ev ${esc(e.type)}" title="${esc(EV_LABEL[e.type]||e.type)}"><b>${esc(EV_LABEL[e.type]||e.type)}:</b> ${esc(e.detail)}</span>`;
  $("#st-clusters").innerHTML=(d.clusters||[]).map((c,ci)=>{
    const its=(c.ideas||[]).filter(it=>(!ff||it.funnel===ff)&&(!fp||it.priority===fp)&&(!hide||!(it.coverage&&it.coverage.status==="covered")));
    if(!its.length) return "";
    return `<div class="block"><h3 style="font-size:17px">${esc(c.name)}</h3>
      <div class="pillar">${c.pillar&&c.pillar.existing_url?`Pillar page you already have: <a class="url" href="${esc(c.pillar.existing_url)}" target="_blank" rel="noopener">${esc(c.pillar.existing_url)}</a>. Link every supporting page to it.`:`Pillar page to create: <b>${esc(c.pillar?.title_idea||c.pillar?.keyword||"")}</b>. The broad guide every supporting page links to.`}</div>
      ${its.map(it=>{ const cov=it.coverage&&it.coverage.status==="covered", dat=esc(JSON.stringify({keyword:it.keyword,title_idea:it.title_idea,intent:it.intent,page_type:it.page_type,funnel:it.funnel,angle:it.angle,information_gain:it.information_gain,evidence:it.evidence,priority:it.priority,cluster:c.name}));
        return `<div class="idea ${cov?"covered":""}"><input type="checkbox" data-isel="${dat}" ${it.in_plan||cov?"disabled":""} aria-label="Select idea" style="margin-top:4px">
         <div class="body"><div class="t">${it.is_pillar?'<span class="pill pass">Pillar</span> ':""}${esc(it.title_idea||it.keyword)}</div>
           <div class="status">Keyword: ${esc(it.keyword)} · ${esc(INTENT_LABEL[it.intent]||it.intent)} · ${esc((it.page_type||"").replace(/_/g," "))} · ${esc(FUNNEL_LABEL[it.funnel]||it.funnel||"")} · <span class="pill ${it.priority==="high"?"fail":it.priority==="medium"?"warn":""}">${esc(it.priority||"")}</span>${it.in_plan?' · <span class="pill pass">In your plan</span>':""}</div>
           ${cov?`<p class="warn" style="margin:6px 0 0">You already have a page for this: <a class="url" href="${esc(it.coverage.url)}" target="_blank" rel="noopener">${esc(it.coverage.url)}</a>. Improve it instead of writing a new one.</p>`:it.coverage&&it.coverage.status==="partial"?`<p class="status" style="margin:6px 0 0">Related page: <span class="url">${esc(it.coverage.url)}</span>. Make sure the new page has a clearly different purpose.</p>`:""}
           ${it.angle?`<p style="margin:6px 0 0"><b>Angle:</b> ${esc(it.angle)}</p>`:""}${it.information_gain?`<p class="status" style="margin:2px 0 0"><b>Original material:</b> ${esc(it.information_gain)}</p>`:""}
           <div>${(it.evidence||[]).map(evChip).join("")}</div></div>
         <div style="display:flex;flex-direction:column;gap:6px">${cov?`<button class="btn ghost small" data-icheck="${esc(it.keyword)}">Get update plan</button>`:`<button class="btn small" data-iwrite="${dat}">Write</button><button class="btn ghost small" data-icheck="${esc(it.keyword)}">Check</button>`}</div></div>`; }).join("")}</div>`; }).join("")||emptyBox("No ideas match these filters","");
  const out=$("#st-clusters");
  out.querySelectorAll("[data-iwrite]").forEach(b=>b.onclick=()=>writeIdea(JSON.parse(b.dataset.iwrite)));
  out.querySelectorAll("[data-icheck]").forEach(b=>b.onclick=()=>openCheck(b.dataset.icheck));
}
function renderReview(){
  const d=STRAT, el=$("#st-review");
  if(!d){ el.innerHTML=`<div class="panel">${emptyBox("No review yet","Run Find content ideas on the Ideas tab: it also reviews your site.")}</div>`; return; }
  const sev=v=>v==="high"?"fail":v==="medium"?"warn":"pass";
  el.innerHTML=`<div class="panel"><div class="row" style="align-items:flex-start;flex-wrap:nowrap"><div style="flex:1"><h2>What your site covers</h2><p style="margin:6px 0 0">${esc(d.summary||"")}</p></div>
     <div class="kpi">${ring((d.fit_score||0)*10,{label:"topical fit",text:`${d.fit_score||0}/10`})}<div class="lbl">How well your content<br>fits your product</div></div></div>
     <div class="grid2" style="margin-top:14px"><div class="block"><h3>Strengths</h3>${list(d.strengths)}</div><div class="block"><h3>Sections</h3>${(d.section_review||[]).length?`<div class="tw"><table><tr><th>Section</th><th>Verdict</th><th>Why</th></tr>${d.section_review.map(r=>`<tr><td>${esc(r.section)}</td><td class="act">${esc(r.verdict)}</td><td>${esc(r.reason)}</td></tr>`).join("")}</table></div>`:"<p class='status'>–</p>"}</div></div></div>
   ${(d.risks||[]).length?`<div class="panel"><h2>Risks under Google's rules</h2><div class="tw" style="margin-top:10px"><table><tr><th>Issue</th><th>Evidence</th><th>Severity</th><th>Fix</th></tr>${d.risks.map(r=>`<tr><td>${esc(r.issue)}</td><td>${esc(r.evidence)}</td><td><span class="pill ${sev(r.severity)}">${esc(r.severity)}</span></td><td>${esc(r.fix)}</td></tr>`).join("")}</table></div></div>`:""}
   ${(d.pages_to_improve||[]).length?`<div class="panel"><h2>Existing pages to improve</h2><p class="lead">Often faster than writing new pages.</p><div class="tw"><table><tr><th>Page</th><th>Why</th><th>What to add</th><th><span class="sr-only">Actions</span></th></tr>${d.pages_to_improve.map(r=>`<tr><td class="url">${esc(r.url)}</td><td>${esc(r.why)}</td><td>${esc(r.what_to_add)}</td><td>${r.keyword?`<button class="btn ghost small" data-icheck="${esc(r.keyword)}">Get update plan</button>`:""}</td></tr>`).join("")}</table></div></div>`:""}`;
  el.querySelectorAll("[data-icheck]").forEach(b=>b.onclick=()=>openCheck(b.dataset.icheck));
}
async function loadPlan(){
  const all=await api(`/api/sites/${SITE_ID}/plan`), el=$("#st-plan");
  if(!all.length){ el.innerHTML=`<div class="panel">${emptyBox("Your content plan is empty","Tick ideas on the Ideas tab and click Add selected to plan.")}</div>`; return; }
  const months=[...new Set(all.map(x=>x.month||""))].sort(), mName=m=>{ if(!m) return "No month"; const [y,mm]=m.split("-"); return new Date(Date.UTC(+y,+mm-1,1)).toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"}); };
  const cnt=st=>all.filter(x=>x.status===st).length;
  el.innerHTML=`<div class="grid4">${["planned","writing","review","approved"].map(st=>`<div class="panel kpi"><div><div class="num">${cnt(st)}</div><div class="lbl">${st==="review"?"ready for review":st}</div></div></div>`).join("")}</div>
   <div class="panel"><div class="row" style="justify-content:space-between"><p class="status" style="margin:0">Statuses update by themselves when a page is written (writing), passes checks (review) or is approved.</p><button class="btn ghost small" id="pl-csv">Export CSV</button></div>
   ${months.map(m=>{ const its=all.filter(x=>(x.month||"")===m), done=its.filter(x=>x.status==="approved").length;
     return `<div class="month"><h3>${esc(mName(m))} <span class="status">${its.length} page${its.length>1?"s":""}</span></h3><div style="width:200px">${hbars([{label:"Approved",value:done,color:"var(--good)"}],{max:its.length||1,fmt:v=>`${v}/${its.length}`})}</div></div>
       ${its.map(x=>`<div class="plan-item" data-pid="${x.id}"><div style="min-width:0"><b>${esc(x.title)}</b><br><span class="status">${esc(x.keyword)} · ${esc((x.page_type||"").replace(/_/g," "))}${x.cluster?` · ${esc(x.cluster)}`:""}</span></div>
         <select class="inline-edit" data-pf="status" aria-label="Status">${PLAN_STATUS.map(st=>`<option value="${st}" ${st===x.status?"selected":""}>${st==="review"?"ready for review":st}</option>`).join("")}</select>
         <input class="inline-edit" type="month" data-pf="month" value="${esc(x.month||"")}" aria-label="Month">
         <input class="inline-edit" data-pf="owner" placeholder="Writer" value="${esc(x.owner||"")}" aria-label="Writer">
         <div class="row" style="flex-wrap:nowrap">${x.content_id?`<button class="btn ghost small" data-popen="${x.content_id}">Open page</button>`:`<button class="btn small" data-pwrite="${x.id}">Write</button>`}<button class="btn ghost small" data-pdel="${x.id}" aria-label="Remove from plan">✕</button></div></div>`).join("")}`; }).join("")}</div>`;
  el.querySelectorAll("[data-pf]").forEach(inp=>inp.onchange=async()=>{ const pid=+inp.closest("[data-pid]").dataset.pid; await api(`/api/sites/${SITE_ID}/plan/${pid}`,{method:"PATCH",body:JSON.stringify({[inp.dataset.pf]:inp.value})}); if(inp.dataset.pf!=="owner") loadPlan(); });
  el.querySelectorAll("[data-pdel]").forEach(b=>b.onclick=async()=>{ await api(`/api/sites/${SITE_ID}/plan/${b.dataset.pdel}`,{method:"DELETE"}); loadPlan(); });
  el.querySelectorAll("[data-pwrite]").forEach(b=>b.onclick=()=>writeIdea(all.find(x=>x.id===+b.dataset.pwrite)));
  el.querySelectorAll("[data-popen]").forEach(b=>b.onclick=async()=>{ const c=await api(`/api/contents/${b.dataset.popen}`); await openInLibrary(c); });
  $("#pl-csv").onclick=()=>api(`/api/sites/${SITE_ID}/plan/export.csv`);
}
$("#st-run").onclick=()=>{if(!needSite($("#st-status"),true))return;busy($("#st-run"),$("#st-status"),"Starting…",async()=>{
  STRAT=await api(`/api/sites/${SITE_ID}/strategy-v2`,{method:"POST",body:JSON.stringify({focus:$("#st-focus").value.trim()}),onProgress:m=>{$("#st-status").dataset.progress="1";$("#st-status").textContent=m;}});
  renderStrategy(); });};
function bindUse(root){root.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>{const o=JSON.parse(b.dataset.use);$("#g-kw").value=o.k;if(o.i)$("#g-intent").value=o.i;if(o.t)$("#g-type").value=o.t;show("generate");});}

// keyword check
const ACTION_VIEW={create:["create","Create a new page","Nobody on your site serves this search yet."],update:["update","Improve your existing page","You already have a page for this search. Make it better instead of writing a duplicate."],
  merge:["merge","Combine competing pages","Several of your pages compete for this search. Merge them into one strong page."],redirect:["redirect","Redirect a duplicate page","A duplicate page should point to your main page."],
  keep:["keep","Keep your current page","Your page already serves a distinct purpose."],skip:["skip","Not worth a page","This search is off-topic, too thin, or better as a section of another page."],review:["keep","Review this keyword",""]};
const TYPE_LABEL={guide:"Guide",listicle:"List",comparison:"Comparison",tool:"Tool",product_page:"Product page",template:"Template",video:"Video",forum:"Forum",news:"News",docs:"Docs",other:"Other"};
let CHECK=null;
function fmtDate(t){try{return new Date(t).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch{return "";}}
async function loadRecent(){ if(!SITE_ID){$("#k-recent").innerHTML="";return;}
  const r=await api(`/api/sites/${SITE_ID}/keyword-check/recent`).catch(()=>[]);
  $("#k-recent").innerHTML=r.length?`<div class="chips"><span class="status">Recent checks (open free, no AI cost):</span>${r.map(x=>`<button class="chip" data-recent="${esc(x.keyword)}">${esc(x.keyword)}</button>`).join("")}</div>`:"";
  $("#k-recent").querySelectorAll("[data-recent]").forEach(b=>b.onclick=()=>openCheck(b.dataset.recent));
}
async function openCheck(kw,runIfMissing=true){
  $("#k-kw").value=kw; show("keyword");
  const saved=await api(`/api/sites/${SITE_ID}/keyword-check/saved?keyword=${encodeURIComponent(kw)}`).catch(()=>null);
  if(saved){ CHECK=saved; renderCheck(); } else if(runIfMissing) $("#k-run").click();
}
function researchNotes(c){
  const s=c.serp||{}, a=c.analysis||{}, out=[];
  if(a.intent_explanation) out.push(`Searcher wants: ${a.intent_explanation}`);
  if(s.searched){
    if(s.recommended_angle) out.push(`Angle: ${s.recommended_angle}`);
    if((s.must_cover||[]).length) out.push(`Cover what top pages cover: ${s.must_cover.map(x=>x.topic).join("; ")}`);
    if((s.questions||[]).length) out.push(`Answer these questions: ${s.questions.join(" ")}`);
    if((s.gaps||[]).length) out.push(`Win on what others miss: ${s.gaps.join("; ")}`);
  }
  return out.join("\n");
}
function writeFromCheck(kw,intent,pageType){
  prefillWrite(kw,intent);
  if(pageType&&$(`#g-type option[value="${pageType}"]`)) $("#g-type").value=pageType;
  if(CHECK&&CHECK.keyword===kw) $("#g-notes").value=researchNotes(CHECK);
}
function renderCheck(){
  const d=CHECK, v=d.verdict||{}, a=d.analysis||{}, s=d.serp, kw=d.keyword;
  const intent=a.dominant_intent||v.keyword_intent, [cls,title,sub]=ACTION_VIEW[d.action]||ACTION_VIEW.review;
  const pt=(s&&s.searched&&s.recommended_page_type)||"";
  const primaryBtn = d.action==="create" ? `<button class="btn" data-k-write>Write this page</button>`
    : (["update","merge","keep"].includes(d.action)&&d.primary_url) ? `<button class="btn" data-k-plan>Get an update plan</button>`
    : `<button class="btn ghost" data-k-tab="angles">See other angles</button>`;
  const comp=s&&s.searched&&s.competition?s.competition:null;
  $("#k-out").innerHTML=`
   <div class="panel decision ${cls}">
     <div style="flex:1;min-width:260px"><p class="status" style="margin:0 0 4px">Recommendation for “${esc(kw)}”</p><h2>${esc(title)}</h2>
       <p class="why">${esc(a.decision_reason||sub)}</p>
       ${d.primary_url?`<p style="margin:8px 0 0"><span class="status">Your page:</span> <a href="${esc(d.primary_url)}" target="_blank" rel="noopener" class="url">${esc(d.primary_url)}</a></p>`:""}</div>
     <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${primaryBtn}<span class="status">Checked ${esc(fmtDate(d.checked_at))} · <button class="linkbtn" data-k-recheck>Check again</button></span></div>
   </div>
   <div class="grid3">
     <div class="panel mini-card"><div class="lbl">What the searcher wants</div><div class="val">${esc(INTENT_LABEL[intent]||intent||"–")}</div><p class="status" style="margin:6px 0 0">${esc(a.intent_explanation||"")}</p></div>
     <div class="panel mini-card"><div class="lbl">What Google tends to show</div><div class="val">${esc((s&&s.searched&&s.dominant_format)||a.serp_format_expected||"–")}</div>${s&&s.searched&&s.length_note?`<p class="status" style="margin:6px 0 0">${esc(s.length_note)}</p>`:""}</div>
     <div class="panel mini-card"><div class="lbl">Competition</div><div class="val">${comp?`<span class="pill ${comp.level==="high"?"fail":comp.level==="medium"?"warn":"pass"}">${esc(comp.level)}</span>`:"Not researched"}</div><p class="status" style="margin:6px 0 0">${esc(comp?comp.reason:"Turn on “Research what currently ranks” to see who you're up against.")}</p></div>
   </div>
   <div class="panel">
     <div class="tabs2" role="group" id="k-tabs"><button aria-pressed="true" data-kct="ranks">What ranks now</button><button aria-pressed="false" data-kct="mine">Your pages</button><button aria-pressed="false" data-kct="angles">Other angles</button></div>
     <div data-kcp="ranks">${renderRanks(s)}</div>
     <div data-kcp="mine" class="hidden">${renderMine(d)}</div>
     <div data-kcp="angles" class="hidden">${renderAngles(d)}</div>
   </div>
   <div id="k-plan">${d.update_plan?renderPlan(d.update_plan):""}</div>`;
  const out=$("#k-out");
  const tab=t=>{out.querySelectorAll("[data-kct]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.kct===t)));out.querySelectorAll("[data-kcp]").forEach(x=>x.classList.toggle("hidden",x.dataset.kcp!==t));};
  out.querySelectorAll("[data-kct]").forEach(b=>b.onclick=()=>tab(b.dataset.kct));
  out.querySelectorAll("[data-k-tab]").forEach(b=>b.onclick=()=>{tab(b.dataset.kTab);out.querySelector("#k-tabs").scrollIntoView({behavior:"smooth",block:"start"});});
  const w=out.querySelector("[data-k-write]"); if(w) w.onclick=()=>writeFromCheck(kw,intent,pt);
  out.querySelectorAll("[data-angle]").forEach(b=>b.onclick=()=>{const o=JSON.parse(b.dataset.angle);prefillWrite(o.k,o.i);if(o.t&&$(`#g-type option[value="${o.t}"]`))$("#g-type").value=o.t;});
  const rc=out.querySelector("[data-k-recheck]"); if(rc) rc.onclick=()=>{$("#k-kw").value=kw;$("#k-run").click();};
  const pl=out.querySelector("[data-k-plan]"); if(pl) pl.onclick=()=>{ if(!needAI($("#k-status")))return; busy(pl,$("#k-status"),"Reading your page and comparing it with what ranks… about 30 seconds.",async()=>{
    const plan=await api(`/api/sites/${SITE_ID}/keyword-check/update-plan`,{method:"POST",body:JSON.stringify({keyword:kw,url:d.primary_url})});
    CHECK.update_plan=plan; $("#k-plan").innerHTML=renderPlan(plan); bindPlan(); $("#k-plan").scrollIntoView({behavior:"smooth",block:"start"});});};
  bindPlan();
}
function renderRanks(s){
  if(!s) return emptyBox("Rankings not researched","Tick “Research what currently ranks” and check again to see the top results, what they cover and what they miss.");
  if(!s.searched) return emptyBox("Couldn't research current rankings",s.error||"The AI couldn't search the web for this keyword.");
  const mix=(s.format_mix||[]).filter(x=>x.count>0).map((x,i)=>({label:TYPE_LABEL[x.type]||x.type,value:x.count,color:PAL[i%PAL.length]}));
  return `<p class="status">${s.via?`From ${esc(s.via)} search results, analysed by your AI`:"From a web search by your AI provider"}: a close guide to what ranks, not an exact Google ranking.</p>
   <div class="grid2" style="margin-top:12px"><div><h3 style="font-size:15px;margin-bottom:8px">Pages that rank</h3>
     <ol class="c" style="padding-left:20px">${(s.results||[]).map(r=>`<li style="margin:8px 0"><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title)}</b></a> <span class="pill">${esc(TYPE_LABEL[r.type]||r.type||"")}</span><br><span class="status">${esc(r.angle||"")}</span></li>`).join("")}</ol></div>
     <div><h3 style="font-size:15px;margin-bottom:8px">Types of page ranking</h3>${hbars(mix)||"<p class='status'>Not available.</p>"}
       ${(s.must_cover||[]).length?`<h3 style="font-size:15px;margin:18px 0 8px">Topics top pages cover</h3>${hbars(s.must_cover.map(x=>({label:x.topic,value:{most:3,some:2,few:1}[x.share]||1,color:x.share==="most"?"var(--c1)":x.share==="some"?"var(--c2)":"var(--c5)"})),{max:3,fmt:v=>["","few","some","most"][v]})}`:""}</div></div>
   <div class="grid2"><div><h3 style="font-size:15px;margin-bottom:8px">Questions searchers ask</h3>${list(s.questions)||"<p class='status'>None found.</p>"}</div>
     <div><h3 style="font-size:15px;margin-bottom:8px">Your opportunity: what top pages miss</h3>${(s.gaps||[]).map(g=>`<div class="gap-item">${esc(g)}</div>`).join("")||"<p class='status'>None found.</p>"}
       ${s.recommended_angle?`<p style="margin-top:12px"><b>Suggested angle:</b> ${esc(s.recommended_angle)}</p>`:""}</div></div>`;
}
function renderMine(d){
  const a=d.analysis||{};
  return `${d.matches.length?`<div class="tw"><table><tr><th>Your page</th><th>Searcher intent</th><th>Match</th></tr>${d.matches.map(m=>`<tr><td>${esc(m.title)}<br><a class="url" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a></td><td>${esc(INTENT_LABEL[m.intent]||m.intent)}${m.same_intent?' <span class="pill fail">same intent</span>':""}</td><td>${Math.round(m.similarity*100)}%</td></tr>`).join("")}</table></div>`:emptyBox("No related pages","Nothing on your site targets this search yet.")}
   ${(a.consolidation||[]).length?`<div class="block"><h3>Combine competing pages</h3><div class="tw"><table><tr><th>Page</th><th>Action</th><th>Why</th></tr>${a.consolidation.map(x=>`<tr><td class="url">${esc(x.url)}</td><td class="act">${esc(x.action)}</td><td>${esc(x.reason)}</td></tr>`).join("")}</table></div></div>`:""}
   ${(a.link_to_new_page_from||[]).length?`<div class="block"><h3>Pages that should link to the page for this search</h3>${list(a.link_to_new_page_from.map(l=>`${l.url} (link text: “${l.anchor}”)`))}</div>`:""}`;
}
function renderAngles(d){
  const a=d.analysis||{}, v=d.verdict||{}, opts=a.different_intent_options||[];
  return `<p class="lead">Searches around the same topic with a different intent, which a <b>separate</b> page could serve without competing with your existing pages.</p>
   ${opts.length?`<div class="tw"><table><tr><th>Search</th><th>Searcher wants</th><th>How it differs</th><th><span class="sr-only">Actions</span></th></tr>${opts.map(o=>`<tr><td><b>${esc(o.keyword)}</b><br><span class="status">${esc(o.title_idea||"")}</span></td><td>${esc(INTENT_LABEL[o.intent]||o.intent||"")}</td><td>${esc(o.angle||"")}</td><td><button class="btn ghost small" data-angle='${esc(JSON.stringify({k:o.keyword,i:o.intent,t:o.page_type}))}'>Write</button></td></tr>`).join("")}</table></div>`:emptyBox("No other angles suggested","")}
   ${(v.open_intents||[]).length?`<p class="status" style="margin-top:10px">Intents your site doesn't cover for this topic yet: ${esc(v.open_intents.map(x=>INTENT_LABEL[x]||x).join(", "))}</p>`:""}`;
}
function renderPlan(p){
  const pri=x=>`<span class="pill ${x==="high"?"fail":x==="medium"?"warn":""}">${esc(x||"")}</span>`;
  return `<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-start">
     <div style="flex:1;min-width:240px"><h2>Update plan</h2><p class="status" style="margin:4px 0 8px">For <span class="url">${esc(p.page?.url||"")}</span> · ${esc(fmtDate(p.created_at))}</p><p style="margin:0">${esc(p.verdict||"")}</p></div>
     <div class="kpi">${ring(p.fit_score||0,{label:"fit"})}<div class="lbl">How well it fits<br>the search today</div></div></div>
   ${(p.first_three_steps||[]).length?`<div class="block"><h3>Do these first</h3><ol class="steps">${p.first_three_steps.map((x,i)=>`<li><span class="n">${i+1}</span><span class="t">${esc(x)}</span></li>`).join("")}</ol></div>`:""}
   ${(p.add_sections||[]).length?`<div class="block"><h3>Sections to add</h3><div class="tw"><table><tr><th>Heading</th><th>Why</th><th>Priority</th></tr>${p.add_sections.map(x=>`<tr><td><b>${esc(x.heading)}</b></td><td>${esc(x.why)}</td><td>${pri(x.priority)}</td></tr>`).join("")}</table></div></div>`:""}
   ${(p.rewrite||[]).length?`<div class="block"><h3>Rewrite</h3><div class="tw"><table><tr><th>What</th><th>Now</th><th>Suggested</th><th>Why</th></tr>${p.rewrite.map(x=>`<tr><td>${esc(x.what)}</td><td class="status">${esc(x.current||"")}</td><td><b>${esc(x.suggested||"")}</b></td><td class="status">${esc(x.why||"")}</td></tr>`).join("")}</table></div></div>`:""}
   <div class="grid2"><div class="block"><h3>Questions to answer</h3>${list(p.questions_to_answer)||"<p class='status'>None.</p>"}</div><div class="block"><h3>Proof to add</h3>${list(p.proof_to_add)||"<p class='status'>None.</p>"}</div></div>
   <div class="grid2"><div class="block"><h3>Keep</h3>${list(p.keep)||"<p class='status'>–</p>"}</div><div class="block"><h3>Remove or trim</h3>${list(p.remove_or_trim)||"<p class='status'>Nothing.</p>"}</div></div>
   ${(p.internal_links||[]).length?`<div class="block"><h3>Internal links</h3>${list(p.internal_links)}</div>`:""}
   <div class="row"><button class="btn ghost" data-plan-dl>Download plan</button></div></div>`;
}
function bindPlan(){ const b=$("#k-plan [data-plan-dl]"); if(!b||!CHECK||!CHECK.update_plan) return; const p=CHECK.update_plan;
  b.onclick=()=>{ const L=a=>(a||[]).map(x=>"- "+x).join("\n");
    download(`update-plan-${CHECK.keyword.replace(/\W+/g,"-")}.md`,`# Update plan: ${CHECK.keyword}\n\nPage: ${p.page?.url||""}\nFit today: ${p.fit_score}/100. ${p.verdict||""}\n\n## Do these first\n${(p.first_three_steps||[]).map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\n## Sections to add\n${(p.add_sections||[]).map(x=>`- **${x.heading}** (${x.priority}): ${x.why}`).join("\n")}\n\n## Rewrite\n${(p.rewrite||[]).map(x=>`- ${x.what}: "${x.suggested}" (now: "${x.current||""}"). ${x.why||""}`).join("\n")}\n\n## Questions to answer\n${L(p.questions_to_answer)}\n\n## Proof to add\n${L(p.proof_to_add)}\n\n## Keep\n${L(p.keep)}\n\n## Remove or trim\n${L(p.remove_or_trim)}\n\n## Internal links\n${L(p.internal_links)}\n`,"text/markdown"); };
}
$("#k-run").onclick=()=>{if(!needSite($("#k-status"),true))return;const kw=$("#k-kw").value.trim();if(!kw){$("#k-status").textContent="Enter a keyword.";$("#k-status").classList.add("err");return}
 busy($("#k-run"),$("#k-status"),"Starting…",async()=>{
  CHECK=await api(`/api/sites/${SITE_ID}/keyword-check`,{method:"POST",body:JSON.stringify({keyword:kw,research:$("#k-research").checked}),onProgress:m=>{$("#k-status").dataset.progress="1";$("#k-status").textContent=m;}});
  renderCheck(); loadRecent();
 });};
$("#k-kw").onkeydown=e=>{if(e.key==="Enter")$("#k-run").click();};

// ---------- write form helpers ----------
const STYLE_FIELDS=[["tone","st-tone"],["reading_level","st-level"],["person","st-person"],["spelling","st-spell"],["avoid","st-avoid"],["cta","st-cta"],["write_mode","st-mode"],["language","st-language"],["notes","st-notes"]];
async function loadStyle(){ if(!SITE_ID) return; const s=await api(`/api/sites/${SITE_ID}/style`).catch(()=>({}));
  STYLE_FIELDS.forEach(([k,id])=>$("#"+id).value=s[k]||""); const n=STYLE_FIELDS.filter(([k])=>s[k]).length;
  $("#g-style-sum").textContent=n?`· ${n} rule${n>1?"s":""} set${s.tone?`: ${s.tone}`:""}`:"· not set yet (optional)"; }
$("#st-save").onclick=()=>{ if(!needSite($("#sty-status")))return; busy($("#st-save"),$("#sty-status"),"Saving…",async()=>{
  const s={}; STYLE_FIELDS.forEach(([k,id])=>{const v=$("#"+id).value.trim(); if(v) s[k]=v;}); await api(`/api/sites/${SITE_ID}/style`,{method:"POST",body:JSON.stringify(s)}); await loadStyle(); $("#sty-status").textContent="Saved for this website."; }); };
async function loadAuthors(){ const a=await api("/api/authors").catch(()=>[]); $("#authors-list").innerHTML=a.map(x=>`<option value="${esc(x)}">`).join(""); if(!$("#g-author").value&&a[0]) $("#g-author").value=a[0]; }
let kwInfoT=null;
async function kwInfo(){ const kw=$("#g-kw").value.trim(), box=$("#g-kwinfo"); if(!kw||!SITE_ID){box.innerHTML="";return;}
  const [saved,cov]=await Promise.all([api(`/api/sites/${SITE_ID}/keyword-check/saved?keyword=${encodeURIComponent(kw)}`).catch(()=>null),api(`/api/sites/${SITE_ID}/coverage?keyword=${encodeURIComponent(kw)}`).catch(()=>null)]);
  if($("#g-kw").value.trim()!==kw) return;
  const parts=[];
  if(cov&&cov.status==="covered") parts.push(`<span class="fail">⚠ You already have a page for this: <a class="url" href="${esc(cov.url)}" target="_blank" rel="noopener">${esc(cov.url)}</a></span>`);
  else if(cov&&cov.status==="partial") parts.push(`<span class="warn">Related page: <a class="url" href="${esc(cov.url)}" target="_blank" rel="noopener">${esc(cov.url)}</a></span>`);
  if(saved){ const label=(ACTION_VIEW[saved.action]||ACTION_VIEW.review)[1]; parts.push(`<span class="pass">✓ Checked ${esc(fmtDate(saved.checked_at))}: ${esc(label)}.${saved.serp&&saved.serp.searched?" Its research on what ranks will be used.":""}</span> <button class="linkbtn" data-kwi-open>View</button>`); }
  else parts.push(`Not checked yet. <button class="linkbtn" data-kwi-check>Check this keyword first</button> <span class="status">(recommended: researches what ranks and feeds it into the page)</span>`);
  box.innerHTML=parts.join("<br>");
  const o=box.querySelector("[data-kwi-open]"); if(o) o.onclick=()=>openCheck(kw,false);
  const c=box.querySelector("[data-kwi-check]"); if(c) c.onclick=()=>{ $("#k-kw").value=kw; show("keyword"); $("#k-run").click(); };
}
$("#g-kw").addEventListener("input",()=>{ clearTimeout(kwInfoT); kwInfoT=setTimeout(kwInfo,350); });

// generate
async function checkResume(){
  const j=SITE_ID?await api(`/api/sites/${SITE_ID}/generate/checkpoint`).catch(()=>null):null, el=$("#g-resume");
  if(!j||Date.now()-(j.at||0)>7*864e5){ el.classList.add("hidden"); return; }
  const stepName=j.step===2&&j.sections_done?`while writing section ${j.sections_done+1} of ${j.sections_total} (${j.sections_done} already done)`:({2:"after planning",3:"after writing"}[j.step]||`at step ${j.step}`);
  el.innerHTML=`<div class="verdict related" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span>Writing “${esc(j.keyword)}” stopped ${esc(stepName)}. Resume to continue without paying for the finished steps again.</span><span class="row"><button class="btn small" id="g-resume-go">Resume</button><button class="btn ghost small" id="g-resume-drop">Discard</button></span></div>`;
  el.classList.remove("hidden");
  $("#g-resume-go").onclick=()=>{ $("#g-kw").value=j.keyword; $("#g-intent").value=j.intent; $("#g-type").value=j.page_type; RESUME=true; $("#g-run").click(); };
  $("#g-resume-drop").onclick=async()=>{ await api(`/api/sites/${SITE_ID}/generate/checkpoint`,{method:"DELETE"}); el.classList.add("hidden"); };
}
let RESUME=false;
function setSteps(n){ document.querySelectorAll("#g-steps li").forEach(li=>{const k=+li.dataset.step;li.className=k<n?"done":k===n?"now":"";}); }
$("#g-run").onclick=()=>{if(!needSite($("#g-status"),true))return;busy($("#g-run"),$("#g-status"),"Starting… this takes 2–6 minutes. Keep this tab open.",async()=>{
  const body={keyword:$("#g-kw").value.trim(),intent:$("#g-intent").value,page_type:$("#g-type").value,audience:$("#g-aud").value,notes:$("#g-notes").value,author:$("#g-author").value.trim(),override_duplicate:$("#g-override").checked,verify_claims:$("#g-verify").checked,resume:RESUME}; RESUME=false;
  if(!body.keyword) throw new Error("Enter a keyword.");
  setSteps(0); $("#g-steps").classList.remove("hidden"); $("#g-out").innerHTML="";   // don't leave the previous page on screen while a new one is written
  try{
    const d=await api(`/api/sites/${SITE_ID}/generate`,{method:"POST",body:JSON.stringify(body),onProgress:m=>{$("#g-status").dataset.progress="1";$("#g-status").textContent=m+" Keep this tab open.";const n=(m.match(/\((\d)\/4\)/)||[])[1];if(n)setSteps(+n);}});
    setSteps(5); $("#g-resume").classList.add("hidden");
    const item=await api(`/api/contents/${d.id}`); renderItem(item,$("#g-out")); loadAuthors();
    if(item.status==="ready_for_human_review") chatEvent("approval",`Ready for review: ${item.title||item.keyword}`,[`Keyword: ${item.keyword}`,`Written for ${CURRENT_SITE?.name||window._siteUrl||"your website"}. Open My pages to review and approve it.`]);
  } finally { setTimeout(()=>$("#g-steps").classList.add("hidden"),1200); }
});};
$("#g-run").addEventListener("click",()=>setTimeout(function wait(){ if($("#g-run").disabled) return setTimeout(wait,500); if($("#g-status").classList.contains("err")) checkResume(); },800));
const GATE={approved:"Approved",ready_for_human_review:"Ready for human review",improve_before_publishing:"Improve before publishing",do_not_publish:"Do not publish yet",
  needs_work:"Needs work",blocked:"Blocked"};
const SCORE_LABEL={seo_readiness:"SEO readiness",content_quality:"Content quality",search_satisfaction:"Search satisfaction",task_completion:"Task completion",evidence:"Evidence",ai_citation_readiness:"AI citation readiness"};
function scoresHtml(sc,min){return `<div class="scores">${Object.entries(sc||{}).map(([k,v])=>{const m=(min||{})[k]||0;return `<div class="sc ${v<m?"low":""}"><strong>${v}</strong><span>${esc(SCORE_LABEL[k]||k)}${m?` · min ${m}`:""}</span><div class="bar"><i style="width:${Math.max(0,Math.min(100,v))}%"></i>${m?`<em style="left:${m}%"></em>`:""}</div></div>`}).join("")}</div>`}
function renderItem(item,el,tab){ renderContent(item.payload,item.report,el,item.id,item,tab); }
function renderContent(c,r,el,id,item=null,openTab=null){
  const val=r.validation||{},ev=r.evaluation||{},g=r.gate||{status:r.status,scores:{}},sat=r.satisfaction_model||{},cl=r.claims;
  const min=(RULES&&RULES.release_gate&&RULES.release_gate.min_scores)||{};
  const tabs=["Preview","Searcher","Fact-check","Spam risk","SEO","Checks","Markdown","Schema"];
  if(item) tabs.splice(1,0,"Edit");
  const T=name=>tabs.indexOf(name);
  const approved=item&&item.status==="approved";
  const covIcon=st=>st==="answered"?'<span class="pass">answered</span>':st==="partial"?'<span class="warn">partial</span>':'<span class="fail">missing</span>';
  const qm=sat.question_map||{};
  el.innerHTML=`<div class="panel">
   <h2>${esc(c.h1||c.title_tag)}</h2>
   <div class="gate ${approved?"approved":esc(g.status)}"><b>${approved?`Approved by ${esc(item.approved.by)} · ${esc(fmtDate(item.approved.at))}`:esc(GATE[g.status]||g.status)}</b>
     ${(g.blocking_reasons||[]).length?`<ul class="c">${g.blocking_reasons.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
     ${Object.keys(g.below_threshold||{}).length?`<p class="status">Below threshold: ${Object.keys(g.below_threshold).map(k=>SCORE_LABEL[k]||k).join(", ")}</p>`:""}
     <p class="status">Spam risk: <b>${esc(g.spam_risk||"–")}</b> · ${val.placeholders?`<mark>${val.placeholders} placeholders to fill</mark> · `:""}${esc(r.note||"")}</p></div>
   ${scoresHtml(g.scores,min)}
   ${(r.rounds||[]).length?`<p class="status">Audit and repair rounds: ${r.rounds.map(x=>`round ${x.round}: ${esc(GATE[x.status]||x.status)} (satisfaction ${x.scores.search_satisfaction}, quality ${x.scores.content_quality})${x.repair?`, then ${esc(x.repair)}`:""}${x.note?` (${esc(x.note)})`:""}`).join(" → ")}${r.ai_calls?` · ${r.ai_calls} AI calls`:""}${r.hybrid?` · hybrid: about ${r.hybrid.est_saving}% cheaper than writing it all with the paid model (estimate; the paid model read ${r.hybrid.paid_share}% of all tokens and wrote ${r.hybrid.paid_output_share}% of the text)`:""}${r.language&&!/^english/i.test(r.language)?` · written in ${esc(r.language)}`:""}</p>`:""}
   ${(r.warnings||[]).length?`<div class="verdict related">${r.warnings.map(esc).join("<br>")}</div>`:""}
   <div class="tabs2" role="group">${tabs.map((t,i)=>`<button aria-pressed="${i===0}" data-t="${i}">${t}</button>`).join("")}</div>
   <div data-p="${T("Preview")}"><div class="preview">${hl(c.html||"")}</div></div>
   ${item?`<div data-p="${T("Edit")}" class="hidden">${editPanel(item)}</div>`:""}
   <div data-p="${T("Searcher")}" class="hidden">
     <div class="grid2"><div class="block"><h3>The searcher</h3><p><b>Problem:</b> ${esc(sat.user_problem)}</p><p><b>Goal:</b> ${esc(sat.user_goal)}</p><p><b>Should be able to:</b> ${esc(sat.action_after_reading)}</p><p class="status">Level: ${esc(sat.knowledge_level)} · Best format: ${esc(sat.best_format)} · Structure used: ${esc(r.structure)}</p></div>
     <div class="block"><h3>Task completion: ${esc((ev.task_completion||{}).score??"–")}/100</h3>${list((ev.task_completion||{}).blockers)||"<p>No blockers found.</p>"}
       <h3 style="margin-top:12px">Still missing for the searcher</h3>${list((ev.satisfaction||{}).missing)||"<p>Nothing missing.</p>"}</div></div>
     <div class="block"><h3>Question coverage</h3><div class="tw"><table><tr><th>Question</th><th>Type</th><th>Status</th></tr>${(ev.question_coverage||[]).map(q=>`<tr><td>${esc(q.question)}</td><td>${esc(q.type)}</td><td>${covIcon(q.status)}</td></tr>`).join("")}</table></div></div>
     <div class="block"><h3>Next questions the searcher will ask</h3>${list((sat.next_questions||[]).map(q=>typeof q==="string"?q:`${q.question}${q.own_page?" (deserves its own page)":""}`))}</div>
     <div class="block"><h3>Existing pages that should link to this page</h3>${list(((r.brief||{}).link_from_existing||[]).map(l=>`${l.url} → anchor "${l.anchor}" (${l.where||""})`))||"<p>None suggested.</p>"}</div>
   </div>
   <div data-p="${T("Fact-check")}" class="hidden">${cl?`<p class="status">${esc(cl.summary?Object.entries(cl.summary).map(([k,v])=>`${k.replaceAll("_"," ")}: ${v}`).join(" · "):"")}${cl.corrections_applied?` · ${cl.corrections_applied} corrections applied automatically`:""}</p>
     <div class="tw"><table><tr><th>Claim</th><th>Status</th><th>Source</th><th>Note / correction</th></tr>${(cl.claims||[]).map(x=>`<tr><td>${esc(x.claim)}</td><td class="${x.status==="supported"||x.status==="corrected"?"pass":x.status==="needs_publisher_data"?"warn":"fail"}"><b>${esc(String(x.status).replaceAll("_"," "))}</b></td><td>${x.source_url?`<a href="${esc(x.source_url)}" target="_blank" rel="noopener">Tier ${esc(x.source_tier)}</a>`:"–"}</td><td>${esc(x.note)} ${x.correction?`<br><span class="status">${esc(x.correction)}</span>`:""}</td></tr>`).join("")}</table></div>`:"<p>Fact-check was turned off for this page.</p>"}</div>
   <div data-p="${T("Spam risk")}" class="hidden"><p class="status">Internal diagnostics modelled on Google's spam policies. Not Google's own systems, and not a guarantee.</p><div class="tw"><table><tr><th>Check</th><th>Risk</th><th>Evidence</th></tr>${(ev.spam_risk||[]).map(x=>`<tr><td>${esc(((RULES||{}).spam_risk_checks||{})[x.check]||x.check)}</td><td class="${x.level==="high"||x.level==="medium"?"fail":x.level==="low"?"warn":"pass"}"><b>${esc(x.level)}</b></td><td>${esc(x.evidence)}</td></tr>`).join("")}</table></div>
     <div class="block"><h3>AI citation readiness: ${esc((ev.ai_citation_readiness||{}).score??"–")}/100</h3>${list((ev.ai_citation_readiness||{}).weak_passages)||"<p>No weak passages found.</p>"}</div></div>
   <div data-p="${T("SEO")}" class="hidden">
     <div class="block"><h3>Search result preview</h3><div class="serp"><div class="u">${esc((SITE_URL()||"")+"/"+(c.slug||""))}</div><div class="t">${esc(c.title_tag)}</div><div class="d">${esc(c.meta_description)}</div></div>
     <p class="status">Title ${String(c.title_tag||"").length} chars · Meta ${String(c.meta_description||"").length} chars · Slug /${esc(c.slug)}</p></div>
     <div class="block"><h3>Headings</h3>${list(((c.body_markdown||"").match(/^#{1,3} .+$/gm)||[]))}</div>
     <div class="block"><h3>Internal links from this page</h3>${list((c.internal_links||[]).map(l=>`${l.anchor} → ${l.url}`))}</div>
     <div class="block"><h3>FAQs</h3>${list((c.faqs||[]).map(f=>f.q))}</div>
     <div class="block"><h3>Secondary keywords</h3><p>${esc((c.secondary_keywords||[]).join(", "))}</p></div>
     <div class="block"><h3>Images to add</h3>${list((c.image_suggestions||[]).map(i=>`${i.placement}: ${i.description} (alt: "${i.alt}")`))}</div>
     <div class="block"><h3>Call to action</h3><p>${esc(c.cta)}</p></div>
     <div class="block"><h3>Author box note</h3><p>${esc(c.ai_disclosure)}</p></div>
   </div>
   <div data-p="${T("Checks")}" class="hidden"><div class="tw"><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>${(val.checks||[]).map(k=>`<tr><td>${esc(k.label)}</td><td class="${k.status}"><b>${k.status}</b></td><td>${esc(k.detail)}</td></tr>`).join("")}</table></div>
     <div class="block"><h3>Helpful-content scorecard</h3><div class="tw"><table><tr><th>#</th><th>Question</th><th>Score</th><th>Why</th></tr>${(((ev.content_quality||{}).scorecard)||(r.quality_review||{}).scores||[]).map((x,i)=>`<tr><td>${i+1}</td><td>${esc((RULES&&RULES.scorecard[i])||"")}</td><td>${x.score}/2</td><td>${esc(x.reason)}</td></tr>`).join("")}</table></div></div></div>
   <div data-p="${T("Markdown")}" class="hidden"><pre>${esc(c.body_markdown)}</pre></div>
   <div data-p="${T("Schema")}" class="hidden"><pre>${esc(JSON.stringify(c.schema_jsonld,null,2))}</pre></div>
   <div class="row" style="margin-top:14px"><span class="status">Export:</span>${id?`<button class="btn ghost small" data-export="${id}">Markdown file</button><button class="btn ghost small" data-export-html="${id}">HTML file</button>`:""}<button class="btn ghost small" data-copy>Copy HTML (for a CMS)</button><button class="btn ghost small" data-copy-rich>Copy for Google Docs / Word</button><span class="status" data-copy-status></span></div>
   ${item&&item.refresh?`<div data-refresh-panel></div>`:""}${item?`<div data-review-panel></div>`:""}${item?approvePanel(item):""}${item?`<div data-brief-line></div><div data-ga4-line></div><div data-lang-panel></div><div data-repurpose-panel></div><div data-wiki-panel></div>`:""}
  </div>`;
  el.querySelectorAll(".tabs2 button").forEach(b=>b.onclick=()=>{el.querySelectorAll(".tabs2 button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));el.querySelectorAll("[data-p]").forEach(p=>p.classList.toggle("hidden",p.dataset.p!==b.dataset.t));});
  const ex=el.querySelector("[data-export]"); if(ex) ex.onclick=()=>api(`/api/contents/${ex.dataset.export}/export.md`);
  const cs=el.querySelector("[data-copy-status]"), done=m=>{cs.textContent=m;setTimeout(()=>cs.textContent="",3000);};
  el.querySelector("[data-copy]").onclick=async()=>{try{await navigator.clipboard.writeText((c.html||"")+`\n<script type="application/ld+json">${JSON.stringify(c.schema_jsonld)}<\/script>`);done("Copied HTML with schema.");}catch{done("Your browser blocked copying.");}};
  el.querySelector("[data-copy-rich]").onclick=async()=>{try{const html=sanitize(c.html||"");
    await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([c.body_markdown||""],{type:"text/plain"})})]);done("Copied. Paste into Google Docs or Word: headings and links are kept.");}catch{done("Your browser blocked rich copying. Use the HTML file instead.");}};
  const exh=el.querySelector("[data-export-html]"); if(exh) exh.onclick=()=>api(`/api/contents/${exh.dataset.exportHtml}/export.html`);
  if(item){ bindEdit(item,el); bindApprove(item,el); renderLangPanel(item,el).catch(()=>{}); renderRepurpose(item,el); renderWikiCheck(item,el); if(item.refresh) renderRefresh(item,el); renderCollab(item,el).catch(e=>console.warn(e));
    api(`/api/sites/${SITE_ID}/contents/${item.id}/brief-coverage`).then(c=>{ const box=el.querySelector("[data-brief-line]"); if(!c||!box) return; const sc=c.sections.filter(x=>x.covered).length, qc=c.questions.filter(x=>x.covered).length, miss=[...c.sections.filter(x=>!x.covered).map(x=>x.h2),...c.questions.filter(x=>!x.covered).map(x=>x.q)];
      box.innerHTML=`<div class="verdict ${miss.length?"related":"create"}" style="margin:8px 0">Brief coverage: <b>${sc} of ${c.sections.length}</b> outline sections and <b>${qc} of ${c.questions.length}</b> questions.${miss.length?` Missing: ${miss.slice(0,6).map(m=>`“${esc(m)}”`).join(", ")}${miss.length>6?"…":""}`:" Everything in the brief is covered."}</div>`; }).catch(()=>{});
    GA4.report(SITE_ID).then(d=>{ const st=GA4.pageStats(d,item.url||item.published?.link), box=el.querySelector("[data-ga4-line]"); if(!st||!box) return; const c=GA4.change(st.conversions,st.prev_conversions);
      box.innerHTML=`<p class="status" style="margin:8px 0">Google Analytics, last ${st.days} days${d.organic?" (organic search)":""}: <b>${fmtN(st.sessions)}</b> sessions · <b>${fmtN(Math.round(st.conversions))}</b> conversions (${st.sessions?(100*st.conversions/st.sessions).toFixed(1):0}%)${c!=null&&isFinite(c)?` <span class="${c>=0?"pass":"fail"}">${c>=0?"▲":"▼"} ${Math.abs(c)}%</span>`:""}</p>`; }).catch(()=>{}); }
  if(openTab&&T(openTab)>=0){ const b=el.querySelector(`.tabs2 button[data-t="${T(openTab)}"]`); if(b) b.click(); }
}
// ---------- editing ----------
let SITE_URLS=null, DIRTY=false;
window.addEventListener("beforeunload",e=>{ if(DIRTY){ e.preventDefault(); e.returnValue=""; } });
async function siteUrls(){ if(!SITE_URLS) SITE_URLS=new Set((await api(`/api/sites/${SITE_ID}/pages`)).map(p=>p.url)); return SITE_URLS; }
const PH_RE=/\[(ADD|SOURCE|SCREENSHOT|DATA|QUOTE|EXPERT|EXAMPLE)[^\]]*\]/g;
function editPanel(item){
  const x=item.payload, secs=(x.body_markdown||"").split("\n").filter(l=>/^## (?!#)/.test(l)).map(l=>l.slice(3).trim());
  const vers=(item.versions||[]).slice().reverse();
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><p class="status" style="margin:0">Edit the page, fill the highlighted placeholders, then <b>Save</b>. Checks run again instantly.</p><span class="unsaved hidden" data-unsaved>Unsaved changes</span></div>
   <div class="grid3" style="margin-bottom:6px">
     <div class="field"><label>Title tag</label><input data-e="title_tag" value="${esc(x.title_tag||"")}"><div class="cnt" data-cnt="title_tag"></div></div>
     <div class="field"><label>Meta description</label><input data-e="meta_description" value="${esc(x.meta_description||"")}"><div class="cnt" data-cnt="meta_description"></div></div>
     <div class="field"><label>URL slug</label><input data-e="slug" value="${esc(x.slug||"")}"></div>
   </div>
   <div class="edit-grid">
     <div><textarea class="md-edit" data-e="markdown" spellcheck="true" aria-label="Page content (Markdown)">${esc(x.body_markdown||"")}</textarea>
       <div class="row" style="margin-top:10px"><button class="btn" data-save>Save changes</button><button class="btn ghost" data-review>Re-review with AI</button></div>
       <p class="status" data-live style="margin:8px 0 0"></p><span class="status" data-estatus role="status"></span></div>
     <div class="preview" data-live-preview>${hl(x.html||"")}</div>
   </div>
   <div class="grid2" style="margin-top:16px">
     <div class="block"><h3>Placeholders to fill <span class="pill warn" data-ph-n></span></h3><p class="status">Replace each one with real proof: a screenshot, a number with its source, a real quote.</p><div class="ph-list" data-ph-list></div></div>
     <div class="block"><h3>Rewrite one section with AI</h3><p class="status">Cheaper and faster than writing the whole page again.</p>
       <div class="field"><select data-sec aria-label="Section">${secs.map(h=>`<option>${esc(h)}</option>`).join("")}</select></div>
       <div class="field"><input data-sec-ins aria-label="What should change" placeholder="What should change? e.g. add a real example, make it shorter, explain for beginners"></div>
       <button class="btn ghost" data-sec-run ${secs.length?"":"disabled"}>Rewrite this section</button></div>
   </div>
   <details class="block"><summary><b>Version history (${vers.length})</b></summary><div class="tw" style="margin-top:8px"><table><tr><th>Version</th><th>When</th><th>What changed</th><th><span class="sr-only">Actions</span></th></tr>
     ${vers.map((v,k)=>`<tr><td>v${v.v}${k===0?' <span class="pill pass">current</span>':""}</td><td>${esc(fmtDate(v.at))}</td><td>${esc(v.note||v.source)}</td><td>${k===0?"":`<button class="btn ghost small" data-restore="${v.v}">Restore</button>`}</td></tr>`).join("")}</table></div></details>`;
}
function bindEdit(item,el){
  const md=el.querySelector('[data-e="markdown"]'); if(!md) return;
  const get=n=>el.querySelector(`[data-e="${n}"]`).value, st=el.querySelector("[data-estatus]"), live=el.querySelector("[data-live]");
  const cnt=()=>{ const t=get("title_tag").length, m=get("meta_description").length;
    const ct=el.querySelector('[data-cnt="title_tag"]'), cm=el.querySelector('[data-cnt="meta_description"]');
    ct.textContent=`${t} characters (aim for 30–60)`; ct.classList.toggle("bad",t<30||t>60);
    cm.textContent=`${m} characters (aim for 120–160)`; cm.classList.toggle("bad",m<120||m>160); };
  const phs=()=>{ const list=[...md.value.matchAll(PH_RE)], n=el.querySelector("[data-ph-n]");
    n.textContent=list.length; n.className="pill "+(list.length?"warn":"pass");
    el.querySelector("[data-ph-list]").innerHTML=list.length?list.map(m=>`<div class="ph-item"><span title="${esc(m[0])}">${esc(m[0])}</span><button class="btn ghost small" data-ph="${m.index}" data-len="${m[0].length}">Find</button></div>`).join(""):`<p class="pass" style="margin:0">All placeholders filled.</p>`;
    el.querySelectorAll("[data-ph]").forEach(b=>b.onclick=()=>{const i=+b.dataset.ph;md.focus();md.setSelectionRange(i,i+(+b.dataset.len));const line=md.value.slice(0,i).split("\n").length;md.scrollTop=Math.max(0,(line-5)*21);}); };
  let t=null;
  const refresh=async()=>{ const urls=await siteUrls().catch(()=>new Set());
    const r=liveCheck({...item.payload,body_markdown:md.value,title_tag:get("title_tag"),meta_description:get("meta_description"),slug:get("slug")},item.keyword,item.page_type,urls,item.author||"");
    const pass=r.checks.filter(c=>c.status==="pass").length;
    live.innerHTML=`Live SEO checks: <b class="pass">${pass} passing</b>${r.fails?`, <b class="fail">${r.fails} failing</b> (${esc(r.checks.filter(c=>c.status==="fail").map(c=>c.label).join(", "))})`:""}${r.warns?`, ${r.warns} to review`:""} · ${r.word_count} words`;
    el.querySelector("[data-live-preview]").innerHTML=hl(window.marked?window.marked.parse(md.value):esc(md.value)); };
  const changed=()=>{ DIRTY=true; el.querySelector("[data-unsaved]").classList.remove("hidden"); cnt(); phs(); clearTimeout(t); t=setTimeout(refresh,350); };
  el.querySelectorAll("[data-e]").forEach(i=>i.oninput=changed);
  cnt(); phs(); refresh();
  const after=(it,msg)=>{ DIRTY=false; renderItem(it,el,"Edit"); const s2=el.querySelector("[data-estatus]"); if(s2) s2.textContent=msg; };
  el.querySelector("[data-save]").onclick=e=>busy(e.target,st,"Saving and re-checking…",async()=>{
    const it=await api(`/api/sites/${SITE_ID}/contents/${item.id}/save`,{method:"POST",body:JSON.stringify({markdown:md.value,title_tag:get("title_tag"),meta_description:get("meta_description"),slug:get("slug"),note:"Edited"})});
    after(it,"Saved. Checks updated."); });
  el.querySelector("[data-review]").onclick=e=>{ if(!needAI(st))return; if(DIRTY){st.textContent="Save your changes first.";st.classList.add("err");return;}
    busy(e.target,st,"Re-reviewing the page with AI… about 30 seconds.",async()=>{ const it=await api(`/api/sites/${SITE_ID}/contents/${item.id}/review`,{method:"POST"}); after(it,"Re-reviewed. Scores updated."); }); };
  el.querySelector("[data-sec-run]").onclick=e=>{ if(!needAI(st))return; if(DIRTY){st.textContent="Save your changes first, so they aren't lost.";st.classList.add("err");return;}
    busy(e.target,st,"Rewriting the section…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/contents/${item.id}/rewrite-section`,{method:"POST",body:JSON.stringify({heading:el.querySelector("[data-sec]").value,instruction:el.querySelector("[data-sec-ins]").value})});
      after(r.item,`Section rewritten: ${r.summary||"done"} Use Version history to undo.`); }); };
  el.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>busy(b,st,"Restoring…",async()=>{ const it=await api(`/api/sites/${SITE_ID}/contents/${item.id}/restore`,{method:"POST",body:JSON.stringify({v:+b.dataset.restore})}); after(it,`Restored version ${b.dataset.restore}.`); }));
}
function approvePanel(item){
  if(item.status==="approved"){ const pub=item.published, ok=SITE_ID&&CMS.configured(SITE_ID);
    return `<div class="approve-box"><b class="pass">Approved by ${esc(item.approved.by)} on ${esc(fmtDate(item.approved.at))}.</b> <span class="status">Editing the page again sends it back to review.</span>
    <div class="row" style="margin-top:10px">${ok?`<button class="btn small" data-wp-send>${pub?"Update in WordPress":"Send to WordPress as a draft"}</button>`:`<button class="btn ghost small" data-go="site">Connect WordPress to publish from here</button>`}
      ${pub?`<span class="status">In WordPress (${esc(pub.status)}) since ${esc(fmtDate(pub.at))} · <a href="${esc(pub.edit_link)}" target="_blank" rel="noopener">Open in the WordPress editor</a> · <a href="${esc(pub.link)}" target="_blank" rel="noopener">Preview</a></span>`:""}
      <span class="status" data-wp-status role="status"></span></div>
    ${(item.url||pub?.link)&&!READONLY?`<div class="row" style="margin-top:8px"><button class="btn ghost small" data-inow>Notify search engines (IndexNow)</button><span class="status" data-inow-st role="status"></span></div>`:""}</div>`; }
  const ph=(item.report.validation||{}).placeholders||0;
  return `<div class="approve-box"><h3 style="font-size:15px;margin-bottom:6px">Approve for publishing</h3>
   <p class="status" style="margin-top:0">${ph?`<span class="warn">${ph} placeholder${ph>1?"s":""} still to fill (Edit tab).</span> `:""}A person must check the page before it goes live.</p>
   <label class="check"><input type="checkbox" data-conf> Every placeholder is replaced with real proof (screenshots, data with sources, real quotes)</label>
   <label class="check" style="margin-top:6px"><input type="checkbox" data-conf> Facts, numbers and product details are correct</label>
   <label class="check" style="margin-top:6px"><input type="checkbox" data-conf> The named author has read and stands behind the page</label>
   ${item.source_id?`<div class="field" style="margin:12px 0 0;max-width:560px"><label>Fluent ${esc(LANGS[item.lang]||item.lang)} speaker who reviewed it <span>(required for translated versions)</span></label><input data-fluent placeholder="Name and role, e.g. Lucía García, native Spanish editor"></div>`:""}
   <div class="row" style="margin-top:12px;flex-wrap:nowrap;max-width:560px"><input data-reviewer aria-label="Your name" placeholder="Your name" value="${esc((item.author||"").split(",")[0])}"><button class="btn" data-approve>Approve</button></div>
   <span class="status" data-astatus role="status"></span></div>`;
}
function bindApprove(item,el){
  const inb=el.querySelector("[data-inow]");
  if(inb) inb.onclick=()=>busy(inb,el.querySelector("[data-inow-st]"),"Notifying search engines…",async()=>{ const v=await INOW.get(SITE_ID);
    if(!v.verified?.ok) throw new Error("Set up and verify IndexNow first (Websites → Instant indexing).");
    const r=await INOW.submit(SITE_ID,window._siteUrl||"",[item.url||item.published.link]); const st=el.querySelector("[data-inow-st]"); if(st){ st.className=r.accepted?"status pass":"status err"; st.textContent=r.message; } });
  const wp=el.querySelector("[data-wp-send]");
  if(wp) wp.onclick=()=>busy(wp,el.querySelector("[data-wp-status]"),item.published?"Updating in WordPress…":"Sending to WordPress…",async()=>{
    if(READONLY) throw new Error("Your role is view-only.");
    const r=await CMS.send(SITE_ID,item); const who=AUTH.state().user?.email||"";
    item.published=await api(`/api/sites/${SITE_ID}/contents/${item.id}/published`,{method:"POST",body:JSON.stringify({...r,platform:"wordpress",by:who})});
    renderItem(item,el); const st=el.querySelector("[data-wp-status]"); if(st) st.textContent=r.recreated?"The earlier post had been deleted in WordPress, so a new draft was created.":r.updated?"Updated in WordPress.":"Sent. It's a draft in WordPress: review it there and press Publish."; });
  bindGo(el);
  const b=el.querySelector("[data-approve]"); if(!b) return; const st=el.querySelector("[data-astatus]");
  b.onclick=()=>busy(b,st,"Checking…",async()=>{ if(DIRTY) throw new Error("Save your edits first.");
    const it=await api(`/api/sites/${SITE_ID}/contents/${item.id}/approve`,{method:"POST",body:JSON.stringify({reviewer:el.querySelector("[data-reviewer]").value,fluent:(el.querySelector("[data-fluent]")||{}).value||"",confirmations:[...el.querySelectorAll("[data-conf]:checked")].map(()=>1)})});
    renderItem(it,el); }); }
function sanitize(html){ const d=new DOMParser().parseFromString(`<div>${html}</div>`,"text/html");
  d.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,base,svg,math").forEach(e=>e.remove());
  for(const e of d.querySelectorAll("*")) for(const a of [...e.attributes]){const n=a.name.toLowerCase(),v=(a.value||"").trim().toLowerCase(); if(n.startsWith("on")||n==="style"||n==="srcdoc"||((n==="href"||n==="src")&&/^(javascript|data|vbscript):/.test(v))) e.removeAttribute(a.name);}
  return d.body.firstChild.innerHTML; }
const hl=h=>sanitize(h).replace(/\[(ADD|SOURCE|SCREENSHOT|DATA|QUOTE|EXPERT|EXAMPLE)[^\]]*\]/g,m=>`<mark>${m}</mark>`);
const SITE_URL=()=>window._siteUrl||"";

// audit
// ---------- review a draft ----------
let REV=null, A_SRC_URL="";
document.querySelectorAll("#a-src [data-as]").forEach(b=>b.onclick=()=>{document.querySelectorAll("#a-src [data-as]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));document.querySelectorAll("[data-asp]").forEach(p=>p.classList.toggle("hidden",p.dataset.asp!==b.dataset.as));});
$("#a-draft").addEventListener("paste",e=>{ const html=e.clipboardData&&e.clipboardData.getData("text/html"); if(!html) return;
  const md=htmlToMarkdown(html); if(!md) return; e.preventDefault();
  const ta=$("#a-draft"), a=ta.selectionStart, b=ta.selectionEnd; ta.value=ta.value.slice(0,a)+md+ta.value.slice(b); ta.selectionStart=ta.selectionEnd=a+md.length; A_SRC_URL=""; draftInfo("Pasted with formatting kept."); });
$("#a-draft").addEventListener("input",()=>draftInfo());
function draftInfo(msg){ const w=($("#a-draft").value.match(/\S+/g)||[]).length, h=($("#a-draft").value.match(/^#{1,3} /gm)||[]).length; $("#a-draft-info").textContent=`${msg?msg+" ":""}${w} words · ${h} headings${A_SRC_URL?` · from ${A_SRC_URL}`:""}`; }
$("#a-file").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; const t=await f.text(); $("#a-draft").value=/\.html?$/i.test(f.name)?htmlToMarkdown(t):t; A_SRC_URL=""; draftInfo(`Loaded ${f.name}.`); };
$("#a-url-load").onclick=()=>{ if(!needSite($("#a-status")))return; busy($("#a-url-load"),$("#a-status"),"Loading the page…",async()=>{
  const r=await api(`/api/sites/${SITE_ID}/review/load-url`,{method:"POST",body:JSON.stringify({url:$("#a-url").value.trim()})});
  $("#a-draft").value=r.markdown; $("#a-title").value=r.title||""; $("#a-meta").value=r.meta_description||""; A_SRC_URL=r.url; draftInfo("Loaded."); }); };
let aKwT=null;
$("#a-kw").addEventListener("input",()=>{ clearTimeout(aKwT); aKwT=setTimeout(async()=>{ const kw=$("#a-kw").value.trim(); if(!kw||!SITE_ID){$("#a-kwinfo").innerHTML="";return;}
  const cov=await api(`/api/sites/${SITE_ID}/coverage?keyword=${encodeURIComponent(kw)}`).catch(()=>null); if($("#a-kw").value.trim()!==kw) return;
  $("#a-kwinfo").innerHTML=cov&&cov.status==="covered"?`<span class="warn">You already have a page for this: <span class="url">${esc(cov.url)}</span>${A_SRC_URL&&cov.url.replace(/\/$/,"")===A_SRC_URL.replace(/\/$/,"")?" (the page you're reviewing)":". If this draft is a new page, it will compete with it."}</span>`:cov&&cov.status==="partial"?`<span class="status">Related page: ${esc(cov.url)}</span>`:""; },350); });
async function loadReviews(){ if(!SITE_ID) return; const r=await api(`/api/sites/${SITE_ID}/reviews`).catch(()=>[]);
  $("#a-recent").innerHTML=r.length?`<div class="chips"><span class="status">Recent reviews (open free):</span>${r.slice(0,8).map(x=>`<button class="chip" data-rev="${x.id}" title="${esc(fmtDate(x.at))}">${esc(x.keyword)} · ${esc((GATE[x.gate.status]||"").replace(" yet",""))}</button>`).join("")}</div>`:"";
  $("#a-recent").querySelectorAll("[data-rev]").forEach(b=>b.onclick=async()=>{ REV=await api(`/api/sites/${SITE_ID}/reviews/${b.dataset.rev}`); renderReviewResult(); }); }
function highlightHtml(html,items){
  const d=new DOMParser().parseFromString(`<div>${html}</div>`,"text/html"), root=d.body.firstChild;
  const strip=t=>t.replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/[*_`]/g,"").replace(/\s+/g," ").trim();
  for(const h of items){
    const full=strip(h.text), needle=(h.type==="filler"?full:full.slice(0,60)).toLowerCase(); if(needle.length<4) continue;
    const walker=d.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n;
    while((n=walker.nextNode())){ if(n.parentElement&&n.parentElement.closest("mark")) continue;
      const i=n.textContent.toLowerCase().indexOf(needle); if(i<0) continue;
      const end=Math.min(n.textContent.length,i+(h.type==="filler"?needle.length:full.length));
      const range=d.createRange(); range.setStart(n,i); range.setEnd(n,end);
      const m=d.createElement("mark"); m.className="hl-"+h.type; m.title=h.message; try{ range.surroundContents(m); }catch{} break; }
  }
  return root.innerHTML;
}
function renderReviewResult(){
  const r=REV, ev=r.evaluation||{}, au=r.audit||{}, g=r.gate, val=r.validation||{}, min=(RULES&&RULES.release_gate&&RULES.release_gate.min_scores)||{};
  const hlCount=t=>r.highlights.filter(h=>h.type===t).length, covIcon=st=>st==="answered"?'<span class="pass">answered</span>':st==="partial"?'<span class="warn">partial</span>':'<span class="fail">missing</span>';
  const issues=(ev.issues||[]).filter(i=>i.severity==="critical"||i.severity==="major");
  const tabs=[["hl","Highlights"],["fix","Fixes"],["searcher","Searcher"],["overlap","Overlap"],["checks","Checks"],["facts","Fact-check"]];
  $("#a-out").innerHTML=`<div class="panel">
    <div class="row" style="justify-content:space-between;align-items:flex-start"><div><p class="status" style="margin:0">Review of “${esc(r.keyword)}” · ${esc(fmtDate(r.at))}${r.source_url?` · <span class="url">${esc(r.source_url)}</span>`:""}</p><h2 style="margin-top:4px">${esc(r.title_tag||(r.draft.match(/^# (.+)$/m)||[])[1]||r.keyword)}</h2></div>
      <div class="row"><button class="btn" id="a-import">Open in editor</button><button class="btn ghost" id="a-dl">Download report</button></div></div>
    <div class="gate ${esc(g.status)}"><b>${esc(GATE[g.status]||g.status)}</b>${(g.blocking_reasons||[]).length?`<ul class="c">${g.blocking_reasons.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      ${Object.keys(g.below_threshold||{}).length?`<p class="status">Below threshold: ${Object.keys(g.below_threshold).map(k=>SCORE_LABEL[k]||k).join(", ")}</p>`:""}<p class="status">Spam risk: <b>${esc(g.spam_risk)}</b> · Helpful-content score ${r.audit&&r.audit.total!=null?r.audit.total:(au.scores||[]).reduce((t,x)=>t+(+x.score||0),0)}/20 · Search intent: ${esc(INTENT_LABEL[r.intent]||r.intent)}</p></div>
    ${scoresHtml(g.scores,min)}
    <div class="tabs2" role="group" id="a-tabs">${tabs.map(([k,l],i)=>`<button data-at="${k}" aria-pressed="${i===0}">${l}${k==="hl"&&r.highlights.length?` (${r.highlights.length})`:k==="fix"?` (${(au.top_fixes||[]).length+issues.length})`:""}</button>`).join("")}</div>
    <div data-ap="hl"><div class="hl-legend"><span><mark class="hl-unsourced">unsourced statistic</mark> ${hlCount("unsourced")}</span><span><mark class="hl-filler">filler</mark> ${hlCount("filler")}</span><span><mark class="hl-repetition">keyword repetition</mark> ${hlCount("repetition")}</span><span><mark class="hl-long">long paragraph</mark> ${hlCount("long")}</span><span class="status">Hover a highlight to see why.</span></div>
      <div class="edit-grid"><div class="preview">${highlightHtml(sanitize(window.marked?window.marked.parse(r.draft):esc(r.draft)),r.highlights)}</div>
      <div>${r.highlights.length?`<ul class="c hl-list">${r.highlights.map(h=>`<li><mark class="hl-${h.type}">${esc(h.text.slice(0,90))}${h.text.length>90?"…":""}</mark><br><span class="status">${esc(h.message)}</span></li>`).join("")}</ul>`:`<p class="pass">No filler, unsourced statistics, keyword stuffing or long paragraphs found.</p>`}</div></div></div>
    <div data-ap="fix" class="hidden">
      ${(au.top_fixes||[]).length?`<div class="block"><h3>Top fixes</h3><ol class="steps">${au.top_fixes.map((x,i)=>`<li><span class="n">${i+1}</span><span class="t">${esc(x)}</span></li>`).join("")}</ol></div>`:""}
      ${issues.length?`<div class="block"><h3>Important issues</h3><div class="tw"><table><tr><th>Severity</th><th>Issue</th><th>Fix</th></tr>${issues.map(i=>`<tr><td><span class="pill ${i.severity==="critical"?"fail":"warn"}">${esc(i.severity)}</span></td><td>${esc(i.issue)}</td><td>${esc(i.fix)}</td></tr>`).join("")}</table></div></div>`:""}
      <div class="grid2"><div class="block"><h3>Suggested title and description</h3>${au.suggested_title_tag?`<div class="snip-opt"><div class="t">${esc(au.suggested_title_tag)}</div><div class="status">${esc(au.suggested_meta_description||"")}</div></div>`:"<p class='status'>–</p>"}</div>
        <div class="block"><h3>Suggested headings and FAQs</h3>${list(au.suggested_h2s)}${(au.suggested_faqs||[]).length?`<p class="status" style="margin-top:8px">FAQs to answer:</p>${list(au.suggested_faqs)}`:""}</div></div></div>
    <div data-ap="searcher" class="hidden"><div class="grid2"><div class="block"><h3>Still missing for the searcher</h3>${list((ev.satisfaction||{}).missing)||"<p class='pass'>Nothing obvious missing.</p>"}</div><div class="block"><h3>Why a reader couldn't finish the task</h3>${list((ev.task_completion||{}).blockers)||"<p class='pass'>No blockers found.</p>"}</div></div>
      ${(ev.question_coverage||[]).length?`<div class="block"><h3>Questions answered</h3><div class="tw"><table><tr><th>Question</th><th>Status</th></tr>${ev.question_coverage.map(q=>`<tr><td>${esc(q.question)}</td><td>${covIcon(q.status)}</td></tr>`).join("")}</table></div></div>`:""}
      ${((ev.ai_citation_readiness||{}).weak_passages||[]).length?`<div class="block"><h3>Make these passages easier for AI to quote</h3>${list(ev.ai_citation_readiness.weak_passages)}</div>`:""}</div>
    <div data-ap="overlap" class="hidden">${(au.duplicates||[]).length?`<div class="verdict exists">This draft overlaps with pages you already have.</div><div class="tw"><table><tr><th>Your page</th><th>Overlap</th><th>Do this</th></tr>${au.duplicates.map(x=>`<tr><td class="url">${esc(x.url)}</td><td>${esc(x.issue)}</td><td>${esc(x.action)}</td></tr>`).join("")}</table></div>`:`<p class="pass">No duplicate of an existing page found.</p>`}
      ${(r.matches||[]).length?`<div class="block"><h3>Related pages on your site</h3><div class="tw"><table><tr><th>Page</th><th>Searcher wants</th><th>Match</th></tr>${r.matches.slice(0,6).map(m=>`<tr><td>${esc(m.title)}<br><span class="url">${esc(m.url)}</span></td><td>${esc(INTENT_LABEL[m.intent]||m.intent)}</td><td>${Math.round(m.similarity*100)}%</td></tr>`).join("")}</table></div></div>`:""}
      ${(au.internal_links||[]).length?`<div class="block"><h3>Internal links to add</h3>${list(au.internal_links.map(l=>`${l.anchor} → ${l.url}`))}</div>`:""}</div>
    <div data-ap="checks" class="hidden"><div class="tw"><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>${(val.checks||[]).map(k=>`<tr><td>${esc(k.label)}</td><td class="${k.status}"><b>${k.status}</b></td><td>${esc(k.detail)}</td></tr>`).join("")}</table></div>
      <div class="block"><h3>Helpful-content scorecard</h3><div class="tw"><table><tr><th>#</th><th>Question</th><th>Score</th><th>Why</th></tr>${(((ev.content_quality||{}).scorecard)||au.scores||[]).map((x,i)=>`<tr><td>${i+1}</td><td>${esc((RULES&&RULES.scorecard[i])||"")}</td><td>${x.score}/2</td><td>${esc(x.reason)}</td></tr>`).join("")}</table></div></div></div>
    <div data-ap="facts" class="hidden">${r.claims?`<div class="tw"><table><tr><th>Claim</th><th>Status</th><th>Source / correction</th></tr>${(r.claims.claims||[]).map(x=>`<tr><td>${esc(x.claim)}</td><td class="${x.status==="supported"?"pass":x.status==="needs_publisher_data"?"warn":"fail"}"><b>${esc(String(x.status).replace(/_/g," "))}</b></td><td>${x.source_url?`<a href="${esc(x.source_url)}" target="_blank" rel="noopener">Tier ${esc(x.source_tier)}</a>`:""} <span class="status">${esc(x.correction||x.note||"")}</span></td></tr>`).join("")}</table></div>`:emptyBox("Not fact-checked","Tick “Fact-check claims with web search” and review again to verify statistics, prices and product claims.")}</div>
  </div>`;
  const out=$("#a-out");
  out.querySelectorAll("[data-at]").forEach(b=>b.onclick=()=>{out.querySelectorAll("[data-at]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));out.querySelectorAll("[data-ap]").forEach(p=>p.classList.toggle("hidden",p.dataset.ap!==b.dataset.at));});
  $("#a-import").onclick=()=>busy($("#a-import"),$("#a-status"),"Opening in the editor…",async()=>{ const it=await api(`/api/sites/${SITE_ID}/reviews/${r.id}/import`,{method:"POST"}); await openInLibrary(it,"Edit"); });
  $("#a-dl").onclick=()=>{ const L=a=>(a||[]).map(x=>"- "+x).join("\n");
    download(`review-${r.keyword.replace(/\W+/g,"-")}.md`,`# Review: ${r.keyword}\n\n${fmtDate(r.at)}${r.source_url?` · ${r.source_url}`:""}\n\n**Status:** ${GATE[g.status]||g.status}. Spam risk: ${g.spam_risk}.\n\n## Scores\n${Object.entries(g.scores).map(([k,v])=>`- ${SCORE_LABEL[k]||k}: ${v}${min[k]?` (minimum ${min[k]})`:""}`).join("\n")}\n\n## Top fixes\n${(au.top_fixes||[]).map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\n## Important issues\n${issues.map(i=>`- (${i.severity}) ${i.issue} → ${i.fix}`).join("\n")}\n\n## Still missing for the searcher\n${L((ev.satisfaction||{}).missing)}\n\n## Highlights\n${r.highlights.map(h=>`- [${h.type}] "${h.text.slice(0,100)}": ${h.message}`).join("\n")}\n\n## Suggested title and description\n${au.suggested_title_tag||""}\n${au.suggested_meta_description||""}\n\n## Overlap with existing pages\n${(au.duplicates||[]).map(x=>`- ${x.url}: ${x.issue} → ${x.action}`).join("\n")||"- None"}\n`,"text/markdown"); };
  out.scrollIntoView({behavior:"smooth",block:"start"});
}
$("#a-run").onclick=()=>{if(!needSite($("#a-status"),true))return;busy($("#a-run"),$("#a-status"),"Starting…",async()=>{
  REV=await api(`/api/sites/${SITE_ID}/review`,{method:"POST",body:JSON.stringify({keyword:$("#a-kw").value,draft:$("#a-draft").value,title_tag:$("#a-title").value.trim(),meta_description:$("#a-meta").value.trim(),author:$("#a-author").value.trim(),source:A_SRC_URL?"url":"paste",source_url:A_SRC_URL,verify_claims:$("#a-verify").checked}),onProgress:m=>{$("#a-status").dataset.progress="1";$("#a-status").textContent=m;}});
  renderReviewResult(); loadReviews(); });};

// URL map
function renderUrlMap(d){
  const rv=(d.review&&d.review.review)||null; const byUrl={};
  (rv&&rv.groups||[]).forEach(g=>(g.urls||[]).forEach(u=>byUrl[u.url]={...u,primary:g.primary_url,priority:g.priority}));
  $("#um-out").innerHTML=`<div class="block"><h3>Pages competing for the same topic and intent (${d.groups.length} groups)</h3>
   ${d.groups.length?d.groups.map(g=>`<div class="tw"><table><tr><th colspan="4">${esc(g.topic)} · ${esc(g.intent)} · ${g.size} pages${byUrl[g.urls[0].url]&&byUrl[g.urls[0].url].priority?` · ${esc(byUrl[g.urls[0].url].priority)}`:""}</th></tr>
     <tr><th>Page</th><th>Words</th><th>Action</th><th>Reason</th></tr>${g.urls.map(u=>{const r=byUrl[u.url]||{};return `<tr><td>${esc(u.title)}<br><span class="status">${esc(u.url)}</span>${r.primary===u.url?' <span class="pill pass">primary</span>':""}</td><td>${u.words}</td><td class="act">${esc(r.action||"–")}</td><td>${esc(r.reason||"")}</td></tr>`}).join("")}</table></div>`).join(""):"<p>No overlapping pages found in the pages read.</p>"}</div>
`;
}
$("#um-load").onclick=()=>{if(!needSite($("#um-status")))return;busy($("#um-load"),$("#um-status"),"Comparing pages…",async()=>renderUrlMap(await api(`/api/sites/${SITE_ID}/url-map`)));};
$("#um-review").onclick=()=>{if(!needSite($("#um-status"),true))return;busy($("#um-review"),$("#um-status"),"Choosing primary URLs and actions…",async()=>{await api(`/api/sites/${SITE_ID}/url-map/review`,{method:"POST"});renderUrlMap(await api(`/api/sites/${SITE_ID}/url-map`));});};

// helpers for uploads
function readB64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});}
const PRI=p=>`<span class="pri ${esc(p)}">${esc(p)}</span>`;

// actions
let ACTIONS=[];
const PRI_NAME={P0:"Fix now",P1:"High impact",P2:"Worthwhile",P3:"When there's time"};
let AC_VIEW="priority", AC_OPEN=new Set();
const todayIso=()=>new Date().toISOString().slice(0,10);
const isOverdue=a=>a.due&&a.due<todayIso()&&["open","in_progress"].includes(a.status);
const waitFor=async(fn,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,120));}return null;};
function acFilters(){
  const srcs=[...new Set(ACTIONS.map(a=>a.source))].sort(), owners=[...new Set(ACTIONS.map(a=>a.owner).filter(Boolean))].sort();
  const keep=(id,opts,first)=>{const v=$(id).value;$(id).innerHTML=`<option value="">${first}</option>`+opts.map(o=>`<option ${o===v?"selected":""}>${esc(o)}</option>`).join("");};
  keep("#ac-source",srcs,"All sources"); keep("#ac-owner",owners,"Anyone");
}
function renderActions(){
  acFilters();
  const open=ACTIONS.filter(a=>["open","in_progress"].includes(a.status)), done30=ACTIONS.filter(a=>a.status==="done"&&a.done_at&&Date.now()-a.done_at<30*864e5);
  const quick=open.filter(a=>a.quick_win).sort((a,b)=>b.score-a.score), overdue=open.filter(isOverdue), resolved=ACTIONS.filter(a=>a.status==="resolved").length;
  const weeks=[...Array(8)].map((_,k)=>{const end=Date.now()-k*7*864e5,start=end-7*864e5;return {label:k?`${k}w ago`:"This week",value:ACTIONS.filter(a=>a.done_at&&a.done_at>start&&a.done_at<=end).length};}).reverse();
  const kpi=(n,l,cls="")=>`<div class="panel kpi"><div><div class="num ${cls}">${n}</div><div class="lbl">${l}</div></div></div>`;
  $("#ac-top").innerHTML=ACTIONS.length?`<div class="grid4">${kpi(open.length,"open to-dos")}${kpi(quick.length,"quick wins (big impact, little effort)","pass")}${kpi(overdue.length,"overdue",overdue.length?"fail":"")}${kpi(done30.length,"done in the last 30 days")}</div>
    <div class="grid2">${card("Start here","Quick wins: the most valuable things you can fix fast",quick.length?quick.slice(0,5).map(a=>`<div class="row" style="flex-wrap:nowrap;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--soft-line)">${PRI(a.priority)}<span style="flex:1;min-width:0">${esc(a.title)}<br><span class="status">${esc(a.source)}${a.impact?` · ${esc(a.impact)}`:""}</span></span>${a.link?`<button class="btn small" data-doit="${a.id}">Do it</button>`:""}</div>`).join(""):"<p class='status'>No quick wins open. Nice work.</p>")}
      ${card("Progress","Items you marked done per week",(weeks.some(w=>w.value)?columns(weeks,{color:"var(--c1)"}):emptyBox("Nothing marked done yet","As you finish to-dos, mark them done to see your progress here."))+`<p class="status">${resolved?`${resolved} more resolved automatically, because the problem disappeared when the data was refreshed.`:"Items also resolve automatically when the problem disappears."}</p>`)}</div>`:"";
  const f=$("#ac-filter").value, src=$("#ac-source").value, own=$("#ac-owner").value, q=$("#ac-q").value.trim().toLowerCase();
  let rows=ACTIONS.filter(a=>f==="all"?true:f==="done"?["done","dismissed","resolved"].includes(a.status):f==="quick"?a.quick_win&&["open","in_progress"].includes(a.status):f==="overdue"?isOverdue(a):["open","in_progress"].includes(a.status));
  rows=rows.filter(a=>(!src||a.source===src)&&(!own||a.owner===own)&&(!q||(a.title+" "+a.detail+" "+(a.urls||[]).join(" ")).toLowerCase().includes(q)));
  const order={P0:0,P1:1,P2:2,P3:3}; rows.sort((a,b)=>order[a.priority]-order[b.priority]||b.score-a.score);
  let groups;
  if(AC_VIEW==="page"){ const m=new Map(); for(const a of rows){ const k=(a.urls||[]).length===1?a.urls[0]:(a.urls||[]).length?"Several pages":"Site-wide"; if(!m.has(k))m.set(k,[]); m.get(k).push(a);} groups=[...m].sort((x,y)=>(["Site-wide","Several pages"].includes(x[0])?1:0)-(["Site-wide","Several pages"].includes(y[0])?1:0)||y[1].length-x[1].length).map(([k,v])=>[k.startsWith("http")?shortUrl(k):k,v]); }
  else if(AC_VIEW==="source"){ const m=new Map(); for(const a of rows){ if(!m.has(a.source))m.set(a.source,[]); m.get(a.source).push(a);} groups=[...m]; }
  else groups=["P0","P1","P2","P3"].map(p=>[p,rows.filter(a=>a.priority===p)]).filter(g=>g[1].length);
  $("#ac-out").innerHTML=!ACTIONS.length?emptyBox("No to-dos yet","Read your website, check keywords or upload Google data, and this list fills itself."):!rows.length?emptyBox("Nothing matches","Try another filter."):
    groups.map(([g,items])=>`<div class="act-group">${AC_VIEW==="priority"?`${PRI(g)} ${esc(PRI_NAME[g])}`:esc(g)} <span class="status">${items.length}</span></div>${items.map(actItem).join("")}`).join("");
  const out=$("#ac-out");
  out.querySelectorAll("[data-rid]").forEach(sel=>sel.onchange=()=>patchAction(+sel.dataset.rid,{status:sel.value}));
  out.querySelectorAll("[data-more]").forEach(b=>b.onclick=()=>{const id=+b.dataset.more;AC_OPEN.has(id)?AC_OPEN.delete(id):AC_OPEN.add(id);renderActions();});
  out.querySelectorAll("[data-asave]").forEach(b=>b.onclick=()=>{const it=b.closest(".act-item");patchAction(+b.dataset.asave,{owner:it.querySelector("[data-owner]").value,due:it.querySelector("[data-due]").value,notes:it.querySelector("[data-notes]").value});});
  document.querySelectorAll("#ac-top [data-doit], #ac-out [data-doit]").forEach(b=>b.onclick=()=>goAction(ACTIONS.find(a=>a.id===+b.dataset.doit)));
}
function actItem(a){
  const isDone=!["open","in_progress"].includes(a.status), openEd=AC_OPEN.has(a.id);
  return `<div class="act-item ${isDone?"done":""}"><div class="act-main">
     <div class="body"><div class="title">${esc(a.title)}</div><div class="status" style="margin-top:2px">${esc(a.detail||"")}</div>
       <div class="act-meta">${PRI(a.priority)}<span class="pill">${esc(a.source)}</span>${a.quick_win&&!isDone?'<span class="qw">Quick win</span>':""}${a.impact?`<span>Impact: ${esc(a.impact)}</span>`:""}<span>Effort: ${esc(a.effort||"–")}</span>
         ${a.owner?`<span>· ${esc(a.owner)}</span>`:""}${a.due?`<span class="${isOverdue(a)?"overdue":""}">· due ${esc(a.due)}${isOverdue(a)?" (overdue)":""}</span>`:""}${a.notes?`<span title="${esc(a.notes)}">· has notes</span>`:""}
         <button class="linkbtn" data-more="${a.id}">${openEd?"Hide details":"Details, owner and notes"}</button></div></div>
     <div class="act-side">${a.link&&!isDone?`<button class="btn small" data-doit="${a.id}">Do it</button>`:""}${a.status==="resolved"?'<span class="pill pass">Resolved</span>':`<select class="inline-edit" data-rid="${a.id}" aria-label="Status">${["open","in_progress","done","dismissed"].map(s=>`<option ${s===a.status?"selected":""} value="${s}">${s.replace("_"," ")}</option>`).join("")}</select>`}</div></div>
   ${openEd?`${(a.urls||[]).length?`<div style="margin-top:8px"><span class="status">Pages:</span>${list(a.urls.slice(0,20))}</div>`:""}
     <div class="act-edit"><input data-owner placeholder="Owner (who will do it)" value="${esc(a.owner||"")}" aria-label="Owner"><input data-due type="date" value="${esc(a.due||"")}" aria-label="Due date">
       <textarea data-notes placeholder="Notes" style="min-height:60px;grid-column:1/-1" aria-label="Notes">${esc(a.notes||"")}</textarea></div>
     <div class="row" style="margin-top:8px"><button class="btn ghost small" data-asave="${a.id}">Save</button></div>`:""}</div>`;
}
async function patchAction(rid,fields){ const r=await api(`/api/sites/${SITE_ID}/actions/${rid}`,{method:"PATCH",body:JSON.stringify(fields)}); ACTIONS=ACTIONS.map(a=>a.id===r.id?r:a); renderActions(); }
async function goAction(a){
  const L=a&&a.link; if(!L) return;
  if(L.view==="tech"){ TA=null; show("tech"); await waitFor(()=>TA);
    if(TA_GROUP_OF[L.tab]){ TA_TAB=L.tab; renderAudit(); return; }
    if(L.url){ TA_TAB="pages"; renderAudit(); openPage(L.url); }
    else if(L.check){ TA_TAB="issues"; renderAudit(); const d=$(`#ta-out details[data-check="${L.check}"]`); if(d){ d.open=true; d.scrollIntoView({behavior:"smooth",block:"start"}); } } return; }
  if(L.view==="keyword") return openCheck(L.keyword);
  if(L.view==="generate") return prefillWrite(L.keyword,L.intent);
  if(L.view==="competitors"){ show("competitors"); return; }
  if(L.view==="migration"){ show("migration"); return; }
  if(L.view==="gsc"&&L.section==="decay"){ show("gsc"); const el=await waitFor(()=>$("#decay-panel h2")); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); return; }
  if(L.view==="gsc"&&L.section==="bing"){ show("gsc"); const el=await waitFor(()=>$("#bing-panel h2")); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); return; }
  if(L.view==="gsc"){ GSC_TAB=L.tab||"quick"; GS_TAB=L.section||(L.tab?"searches":"overview"); show("gsc"); const el=await waitFor(()=>$("#gsc-tabs")); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); return; }
  if(L.view==="urlmap"){ show("urlmap"); kwTab(L.tab||"list"); return; }
  if(L.view==="aivis"){ VIS=null; show("aivis"); await waitFor(()=>VIS);
    const k=(VIS.summary.questions||[]).findIndex(q=>q.question===L.question); const b=k>=0&&$(`#av-out [data-qopen="${k}"]`);
    if(b){ if(!VIS_OPEN.has(k)) b.click(); b.scrollIntoView({behavior:"smooth",block:"center"}); } return; }
  if(L.view==="library"){ const c=await api(`/api/contents/${L.content_id}`).catch(()=>null); if(c) await openInLibrary(c); else show("library"); return; }
  show(L.view);
}
async function loadActions(){ if(!SITE_ID)return; ACTIONS=await api(`/api/sites/${SITE_ID}/actions/generate`,{method:"POST"}).catch(()=>api(`/api/sites/${SITE_ID}/actions`)); renderActions(); }
["#ac-filter","#ac-source","#ac-owner"].forEach(id=>$(id).onchange=renderActions); $("#ac-q").oninput=renderActions;
document.querySelectorAll("#ac-views [data-av]").forEach(b=>b.onclick=()=>{AC_VIEW=b.dataset.av;document.querySelectorAll("#ac-views [data-av]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));renderActions();});
$("#ac-csv").onclick=()=>{ if(SITE_ID) api(`/api/sites/${SITE_ID}/actions/export.csv`); };
$("#ac-run").onclick=()=>{if(!needSite($("#ac-status")))return;busy($("#ac-run"),$("#ac-status"),"Refreshing…",loadActions);};

// technical audit
// ---------- site health ----------
let TA=null, TA_TAB="issues", TA_PAGE=null;
// Site health: six main tabs, some with sub-tabs; each shows its problem count
const TA_GROUPS=[["problems","Problems"],["pages","Pages"],["speed","Speed"],["indexing","Indexing"],["links","Links"],["content","Content"]];
const TA_SUBS=[["issues","problems","Issues"],["ignored","problems","Ignored"],["pages","pages","Pages"],["speed","speed","Speed"],["index","indexing","In Google"],["sitemaps","indexing","Sitemaps &amp; robots.txt"],
  ["links","links","Internal links"],["ext","links","External links"],["dupes","content","Duplicates"],["schema","content","Structured data"],["images","content","Images"]];
const TA_GROUP_OF=Object.fromEntries(TA_SUBS.map(([t,g])=>[t,g])), TA_LAST={};
const countLabel=v=>v==null?`<span class="status" style="font-weight:400">not checked</span>`:v==="partial"?`<span class="status" style="font-weight:400" title="Only part of the site was read">read more pages</span>`:v==="some"?`<span class="status" style="font-weight:400">some not checked</span>`:v?`<b class="warn">${v}</b>`:`<span class="pass">✓</span>`;
let TA_CT=null; const taCountsSoon=()=>{ clearTimeout(TA_CT); TA_CT=setTimeout(()=>{ const o=$("#ta-out"); if(o&&o.querySelector("#ta-main")) taCounts(o); },400); };
async function taCounts(out){ if(!SITE_ID) return; const c=await api(`/api/sites/${SITE_ID}/health-counts`).catch(()=>null); if(!c) return;
  for(const [t,v] of Object.entries(c)){ const el=out.querySelector(`[data-tcs="${t}"]`); if(el) el.innerHTML=countLabel(v); }
  for(const [g] of TA_GROUPS){ if(g==="problems"||g==="pages") continue; const subs=TA_SUBS.filter(x=>x[1]===g).map(x=>c[x[0]]), known=subs.filter(v=>v!=null), el=out.querySelector(`[data-tcm="${g}"]`);
    // a number when problems are known; a tick only when every check in the group ran and found nothing
    const nums=known.filter(v=>typeof v==="number"), sum=nums.reduce((a,b)=>a+b,0);
    if(el) el.innerHTML=countLabel(sum>0?sum:!known.length?null:nums.length===subs.length?0:"some"); } }
const SEV_LABEL={error:"Error",high:"High",medium:"Medium",low:"Low"}, SEV_COL={error:"var(--c4)",high:"var(--c4)",medium:"var(--c3)",low:"var(--c5)"};
const sevPill=s=>`<span class="pill ${s==="low"?"":s==="medium"?"warn":"fail"}">${SEV_LABEL[s]}</span>`;
const shortUrl=u=>{try{const x=new URL(u);let t=(x.pathname+x.search)||"/";try{t=decodeURIComponent(t);}catch{}return t;}catch{return u;}};
async function runAudit(){ TA=await api(`/api/sites/${SITE_ID}/technical-audit`); renderAudit(); }
function renderAudit(){
  const d=TA; if(!d) return;
  $("#ta-meta").textContent=`${d.note}${d.crawled_at?` Last read: ${d.crawled_at}.`:""}${d.has_traffic?" Issues are sorted by Google clicks from your Search Console data.":""}`;
  const hist=d.history||[], pr=d.progress;
  const progressCard=pr?`<div class="panel mini-card"><div class="lbl">Since last read (${esc(pr.since||"")})</div>
      <div class="val"><span class="pass">${pr.fixed} fixed</span> · <span class="${pr.new?"fail":""}">${pr.new} new</span></div>
      <p class="status" style="margin:6px 0 0">Health ${pr.health_before} → <b>${d.health_score}</b></p>${hist.length>1?columns(hist.slice(-8).map((h,k,arr)=>({label:new Set(arr.map(x=>(x.crawled_at||"").slice(0,10))).size===1?(h.crawled_at||"").slice(11,16):(h.crawled_at||"").slice(5,10),value:h.health})),{fmt:v=>v,color:"var(--c2)"}):""}</div>`
    :`<div class="panel mini-card"><div class="lbl">Progress tracking</div><p class="status" style="margin:6px 0 0">Fix some issues, then click <b>Read website again</b>. You'll see what got fixed and what's new.</p></div>`;
  $("#ta-out").innerHTML=`<div class="grid3">
     <div class="panel kpi">${ring(d.health_score,{label:"site health"})}<div><div style="font-weight:600">Site health ${d.health_score}/100</div><div class="lbl">Share of ${d.pages_checked} pages with no serious problems</div></div></div>
     <div class="panel">${hbars(["error","high","medium","low"].map(k=>({label:SEV_LABEL[k]+" issues",value:d.counts[k]||0,color:SEV_COL[k]})))}</div>
     ${progressCard}
   </div>
   <div class="panel">
     <div class="tabs2" role="group" aria-label="Site health sections" id="ta-main">${TA_GROUPS.map(([g,label])=>`<button data-tm="${g}">${label} <span class="tcount" data-tcm="${g}">${g==="problems"?d.issues.length:g==="pages"?d.page_rows.length:""}</span></button>`).join("")}</div>
     <div class="tabs2 sub" role="group" aria-label="Sub-sections" id="ta-tabs">${TA_SUBS.map(([t,g,label])=>`<button data-tt="${t}" data-tg="${g}">${label} <span class="tcount" data-tcs="${t}">${t==="issues"?d.issues.length:t==="ignored"?(d.ignored||[]).length:""}</span></button>`).join("")}</div>
     <div data-tp="issues">${d.issues.length?d.issues.map(issueBlock).join(""):emptyBox("No issues found","Every checked page passed. Read more pages to check the rest of the site.")}</div>
     <div data-tp="pages"><div class="row" style="margin-bottom:10px"><input id="ta-q" placeholder="Search pages" style="flex:1;min-width:180px"></div><div id="ta-pages"></div><div id="ta-page"></div></div>
     <div data-tp="speed"><div id="ta-speed"><p class="status">Loading…</p></div></div>
     <div data-tp="index"><div id="ta-index"><p class="status">Loading…</p></div></div>
     <div data-tp="links"><div id="ta-links"><p class="status">Loading…</p></div></div>
     <div data-tp="schema"><div id="ta-schema"><p class="status">Loading…</p></div></div>
     <div data-tp="dupes"><div id="ta-dupes"><p class="status">Loading…</p></div></div>
     <div data-tp="images"><div id="ta-images"><p class="status">Loading…</p></div></div>
     <div data-tp="sitemaps"><div id="ta-sitemaps"><p class="status">Loading…</p></div></div>
     <div data-tp="ext"><div id="ta-ext"><p class="status">Loading…</p></div></div>
     <div data-tp="ignored">${(d.ignored||[]).length?`<p class="status">Ignored issues don't count towards your score or to-do list.</p><div class="tw"><table><tr><th>Issue</th><th>Page</th><th>Reason</th><th><span class="sr-only">Actions</span></th></tr>${d.ignored.map(x=>`<tr><td>${esc((CHECK_LABELS[x.check]||x.check))}</td><td class="url">${esc(x.url)}</td><td>${esc(x.reason||"")}</td><td><button class="btn ghost small" data-unig='${esc(JSON.stringify({check:x.check,url:x.url}))}'>Restore</button></td></tr>`).join("")}</table></div>`:emptyBox("Nothing ignored","Use Ignore on an issue that's intentional, like a login page that's hidden from Google on purpose.")}</div>
   </div>`;
  const out=$("#ta-out");
  const tab=t=>{TA_TAB=t; const g=TA_GROUP_OF[t]||"problems"; TA_LAST[g]=t;
    out.querySelectorAll("[data-tm]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.tm===g)));
    out.querySelectorAll("#ta-tabs [data-tt]").forEach(b=>b.classList.toggle("hidden",b.dataset.tg!==g));
    { const sub=out.querySelector("#ta-tabs"); if(sub) sub.classList.toggle("hidden",TA_SUBS.filter(x=>x[1]===g).length<2); }
    out.querySelectorAll("[data-tt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.tt===t)));out.querySelectorAll("[data-tp]").forEach(p=>p.classList.toggle("hidden",p.dataset.tp!==t));};
  out.querySelectorAll("[data-tt]").forEach(b=>b.onclick=()=>tab(b.dataset.tt));
  out.querySelectorAll("[data-tm]").forEach(b=>b.onclick=()=>tab(TA_LAST[b.dataset.tm]||TA_SUBS.find(x=>x[1]===b.dataset.tm)[0])); tab(TA_TAB); taCounts(out);
  renderSpeed().catch(()=>{}); renderIndex().catch(()=>{}); renderLinks().catch(()=>{}); renderSchema().catch(()=>{}); renderDupes().catch(()=>{}); renderImages().catch(()=>{}); renderSitemaps().catch(()=>{}); renderExt().catch(()=>{});
  out.querySelectorAll("[data-ig]").forEach(b=>b.onclick=async()=>{ const o=JSON.parse(b.dataset.ig); const reason=b.closest("tr").querySelector("[data-igr]")?.value||""; await api(`/api/sites/${SITE_ID}/technical-audit/ignore`,{method:"POST",body:JSON.stringify({...o,reason})}); await runAudit(); });
  out.querySelectorAll("[data-unig]").forEach(b=>b.onclick=async()=>{ await api(`/api/sites/${SITE_ID}/technical-audit/unignore`,{method:"POST",body:b.dataset.unig}); await runAudit(); });
  out.querySelectorAll("[data-open-page]").forEach(b=>b.onclick=()=>{tab("pages");openPage(b.dataset.openPage);});
  $("#ta-q").oninput=renderPages; renderPages();
  if(TA_PAGE) openPage(TA_PAGE,true);
}
const CHECK_LABELS={};
function issueBlock(i){
  CHECK_LABELS[i.check]=i.label;
  return `<details class="iss" data-check="${esc(i.check)}"><summary>${sevPill(i.severity)}<b>${esc(i.label)}</b><span class="status">${i.count} page${i.count>1?"s":""}${i.clicks?` · ${fmtN(i.clicks)} Google clicks affected`:""}</span></summary>
   <p class="why"><b>Why it matters:</b> ${esc(i.why)}</p><p class="why" style="margin-bottom:10px"><b>How to fix:</b> ${esc(i.fix)}</p>
   <div class="tw"><table><tr><th>Page</th><th>Detail</th>${TA.has_traffic?"<th>Google clicks</th>":""}<th><span class="sr-only">Actions</span></th></tr>${i.pages.slice(0,100).map(x=>`<tr><td><button class="linkbtn" data-open-page="${esc(x.url)}" title="${esc(x.url)}">${esc(shortUrl(x.url))}</button></td><td>${esc(x.detail)}</td>${TA.has_traffic?`<td>${x.clicks==null?"–":fmtN(x.clicks)}</td>`:""}<td style="white-space:nowrap"><input data-igr placeholder="Reason (optional)" class="inline-edit" style="width:150px"> <button class="btn ghost small" data-ig='${esc(JSON.stringify({check:i.check,url:x.url}))}'>Ignore</button></td></tr>`).join("")}</table></div>${i.count>100?`<p class="status">Showing 100 of ${i.count}. Export the CSV for the full list.</p>`:""}</details>`;
}
function renderPages(){
  const q=($("#ta-q")?.value||"").toLowerCase(), rows=TA.page_rows.filter(r=>!q||r.url.toLowerCase().includes(q));
  $("#ta-pages").innerHTML=rows.length?`<div class="tw"><table><tr><th>Page</th>${TA.has_traffic?"<th>Google clicks</th>":""}<th>Problems</th><th><span class="sr-only">Actions</span></th></tr>${rows.slice(0,200).map(r=>`<tr><td title="${esc(r.url)}">${esc(shortUrl(r.url))}</td>${TA.has_traffic?`<td>${r.clicks==null?"–":fmtN(r.clicks)}</td>`:""}
     <td>${["error","high","medium","low"].filter(k=>r[k]).map(k=>`<span class="pill ${k==="low"?"":k==="medium"?"warn":"fail"}">${r[k]} ${SEV_LABEL[k].toLowerCase()}</span>`).join(" ")}</td>
     <td><button class="btn ghost small" data-pg="${esc(r.url)}">Open</button></td></tr>`).join("")}</table></div>`:emptyBox("No pages with problems","");
  $("#ta-pages").querySelectorAll("[data-pg]").forEach(b=>b.onclick=()=>openPage(b.dataset.pg));
}
async function openPage(url,silent){
  TA_PAGE=url; const row=TA.page_rows.find(r=>r.url===url)||{url,issues:[]}; const p=await api(`/api/sites/${SITE_ID}/page?url=${encodeURIComponent(url)}`).catch(()=>null);
  const fact=(l,v)=>`<div><span class="status">${l}</span><b>${v}</b></div>`;
  $("#ta-page").innerHTML=`<div class="panel" style="margin-top:14px;border-color:var(--accent)">
    <div class="row" style="justify-content:space-between"><h3 style="font-size:17px;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(p?.title||shortUrl(url))}</h3><button class="btn ghost small" data-close-page>Close</button></div>
    <a class="url" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
    ${p?`<div class="facts">${fact("Title",`${(p.title||"").length} chars`)}${fact("Meta description",`${(p.meta_description||"").length} chars`)}${fact("H1s",(p.h1||[]).length)}${fact("Words",fmtN(p.word_count||0))}${fact("Links in / out",`${p.inbound_links??"–"} / ${p.internal_links??"–"}`)}${fact("Images without alt",`${p.images_missing_alt||0} of ${p.images||0}`)}${fact("Mobile-ready",p.viewport===undefined?"–":p.viewport?"Yes":"No")}${fact("Structured data",(p.schema_types||[]).join(", ")||"None")}</div>`:`<p class="status">This page returned an error, so there's no content to show.</p>`}
    <h3 style="font-size:15px;margin:12px 0 6px">Problems on this page</h3>
    ${row.issues.length?`<ul class="c">${row.issues.map(x=>`<li>${sevPill(x.severity)} ${esc(x.label)}${x.detail?` <span class="status">(${esc(x.detail)})</span>`:""}</li>`).join("")}</ul>`:`<p class="pass">No problems found.</p>`}
    ${p?`<div class="row" style="margin-top:12px"><button class="btn" data-fixes>Suggest fixes with AI</button><button class="btn ghost" data-hist>See history</button><button class="btn ghost" data-inspect1>Check in Google</button>${READONLY?"":`<button class="btn ghost" data-refresh1>Create a refresh draft</button>`}<span class="status" data-fstatus></span></div><div data-fout></div>`:""}</div>`;
  const box=$("#ta-page"); box.querySelector("[data-close-page]").onclick=()=>{TA_PAGE=null;box.innerHTML="";};
  { const hb=document.querySelector("#ta-out [data-hist]"); if(hb) hb.onclick=()=>window._openHistory(url);
    api(`/api/sites/${SITE_ID}/images/page`,{method:"POST",body:JSON.stringify({url})}).then(list=>{ const host=document.querySelector("#ta-out [data-refresh1]")?.closest(".panel")||document.querySelector("#ta-out"); if(!list||!list.length||!host) return;
      const d2=document.createElement("div"); d2.className="ans"; d2.style.margin="8px 0"; d2.innerHTML=`<b>Images on this page with problems (${list.length})</b>${list.slice(0,8).map(i=>`<div style="margin-top:4px"><span class="url">${esc(decodeURIComponent(i.src.split("/").pop().split("?")[0]).slice(0,50))}</span>: ${i.issues.map(x=>`<span class="${x.level}">${esc(IMG_KIND[x.kind])}</span>`).join(", ")}</div>`).join("")}`; host.appendChild(d2); }).catch(()=>{});
    const rb=document.querySelector("#ta-out [data-refresh1]"); if(rb) rb.onclick=()=>{ const st=document.querySelector("#ta-out [data-fstatus]"); if(!needAI(st)) return; refreshFrom(url,rb,st); };
    const ib=document.querySelector("#ta-out [data-inspect1]"); if(ib) ib.onclick=()=>busy(ib,document.querySelector("#ta-out [data-fstatus]"),"Asking Google…",async()=>{ const id=SITE_ID, conn=await GSCC.get(id);
      if(!conn||!conn.property) throw new Error("Connect Search Console first (Performance screen).");
      const d=await api(`/api/sites/${id}/index/run`,{method:"POST",body:JSON.stringify({urls:[url]}),inspectFn:u=>GSCC.inspect(id,u)}); const r=(d.results||[]).find(x=>x.url===url);
      const st=document.querySelector("#ta-out [data-fstatus]"); if(st&&r){ st.innerHTML=`<span class="${r.status==="ok"?"pass":r.status==="problem"?"fail":""}">${esc(r.coverage)}</span>: ${esc(r.meaning)}${r.fix?` <b>Fix:</b> ${esc(r.fix)}`:""}`; } }); }
  const fb=box.querySelector("[data-fixes]"); if(fb) fb.onclick=()=>{ const st=box.querySelector("[data-fstatus]"); if(!needAI(st))return;
    busy(fb,st,"Writing suggestions…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/technical-audit/page-fixes`,{method:"POST",body:JSON.stringify({url})});
      const rowH=(lbl,o,n,max)=>`<div class="h">${lbl}</div><div class="old">${esc(o||"(none)")}</div><div class="new">${esc(n||"")} <span class="status">(${(n||"").length} chars)</span> <button class="linkbtn" data-copy-text="${esc(n||"")}">Copy</button></div>`;
      box.querySelector("[data-fout]").innerHTML=`<div class="block"><p class="status">Optimised for: <b>${esc(r.keyword||"")}</b>. ${esc(r.why||"")}</p>
        <div class="fix-cmp"><div class="h"></div><div class="h">Now</div><div class="h">Suggested</div>${rowH("Title tag",r.current.title_tag,r.title_tag)}${rowH("Meta description",r.current.meta_description,r.meta_description)}${rowH("H1",r.current.h1,r.h1)}</div>
        ${(r.other_fixes||[]).length?`<h3 style="font-size:15px;margin:14px 0 6px">Other fixes</h3>${list(r.other_fixes)}`:""}</div>`;
      box.querySelectorAll("[data-copy-text]").forEach(c=>c.onclick=async()=>{try{await navigator.clipboard.writeText(c.dataset.copyText);c.textContent="Copied";}catch{c.textContent="Copy blocked";}});
    }); };
  if(!silent) box.scrollIntoView({behavior:"smooth",block:"start"});
}
$("#ta-run").onclick=()=>{if(!needSite($("#ta-status")))return;busy($("#ta-run"),$("#ta-status"),"Checking pages…",runAudit);};
$("#ta-csv").onclick=()=>{ if(SITE_ID) api(`/api/sites/${SITE_ID}/technical-audit/export.csv`); };
$("#ta-recrawl").onclick=()=>{if(!needSite($("#ta-status")))return;busy($("#ta-recrawl"),$("#ta-status"),"Reading your website again…",async()=>{
  await api(`/api/sites/${SITE_ID}/recrawl`,{method:"POST"}); $("#ta-status").dataset.progress="1";
  for(let i=0;i<600;i++){ await new Promise(r=>setTimeout(r,2000)); const s=await api(`/api/sites/${SITE_ID}`); $("#ta-status").textContent=s.status==="ready"?"Done.":`${s.status}`;
    if(s.status==="ready"||s.status==="error"){ if(s.status==="error") throw new Error(s.error||"Reading failed."); break; } }
  SITE_URLS=null; await runAudit(); });};

// Search Console
function gscTable(rows,cols){return rows.length?`<div class="tw"><table><tr>${cols.map(c=>`<th>${esc(c[0])}</th>`).join("")}</tr>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(typeof c[1]==="function"?c[1](r):r[c[1]])}</td>`).join("")}</tr>`).join("")}</table></div>`:"<p>None found.</p>";}
// ---------- Google search ----------
const NOTE_COLOR={note:"var(--c6)",published:"var(--good)",refreshed:"var(--c1)",competitor:"var(--c4)",migration:"var(--c3)"};
// annotation lines for a chart: x(i) and the dates; a small marker at the top, details on hover
function noteMarks(notes,dates,x,top,bottom){ if(!notes||!notes.length||!dates.length) return ""; const first=dates[0], last=dates[dates.length-1];
  return notes.filter(n=>n.date>=first&&n.date<=last).map(n=>{ const i=dates.findIndex(d=>d>=n.date); if(i<0) return ""; const c=NOTE_COLOR[n.kind]||"var(--c6)";
    return `<g><line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${bottom}" stroke="${c}" stroke-width="1.4" stroke-dasharray="2 3"/><circle cx="${x(i)}" cy="${top}" r="5" fill="${c}"/><title>${esc(n.date)}: ${esc(n.text)}${n.by?` (${esc(n.by)})`:""}</title></g>`; }).join(""); }
function lineChart(points,{updates=[],label="clicks per day",color="var(--c1)",notes=[]}={}){
  if(points.length<2) return "";
  const W=760,H=220,L=44,Rp=10,T=18,B=28, max=Math.max(...points.map(p=>p.value),1), n=points.length;
  const x=i=>L+(W-L-Rp)*i/(n-1), y=v=>T+(H-T-B)*(1-v/max), idx=d=>points.findIndex(p=>p.date>=d);
  const path=points.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const bands=updates.map(u=>{ let a=idx(u.start), b=idx(u.end); if(a<0) return ""; if(b<0) b=n-1; if(points[b].date>u.end&&b>a) b--;
    const col=u.type==="core"?"var(--c2)":u.type==="spam"?"var(--c4)":"var(--c5)";
    return `<rect x="${x(a)}" y="${T}" width="${Math.max(3,x(b)-x(a))}" height="${H-T-B}" fill="${col}" opacity=".13"><title>${esc(u.name)} (${u.start} to ${u.end})</title></rect><line x1="${x(a)}" x2="${x(a)}" y1="${T-6}" y2="${H-B}" stroke="${col}" stroke-dasharray="3 3"/>`; }).join("");
  const ticks=[0,.25,.5,.75,1].map(f=>Math.round((n-1)*f)), yt=[0,.5,1].map(f=>Math.round(max*f));
  return `<div class="line-chart chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${yt.map(v=>`<line x1="${L}" x2="${W-Rp}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text class="ax" x="${L-6}" y="${y(v)+4}" text-anchor="end">${fmtN(v)}</text>`).join("")}
    ${bands}
    ${noteMarks(notes,points.map(p=>p.date),x,T-4,H-B)}
    <path d="${path} L${x(n-1)},${H-B} L${x(0)},${H-B} Z" fill="${color}" opacity=".08"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
    ${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="6" fill="transparent"><title>${esc(p.date)}: ${fmtN(p.value)} ${esc(label.split(" ")[0])}</title></circle>`).join("")}
    ${ticks.map(i=>`<text class="ax" x="${x(i)}" y="${H-8}" text-anchor="middle">${esc(new Date(points[i].date+"T00:00:00Z").toLocaleDateString(undefined,{day:"numeric",month:"short",timeZone:"UTC"}))}</text>`).join("")}
  </svg></div>`;
}
const deltaHtml=(v,{suffix="%",invert=false,abs=false}={})=>{ if(v==null) return ""; const good=invert?v<0:v>0, flat=v===0;
  return `<span class="delta ${flat?"flat":good?"up":"down"}">${v>0?"▲":v<0?"▼":"■"} ${abs?Math.abs(v):Math.abs(v)}${suffix}</span>`; };
let GSC=null, GSC_TAB="quick", GS_TAB=null;
// Google search screen: tabs, and Search Console results split into Overview and Searches & pages
function gsTab(t){ GS_TAB=t; if(t==="rankings") loadRanks().catch(e=>{ $("#rk-out").innerHTML=`<p class="err">${esc(e.message)}</p>`; }); const sec=document.querySelector("section[data-view=gsc]"); if(!sec) return;
  sec.querySelectorAll("#gs-tabs [data-gs]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.gs===t)));
  sec.querySelectorAll("[data-gsp]").forEach(el=>el.classList.toggle("hidden",!el.dataset.gsp.split(" ").includes(t)));
  sec.querySelectorAll("#gsc-out > [data-gpart]").forEach(el=>el.classList.toggle("hidden",el.dataset.gpart!==t)); }
function gsSplit(){ const out=$("#gsc-out"); if(!out) return; let part="overview";
  for(const el of out.children){ el.dataset.gpart=part; if(part==="overview"&&(el.querySelector(".line-chart")||el.querySelector("[data-notes-box]")||/No daily data/.test(el.textContent||""))) part="searches"; } }
async function gsSources(){ const box=$("#gs-sources"); if(!box||!SITE_ID) return;
  const [conn,imps,ga]=await Promise.all([GSCC.get(SITE_ID).catch(()=>null),api(`/api/sites/${SITE_ID}/gsc`).then(d=>d.imports||[]).catch(()=>[]),GA4.get(SITE_ID).catch(()=>null)]), bing=!!LLM.getSettings().bingKey;
  const chip=(on,label,detail,tab)=>`<button data-gsgo="${tab}"><span class="dot ${on?"on":""}"></span><b>${label}</b> ${esc(detail)}</button>`;
  box.innerHTML=`<span>Data sources:</span>${chip(!!(conn?.property||imps.length),"Search Console",conn?.property?"connected":imps.length?`imported (${imps[0].label})`:"not set up","import")}${chip(!!ga?.property,"Analytics",ga?.property?"connected":"not connected","analytics")}${chip(bing,"Bing",bing?"key added":"not set up","bing")}`;
  box.querySelectorAll("[data-gsgo]").forEach(b=>b.onclick=()=>gsTab(b.dataset.gsgo)); return imps.length||conn?.property; }
async function loadGsc(){ await loadAnn();
  const d=await api(`/api/sites/${SITE_ID}/gsc`); GSC=d;
  $("#gsc-imports").innerHTML=d.imports.length?`<p class="status">Uploaded: ${d.imports.map(i=>`<span class="pill">${esc(i.label)}</span> <button class="btn ghost small" data-gdel="${i.id}" aria-label="Delete ${esc(i.label)}">Remove</button>`).join(" ")}</p>`:"";
  $("#gsc-imports").querySelectorAll("[data-gdel]").forEach(x=>x.onclick=async()=>{await api(`/api/sites/${SITE_ID}/gsc/${x.dataset.gdel}`,{method:"DELETE"});loadGsc();});
  if(!d.analysis){$("#gsc-out").innerHTML=`<div class="panel" data-gpart="overview">${emptyBox("No Search Console data yet","Connect Search Console or upload an export under Import & connect.")}<p style="margin:0"><button class="btn" data-gsgo2>Import &amp; connect</button></p></div><div class="panel" data-gpart="searches">${emptyBox("No Search Console data yet","Connect Search Console or upload an export under Import & connect.")}</div>`;
    $("#gsc-how").open=true; $("#gsc-out").querySelector("[data-gsgo2]").onclick=()=>gsTab("import"); gsSources(); gsTab(GS_TAB&&GS_TAB!=="overview"&&GS_TAB!=="searches"?GS_TAB:"import"); return}
  $("#gsc-how").open=false;
  const a=d.analysis, t=a.totals||a.totals, c=a.change, imps=d.imports;
  const kpi=(n,l,dl)=>`<div class="panel kpi"><div><div class="num">${n}</div><div class="lbl">${l} ${dl||""}</div></div></div>`;
  const section=(title,sub,body)=>`<div class="panel"><h2>${esc(title)}</h2><p class="lead">${esc(sub)}</p>${body}</div>`;
  const impactRows=(a.impact||[]).map(u=>`<tr><td><span class="dot" style="background:${u.type==="core"?"var(--c2)":u.type==="spam"?"var(--c4)":"var(--c5)"}"></span>${esc(u.name)}</td><td>${esc(u.start)} → ${esc(u.end)}</td><td>${u.before==null?"–":fmtN(u.before)} → ${u.after==null?"–":fmtN(u.after)}</td>
     <td>${u.change==null?`<span class="status">Not enough data ${u.days_after<7?"after":"before"} the update</span>`:u.change<=-20?`<span class="pill fail">${u.change}% · possibly affected</span>`:u.change>=20?`<span class="pill pass">+${u.change}%</span>`:`<span class="pill">${u.change>0?"+":""}${u.change}% · no clear effect</span>`}</td></tr>`).join("");
  const br=a.brand;
  $("#gsc-out").innerHTML=`
   <p class="status" style="margin:-6px 0 12px">${a.range?`Showing <b>${esc(imps[0].label)}</b>`:`Showing <b>${esc(imps[0].label)}</b>`}${imps[1]?` compared with <b>${esc(imps[1].label)}</b>${c&&c.basis!=="date"?" (compared using the searches list, because one period has no daily data)":""}`:". Upload an earlier period to compare."}</p>
   <div class="grid4">${kpi(fmtN(t.clicks),"Clicks",c?deltaHtml(c.clicks):"")}${kpi(fmtN(t.impressions),"Times shown in Google",c?deltaHtml(c.impressions):"")}${kpi(t.ctr+"%","Click rate",c?deltaHtml(c.ctr,{suffix:" pts"}):"")}${kpi(t.position??"–","Average position",c&&c.position!=null?deltaHtml(c.position,{suffix:"",invert:true})+'<span class="status"> (lower is better)</span>':"")}</div>
   ${(a.daily||[]).length>1?`<div class="panel"><h2>Clicks per day</h2><p class="lead">Shaded bands are confirmed Google updates. Hover over a band for its name and dates.</p>
     ${(window._gscDaily=a.daily.map(x=>x.date),"")}${lineChart(a.daily.map(x=>({date:x.date,value:x.clicks})),{updates:a.impact||[],notes:ANN})}
     <div data-notes-box></div>
     <div class="upd-legend"><span><i style="background:var(--c2);opacity:.5"></i>Core update</span><span><i style="background:var(--c4);opacity:.5"></i>Spam update</span><span><i style="background:var(--c5);opacity:.5"></i>Other ranking update</span><span>Dates ${esc(updatesSource())}.</span></div>
     ${impactRows?`<h3 style="font-size:15px;margin:16px 0 6px">Did a Google update affect you?</h3><p class="status" style="margin-top:0">Average daily clicks in the 14 days before each update vs the 14 days after it finished. A drop at the same time doesn't prove the update caused it: check which pages fell, and look for seasonal or technical causes too.</p><div class="tw"><table><tr><th>Update</th><th>Dates</th><th>Clicks per day</th><th>Change</th></tr>${impactRows}</table></div>`:`<p class="status">No confirmed Google update falls inside these dates.</p>`}</div>`
     :`<div class="panel">${emptyBox("No daily data in this upload","Upload the full zip from Search Console (it includes daily figures) to see the trend and the impact of Google updates.")}</div>`}
   <div class="grid2">
     ${card("Devices","Clicks by device",a.devices&&a.devices.length?donut(a.devices.map((x,i)=>({label:x.label,value:x.clicks,color:PAL[i%PAL.length]})),{sub:"clicks"})+`<p class="status">${a.devices.map(x=>`${esc(x.label)}: ${x.ctr}% click rate, position ${x.position}`).join(" · ")}</p>`:"<p class='status'>Not in this upload.</p>")}
     ${card("Countries","Clicks by country (top 8)",a.countries&&a.countries.length?hbars(a.countries.slice(0,8).map(x=>({label:x.label,value:x.clicks,color:"var(--c2)"}))):"<p class='status'>Not in this upload.</p>")}
   </div>
   <div class="grid2">
     ${card("Brand vs topic searches","Searches containing your brand name vs everything else",`${br?donut([{label:"Brand searches",value:br.branded.clicks,color:"var(--c2)"},{label:"Topic searches",value:br.non_branded.clicks,color:"var(--c1)"}],{sub:"clicks"}):""}
       <p class="status">Topic searches show how well your content attracts new people. Brand searches mostly come from people who already know you.</p>
       <div class="row" style="flex-wrap:nowrap"><input id="gsc-brand" value="${esc((a.brand_terms||[]).join(", "))}" aria-label="Brand terms" placeholder="Brand terms, comma separated"><button class="btn ghost small" id="gsc-brand-save">Save</button></div>`)}
     ${card("Rising and falling searches",imps[1]?"Biggest changes in clicks vs the earlier period":"Upload an earlier period to compare",imps[1]?`<div class="grid2" style="margin:0"><div><h3 style="font-size:14px" class="pass">Rising</h3>${(a.rising||[]).length?`<ul class="c">${a.rising.slice(0,8).map(x=>`<li>${esc(x.query)} <span class="pass">+${fmtN(x.diff)}</span></li>`).join("")}</ul>`:"<p class='status'>None.</p>"}</div><div><h3 style="font-size:14px" class="fail">Falling</h3>${(a.falling||[]).length?`<ul class="c">${a.falling.slice(0,8).map(x=>`<li>${esc(x.query)} <span class="fail">${fmtN(x.diff)}</span></li>`).join("")}</ul>`:"<p class='status'>None.</p>"}</div></div>`:"")}
   </div>
   <div class="panel"><h2>Opportunities</h2><p class="lead">Where small changes can bring more clicks. Each list comes with a next step.</p>
     <div class="tabs2" role="group" id="gsc-tabs">
       <button data-gt="quick">Shown often, clicked rarely (${a.low_ctr.length})</button><button data-gt="near">Almost on page 1 (${a.striking_distance.length})</button>
       <button data-gt="losing">Losing clicks (${a.declining_pages.length+(a.falling||[]).length})</button><button data-gt="compete">Competing pages (${a.cannibalisation.length})</button><button data-gt="noclick">Never clicked (${a.pages_with_impressions_no_clicks.length})</button></div>
     <div data-gp="quick"><p class="status">Your page shows up but people skip it, usually because the title and description don't match what they searched. Quickest fix: rewrite them.</p>
       ${a.low_ctr.length?`<div class="tw"><table><tr><th>Search or page</th><th>Shown</th><th>Click rate</th><th>Your usual</th><th>Position</th><th>Clicks missed</th><th><span class="sr-only">Actions</span></th></tr>${a.low_ctr.slice(0,20).map((r,k)=>`<tr><td>${esc(r.query||shortUrl(r.page))}</td><td>${fmtN(r.impressions)}</td><td>${r.ctr}%</td><td>${r.benchmark_ctr}%</td><td>${r.position}</td><td>~${fmtN(r.missed_clicks)}</td><td>${r.query?`<button class="btn ghost small" data-snip="${k}">Suggest better titles</button>`:""}</td></tr><tr class="hidden" data-snip-row="${k}"><td colspan="7"></td></tr>`).join("")}</table></div>`:emptyBox("Nothing here","Your click rates look normal for your positions.")}</div>
     <div data-gp="near"><p class="status">These searches rank in positions 8–20. A stronger page could bring them onto page 1, where almost all clicks happen.</p>
       ${a.striking_distance.length?`<div class="tw"><table><tr><th>Search</th><th>Shown</th><th>Position</th><th>Clicks</th><th><span class="sr-only">Actions</span></th></tr>${a.striking_distance.slice(0,25).map(r=>`<tr><td>${esc(r.query)}</td><td>${fmtN(r.impressions)}</td><td>${r.position}</td><td>${fmtN(r.clicks)}</td><td><button class="btn ghost small" data-gcheck="${esc(r.query)}">Check keyword</button></td></tr>`).join("")}</table></div><div style="margin-top:10px"><button class="btn ghost small" id="gsc-tokw">Add all to my keywords</button></div>`:emptyBox("Nothing here","")}</div>
     <div data-gp="losing"><p class="status">Pages that lost 20% or more of their clicks, and searches that lost 10 or more, compared with the earlier period. Check whether the page still fully answers the search, and whether something technical changed.</p>
       ${a.compared||imps[1]?`${a.declining_pages.length?`<div class="tw"><table><tr><th>Page</th><th>Clicks before → now</th><th>Change</th><th>Position</th><th><span class="sr-only">Actions</span></th></tr>${a.declining_pages.map(r=>`<tr><td title="${esc(r.page)}">${esc(shortUrl(r.page))}</td><td>${fmtN(r.clicks_before)} → ${fmtN(r.clicks_now)}</td><td class="fail">${r.change_pct}%</td><td>${r.position_before} → ${r.position_now}</td><td><button class="btn ghost small" data-ghealth="${esc(r.page)}">Open in Site health</button></td></tr>`).join("")}</table></div>`:`<p class="status">No single page lost 20% or more of its clicks.${c&&c.clicks<=-10?` Your total clicks fell ${Math.abs(c.clicks)}%, so the drop is spread across many pages. Look at the daily chart and the Google update table above, and at searches losing clicks below.`:""}</p>`}
         ${(a.falling||[]).length?`<h3 style="font-size:15px;margin:14px 0 6px">Searches losing clicks</h3><div class="tw"><table><tr><th>Search</th><th>Clicks before → now</th><th><span class="sr-only">Actions</span></th></tr>${a.falling.map(x=>`<tr><td>${esc(x.query)}</td><td>${fmtN(x.before)} → ${fmtN(x.now)}</td><td><button class="btn ghost small" data-gcheck="${esc(x.query)}">Check keyword</button></td></tr>`).join("")}</table></div>`:""}`:emptyBox("Upload an earlier period","Then you'll see which pages and searches are losing clicks.")}</div>
     <div data-gp="compete"><p class="status">Several of your pages show up for the same search, so Google splits attention between them. Pick one main page.</p>
       ${a.has_query_page?(a.cannibalisation.length?gscTable(a.cannibalisation.slice(0,20),[["Search","query"],["Shown",r=>fmtN(r.impressions)],["Pages",r=>r.pages.map(p=>shortUrl(p.page)).join(" | ")]]):"<p class='status'>None found.</p>"):emptyBox("Needs a search + page export","The standard zip lists searches and pages separately. Export searches by page from the Search Console API, Looker Studio or BigQuery to see this.")}</div>
     <div data-gp="noclick"><p class="status">Pages that appear in Google but nobody clicks. Check the title and description, and whether the page matches the searches it shows for.</p>
       ${a.pages_with_impressions_no_clicks.length?`<div class="tw"><table><tr><th>Page</th><th>Shown</th><th>Position</th><th><span class="sr-only">Actions</span></th></tr>${a.pages_with_impressions_no_clicks.map(r=>`<tr><td title="${esc(r.page)}">${esc(shortUrl(r.page))}</td><td>${fmtN(r.impressions)}</td><td>${r.position}</td><td><button class="btn ghost small" data-ghealth="${esc(r.page)}">Open in Site health</button></td></tr>`).join("")}</table></div>`:emptyBox("Nothing here","")}</div>
   </div>
   ${(a.topics||[]).length?section("Topics","Your non-brand searches grouped into topics. Each topic should have one strong page.",`<div class="tw"><table><tr><th>Topic</th><th>Searches</th><th>Clicks</th><th>Shown</th><th>Click rate</th><th>Position</th><th>Your page</th><th><span class="sr-only">Actions</span></th></tr>${a.topics.map(tp=>`<tr><td><b>${esc(tp.topic)}</b><br><span class="status">${esc(tp.searches.slice(1,4).join(", "))}${tp.searches.length>4?"…":""}</span></td><td>${tp.searches.length}</td><td>${fmtN(tp.clicks)}</td><td>${fmtN(tp.impressions)}</td><td>${tp.ctr}%</td><td>${tp.position}</td><td>${tp.coverage?covPill(tp.coverage):"–"}</td><td><button class="btn ghost small" data-gcheck="${esc(tp.topic)}">Check</button></td></tr>`).join("")}</table></div>`):""}`;
  const out=$("#gsc-out");
  const tab=t=>{GSC_TAB=t;out.querySelectorAll("[data-gt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.gt===t)));out.querySelectorAll("[data-gp]").forEach(p=>p.classList.toggle("hidden",p.dataset.gp!==t));};
  out.querySelectorAll("[data-gt]").forEach(b=>b.onclick=()=>tab(b.dataset.gt)); tab(GSC_TAB);
  renderNotesBox().catch(()=>{});
  gsSplit(); gsSources(); gsTab(GS_TAB&&GS_TAB!=="import"?GS_TAB:"overview");
  { const head=$("#gsc-out").querySelector("[data-gpart=overview]"); if(head&&!READONLY) head.insertAdjacentHTML("beforeend",` <button class="linkbtn" data-gsup>Upload another period</button>`); const up=$("#gsc-out [data-gsup]"); if(up) up.onclick=()=>gsTab("import"); }
  out.querySelectorAll("[data-gcheck]").forEach(b=>b.onclick=()=>openCheck(b.dataset.gcheck));
  out.querySelectorAll("[data-ghealth]").forEach(b=>b.onclick=async()=>{ show("tech"); for(let i=0;i<40&&!TA;i++) await new Promise(r=>setTimeout(r,150)); if(TA){ TA_TAB="pages"; renderAudit(); openPage(b.dataset.ghealth); } });
  out.querySelectorAll("[data-snip]").forEach(b=>b.onclick=()=>{ const k=+b.dataset.snip, row=a.low_ctr[k], cell=out.querySelector(`[data-snip-row="${k}"]`); cell.classList.remove("hidden"); const td=cell.querySelector("td");
    if(!needAI(td)) return;
    busy(b,td,"Writing title ideas…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/gsc/snippet-fix`,{method:"POST",body:JSON.stringify(row)});
      td.innerHTML=`<p class="status" style="margin:4px 0">${esc(r.diagnosis||"")}</p>${(r.options||[]).map(o=>`<div class="snip-opt"><span class="pill">${esc(o.angle||"")}</span><div class="t">${esc(o.title_tag)}</div><div class="status">${esc(o.meta_description)}</div>
        <button class="linkbtn" data-copy-text="${esc(o.title_tag)}">Copy title</button> · <button class="linkbtn" data-copy-text="${esc(o.meta_description)}">Copy description</button></div>`).join("")}`;
      td.querySelectorAll("[data-copy-text]").forEach(cb=>cb.onclick=async()=>{try{await navigator.clipboard.writeText(cb.dataset.copyText);cb.textContent="Copied";}catch{cb.textContent="Copy blocked";}}); }); });
  const tk=$("#gsc-tokw"); if(tk) tk.onclick=async()=>{await api(`/api/sites/${SITE_ID}/gsc/to-keywords`,{method:"POST",body:JSON.stringify({queries:a.striking_distance.map(r=>r.query)})});tk.textContent="Added to my keywords";tk.disabled=true;};
  $("#gsc-brand-save").onclick=async()=>{ await api(`/api/sites/${SITE_ID}/brand-terms`,{method:"POST",body:JSON.stringify({terms:$("#gsc-brand").value.split(",")})}); await loadGsc(); };
}
$("#gsc-up").onclick=()=>{if(!needSite($("#gsc-status")))return;busy($("#gsc-up"),$("#gsc-status"),"Importing…",async()=>{
  const f=$("#gsc-file").files[0]; if(!f) throw new Error("Choose the export file first.");
  const r=await api(`/api/sites/${SITE_ID}/gsc/import`,{method:"POST",body:JSON.stringify({label:$("#gsc-label").value}),file:f});
  $("#gsc-file").value=""; $("#gsc-label").value=""; GS_TAB="overview"; await loadGsc(); $("#gsc-status").textContent=`Uploaded ${r.rows} rows.`; window.scrollTo(0,0); toast(`Uploaded ${r.rows} rows. Showing the overview.`);
});};


// ---------- AI answers ----------
const ENGINE_LABEL={claude_web_search:"Claude",chatgpt_web_search:"ChatGPT",gemini_web_search:"Gemini",demo:"Demo",chatgpt:"ChatGPT (manual)",google_ai_overviews:"Google AI Overviews",google_ai_mode:"Google AI Mode",perplexity:"Perplexity",gemini:"Gemini (manual)",copilot:"Copilot",claude:"Claude (manual)",other:"Other"};
const PROV_LABEL={claude:"Claude",openai:"ChatGPT",gemini:"Gemini",mock:"Demo mode"};
let VIS=null, VIS_OPEN=new Set();
function updEstimate(){ const q=(VIS&&VIS.questions||[]).length, p=document.querySelectorAll("#av-provs input:checked").length;
  $("#av-est").textContent=q&&p?`${Math.min(q,25)} question${q>1?"s":""} × ${p} assistant${p>1?"s":""} = ${Math.min(q,25)*p} checks, each with a web search (billed by your providers).`:q?"Choose at least one assistant.":"Add questions first."; }
async function loadVis(){
  const d=await api(`/api/sites/${SITE_ID}/visibility`); VIS=d; const sm=d.summary;
  if(!$("#av-engine").options.length) $("#av-engine").innerHTML=["chatgpt","google_ai_overviews","google_ai_mode","perplexity","gemini","copilot","claude","other"].map(e=>`<option value="${e}">${esc(ENGINE_LABEL[e])}</option>`).join("");
  const keep=new Set([...document.querySelectorAll("#av-provs input:checked")].map(x=>x.value));
  $("#av-provs").innerHTML=d.providers.length?d.providers.map(pv=>`<label class="chip"><input type="checkbox" value="${pv}" ${!keep.size||keep.has(pv)?"checked":""}>${esc(PROV_LABEL[pv]||pv)}</label>`).join("")+` <button class="linkbtn" data-go="settings">Add another assistant's key</button>`
    :`<span class="status">No AI keys saved yet.</span> <button class="linkbtn" data-go="settings">Connect AI</button>`;
  bindGo($("#av-provs")); $("#av-provs").querySelectorAll("input").forEach(x=>x.onchange=updEstimate); updEstimate();
  if(!sm.checks&&!d.questions.length){$("#av-out").innerHTML=`<div class="panel">${emptyBox("Start by adding questions","Add 5–10 questions your buyers would ask AI, or let AI suggest some. Then click Run all questions.")}</div>`;return}
  const kpi=(n,l)=>`<div class="panel kpi"><div><div class="num">${n}</div><div class="lbl">${l}</div></div></div>`;
  const engs=Object.keys(sm.engines), qrows=sm.questions;
  const cell=r=>!r?'<span class="status">–</span>':r.error?`<span class="pill" title="${esc(r.error)}">error</span>`:r.mentioned?`<span class="pill pass">✓${r.position?` #${r.position}`:""}${r.cited_url?" · linked":""}</span>`:`<span class="pill fail">✗</span>`;
  const sameDay=new Set(sm.trend.map(t=>t.date)).size===1;
  const trendChart=sm.trend.length?columns(sm.trend.map(t=>({label:sameDay&&t.at?new Date(t.at).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}):(t.date||"").slice(5),value:t.mention_rate})),{fmt:v=>v+"%",color:"var(--c2)"}):"";
  $("#av-out").innerHTML=`
   <div class="grid4">${kpi(sm.mention_rate+"%","of current answers mention you")}${kpi(sm.citation_rate+"%","link to your site")}${kpi(sm.avg_position?`#${sm.avg_position}`:"–","average place when mentioned")}${kpi(qrows.length,"questions tracked")}</div>
   <div class="grid2">
     ${card("Mentioned over time","Share of answers that name you, per run",(sm.trend.length>1?"":`<p class="status">Run your questions again in a week or two to see the trend. Answers vary, so trends matter more than one run.</p>`)+trendChart)}
     ${card("Share of voice","How often each brand is named across current answers",sm.share_of_voice.length?hbars(sm.share_of_voice.map(e=>({label:(e.ours?"★ ":"")+e.name,value:e.answers,color:e.ours?"var(--c1)":e.tracked?"var(--c3)":"var(--c5)"})),{fmt:v=>v+" answers"})+`<div class="row" style="margin-top:10px;flex-wrap:nowrap"><input id="av-comp-list" aria-label="Competitors to track" placeholder="Competitors to track, comma separated" value="${esc((d.competitors||[]).join(", "))}"><button class="btn ghost small" id="av-comp-save">Save</button></div>`:"<p class='status'>Run some questions first.</p>")}
   </div>
   <div class="grid2">
     ${card("Sources AI relies on","Sites the assistants cited. Being listed, reviewed or mentioned on these helps you appear in answers.",sm.sources.length?hbars(sm.sources.map(x=>({label:x.domain,value:x.answers,color:"var(--c3)"})),{fmt:v=>v+" answers"}):"<p class='status'>No sources recorded yet.</p>")}
     ${card("By assistant","Share of current answers that mention you",engs.length?hbars(engs.map(k=>({label:ENGINE_LABEL[k]||k,value:sm.engines[k].mention_rate,color:"var(--c2)"})),{max:100,fmt:v=>v+"%"}):"<p class='status'>No checks yet.</p>")}
   </div>
   <div class="panel"><h2>Questions</h2><p class="lead">Latest result from each assistant. ✓ #2 means you were the second brand named; “linked” means it cited your site. Click a question to read the answers and see how you're described.</p>
     <div class="tw"><table><tr><th>Question</th>${engs.map(e=>`<th>${esc(ENGINE_LABEL[e]||e)}</th>`).join("")}<th>History</th><th><span class="sr-only">Actions</span></th></tr>
     ${qrows.map((q,k)=>`<tr><td style="min-width:260px"><button class="linkbtn" style="font-size:14px;text-align:left" data-qopen="${k}">${esc(q.question)}</button>${q.last?`<br><span class="status">Checked ${esc(q.last)}</span>`:`<br><span class="status">Not run yet</span>`}</td>
       ${engs.map(e=>`<td class="res-cell">${cell(q.results[e])}</td>`).join("")}<td><span class="hist" title="Latest first">${q.history.slice(-8).reverse().map(h=>`<i class="${h.mentioned?"y":"n"}" title="${esc(h.date)} · ${esc(ENGINE_LABEL[h.engine]||h.engine)}"></i>`).join("")}</span></td>
       <td style="white-space:nowrap">${q.id?`${q.checked&&Object.values(q.results).some(r=>!r.error&&!r.mentioned)?`<button class="btn small" data-why="${q.id}" title="${q.mentioned_any?"Some assistants leave you out":"No assistant mentions you"}">Why not us?</button> `:""}<button class="btn ghost small" data-qrun="${q.id}">Run</button> <button class="btn ghost small" data-qdel="${q.id}" aria-label="Remove question">✕</button>`:""}</td></tr>
       <tr class="${VIS_OPEN.has(k)?"":"hidden"}" data-qbody="${k}"><td colspan="${engs.length+3}">${questionBody(q)}</td></tr>`).join("")}</table></div>
     <p class="status" style="margin-top:10px">${esc(sm.note)}</p></div>`;
  const out=$("#av-out");
  out.querySelectorAll("[data-qopen]").forEach(b=>b.onclick=()=>{ const k=+b.dataset.qopen, r=out.querySelector(`[data-qbody="${k}"]`); r.classList.toggle("hidden"); r.classList.contains("hidden")?VIS_OPEN.delete(k):VIS_OPEN.add(k); });
  out.querySelectorAll("[data-qdel]").forEach(b=>b.onclick=async()=>{ await api(`/api/sites/${SITE_ID}/visibility/questions/${b.dataset.qdel}`,{method:"DELETE"}); VIS_OPEN.clear(); loadVis(); });
  out.querySelectorAll("[data-qrun]").forEach(b=>b.onclick=()=>runVis([+b.dataset.qrun],b));
  out.querySelectorAll("[data-why]").forEach(b=>b.onclick=()=>{ const st=$("#av-rstatus"); if(!needAI(st))return; busy(b,st,"Analysing the answers and sources…",async()=>{ await api(`/api/sites/${SITE_ID}/visibility/questions/${b.dataset.why}/why`,{method:"POST"}); VIS_OPEN.add(qrows.findIndex(q=>q.id===+b.dataset.why)); await loadVis(); }); });
  out.querySelectorAll("[data-akw]").forEach(b=>b.onclick=()=>openCheck(b.dataset.akw));
  const cs=$("#av-comp-save"); if(cs) cs.onclick=async()=>{ await api(`/api/sites/${SITE_ID}/visibility/competitors`,{method:"POST",body:JSON.stringify({names:$("#av-comp-list").value.split(",")})}); loadVis(); };
}
function questionBody(q){
  const res=Object.values(q.results), a=q.analysis;
  return `${res.map(r=>`<div class="ans"><b>${esc(ENGINE_LABEL[r.engine]||r.engine)}</b> · ${esc(r.checked_at||"")} ${r.mentioned?'<span class="pill pass">mentions you</span>':'<span class="pill fail">doesn\'t mention you</span>'}${r.no_search?' <span class="pill warn" title="This model answered without a live web search">no web search</span>':""}
     ${r.brand_context?`<p style="margin:6px 0"><b>How it describes you:</b> “${esc(r.brand_context)}” <span class="status">Accurate? If not, make sure your site and review profiles say it clearly.</span></p>`:""}
     ${(r.brands||[]).length?`<p class="status" style="margin:4px 0">Brands named: ${esc(r.brands.join(", "))}</p>`:""}
     ${r.answer_excerpt?`<details><summary class="status">Read the answer</summary><p style="margin:6px 0">${esc(r.answer_excerpt)}</p></details>`:""}
     ${(r.sources||[]).length?`<details><summary class="status">Sources (${r.sources.length})</summary>${list(r.sources)}</details>`:""}${r.error?`<p class="err">${esc(r.error)}</p>`:""}</div>`).join("")||"<p class='status'>Not run yet.</p>"}
   ${a?`<div class="why-box"><b>Why not us?</b> <span class="status">${esc(fmtDate(a.at))}</span><p style="margin:6px 0">${esc(a.summary||"")}</p>${list(a.reasons)}
     ${(a.actions||[]).length?`<h3 style="font-size:14px;margin:10px 0 4px">What to do</h3><ol class="c" style="padding-left:20px">${a.actions.map(x=>`<li><b>${esc(x.title)}</b>: ${esc(x.detail)}${x.target?` <span class="url">${esc(x.target)}</span>`:""}</li>`).join("")}</ol>`:""}
     ${a.suggested_keyword?`<button class="btn ghost small" data-akw="${esc(a.suggested_keyword)}">Check keyword “${esc(a.suggested_keyword)}”</button>`:""}</div>`:""}`;
}
async function runVis(ids,btn){
  const st=$("#av-rstatus"), providers=[...document.querySelectorAll("#av-provs input:checked")].map(x=>x.value);
  if(!needAI(st)) return; if(!providers.length){st.textContent="Choose at least one assistant.";st.classList.add("err");return;}
  await busy(btn,st,"Starting…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/visibility/run`,{method:"POST",body:JSON.stringify({question_ids:ids,providers}),onProgress:m=>{st.dataset.progress="1";st.textContent=m;}});
    await loadVis(); if(r.failed) throw new Error(`${r.checks-r.failed} checks done, ${r.failed} failed: ${r.errors.join(" ")}`); });
}
$("#av-run").onclick=()=>{ if(!needSite($("#av-rstatus"),true))return; runVis(null,$("#av-run")); };
$("#av-add-btn").onclick=()=>{ if(!needSite($("#av-qstatus")))return; busy($("#av-add-btn"),$("#av-qstatus"),"Adding…",async()=>{
  const r=await api(`/api/sites/${SITE_ID}/visibility/questions`,{method:"POST",body:JSON.stringify({questions:$("#av-add").value.split("\n")})}); $("#av-add").value=""; await loadVis(); $("#av-qstatus").textContent=`Added ${r.added}.`; }); };
$("#av-ideas-btn").onclick=()=>{ if(!needSite($("#av-qstatus"),true))return; busy($("#av-ideas-btn"),$("#av-qstatus"),"Thinking of questions…",async()=>{
  const ideas=await api(`/api/sites/${SITE_ID}/visibility/ideas`,{method:"POST",body:"{}"});
  $("#av-ideas").innerHTML=ideas.length?`<div class="block"><h3>Suggested questions</h3><div class="tw"><table><tr><th><span class="sr-only">Actions</span></th><th>Question</th><th>Type</th><th>Why</th></tr>${ideas.map((x,k)=>`<tr><td><input type="checkbox" data-idea="${k}" ${x.tracked?"disabled":"checked"} aria-label="Select question"></td><td>${esc(x.question)}${x.tracked?' <span class="status">(already tracked)</span>':""}</td><td>${esc(x.type||"")}</td><td class="status">${esc(x.why||"")}</td></tr>`).join("")}</table></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="av-ideas-add">Track selected</button><button class="btn ghost" id="av-ideas-close">Close</button></div></div>`:"<p class='status'>No suggestions.</p>";
  const add=$("#av-ideas-add"); if(add) add.onclick=async()=>{ const sel=[...document.querySelectorAll("#av-ideas [data-idea]:checked")].map(c=>ideas[+c.dataset.idea].question);
    const r=await api(`/api/sites/${SITE_ID}/visibility/questions`,{method:"POST",body:JSON.stringify({questions:sel})}); $("#av-ideas").innerHTML=""; await loadVis(); $("#av-qstatus").textContent=`Added ${r.added} questions.`; };
  const cl=$("#av-ideas-close"); if(cl) cl.onclick=()=>$("#av-ideas").innerHTML=""; }); };
$("#av-add-manual").onclick=()=>{if(!needSite($("#av-status")))return;busy($("#av-add-manual"),$("#av-status"),"Saving…",async()=>{
  const prompt=$("#av-prompt").value.trim(); if(!prompt) throw new Error("Enter the question you asked.");
  await api(`/api/sites/${SITE_ID}/visibility`,{method:"POST",body:JSON.stringify([{prompt,engine:$("#av-engine").value,mentioned:$("#av-mentioned").checked,cited_url:$("#av-cited").value.trim(),competitors:$("#av-comp").value.trim(),checked_at:$("#av-date").value}])});
  ["#av-prompt","#av-cited","#av-comp"].forEach(id=>$(id).value="");$("#av-mentioned").checked=false; await loadVis(); $("#av-status").textContent="Saved."; });};

// ---------- keywords ----------
let KW=[], KW_SEL=new Set(), IDEAS=[];
const COV={covered:["pass","Has a page"],partial:["warn","Partly covered"],gap:["fail","No page yet"],unknown:["","–"]};
const covPill=c=>{const x=COV[(c||{}).status]||COV.unknown;return `<span class="pill ${x[0]}">${x[1]}</span>`;};
document.querySelectorAll("#kw-tabs [data-kt]").forEach(b=>b.onclick=()=>kwTab(b.dataset.kt));
function kwTab(t){
  document.querySelectorAll("#kw-tabs [data-kt]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.kt===t)));
  document.querySelectorAll("[data-kp]").forEach(p=>p.classList.toggle("hidden",p.dataset.kp!==t));
  if(t==="clusters"&&SITE_ID) loadClusters().catch(e=>{$("#kc-out").innerHTML=`<p class="err">${esc(e.message)}</p>`;});
  if(t==="list"&&SITE_ID) loadKw().catch(()=>{});
  if(t==="questions") loadQuestions().catch(()=>{});
  if(t==="wiki"&&!$("#wk-q").value&&CURRENT_SITE) $("#wk-q").value="";
}
function kwFiltersInit(){
  if($("#kw-f-intent").options.length>1) return;
  $("#kw-f-intent").innerHTML='<option value="">All intents</option>'+Object.entries(INTENT_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  const acts=["review",...Object.keys((RULES||{}).url_actions||{})];
  $("#kw-f-action").innerHTML='<option value="">All actions</option>'+acts.map(a=>`<option>${a}</option>`).join("");
  $("#kw-bulk-action").innerHTML='<option value="">Set action…</option>'+acts.map(a=>`<option>${a}</option>`).join("");
}
async function loadKw(){
  kwFiltersInit();
  KW=await api(`/api/sites/${SITE_ID}/keywords`);
  const n=k=>KW.filter(x=>(x.coverage||{}).status===k).length;
  $("#kw-summary").innerHTML=KW.length?`<div class="grid4">
     <div class="panel kpi"><div><div class="num">${KW.length}</div><div class="lbl">Keywords</div></div></div>
     <div class="panel kpi"><div><div class="num pass">${n("covered")}</div><div class="lbl">Have a page</div></div></div>
     <div class="panel kpi"><div><div class="num warn">${n("partial")}</div><div class="lbl">Partly covered</div></div></div>
     <div class="panel kpi"><div><div class="num fail">${n("gap")}</div><div class="lbl">No page yet</div></div></div></div>`:"";
  renderKw();
}
let KW_LIMIT=300;   // rows drawn at once; "Show more" adds 300 more
function renderKw(arg){
  if(arg===true||(typeof Event!=="undefined"&&arg instanceof Event)) KW_LIMIT=300;   // searching or changing a filter starts from the top; other redraws keep the rows shown
  const q=$("#kw-q").value.trim().toLowerCase(), fc=$("#kw-f-cov").value, fi=$("#kw-f-intent").value, fa=$("#kw-f-action").value, so=$("#kw-sort").value;
  let rows=KW.filter(k=>(!q||k.keyword.includes(q))&&(!fc||(k.coverage||{}).status===fc)&&(!fi||k.intent===fi)&&(!fa||k.action===fa));
  rows.sort(so==="volume"?(a,b)=>((b.volume||b.gsc_impressions||0)-(a.volume||a.gsc_impressions||0)):so==="keyword"?(a,b)=>a.keyword.localeCompare(b.keyword):so==="recent"?(a,b)=>(b.updated_at||0)-(a.updated_at||0):(a,b)=>b.opportunity-a.opportunity);
  const acts=["review",...Object.keys((RULES||{}).url_actions||{})];
  if(!KW.length){$("#kw-out").innerHTML=emptyBox("No keywords yet","Add keywords above, import a file, or use Find ideas.");$("#kw-bulk").classList.add("hidden");return;}
  const shown=rows.slice(0,KW_LIMIT);
  $("#kw-out").innerHTML=`<p class="status">${rows.length} of ${KW.length} keywords${rows.length>shown.length?` (showing the first ${shown.length})`:""}. Coverage is checked against the pages read from your site, instantly and without AI.</p>
   <div class="tw"><table><thead><tr><th><input type="checkbox" id="kw-all" aria-label="Select all shown"></th><th>Keyword</th><th>Your page</th><th title="0–100: search demand, business value and ease">Score</th><th>Volume</th><th>Difficulty</th><th title="How valuable this keyword is to your business, 1–5">Value</th><th>Intent</th><th>Action</th></tr></thead><tbody>
   ${shown.map(k=>`<tr data-kw="${esc(k.keyword)}"><td><input type="checkbox" data-sel ${KW_SEL.has(k.keyword)?"checked":""} aria-label="Select ${esc(k.keyword)}"></td>
     <td class="kw-cell"><b>${esc(k.keyword)}</b><div class="row-links"><button class="linkbtn" data-kcheck>Check</button><button class="linkbtn" data-kcal>Add to calendar</button><button class="linkbtn" data-kbrief>Brief</button>${(k.coverage||{}).status!=="covered"?`<button class="linkbtn" data-kwrite>Write a page</button>`:""}</div>${(k.source&&!["added","manual"].includes(k.source))||k.gsc_impressions!=null?`<br><span class="status">${esc(["added","manual"].includes(k.source)?"":k.source||"")}${k.gsc_impressions!=null?`${k.source&&!["added","manual"].includes(k.source)?" · ":""}${fmtN(k.gsc_impressions)} impressions, pos ${k.gsc_position}`:""}</span>`:""}</td>
     <td class="cov-cell">${covPill(k.coverage)}${k.coverage&&k.coverage.url?`<a class="url trunc" href="${esc(k.coverage.url)}" target="_blank" rel="noopener" title="${esc(k.coverage.url)}">${esc(k.coverage.url.replace(/^https?:\/\/(www\.)?[^/]+/,"")||"/")}</a>`:""}</td>
     <td><b>${k.opportunity}</b></td>
     <td><input class="inline-edit num-in" type="number" data-f="volume" value="${k.volume??""}" placeholder="–" aria-label="Volume"></td>
     <td><input class="inline-edit num-in" type="number" data-f="difficulty" value="${k.difficulty??""}" min="0" max="100" placeholder="–" aria-label="Difficulty"></td>
     <td><input class="inline-edit num-in sm" type="number" data-f="business_value" value="${k.business_value??3}" min="1" max="5" aria-label="Business value"></td>
     <td class="nowrap">${esc(INTENT_LABEL[k.intent]||k.intent||"")}${k.intent_guessed?'<br><span class="status">guessed</span>':""}</td>
     <td><select class="inline-edit" data-f="action" aria-label="Action">${acts.map(a=>`<option ${a===k.action?"selected":""}>${a}</option>`).join("")}</select></td>
</tr>`).join("")}</tbody></table></div>${rows.length>shown.length?`<div class="row" style="margin-top:8px"><button class="btn ghost" id="kw-more">Show ${Math.min(300,rows.length-shown.length)} more</button><span class="status">${fmtN(rows.length-shown.length)} not shown yet. Searching and filters work on all of them.</span></div>`:""}`;
  const more=$("#kw-more"); if(more) more.onclick=()=>{ const y=window.scrollY; KW_LIMIT+=300; renderKw(false); window.scrollTo(0,y); };
  $("#kw-out").querySelectorAll("tr[data-kw]").forEach(tr=>{
    const kw=tr.dataset.kw, k=KW.find(x=>x.keyword===kw);
    tr.querySelector("[data-sel]").onchange=e=>{e.target.checked?KW_SEL.add(kw):KW_SEL.delete(kw);updBulk();};
    tr.querySelectorAll("[data-f]").forEach(inp=>inp.onchange=async()=>{const f=inp.dataset.f;let v=inp.value;if(["volume","business_value"].includes(f))v=v===""?null:parseInt(v);if(f==="difficulty")v=v===""?null:parseFloat(v);
      try{await api(`/api/sites/${SITE_ID}/keywords`,{method:"PATCH",body:JSON.stringify({keyword:kw,[f]:v})});await loadKw();}catch(e){$("#kw-status").textContent=e.message;}});
    tr.querySelector("[data-kcheck]").onclick=()=>{openCheck(kw);};
    { const kb2=tr.querySelector("[data-kbrief]"); if(kb2) kb2.onclick=()=>briefFor(kw,kb2); }
    { const kc=tr.querySelector("[data-kcal]"); if(kc) kc.onclick=async()=>{ const r=await api(`/api/sites/${SITE_ID}/plan`,{method:"POST",body:JSON.stringify({items:[{keyword:kw}]})}); kc.textContent=r.added?"On the calendar ✓":"Already on the calendar"; kc.disabled=true; }; }
    const w=tr.querySelector("[data-kwrite]"); if(w) w.onclick=()=>prefillWrite(kw,k.intent);
  });
  $("#kw-all").checked=shown.length>0&&shown.every(k=>KW_SEL.has(k.keyword));
  $("#kw-all").onchange=e=>{shown.forEach(k=>e.target.checked?KW_SEL.add(k.keyword):KW_SEL.delete(k.keyword));renderKw();};
  updBulk();
}
function suggestPageType(kw,intent){ const k=" "+kw.toLowerCase()+" ";
  if(/ (vs|versus) /.test(k)) return "comparison"; if(/ alternatives? /.test(k)) return "alternatives"; if(/^ (best|top) /.test(k)) return "listicle";
  if(/ (what is|what are|meaning|definition) /.test(k)||/ (template|checklist|examples?|sample) /.test(k)) return "blog_post";
  return {how_to:"how_to_guide",transactional:"landing_page",commercial:"use_case",navigational:"help_article"}[intent]||"blog_post"; }
function prefillWrite(kw,intent){ $("#g-kw").value=kw; setTimeout(()=>kwInfo().catch(()=>{}),50); if(intent&&$(`#g-intent option[value="${intent}"]`))$("#g-intent").value=intent;
  $("#g-type").value=suggestPageType(kw,intent); show("generate"); }
function updBulk(){ KW_SEL=new Set([...KW_SEL].filter(k=>KW.some(x=>x.keyword===k))); $("#kw-bulk").classList.toggle("hidden",!KW_SEL.size); $("#kw-bulk-n").textContent=`${KW_SEL.size} selected`; }
["#kw-q","#kw-f-cov","#kw-f-intent","#kw-f-action","#kw-sort"].forEach(id=>$(id)[id==="#kw-q"?"oninput":"onchange"]=renderKw);
const bulk=async(op,fields={})=>{await api(`/api/sites/${SITE_ID}/keywords/bulk`,{method:"POST",body:JSON.stringify({keywords:[...KW_SEL],op,fields})});if(op==="delete")KW_SEL.clear();await loadKw();};
$("#kw-bulk-action").onchange=e=>{if(e.target.value)bulk("update",{action:e.target.value}).then(()=>e.target.value="");};
$("#kw-bulk-value").onchange=e=>{if(e.target.value)bulk("update",{business_value:parseInt(e.target.value)}).then(()=>e.target.value="");};
let bulkDelArm=false; $("#kw-bulk-del").onclick=()=>{if(!bulkDelArm){bulkDelArm=true;$("#kw-bulk-del").textContent="Click again to remove";setTimeout(()=>{bulkDelArm=false;$("#kw-bulk-del").textContent="Remove";},3000);return;}bulkDelArm=false;$("#kw-bulk-del").textContent="Remove";bulk("delete");};
$("#kw-bulk-clear").onclick=()=>{KW_SEL.clear();renderKw();};
$("#kw-add-btn").onclick=()=>{if(!needSite($("#kw-status")))return;busy($("#kw-add-btn"),$("#kw-status"),"Adding…",async()=>{
  const list=$("#kw-add").value.split(/\n|,/).map(x=>x.trim()).filter(Boolean); if(!list.length) throw new Error("Type or paste at least one keyword.");
  const r=await api(`/api/sites/${SITE_ID}/keywords/add`,{method:"POST",body:JSON.stringify({keywords:list})}); $("#kw-add").value=""; await loadKw();
  $("#kw-status").textContent=`Added ${r.added}${r.skipped?`, ${r.skipped} already in your list`:""}.`;});};
$("#kw-export").onclick=()=>{ if(SITE_ID) api(`/api/sites/${SITE_ID}/keywords/export.csv`); };
$("#kw-import").onclick=()=>{if(!needSite($("#kw-status")))return;busy($("#kw-import"),$("#kw-status"),"Importing…",async()=>{
  const f=$("#kw-file").files[0]; if(!f) throw new Error("Choose a keyword file first.");
  const r=await api(`/api/sites/${SITE_ID}/keywords/import`,{method:"POST",body:"{}",file:f});
  $("#kw-file").value=""; await loadKw(); $("#kw-status").textContent=`Imported ${r.imported} keywords.`;
});};
// find ideas
$("#ki-run").onclick=()=>{if(!needSite($("#ki-status"),true))return;busy($("#ki-run"),$("#ki-status"),"Finding ideas… about 30 seconds.",async()=>{
  const d=await api(`/api/sites/${SITE_ID}/keywords/ideas`,{method:"POST",body:JSON.stringify({seed:$("#ki-seed").value,focus:$("#ki-focus").value})});
  IDEAS=d.ideas; renderIdeas(d.note);
});};
function renderIdeas(note){
  const TYPE={question:"Question",long_tail:"Long-tail",comparison:"Comparison",use_case:"Use case",buying:"Buying",problem:"Problem"};
  const cnt=s=>IDEAS.filter(i=>i.coverage.status===s).length;
  $("#ki-out").innerHTML=IDEAS.length?`<div class="verdict" style="margin-top:16px">${IDEAS.length} ideas: <b class="fail">${cnt("gap")} have no page yet</b>, ${cnt("partial")} partly covered, ${cnt("covered")} already have a page. ${esc(note||"")} <br><span class="status">These are AI suggestions without search volumes. Check demand in Ahrefs, Semrush, Keyword Planner or your Search Console data before writing.</span></div>
   <div class="row" style="margin:8px 0"><button class="btn" id="ki-add">Add selected to My keywords</button><button class="btn ghost small" id="ki-gaps">Select ideas with no page</button><span class="status" id="ki-astatus"></span></div>
   <div class="tw"><table><thead><tr><th><span class="sr-only">Actions</span></th><th>Keyword idea</th><th>Type</th><th>Intent</th><th>Your page</th><th>Why it fits</th></tr></thead><tbody>
   ${IDEAS.map((x,i)=>`<tr><td><input type="checkbox" data-ii="${i}" ${x.in_list?"disabled":""} aria-label="Select ${esc(x.keyword)}"></td><td><b>${esc(x.keyword)}</b>${x.in_list?'<br><span class="status">already in your list</span>':""}</td><td>${esc(TYPE[x.type]||x.type||"")}</td><td>${esc(INTENT_LABEL[x.intent]||x.intent)}</td>
     <td class="cov-cell">${covPill(x.coverage)}${x.coverage.url?`<a class="url trunc" href="${esc(x.coverage.url)}" target="_blank" rel="noopener" title="${esc(x.coverage.url)}">${esc(x.coverage.url.replace(/^https?:\/\/(www\.)?[^/]+/,"")||"/")}</a>`:""}</td><td class="status">${esc(x.why||"")}</td></tr>`).join("")}</tbody></table></div>`:emptyBox("No ideas returned","Try a broader topic.");
  const add=$("#ki-add"); if(!add) return;
  $("#ki-gaps").onclick=()=>$("#ki-out").querySelectorAll("[data-ii]").forEach(c=>{if(!c.disabled)c.checked=IDEAS[c.dataset.ii].coverage.status==="gap";});
  add.onclick=()=>busy(add,$("#ki-astatus"),"Adding…",async()=>{
    const sel=[...$("#ki-out").querySelectorAll("[data-ii]:checked")].map(c=>IDEAS[c.dataset.ii]); if(!sel.length) throw new Error("Select at least one idea.");
    const r=await api(`/api/sites/${SITE_ID}/keywords/add`,{method:"POST",body:JSON.stringify({keywords:sel.map(x=>x.keyword),source:"idea: "+$("#ki-seed").value.trim()})});
    for(const x of sel) await api(`/api/sites/${SITE_ID}/keywords`,{method:"PATCH",body:JSON.stringify({keyword:x.keyword,intent:x.intent})});
    sel.forEach(x=>x.in_list=true); renderIdeas(note); $("#ki-astatus").textContent=`Added ${r.added} to My keywords.`;
  });
}
// clusters
async function loadClusters(){
  const cs=await api(`/api/sites/${SITE_ID}/keywords/clusters`);
  if(!cs.length){$("#kc-out").innerHTML=emptyBox("No keywords yet","Add keywords first, then come back to see how they group.");return;}
  const multi=cs.filter(c=>c.size>1).length;
  const ACT={update:["pass","Improve the existing page"],update_or_create:["warn","Improve the related page, or create one"],create:["fail","Create one new page"]};
  $("#kc-out").innerHTML=`<p class="status">${cs.length} clusters from ${cs.reduce((a,c)=>a+c.size,0)} keywords · ${multi} clusters combine several keywords into one page.</p>
   <div style="display:grid;gap:10px">${cs.map((c,i)=>`<div class="panel" style="margin:0;padding:16px">
     <div class="row" style="justify-content:space-between"><div><b style="font-size:16px">${esc(c.name)}</b> <span class="pill">${esc(INTENT_LABEL[c.intent]||c.intent)}</span> <span class="status">${c.size} keyword${c.size>1?"s":""}${c.total_volume?` · ${fmtN(c.total_volume)} searches`:""} · opportunity ${c.opportunity}</span></div>
       <div class="row"><span class="pill ${ACT[c.action][0]}">${ACT[c.action][1]}</span>${c.action!=="update"?`<button class="btn small" data-cw="${i}">Write this page</button>`:`<button class="btn ghost small" data-cc="${i}">Check</button>`}</div></div>
     <div class="row" style="gap:6px;margin-top:10px">${c.keywords.map((k,j)=>`<span class="pill" style="${j===0?"background:var(--soft);color:var(--accent)":""}">${esc(k)}</span>`).join("")}</div>
     ${c.owner_url?`<p class="status" style="margin:8px 0 0">${c.owner_status==="covered"?"Page that owns it:":"Closest page you have (check it really fits before improving it):"} <span class="url">${esc(c.owner_url)}</span></p>`:""}</div>`).join("")}</div>`;
  $("#kc-out").querySelectorAll("[data-cw]").forEach(b=>b.onclick=()=>{const c=cs[b.dataset.cw];prefillWrite(c.primary,c.intent);const others=c.keywords.slice(1);const kept=$("#g-notes").value.split("\n").filter(l=>!l.startsWith("Also cover these related searches")).join("\n").trim();$("#g-notes").value=[kept,others.length?`Also cover these related searches on the same page: ${others.join(", ")}`:""].filter(Boolean).join("\n");});
  $("#kc-out").querySelectorAll("[data-cc]").forEach(b=>b.onclick=()=>{$("#k-kw").value=cs[b.dataset.cc].primary;show("keyword");$("#k-run").click();});
}

// library
async function openInLibrary(item,tab){ show("library"); await waitFor(()=>$("#lib-out table")||$("#lib-out .empty"),6000); renderItem(item,$("#lib-view"),tab); $("#lib-view").scrollIntoView({behavior:"smooth",block:"start"}); }
function statusPill(r){ if(r.status==="approved") return `<span class="pill pass">Approved${r.approved?` by ${esc(r.approved.by)}`:""}</span>`;
  const cls={ready_for_human_review:"pass",improve_before_publishing:"warn",do_not_publish:"fail"}[r.status]||"warn";
  return `<span class="pill ${cls}">${esc(GATE[r.status]||r.status)}</span>`; }
async function loadLibrary(){ if(!SITE_ID){$("#lib-out").innerHTML="<p>Add a website first.</p>";return}
  const rows=await api(`/api/sites/${SITE_ID}/contents`), ccount=await api(`/api/sites/${SITE_ID}/comment-counts`).catch(()=>({}));
  $("#lib-out").innerHTML=rows.length?`<div class="tw"><table><tr><th>Page</th><th>Keyword</th><th>Searcher wants</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr>${rows.map(r=>`<tr><td><b>${esc(r.title||r.keyword)}</b><br><span class="status">${esc(fmtDate(r.updated_at||r.created_at))}${r.author?` · ${esc(r.author)}`:""}</span></td><td>${esc(r.keyword)}</td><td>${esc(INTENT_LABEL[r.intent]||r.intent)}</td><td>${statusPill(r)}${ccount[r.id]?` <span class="pill warn" title="Open comments">💬 ${ccount[r.id]}</span>`:""}${r.published?` <span class="pill pass" title="Sent to WordPress">in WordPress</span>`:""}</td><td><button class="btn ghost" data-open="${r.id}">Open</button></td></tr>`).join("")}</table></div><div id="lib-view"></div>`:"<p>Nothing generated yet.</p>";
  $("#lib-out").querySelectorAll("[data-open]").forEach(b=>b.onclick=async()=>{const c=await api(`/api/contents/${b.dataset.open}`);renderItem(c,$("#lib-view")); $("#lib-view").scrollIntoView({behavior:"smooth",block:"start"});});
}

// rules
function renderRules(){ if(!RULES)return; const R=RULES;
  $("#rules-out").innerHTML=`<p class="status">Rules version ${esc(R.version)}</p>
  <div class="block"><h3>Core principles</h3>${list(R.principles)}</div>
  <div class="block"><h3>Never do (scaled content abuse)</h3>${list(R.spam_patterns)}</div>
  <div class="block"><h3>High-risk page types</h3>${list(Object.entries(R.high_risk_page_types).map(([k,v])=>`${k}: ${v}`))}</div>
  <div class="block"><h3>SEO requirements checked on every page</h3><div class="tw"><table>${Object.entries(R.seo).filter(([k])=>k!=="min_words").map(([k,v])=>`<tr><td>${esc(k.replaceAll("_"," "))}</td><td>${esc(v)}</td></tr>`).join("")}</table></div></div>
  <div class="block"><h3>Quality scorecard</h3>${list(R.scorecard)}</div>
  <div class="block"><h3>Guardrails</h3>${list(Object.entries(R.guardrails).map(([k,v])=>`${k.replaceAll("_"," ")}: ${v}`))}</div>
  <div class="block"><h3>Release gate</h3>${list([`Up to ${R.release_gate.max_repair_rounds} audit-and-repair rounds`,...Object.entries(R.release_gate.min_scores).map(([k,v])=>`${SCORE_LABEL[k]||k} at least ${v}`),`Spam risk no higher than ${R.release_gate.max_spam_risk}`,"False or outdated claims block release"])}</div>
  <div class="block"><h3>Page structures by intent</h3>${list(Object.entries(R.structures).map(([k,v])=>`${k.replaceAll("_"," ")}: ${v.join(" → ")}`))}</div>
  <div class="block"><h3>Spam-risk checks</h3>${list(Object.values(R.spam_risk_checks))}</div>
  <div class="block"><h3>Source tiers for fact-checking</h3>${list(Object.entries(R.source_tiers).map(([k,v])=>`Tier ${k}: ${v}`))}</div>
  <div class="block"><h3>Keyword-to-URL actions</h3>${list(Object.entries(R.url_actions).map(([k,v])=>`${k}: ${v}`))}</div>`;
}


// ---------- AI activity, stop, usage, storage, errors ----------
// keep the screen awake while the AI works, so long runs (especially free models) don't stop when the computer sleeps
let WAKE=null;
async function wake(on){ try{ if(on&&!WAKE&&navigator.wakeLock&&document.visibilityState==="visible"){ WAKE=await navigator.wakeLock.request("screen"); WAKE.addEventListener("release",()=>{WAKE=null;}); } else if(!on&&WAKE){ await WAKE.release(); WAKE=null; } }catch{ WAKE=null; } }
window.addEventListener("ai-activity",e=>{ $("#ai-bar").classList.toggle("hidden",!e.detail.active); wake(e.detail.active>0); });
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"&&!$("#ai-bar").classList.contains("hidden")) wake(true); });
$("#ai-stop").onclick=()=>{ LLM.cancelAll(); $("#ai-bar").classList.add("hidden"); };
// messages are neutral; errors (kind "error") are red
function toast(msg,kind=""){ $("#toast-msg").textContent=msg; $("#toast").classList.toggle("toast-err",kind==="error"); $("#toast").classList.remove("hidden"); clearTimeout(window._toastT); window._toastT=setTimeout(()=>$("#toast").classList.add("hidden"),12000); }
$("#toast-x").onclick=()=>$("#toast").classList.add("hidden");
window.addEventListener("unhandledrejection",e=>{ const m=e.reason&&e.reason.message||String(e.reason||""); if(!m||/^Stopped\.?$/.test(m)) return; toast("Something went wrong: "+m); });
window.addEventListener("error",e=>{ if(e.message&&!/ResizeObserver/.test(e.message)) toast("Something went wrong: "+e.message); });
function renderUsage(){
  const u=LLM.getUsage(), months=Object.keys(u).sort().reverse(), m=months[0], el=$("#usage-out"); if(!el) return;
  if(!m){ el.innerHTML=`<p class="status">No AI requests yet.</p>`; return; }
  const rows=Object.entries(u[m]);
  el.innerHTML=`<div class="tw"><table><tr><th>Provider (${esc(m)})</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th><th>Web searches</th><th>Failed</th></tr>${rows.map(([p,x])=>`<tr><td>${esc(p.startsWith("search_")?`Web search (${WS.SEARCH_PROVIDERS[p.slice(7)]?.label||p.slice(7)})`:PROV.find(z=>z[0]===p)?.[1]||p)}</td><td>${fmtN(x.requests)}</td><td>${fmtN(x.input)}</td><td>${fmtN(x.output)}</td><td>${fmtN(x.searches)}</td><td>${x.errors?`<span class="fail">${x.errors}</span>`:"0"}</td></tr>`).join("")}</table></div>
   ${months.length>1?`<p class="status">Earlier months: ${months.slice(1,7).map(mm=>`${esc(mm)}: ${fmtN(Object.values(u[mm]).reduce((t,x)=>t+x.requests,0))} requests`).join(" · ")}</p>`:""}`;
}
async function renderStorage(){ const i=await store.storageInfo(), el=$("#storage-out"); if(!el) return;
  const mb=v=>v==null?"?":(v/1048576).toFixed(v>1e8?0:1)+" MB";
  el.innerHTML=`Using ${mb(i.usage)} of ${mb(i.quota)} available in this browser. ${i.persisted?'<span class="pass">Protected from automatic clean-up.</span>':i.persisted===false?'<span class="warn">Not yet protected: the browser may clear it when disk space runs low. Download a backup regularly.</span>':""}`; }

$("#s-type").innerHTML=`<option value="">Detect automatically</option>`+Object.entries(BUSINESS_TYPES).map(([k,v])=>`<option value="${k}">${esc(v.label)}${v.ymyl?" (needs expert review)":""}</option>`).join("");
// ---------- team sync ----------
const ago=t=>{ if(!t) return "never"; const m=Math.round((Date.now()-t)/60000); return m<1?"just now":m<60?`${m} min ago`:`${Math.round(m/60)} h ago`; };
function renderSync(st){
  const cfg=SYNC.syncSettings(), meta=SYNC.syncMeta(), pill=$("#sync-pill"), state=st?.state||meta.state;
  pill.classList.toggle("hidden",!cfg.enabled);
  pill.textContent= state==="syncing"?"☁ Syncing…":state==="error"?"☁ Sync problem":`☁ Synced ${ago(meta.last)}`;
  pill.classList.toggle("err-pill",state==="error");
  if($("#team-status")) $("#team-status").innerHTML=cfg.enabled?`<span class="${state==="error"?"fail":"pass"}">${state==="error"?"Team sync has a problem: "+esc(st?.message||meta.error||""):"Team sync is on"}</span>${cfg.name?` as <b>${esc(cfg.name)}</b>`:""} · last synced ${esc(ago(meta.last))}.`:`Team sync is off. Your data is only in this browser.`;
  if($("#team-key")&&!$("#team-key").value) $("#team-key").value=cfg.teamKey||""; if($("#team-name")&&!$("#team-name").value) $("#team-name").value=cfg.name||"";
  if($("#team-on")) { $("#team-on").textContent=cfg.enabled?"Save and re-check":"Turn on team sync"; $("#team-off").classList.toggle("hidden",!cfg.enabled); $("#team-now").classList.toggle("hidden",!cfg.enabled); }
}
window.addEventListener("sync-status",async e=>{
  renderSync(e.detail);
  if(e.detail.state==="warn") toast(e.detail.message);
  if(e.detail.state==="ok"&&(e.detail.changed||[]).length){
    if(e.detail.changed.includes("sites")) await loadSites().catch(()=>{});
    const mine=e.detail.changed.some(k=>k==="sites"||k.endsWith(":"+SITE_ID));
    if(mine&&!DIRTY&&!document.querySelector("button[disabled]")) refreshView();
  }
});
function refreshView(){ const v=CURRENT; const y=window.scrollY;
  const map={home:loadHome,actions:loadActions,urlmap:loadKw,library:loadLibrary,strategy:loadStrategy,tech:runAudit,gsc:loadGsc,aivis:loadVis,kb:loadKB};
  const fn=map[v]; if(fn) Promise.resolve(fn()).then(()=>window.scrollTo(0,y)).catch(()=>{}); }
$("#team-on").onclick=()=>busy($("#team-on"),$("#team-msg"),"Connecting to your team workspace…",async()=>{
  const key=$("#team-key").value.trim(), name=$("#team-name").value.trim(); if(!key) throw new Error("Enter the team password.");
  const r=await SYNC.enable({teamKey:key,name}); renderSync();
  $("#team-msg").textContent=`Team sync is on. ${r&&r.changed&&r.changed.length?`Received ${r.changed.length} item${r.changed.length>1?"s":""} from your team.`:"Your data is now shared."}`; });
$("#team-now").onclick=()=>busy($("#team-now"),$("#team-msg"),"Syncing…",async()=>{ const r=await SYNC.syncNow(); $("#team-msg").textContent=r&&r.changed&&r.changed.length?`Received ${r.changed.length} update${r.changed.length>1?"s":""}.`:"Up to date."; });
$("#team-off").onclick=()=>{ SYNC.disable(); renderSync(); $("#team-msg").textContent="Team sync is off. Your data stays in this browser."; };
// (team sync starts after sign-in checks, in the start-up code at the bottom)

// ---------- hybrid mode ----------
function renderHybrid(){
  const st=LLM.getSettings(), h=LLM.hybridSettings(), keyed=LLM.PAID.filter(k=>(st.keys[k]||"").trim());
  $("#hy-rev").innerHTML=keyed.length?keyed.map(k=>`<option value="${k}" ${k===h.reviewer?"selected":""}>${esc(LLM.PROVIDERS[k].label)} · ${esc(st.models[k]||LLM.PROVIDERS[k].defaultModel)}</option>`).join(""):`<option value="">Add a Claude, ChatGPT or Gemini key above first</option>`;
  $("#hy-rev").disabled=!keyed.length; $("#hy-on").checked=!!h.enabled; $("#hy-plan").checked=h.plan!==false;
  const rv=LLM.hybridReviewer(), free=!!LLM.PROVIDERS[st.provider]?.keyless;
  $("#hy-status").innerHTML=rv?`<span class="pass">On: ${esc(PROV.find(p=>p[0]===st.provider)?.[1]||st.provider)} writes, ${esc(LLM.PROVIDERS[rv].label.split(" (")[0])} ${h.plan!==false?"plans and ":""}reviews.</span>`
    :h.enabled?(!free?`<span class="warn">Hybrid mode only applies when Built-in AI or Ollama is your main AI (choose one above).</span>`:!keyed.length?`<span class="warn">Add a paid model's key first.</span>`:"")
    :"Off.";
}
$("#hy-save").onclick=()=>{ LLM.saveHybrid({enabled:$("#hy-on").checked,reviewer:$("#hy-rev").value,plan:$("#hy-plan").checked}); renderHybrid(); updatePill(); };

// ---------- web search for the free AI options ----------
function renderSearch(){ const c=WS.searchSettings(); $("#srch-prov").value=c.provider; $("#srch-key").value=c.key||""; $("#srch-team").checked=!!c.team;
  $("#srch-help").textContent=`(get one at ${WS.SEARCH_PROVIDERS[c.provider].help})`; $("#srch-key").disabled=!!c.team; }
$("#srch-prov").onchange=()=>{ $("#srch-help").textContent=`(get one at ${WS.SEARCH_PROVIDERS[$("#srch-prov").value].help})`; };
$("#srch-team").onchange=()=>{ $("#srch-key").disabled=$("#srch-team").checked; };
const saveSearch=()=>WS.saveSearchSettings({provider:$("#srch-prov").value,key:$("#srch-team").checked?"":$("#srch-key").value.trim(),team:$("#srch-team").checked});
$("#srch-save").onclick=()=>{ saveSearch(); $("#srch-status").textContent=WS.searchConfigured()?"Saved. The free AI options will now use web search.":"Saved. Web search is off until you add a key."; };
$("#srch-test").onclick=()=>busy($("#srch-test"),$("#srch-status"),"Searching…",async()=>{ saveSearch();
  const r=await WS.webSearch("how to write a standard operating procedure",{n:3,fresh:true});   // always ask the service, so a wrong key shows up
  $("#srch-status").innerHTML=`Works: ${r.results.length} results${r.cached?" (from today's cache)":""}, e.g. <span class="url">${esc(r.results[0]?.url||"")}</span>`; });

// ---------- Settings ----------
const PROV=[["claude","Claude","Anthropic"],["openai","ChatGPT","OpenAI"],["gemini","Gemini","Google"],["local","Built-in AI","Free · runs in your browser, no key"],["ollama","Ollama","Free · runs on your computer"],["mock","Demo mode","No key needed: sample answers"]];
let SET_PROV=LLM.getSettings().provider;
function updatePill(){
  const st=LLM.getSettings(), b=$("#ai-pill"); if(!b) return;
  if(!LLM.isConfigured(st)){ b.textContent="Connect AI"; b.classList.remove("ghost"); return; }
  b.classList.add("ghost");
  const label=PROV.find(p=>p[0]===st.provider)?.[1]||st.provider, model=st.provider==="local"?(LLM.LOCAL_MODELS.find(m=>m.id===LLM.activeModel(st))?.name||LLM.activeModel(st)):LLM.activeModel(st);
  const rv=LLM.hybridReviewer(st);
  b.textContent= st.provider==="mock" ? "AI: Demo mode" : `AI: ${label} · ${model}${rv?` + ${LLM.PROVIDERS[rv].label.split(" (")[0]} review`:""}`;
}
function renderSettings(){
  const st=LLM.getSettings();
  $("#prov-cards").innerHTML=PROV.map(([k,l,sub])=>`<button class="panel prov" type="button" data-prov="${k}" aria-pressed="${k===SET_PROV}"><b>${l}</b><span class="status">${sub}</span>${!["mock","local","ollama"].includes(k)&&(st.keys[k]||"")?'<span class="pill pass">key saved</span>':k==="local"&&LLM.localStatus().loaded?'<span class="pill pass">model running</span>':""}</button>`).join("");
  $("#prov-cards").querySelectorAll("[data-prov]").forEach(b=>b.onclick=()=>{SET_PROV=b.dataset.prov;renderSettings();});
  const isMock=SET_PROV==="mock", isLocal=SET_PROV==="local", isOllama=SET_PROV==="ollama", info=LLM.PROVIDERS[SET_PROV];
  $("#key-field").classList.toggle("hidden",isLocal); $("#set-model").closest(".field").classList.toggle("hidden",isLocal);
  $("#local-box").classList.toggle("hidden",!isLocal); $("#ollama-box").classList.toggle("hidden",!isOllama);
  $("#web-row").classList.toggle("hidden",isLocal||isOllama||isMock);
  const keyless=isLocal||isOllama||isMock; $("#set-show").classList.toggle("hidden",isOllama); $("#remember-row").classList.toggle("hidden",keyless); $("#key-note").classList.toggle("hidden",keyless);
  $("#model-hint").textContent=isOllama?"(click \"Load models\" to list the models installed in Ollama)":"(click \"Load models\" to see what your key can use)";
  $("#set-key").disabled=isMock; $("#set-load").disabled=isMock; $("#set-model").disabled=isMock;
  $("#set-keylabel").textContent=isOllama?"Ollama address":"API key";
  $("#set-key").type=isOllama?"text":"password"; $("#set-key").placeholder=isOllama?"http://localhost:11434":"Paste your API key";
  $("#set-key").value=isMock?"":isOllama?(st.ollamaUrl||info.defaultUrl):(st.keys[SET_PROV]||"");
  $("#set-keyhelp").textContent=isMock?"(not needed in demo mode)":isOllama?"(leave as is unless you changed Ollama's port)":info&&info.keyHelp?`(get one at ${info.keyHelp})`:"";
  const list=(st.modelLists||{})[SET_PROV]||[], cur=st.models[SET_PROV]||(info?info.defaultModel:"");
  const opts=[...new Set([cur,...list].filter(Boolean))];
  $("#set-model").innerHTML=isMock?'<option>demo</option>':opts.map(m=>`<option ${m===cur?"selected":""}>${esc(m)}</option>`).join("");
  if(isLocal){
    $("#local-model").innerHTML=LLM.LOCAL_MODELS.map(m=>`<option value="${m.id}" ${m.id===cur?"selected":""}>${esc(m.name)} · ${m.gb} GB download · ${esc(m.note)}</option>`).join("");
    const ls=LLM.localStatus(); $("#local-check").innerHTML=`<span class="status spin">Checking your computer's graphics chip…</span>`; $("#local-load").disabled=true;
    LLM.webgpuSupported().then(g=>{
      $("#local-check").innerHTML=g.ok?`<span class="pass">✓ This computer can run the built-in AI.</span>${g.fallback?' <span class="warn">It will use a slow software fallback, so expect long waits.</span>':""}${ls.loaded?` Running now: <b>${esc(LLM.LOCAL_MODELS.find(m=>m.id===ls.loaded)?.name||ls.loaded)}</b>.`:""}`
        :`<span class="fail">This browser can't run the built-in AI.</span> ${esc(g.why)} Use a recent Chrome or Edge on a computer, or choose Ollama or an API provider.`;
      $("#local-load").disabled=!g.ok; });
    LLM.localModelCached($("#local-model").value).then(c=>{ if(c&&!ls.loaded) $("#local-status").textContent="Already downloaded: starting takes about a minute."; }).catch(()=>{});
  }
  if(isOllama) $("#ollama-origin-cmd").textContent=`launchctl setenv OLLAMA_ORIGINS "${location.origin}"`;
  $("#set-web").checked=st.webSearch!==false; $("#set-remember").checked=st.remember!==false; $("#set-token").value=st.crawlToken||"";
  $("#set-status").textContent=""; $("#set-status").classList.remove("err");
}
function collectSettings(){
  const st=LLM.getSettings(); st.provider=SET_PROV;
  if(SET_PROV==="local") st.models.local=$("#local-model").value;
  else if(SET_PROV==="ollama"){ st.ollamaUrl=$("#set-key").value.trim()||LLM.PROVIDERS.ollama.defaultUrl; if($("#set-model").value) st.models.ollama=$("#set-model").value; }
  else if(SET_PROV!=="mock"){ st.keys[SET_PROV]=$("#set-key").value.trim(); if($("#set-model").value) st.models[SET_PROV]=$("#set-model").value; }
  st.webSearch=$("#set-web").checked; st.remember=$("#set-remember").checked; return st;
}
$("#set-show").onclick=()=>{const k=$("#set-key");k.type=k.type==="password"?"text":"password";$("#set-show").textContent=k.type==="password"?"Show":"Hide";};
$("#set-save").onclick=()=>{ LLM.saveSettings(collectSettings()); updatePill(); setStatus().catch(()=>{}); renderSettings(); renderHybrid(); $("#set-status").textContent="Saved."; };
$("#local-model").onchange=()=>{ $("#local-status").textContent=""; LLM.localModelCached($("#local-model").value).then(c=>{ if(c) $("#local-status").textContent="Already downloaded: starting takes about a minute."; }); };
window.addEventListener("local-ai-progress",e=>{ const bar=$("#local-bar"); if(!bar) return; bar.classList.remove("hidden"); bar.querySelector("i").style.width=Math.round((e.detail.progress||0)*100)+"%"; $("#local-status").textContent=(e.detail.text||"").replace(/\[.*?\]\s*/,"").slice(0,140); });
$("#local-load").onclick=()=>busy($("#local-load"),$("#local-status"),"Preparing…",async()=>{
  const st=collectSettings(); LLM.saveSettings(st); updatePill(); const model=st.models.local;
  await LLM.loadLocalModel(model,(t,f)=>window.dispatchEvent(new CustomEvent("local-ai-progress",{detail:{text:t,progress:f}})));
  $("#local-bar").classList.add("hidden"); renderSettings(); updatePill();
  $("#local-status").textContent=`${LLM.LOCAL_MODELS.find(m=>m.id===model)?.name||model} is running. You can now use every writing feature for free.`; });
$("#set-load").onclick=()=>busy($("#set-load"),$("#set-status"),"Loading models…",async()=>{
  const key=$("#set-key").value.trim(); if(!key&&SET_PROV!=="ollama") throw new Error("Paste your API key first.");
  const models=await LLM.listModels(SET_PROV,key); if(!models.length) throw new Error(SET_PROV==="ollama"?"Ollama is running but has no models. Run: ollama pull qwen3:8b":"No usable models found for this key.");
  const st=collectSettings(); st.modelLists=st.modelLists||{}; st.modelLists[SET_PROV]=models;
  if(!models.includes(st.models[SET_PROV])) st.models[SET_PROV]=models.find(m=>m===LLM.PROVIDERS[SET_PROV].defaultModel)||models[0];
  LLM.saveSettings(st); renderSettings(); updatePill(); $("#set-status").textContent=`Found ${models.length} models. Choose one, then Save.`;
});
$("#set-test").onclick=()=>busy($("#set-test"),$("#set-status"),"Testing…",async()=>{
  const st=collectSettings(); LLM.saveSettings(st); updatePill();
  if(st.provider==="mock"){ $("#set-status").textContent="Demo mode is ready. Answers are samples, not real AI output."; return; }
  if(st.provider==="local"&&!LLM.localStatus().loaded) throw new Error("Click “Download and start this model” first.");
  if(!LLM.PROVIDERS[st.provider].keyless&&!st.keys[st.provider]) throw new Error("Paste your API key first.");
  const r=await LLM.ask("test",'Reply with JSON only: {"ok":true}',{maxTokens:60});
  $("#set-status").textContent= r&&r.ok ? `Connected to ${PROV.find(p=>p[0]===st.provider)[1]} (${updatePill(),$("#ai-pill").textContent.split("· ")[1]||LLM.activeModel(st)}).` : "Connected, but the reply was unexpected.";
});
$("#set-token-save").onclick=()=>{const st=LLM.getSettings();st.crawlToken=$("#set-token").value.trim();LLM.saveSettings(st);$("#set-token-save").textContent="Saved";setTimeout(()=>$("#set-token-save").textContent="Save",1500);};
$("#data-export").onclick=async()=>{ download(`content-engine-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(await store.exportAll()), "application/json"); $("#data-status").textContent="Backup downloaded. It doesn't include your API key."; };
$("#data-import").onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
  try{ await store.importAll(JSON.parse(await f.text())); $("#data-status").textContent="Restored. Reloading…"; setTimeout(()=>location.reload(),600);}catch(err){ $("#data-status").textContent=err.message; $("#data-status").classList.add("err"); } };
let clearArm=false;
$("#data-clear").onclick=async()=>{ if(!clearArm){ clearArm=true; $("#data-clear").textContent="Click again to delete everything"; setTimeout(()=>{clearArm=false;$("#data-clear").textContent="Delete all data";},4000); return; }
  await store.clearAll(); location.reload(); };
document.querySelectorAll("[data-go-settings]").forEach(b=>b.onclick=()=>show("settings"));

// ---------- knowledge base ----------
let KBDATA=null;
async function loadKB(){
  if(!SITE_ID){ $("#kb-sum").innerHTML=`<div class="panel">${emptyBox("Add a website first","The knowledge base belongs to a website.","site","Add a website")}</div>`; bindGo($("#kb-sum")); return; }
  KBDATA=await api(`/api/sites/${SITE_ID}/kb`); const d=KBDATA, sm=d.summary;
  if(!$("#kb-kind").options.length) $("#kb-kind").innerHTML=Object.entries(d.kinds).filter(([k])=>k!=="facts").map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("");
  const missing=[["case_study","a case study or customer result"],["product","product or service details"],["data","your own data or research"]].filter(([k])=>!sm.by_kind[k]).map(x=>x[1]);
  $("#kb-sum").innerHTML=`<div class="grid3"><div class="panel kpi"><div><div class="num">${sm.docs}</div><div class="lbl">documents</div></div></div><div class="panel kpi"><div><div class="num">${fmtN(sm.words)}</div><div class="lbl">words of real material</div></div></div><div class="panel kpi"><div><div class="num">${sm.facts}</div><div class="lbl">quick facts</div></div></div></div>
    ${missing.length?`<div class="verdict related">Tip: add ${esc(missing.join(", "))}. These give pages the first-hand proof Google rewards and AI assistants cite.</div>`:""}`;
  const fd=d.docs.find(x=>x.kind==="facts"); if(document.activeElement!==$("#kb-facts")) $("#kb-facts").value=fd?fd.text:"";
  const docs=d.docs.filter(x=>x.kind!=="facts");
  $("#kb-docs").innerHTML=docs.length?docs.map(x=>`<div class="act-item" data-doc="${x.id}"><div class="act-main"><div class="body"><div class="title">${esc(x.title)}</div>
      <div class="act-meta"><span class="pill">${esc(d.kinds[x.kind]||x.kind)}</span><span>${fmtN(x.words)} words</span><span>· updated ${esc(fmtDate(x.updated_at))}</span>${x.url?`<span>· from <span class="url">${esc(x.url)}</span></span>`:""}</div></div>
      <div class="act-side"><button class="btn ghost small" data-kedit="${x.id}">Edit</button><button class="btn ghost small" data-kdel="${x.id}">Remove</button></div></div><div data-keditor="${x.id}"></div></div>`).join("")
    :emptyBox("No documents yet","Add product or service details, a case study, an FAQ, or your own data.");
  $("#kb-docs").querySelectorAll("[data-kdel]").forEach(b=>b.onclick=async()=>{ if(!confirm("Remove this document from the knowledge base?")) return; try{ await api(`/api/sites/${SITE_ID}/kb/${b.dataset.kdel}`,{method:"DELETE"}); loadKB(); }catch(e){ toast(e.message,"error"); } });
  $("#kb-docs").querySelectorAll("[data-kedit]").forEach(b=>b.onclick=()=>{ const x=docs.find(y=>y.id===+b.dataset.kedit), box=$(`[data-keditor="${x.id}"]`);
    if(box.innerHTML){ box.innerHTML=""; return; }
    box.innerHTML=`<div style="margin-top:10px"><input data-ke-title value="${esc(x.title)}" aria-label="Title"><textarea data-ke-text class="md-edit" style="min-height:200px;margin-top:8px" aria-label="Text">${esc(x.text)}</textarea><div class="row" style="margin-top:8px"><button class="btn small" data-ke-save>Save</button><span class="status" data-ke-st></span></div></div>`;
    box.querySelector("[data-ke-save]").onclick=e=>busy(e.target,box.querySelector("[data-ke-st]"),"Saving…",async()=>{ await api(`/api/sites/${SITE_ID}/kb/${x.id}`,{method:"PATCH",body:JSON.stringify({title:box.querySelector("[data-ke-title]").value,text:box.querySelector("[data-ke-text]").value})}); loadKB(); }); });
}
document.querySelectorAll("#kb-src [data-ks]").forEach(b=>b.onclick=()=>{document.querySelectorAll("#kb-src [data-ks]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));document.querySelectorAll("[data-ksp]").forEach(p=>p.classList.toggle("hidden",p.dataset.ksp!==b.dataset.ks));});
$("#kb-text").addEventListener("paste",e=>{ const html=e.clipboardData&&e.clipboardData.getData("text/html"); if(!html) return; const md=htmlToMarkdown(html); if(!md) return; e.preventDefault();
  const ta=$("#kb-text"), a=ta.selectionStart, b2=ta.selectionEnd; ta.value=ta.value.slice(0,a)+md+ta.value.slice(b2); });
$("#kb-facts-save").onclick=()=>{ if(!needSite($("#kb-facts-status")))return; busy($("#kb-facts-save"),$("#kb-facts-status"),"Saving…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/kb-facts`,{method:"POST",body:JSON.stringify({text:$("#kb-facts").value})}); await loadKB(); $("#kb-facts-status").textContent=`Saved ${r.facts.length} fact${r.facts.length===1?"":"s"}.`; }); };
$("#kb-add").onclick=()=>{ if(!needSite($("#kb-add-status")))return; busy($("#kb-add"),$("#kb-add-status"),"Adding…",async()=>{
  const mode=document.querySelector("#kb-src [aria-pressed=true]").dataset.ks, title=$("#kb-title").value.trim(), kind=$("#kb-kind").value; let n=0;
  if(mode==="paste"){ await api(`/api/sites/${SITE_ID}/kb`,{method:"POST",body:JSON.stringify({title,kind,text:$("#kb-text").value,source:"paste"})}); n=1; $("#kb-text").value=""; }
  else if(mode==="file"){ const files=[...$("#kb-files").files]; if(!files.length) throw new Error("Choose one or more files.");
    for(const f of files){ const raw=await f.text(); const text=/\.html?$/i.test(f.name)?htmlToMarkdown(raw):raw;
      const heading=(text.match(/^#{1,3}\s+(.+)$/m)||[])[1];   // a document's own first heading beats its file name
      await api(`/api/sites/${SITE_ID}/kb`,{method:"POST",body:JSON.stringify({title:files.length===1&&title?title:(heading||f.name.replace(/\.[^.]+$/,"")).slice(0,160),kind,text,source:"file"})}); n++; } $("#kb-files").value=""; }
  else { const url=$("#kb-url").value.trim(); if(!url) throw new Error("Enter a web page address."); await api(`/api/sites/${SITE_ID}/kb-import-url`,{method:"POST",body:JSON.stringify({url,title,kind})}); n=1; $("#kb-url").value=""; }
  $("#kb-title").value=""; await loadKB(); $("#kb-add-status").textContent=`Added ${n} document${n>1?"s":""}.`; }); };
$("#kb-search").onclick=async()=>{ if(!SITE_ID) return; const r=await api(`/api/sites/${SITE_ID}/kb-search?q=${encodeURIComponent($("#kb-q").value)}`);
  $("#kb-results").innerHTML=r.length?r.map(h=>`<div class="ans"><b>${esc(h.title)}</b>${h.heading?` · ${esc(h.heading)}`:""} <span class="status">(relevance ${h.score})</span><p style="margin:6px 0 0">${esc(h.text.slice(0,500))}${h.text.length>500?"…":""}</p></div>`).join(""):`<p class="status">Nothing in the knowledge base matches that yet.</p>`; };
$("#kb-q").onkeydown=e=>{ if(e.key==="Enter") $("#kb-search").click(); };

// ---------- page types: grouped, with suggestions for the website and the search intent ----------
const TYPE_HINTS={ location_page:"Location pages need at least three real local details in “Anything the page should include” (address, opening hours, local team, nearby projects). Near-identical town pages are blocked as doorway pages.",
  review:"Only review what you actually tested: the page must explain how you tested it, with your own photos or measurements.",
  product_page:"Use real specifications and real reviews only. Prices and ratings are never invented; add them from your store.",
  category_page:"Write a short, helpful intro and buying guide; your store adds the product grid.", news_article:"Attribute every quote and link to original sources." };
function renderPageTypes(){
  if(!RULES) return; const L=RULES.page_type_labels||{}, cur=$("#g-type").value;
  const site=CURRENT_SITE||{}, sug=(RULES.type_suggestions||{})[site.business_type]||[], fmts=(RULES.intent_formats||{})[$("#g-intent").value]||[];
  const good=RULES.page_types.filter(t=>fmts.includes(t)&&(!sug.length||sug.includes(t))).concat(RULES.page_types.filter(t=>fmts.includes(t)));
  const suggested=[...new Set(good)].slice(0,3);
  $("#g-type").innerHTML=(suggested.length?`<optgroup label="Suggested for this search">${suggested.map(t=>`<option value="${t}">${esc(L[t]||t)}</option>`).join("")}</optgroup>`:"")+
    (RULES.page_type_groups||[["All",RULES.page_types]]).map(([g,ts])=>`<optgroup label="${esc(g)}">${ts.filter(t=>!suggested.includes(t)).map(t=>`<option value="${t}">${esc(L[t]||t)}</option>`).join("")}</optgroup>`).join("");
  $("#g-type").value=RULES.page_types.includes(cur)&&(suggested.includes(cur)||!suggested.length)?cur:(suggested[0]||cur||RULES.page_types[0]); typeHint(); }
function typeHint(){ const h=TYPE_HINTS[$("#g-type").value]; $("#g-type-hint").classList.toggle("hidden",!h); $("#g-type-hint").textContent=h||""; }
$("#g-type").addEventListener("change",typeHint); $("#g-intent").addEventListener("change",renderPageTypes);

// ---------- real questions (Stack Exchange) ----------
const ONSITE={covered:["pass","You answer this"],partial:["warn","Partly answered"],gap:["fail","Not on your site"],written:["pass","In a page you wrote"]};
let QX_GROUP=true;
async function loadQuestions(){
  if(!SITE_ID) return; const site=CURRENT_SITE||{};
  if(!$("#qx-q").value) $("#qx-q").value=String(site.product||site.name||"").split(/[.;,]/)[0].split(/\s+/).slice(0,5).join(" ");
  if(!$("#qx-sites").children.length){ const def=QX.DEFAULT_SITES[site.business_type]||["superuser","webapps","softwarerecs"];
    $("#qx-sites").innerHTML=Object.entries(QX.SITES).map(([k,v])=>`<label class="check" style="margin:0 10px 4px 0"><input type="checkbox" value="${k}" ${def.includes(k)?"checked":""}> ${esc(v)}</label>`).join(""); }
  renderBank();
}
async function renderBank(){
  const b=await QX.bank(SITE_ID); $("#g-qbank").classList.toggle("hidden",!b.length); $("#g-qbank").textContent=`Add saved questions as FAQ ideas (${b.length})`;
  $("#qx-bank").innerHTML=b.length?`<div class="tw"><table><tr><th>Question</th><th>Views</th><th><span class="sr-only">Actions</span></th></tr>${b.map(q=>`<tr><td><a href="${esc(q.link)}" target="_blank" rel="noopener">${esc(q.title)}</a><br><span class="status">${esc(QX.SITES[q.site]||q.site)}</span></td><td>${fmtN(q.views)}</td>
    <td>${READONLY?"":`<button class="btn ghost small" data-qwrite="${esc(q.id)}">Write a page</button><button class="btn ghost small" data-qdel="${esc(q.id)}">Remove</button>`}</td></tr>`).join("")}</table></div>`:`<p class="status">No saved questions yet. Use “Save” on the questions you want to answer.</p>`;
  $("#qx-bank").querySelectorAll("[data-qdel]").forEach(x=>x.onclick=async()=>{ await QX.remove(SITE_ID,x.dataset.qdel); renderBank(); });
  $("#qx-bank").querySelectorAll("[data-qwrite]").forEach(x=>x.onclick=()=>{ const q=b.find(y=>y.id===x.dataset.qwrite); prefillWrite(q.title.toLowerCase().replace(/\?$/,""),"how_to"); show("generate"); });
}
async function findQuestions(){
  const q=$("#qx-q").value.trim(), sites=[...document.querySelectorAll("#qx-sites input:checked")].map(x=>x.value);
  if(!q){ $("#qx-status").textContent="Type a topic."; return; } if(!sites.length){ $("#qx-status").textContent="Choose at least one Q&A site."; return; }
  await busy($("#qx-go"),$("#qx-status"),"Searching Q&A sites…",async()=>{
    const r=await QX.search(q,sites), rows=await api(`/api/sites/${SITE_ID}/question-coverage`,{method:"POST",body:JSON.stringify({questions:r.items.slice(0,60)})});
    const order={gap:0,partial:1,written:2,covered:3}; rows.sort((a,b)=>order[a.on_site]-order[b.on_site]||b.views-a.views); const saved=new Set((await QX.bank(SITE_ID)).map(x=>x.id));
    // a topic's status is its best-answered question; its details (your page) come from that same question
    const groups=QX.group(rows).map(g=>{ const best=g.members.map(m=>m.on_site).sort((a,b)=>order[b]-order[a])[0]; return {...g, on_site:best, member:g.members.find(m=>m.on_site===best)||g.head}; }).sort((a,b)=>order[a.on_site]-order[b.on_site]||b.views-a.views);
    const statusCell=x=>`<span class="pill ${ONSITE[x.on_site][0]}">${ONSITE[x.on_site][1]}</span>${x.match_url?`<br><span class="url">${esc(x.match_url.replace(/^https?:\/\/[^/]+/,""))}</span>`:""}${x.written_title?`<br><span class="status">“${esc(x.written_title.slice(0,50))}”</span>`:""}`;
    const qrow=(x,i)=>`<tr><td><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a><br><span class="status">${esc(QX.SITES[x.site]||x.site)}${x.tags.length?` · ${esc(x.tags.slice(0,3).join(", "))}`:""}</span></td>
        <td>${fmtN(x.views)}</td><td>${x.score}</td><td>${x.answered?'<span class="pass">well</span>':x.answers?'<span class="warn">not well</span>':'<span class="fail">no</span>'}</td><td>${statusCell(x)}</td>
        <td>${READONLY?"":`<button class="btn ghost small" data-qsave="${i}" ${saved.has(x.id)?"disabled":""}>${saved.has(x.id)?"Saved":"Save"}</button>`}</td></tr>`;
    const head=`<tr><th>Question</th><th>Views</th><th>Votes</th><th>Answered</th><th>On your site</th><th><span class="sr-only">Actions</span></th></tr>`;
    $("#qx-out").innerHTML=`<div class="panel"><div class="row" style="justify-content:space-between"><p class="status" style="margin:0">${rows.length} questions${QX_GROUP?` in ${groups.length} topics`:""}${r.failed.length?` · ${r.failed.length} site${r.failed.length>1?"s":""} didn't answer`:""}${r.cached?` · ${r.cached} of ${r.searched} searches from this browser's cache (no daily allowance used)`:""}. Not on your site, most viewed first.${r.quota!=null&&r.quota<60?` <span class="warn">Only ${r.quota} free searches left today from this network.</span>`:""}</p>
        <label class="check" style="margin:0"><input type="checkbox" id="qx-group" ${QX_GROUP?"checked":""}> Group similar questions</label></div>
      ${!rows.length?emptyBox("No questions found","Try a broader topic or other Q&A sites."):QX_GROUP?`<div class="tw"><table><tr><th>Topic</th><th>Questions</th><th>Total views</th><th>On your site</th></tr>${groups.map((g,k)=>`<tr><td><a href="${esc(g.head.link)}" target="_blank" rel="noopener">${esc(g.head.title)}</a>${g.members.length>1?`<details><summary class="status">${g.members.length-1} similar question${g.members.length>2?"s":""}</summary><div class="tw"><table>${head}${g.members.map(m=>qrow(m,rows.indexOf(m))).join("")}</table></div></details>`:`<br><span class="status">${esc(QX.SITES[g.head.site]||g.head.site)}</span>${READONLY?"":` <button class="btn ghost small" data-qsave="${rows.indexOf(g.head)}" ${saved.has(g.head.id)?"disabled":""}>${saved.has(g.head.id)?"Saved":"Save"}</button>`}`}</td>
        <td>${g.members.length}</td><td>${fmtN(g.views)}</td><td>${statusCell(g.member)}</td></tr>`).join("")}</table></div>`
        :`<div class="tw"><table>${head}${rows.map((x,i)=>qrow(x,i)).join("")}</table></div>`}</div>`;
    const tg=$("#qx-group"); if(tg) tg.onchange=()=>{ QX_GROUP=tg.checked; findQuestions(); };
    $("#qx-out").querySelectorAll("[data-qsave]").forEach(x=>x.onclick=async()=>{ await QX.save(SITE_ID,rows[+x.dataset.qsave]); x.textContent="Saved"; x.disabled=true; renderBank(); });
  });
}
$("#qx-go").onclick=findQuestions; $("#qx-q").onkeydown=e=>{ if(e.key==="Enter") findQuestions(); };
$("#g-qbank").onclick=async()=>{ const b=await QX.bank(SITE_ID); const add=b.slice(0,8).map(q=>`- ${q.title}`).join("\n"); const ta=$("#g-notes"); ta.value=(ta.value?ta.value+"\n\n":"")+`Questions people ask (answer these where they fit, e.g. in the FAQ):\n${add}`; toast(`Added ${Math.min(8,b.length)} saved questions to your notes.`); };

// ---------- topic facts (Wikipedia and Wikidata) ----------
const siteLang=()=>{ const l=(CURRENT_SITE?.style?.language||"").toLowerCase(); const map={english:"en",spanish:"es",portuguese:"pt",french:"fr",german:"de",italian:"it",dutch:"nl",japanese:"ja",chinese:"zh",hindi:"hi",korean:"ko"}; return map[l]||(document.documentElement.lang&&document.documentElement.lang!=="en"?document.documentElement.lang:"en"); };
async function lookupTopic(q){
  q=(q||$("#wk-q").value).trim(); if(!q){ $("#wk-status").textContent="Type a topic."; return; } $("#wk-q").value=q;
  await busy($("#wk-go"),$("#wk-status"),"Looking it up on Wikipedia…",async()=>{
    const lang=siteLang(), t=await WIKI.topic(q,lang);
    if(!t){ $("#wk-out").innerHTML=`<div class="panel">${emptyBox("No Wikipedia article found","Try a broader or more common name for the topic.")}</div>`; return; }
    const cov=SITE_ID&&t.sections.length?await api(`/api/sites/${SITE_ID}/question-coverage`,{method:"POST",body:JSON.stringify({questions:t.sections.map(x=>({id:x.title,title:`${x.title} ${q}`}))})}).catch(()=>[]):[];
    const covBy=new Map(cov.map(c=>[c.id,c]));
    $("#wk-out").innerHTML=`<div class="panel"><h2 style="margin-bottom:2px">${esc(t.title)}</h2><p class="status" style="margin-top:0">${esc(t.description)} · <a href="${esc(t.url)}" target="_blank" rel="noopener">Wikipedia</a>${t.alternatives.length?` · Not the right article? ${t.alternatives.map(a=>`<button class="linkbtn" data-wkalt="${esc(a)}">${esc(a)}</button>`).join(", ")}`:""}</p>
      <p>${esc(t.extract)}</p>
      ${t.sections.length?`<h3 style="font-size:15px">Subtopics a complete treatment covers</h3><div class="tw"><table><tr><th>Subtopic (from the article's sections)</th><th>On your site</th></tr>${t.sections.map(x=>{ const c=covBy.get(x.title); return `<tr><td style="padding-left:${x.level>1?24:8}px">${esc(x.title)}</td><td>${c?`<span class="pill ${ONSITE[c.on_site][0]}">${ONSITE[c.on_site][1]}</span>`:"–"}</td></tr>`; }).join("")}</table></div>`:""}
      ${t.facts.length?`<h3 style="font-size:15px;margin-top:12px">Key facts (Wikidata)</h3><div class="tw"><table><tr><th>Fact</th><th>Value</th><th>Source</th></tr>${t.facts.map(f=>`<tr><td>${esc(f.label)}</td><td>${esc(f.text)}</td><td><a href="${esc(f.source)}" target="_blank" rel="noopener">Wikidata</a></td></tr>`).join("")}</table></div><p class="status">Wikidata is edited by volunteers: check important facts against an official source before relying on them.</p>`:""}
      ${READONLY?"":`<div class="row" style="margin-top:10px">${t.facts.length?`<button class="btn ghost small" id="wk-kb">Add facts to knowledge base</button>`:""}${t.sections.length?`<button class="btn ghost small" id="wk-notes">Add subtopics to Write a page notes</button>`:""}<span class="status" id="wk-st" role="status"></span></div>`}</div>`;
    $("#wk-out").querySelectorAll("[data-wkalt]").forEach(b=>b.onclick=async()=>{ const s2=await WIKI.summary(b.dataset.wkalt,lang); lookupTopic(s2.title); });
    const kb=$("#wk-kb"); if(kb) kb.onclick=()=>busy(kb,$("#wk-st"),"Adding…",async()=>{ await api(`/api/sites/${SITE_ID}/kb`,{method:"POST",body:JSON.stringify({title:`Facts: ${t.title} (Wikidata)`,kind:"data",source:"url",url:t.url,
      text:`# ${t.title}\n\n${t.extract}\n\n`+t.facts.map(f=>`- ${f.label}: ${f.text} (source: ${f.source})`).join("\n")})}); $("#wk-st").textContent="Added to the knowledge base."; });
    const nt=$("#wk-notes"); if(nt) nt.onclick=()=>{ show("generate"); const ta=$("#g-notes"); ta.value=(ta.value?ta.value+"\n\n":"")+`Subtopics a complete page about ${t.title} covers (from Wikipedia; include the relevant ones):\n`+t.sections.map(x=>`- ${x.title}`).join("\n"); toast("Subtopics added to your notes."); };
  });
}
$("#wk-go").onclick=()=>lookupTopic(); $("#wk-q").onkeydown=e=>{ if(e.key==="Enter") lookupTopic(); };
function renderWikiCheck(item,el){
  const box=el.querySelector("[data-wiki-panel]"); if(!box) return;
  box.innerHTML=`<details class="approve-box"><summary><b>Check names and dates against Wikidata</b> <span class="status">(free)</span></summary>
    <p class="status">Finds organisations and products the page mentions and compares founding years and headquarters with Wikidata. Anything flagged is worth checking, not necessarily wrong.</p>
    <div class="row"><button class="btn ghost small" data-wkcheck>Check this page</button><span class="status" data-wkst role="status"></span></div><div data-wkout></div></details>`;
  box.querySelector("[data-wkcheck]").onclick=e=>busy(e.target,box.querySelector("[data-wkst]"),"Looking up names on Wikipedia…",async()=>{
    const r=await WIKI.checkPage(item.payload?.body_markdown||"",item.lang||siteLang());
    box.querySelector("[data-wkout]").innerHTML=`<p class="status">Looked up: ${r.looked.length?r.looked.map(x=>`<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(", "):"no well-known organisations or products found"}.</p>
      ${r.checks.length?`<div class="tw"><table><tr><th>Sentence</th><th>Page says</th><th>Wikidata says</th></tr>${r.checks.map(c=>`<tr><td>${esc(c.sentence.slice(0,200))}</td><td class="warn">${esc(c.says)}</td><td>${esc(c.wikidata)} <a href="${esc(c.source)}" target="_blank" rel="noopener">source</a></td></tr>`).join("")}</table></div>`
        :r.looked.length?`<p class="pass">No conflicts found with Wikidata.</p>`:""}`; });
}

// ---------- page history (Wayback Machine) ----------
let WB_DATA=null;
async function loadHistory(){ if(SITE_ID){ const pg=await (await import("./store.js")).get(`pages:${SITE_ID}`,[]); $("#wb-pages").innerHTML=(pg||[]).slice(0,300).map(p=>`<option value="${esc(p.url)}">`).join(""); } }
let WB_DROP=null;
async function showHistory(url,drop=null){
  url=(url||$("#wb-url").value).trim(); if(!url) return; if(!/^https?:\/\//.test(url)) url="https://"+url; $("#wb-url").value=url;
  // a known traffic drop for this page (from Content decay), if any
  WB_DROP=drop; if(!WB_DROP&&SITE_ID){ const dc=await DECAY.get(SITE_ID); const x=(dc?.pages||[]).find(p=>p.url.replace(/\/$/,"")===url.replace(/\/$/,"")); if(x&&x.start_from) WB_DROP={from:x.start_from,label:x.start_label,decline:x.decline}; }
  await busy($("#wb-go"),$("#wb-status"),"Asking the Internet Archive (it can be slow)…",async()=>{ WB_DATA=await WB.history(url); renderHistory(); if(WB_DATA.cached) $("#wb-status").textContent="From this browser's cache (refreshed daily).";
    if(drop) compareAroundDrop(); });
}
async function compareAroundDrop(){ const pair=WB.aroundDrop(WB_DATA.versions,WB_DROP?.from); if(!pair){ $("#wb-cst").textContent="The archive has no versions on both sides of the drop."; return; }
  await busy($("#wb-drop"),$("#wb-cst"),"Reading the versions either side of the drop…",async()=>{ const [a,b]=await Promise.all([WB.version(WB_DATA.url,pair.before.timestamp),WB.version(WB_DATA.url,pair.after.timestamp)]); renderCompare(a,b,WB.compare(a,b));
    const h=$("#wb-detail h2"); if(h) h.insertAdjacentHTML("afterend",`<p class="status" style="margin-top:0">The last archived version before the traffic drop (clicks down ${WB_DROP.decline}% since ${esc(WB_DROP.label)}) against the first one after it began.</p>`); }); }
async function showTimeline(){ await busy($("#wb-tl"),$("#wb-cst"),"Reading versions…",async()=>{ const rows=await WB.timeline(WB_DATA.url,WB_DATA.versions,{progress:t=>{ $("#wb-cst").textContent=t; }});
  const mark=(on,txt)=>on?`<b class="warn">${txt}</b>`:txt;
  $("#wb-detail").innerHTML=`<div class="panel"><h2>Title and heading changes over time</h2><p class="status" style="margin-top:0">${rows.length} versions spread across the page's history; changes from the previous row are highlighted.</p>
    <div class="tw"><table><tr><th>Date</th><th>Title</th><th>Main heading (H1)</th><th>Words</th><th>Sections</th></tr>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${mark(r.changed.title,esc(r.title))}</td><td>${mark(r.changed.h1,esc(r.h1))}</td><td>${mark(r.changed.words,fmtN(r.words))}</td><td>${mark(r.changed.sections,r.sections)}</td></tr>`).join("")}</table></div></div>`;
  $("#wb-detail").scrollIntoView({behavior:"smooth",block:"start"}); }); }
function renderHistory(){
  const d=WB_DATA, box=$("#wb-out"); if(!d) return;
  if(!d.versions.length){ box.innerHTML=`<div class="panel">${emptyBox("No archived versions","The Internet Archive hasn't saved this page. New or rarely linked pages often aren't archived.")}</div>`; return; }
  const vs=d.versions, years={}; for(const v of vs){ const y=v.timestamp.slice(0,4); years[y]=(years[y]||0)+1; } const ymax=Math.max(...Object.values(years));
  box.innerHTML=`<div class="panel"><div class="grid3" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num">${vs.length}${vs.length>=150?"+":""}</div><div class="lbl">different versions archived</div></div></div>
      <div class="panel kpi"><div><div class="num" style="font-size:20px">${esc(WB.tsDate(vs[vs.length-1].timestamp))}</div><div class="lbl">oldest version${vs.length>=150?" shown":""}</div></div></div>
      <div class="panel kpi"><div><div class="num" style="font-size:20px">${esc(WB.tsDate(vs[0].timestamp))}</div><div class="lbl">latest version</div></div></div></div>
    <div class="row" style="align-items:flex-end;gap:6px;height:70px" aria-label="Versions per year">${Object.entries(years).sort().map(([y,n])=>`<div style="text-align:center;flex:1;max-width:50px"><div style="background:var(--c1);opacity:.75;height:${Math.max(4,48*n/ymax)}px;border-radius:4px 4px 0 0" title="${n} versions in ${y}"></div><span class="status" style="font-size:11px">${y}</span></div>`).join("")}</div>
    <h3 style="font-size:15px;margin:14px 0 4px">Versions <span class="status" style="font-weight:400">(tick two to compare)</span></h3>
    <div class="tw" style="max-height:340px;overflow:auto"><table><tr><th><span class="sr-only">Compare</span></th><th>Date</th><th>Status</th><th>Size</th><th><span class="sr-only">Actions</span></th></tr>
      ${vs.map((v,i)=>`<tr><td><input type="checkbox" data-wbsel="${v.timestamp}" aria-label="Compare the version from ${WB.tsDate(v.timestamp)}" ${i===0||i===Math.min(vs.length-1,Math.max(1,Math.floor(vs.length/3)))?"checked":""}></td><td>${esc(WB.tsDate(v.timestamp))}</td><td class="${v.status&&v.status>=400?"fail":""}">${v.status??"–"}</td><td class="status">${v.length?fmtN(Math.round(v.length/1024))+" KB":"–"}</td>
        <td><button class="btn ghost small" data-wbread="${v.timestamp}">Read</button> <a href="https://web.archive.org/web/${v.timestamp}/${esc(d.url)}" target="_blank" rel="noopener">Open in archive</a></td></tr>`).join("")}</table></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="wb-cmp">Compare the two ticked versions</button>${WB_DROP?`<button class="btn ghost" id="wb-drop">Compare before and after the traffic drop (${esc(WB_DROP.label)})</button>`:""}<button class="btn ghost" id="wb-tl">Title and heading changes over time</button><span class="status" id="wb-cst" role="status"></span></div></div>
    <div id="wb-detail"></div>`;
  box.querySelectorAll("[data-wbread]").forEach(b=>b.onclick=()=>busy(b,$("#wb-cst"),"Reading that version…",async()=>{ renderVersion(await WB.version(d.url,b.dataset.wbread)); }));
  const dropB=$("#wb-drop"); if(dropB) dropB.onclick=compareAroundDrop; $("#wb-tl").onclick=showTimeline;
  $("#wb-cmp").onclick=()=>{ const sel=[...box.querySelectorAll("[data-wbsel]:checked")].map(x=>x.dataset.wbsel).sort(); if(sel.length!==2){ $("#wb-cst").textContent="Tick exactly two versions."; return; }
    busy($("#wb-cmp"),$("#wb-cst"),"Reading both versions…",async()=>{ const [a,b2]=await Promise.all(sel.map(t=>WB.version(d.url,t))); renderCompare(a,b2,WB.compare(a,b2)); }); };
}
function renderCompare(a,b,c){
  const row=(label,x)=>x?`<tr><td>${label}</td><td>${esc(x.before||"(none)")}</td><td>${esc(x.after||"(none)")}</td></tr>`:"";
  $("#wb-detail").innerHTML=`<div class="panel"><h2>What changed: ${esc(a.date)} → ${esc(b.date)}</h2>
    <div class="tw"><table><tr><th>What</th><th>${esc(a.date)}</th><th>${esc(b.date)}</th></tr>${row("Title",c.title)}${row("Meta description",c.meta)}${row("Main heading (H1)",c.h1)}
      <tr><td>Words</td><td>${fmtN(c.words.before)}</td><td>${fmtN(c.words.after)}${c.words.change!=null&&c.words.change!==0?` <span class="${c.words.change>0?"pass":"fail"}">(${c.words.change>0?"+":""}${c.words.change}%)</span>`:""}</td></tr>
      <tr><td>Internal links</td><td>${c.links.before}</td><td>${c.links.after}</td></tr></table></div>
    ${c.headings_added.length||c.headings_removed.length?`<div class="grid2"><div><h3 style="font-size:14px">Sections added</h3>${c.headings_added.length?`<ul class="clean">${c.headings_added.map(h=>`<li class="pass">+ ${esc(h)}</li>`).join("")}</ul>`:`<p class="status">None</p>`}</div>
      <div><h3 style="font-size:14px">Sections removed</h3>${c.headings_removed.length?`<ul class="clean">${c.headings_removed.map(h=>`<li class="fail">− ${esc(h)}</li>`).join("")}</ul>`:`<p class="status">None</p>`}</div></div>`:`<p class="status">The section headings are the same.</p>`}
    <details><summary><b>Text added and removed</b> <span class="status">(${c.sentences_added.length} added, ${c.sentences_removed.length} removed sentences shown)</span></summary>
      <div class="grid2" style="margin-top:8px"><div>${c.sentences_added.map(x=>`<p class="pass" style="margin:4px 0">+ ${esc(x)}</p>`).join("")||`<p class="status">None</p>`}</div><div>${c.sentences_removed.map(x=>`<p class="fail" style="margin:4px 0">− ${esc(x)}</p>`).join("")||`<p class="status">None</p>`}</div></div></details>
    <div class="row" style="margin-top:10px"><button class="btn ghost small" data-wbv="${a.timestamp}">Read the ${esc(a.date)} version</button><button class="btn ghost small" data-wbv="${b.timestamp}">Read the ${esc(b.date)} version</button></div></div>`;
  $("#wb-detail").querySelectorAll("[data-wbv]").forEach(x=>x.onclick=async()=>renderVersion(await WB.version(a.url,x.dataset.wbv)));
  $("#wb-detail").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderVersion(v){
  $("#wb-detail").innerHTML=`<div class="panel"><h2>${esc(v.title||v.url)} <span class="status" style="font-weight:400">· ${esc(v.date)}</span></h2>
    <p class="status">${fmtN(v.word_count)} words · <a href="${esc(v.archive_url)}" target="_blank" rel="noopener">Open in the archive</a></p>
    <div class="row" style="margin:8px 0">${READONLY?"":`<button class="btn ghost small" id="wb-kb">Add to knowledge base</button><button class="btn ghost small" id="wb-review">Open in Review a draft</button>`}<button class="btn ghost small" id="wb-copy">Copy text</button><span class="status" id="wb-vst" role="status"></span></div>
    <div class="preview" style="max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:14px">${mdToHtmlSafe(v.markdown.slice(0,60000))}</div>
    <p class="status">Recovered text may include menus or old details. Check it before reusing, and only reuse content you own.</p></div>`;
  $("#wb-copy").onclick=async()=>{ try{ await navigator.clipboard.writeText(v.markdown); $("#wb-vst").textContent="Copied."; }catch{} };
  const kb=$("#wb-kb"); if(kb) kb.onclick=()=>busy(kb,$("#wb-vst"),"Adding…",async()=>{ if(!SITE_ID) throw new Error("Add a website first."); await api(`/api/sites/${SITE_ID}/kb`,{method:"POST",body:JSON.stringify({title:`${v.title||v.url} (archived ${v.date})`,kind:"other",text:v.markdown,source:"url",url:v.archive_url})}); $("#wb-vst").textContent="Added to the knowledge base."; });
  const rv=$("#wb-review"); if(rv) rv.onclick=()=>{ show("audit"); $("#a-draft").value=v.markdown; toast("The archived text is in Review a draft. Add the keyword and review it."); };
  $("#wb-detail").scrollIntoView({behavior:"smooth",block:"start"});
}
$("#wb-go").onclick=()=>showHistory();
$("#wb-url").onkeydown=e=>{ if(e.key==="Enter") showHistory(); };
window._openHistory=(url,drop)=>{ show("history"); showHistory(url,drop); };

// ---------- chat alerts (Slack, Microsoft Teams, Google Chat) ----------
async function notifyCall(body){ const h=SYNC.authHeaders(); if(!h) throw new Error("Chat alerts need team sync or accounts (Settings → Team & data).");
  const r=await fetch("/api/notify",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",...h},body:JSON.stringify(body)}); const d=await r.json().catch(()=>({}));
  if(r.status===404&&!d.error) throw new Error("The chat alerts function isn't deployed yet. Push the latest code to GitHub."); if(!r.ok) throw new Error(d.error||`Chat alerts failed (${r.status})`); return d; }
function chatEvent(event,title,lines){ if(!SYNC.authHeaders()) return; const link=location.origin.startsWith("https://")?location.origin:""; notifyCall({op:"event",event,title,lines,link}).catch(()=>{}); }
const HOOK_NAME={slack:"Slack",teams:"Microsoft Teams",gchat:"Google Chat"};
async function renderChatAlerts(){
  const box=$("#chat-alerts"); if(!box) return;
  if(!SYNC.authHeaders()){ box.innerHTML=`<p class="status">Chat alerts need team sync or accounts, so the webhooks can be stored safely on the server. Turn on <b>Team workspace</b> above first.</p>`; return; }
  let d; try{ d=await notifyCall({op:"list"}); }catch(e){ box.innerHTML=`<p class="status err">${esc(e.message)}</p>`; return; }
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
  box.innerHTML=`${d.hooks.length?`<div class="tw"><table><tr><th>Channel</th><th>Weekly summary</th><th>Urgent alerts</th><th>Reviews &amp; mentions</th><th>Quiet hours</th><th>Last message</th><th><span class="sr-only">Actions</span></th></tr>${d.hooks.map(h=>`<tr><td><b>${esc(h.name)}</b><br><span class="status">${esc(HOOK_NAME[h.kind])} · ${esc(h.masked)}</span>${h.held?`<br><span class="pill warn">${h.held} urgent alert${h.held>1?"s":""} held</span>`:""}</td>
      ${["weekly","urgent","approval"].map(e=>`<td><input type="checkbox" data-hev="${h.id}:${e}" ${h.events[e]?"checked":""} ${READONLY?"disabled":""} aria-label="${e} for ${esc(h.name)}"></td>`).join("")}
      <td><span class="row" style="flex-wrap:nowrap;gap:4px"><input type="time" data-hqs="${h.id}" value="${esc(h.quiet?.start||"")}" aria-label="Quiet hours start for ${esc(h.name)}" style="width:7.5em" ${READONLY?"disabled":""}>–<input type="time" data-hqe="${h.id}" value="${esc(h.quiet?.end||"")}" aria-label="Quiet hours end for ${esc(h.name)}" style="width:7.5em" ${READONLY?"disabled":""}></span>${h.quiet?`<span class="status">${esc(h.quiet.tz)}</span>`:""}</td>
      <td class="status">${h.last?`<span class="${h.last.ok?"pass":"fail"}">${h.last.ok?"Delivered":"Failed"}</span> ${esc(fmtDate(h.last.at))}${h.last.error?`<br>${esc(h.last.error)}`:""}`:"–"}</td>
      <td>${READONLY?"":`<button class="btn ghost small" data-htest="${h.id}">Send test message</button><button class="btn ghost small" data-hdel="${h.id}">Remove</button>`}</td></tr>`).join("")}</table></div>`:`<p class="status">No chat channels yet.</p>`}
    ${READONLY?"":`<details style="margin-top:10px" ${d.hooks.length?"":"open"}><summary><b>Add a channel</b></summary>
      <ol class="clean" style="margin:8px 0;font-size:14px"><li><b>Slack:</b> create a Slack app with <i>Incoming Webhooks</i> turned on, add it to a channel, and copy the webhook address (hooks.slack.com/services/…).</li>
        <li><b>Microsoft Teams:</b> in the channel, open <i>Workflows</i> → “Post to a channel when a webhook request is received”, and copy the address it gives you.</li>
        <li><b>Google Chat:</b> in the space, open <i>Apps &amp; integrations</i> → <i>Webhooks</i> → add one, and copy its address (chat.googleapis.com/v1/spaces/…).</li></ol>
      <div class="row" style="flex-wrap:nowrap"><input id="hk-name" placeholder="Name, e.g. #marketing" aria-label="Channel name" style="max-width:200px"><input id="hk-url" type="password" autocomplete="off" placeholder="Webhook address (https://…)" aria-label="Webhook address" style="flex:1"><button class="btn" id="hk-add">Add</button></div>
      <div class="row" style="margin-top:6px"><label class="check" style="margin:0 10px 0 0"><input type="checkbox" id="hk-weekly" checked> Weekly summary</label><label class="check" style="margin:0 10px 0 0"><input type="checkbox" id="hk-urgent" checked> Urgent alerts</label><label class="check" style="margin:0"><input type="checkbox" id="hk-approval"> Pages ready for review</label></div>
      <span class="status" id="hk-st" role="status"></span>
      <p class="status">The address is stored encrypted on the server; the browser only sees a shortened version. Urgent alerts are sent when a check finds a problem (the weekly check, or “Run the check now”). Several within 10 minutes are combined into one message, and the same alert isn't repeated within 24 hours. Held alerts (quiet hours or combining) go out with the next hourly run.</p></details>`}`;
  box.querySelectorAll("[data-hev]").forEach(c=>c.onchange=async()=>{ const [id,e]=c.dataset.hev.split(":"), h=d.hooks.find(x=>x.id===id); try{ await notifyCall({op:"update",id,events:{...h.events,[e]:c.checked}}); }catch(err){ toast(err.message,"error"); c.checked=!c.checked; } });
  box.querySelectorAll("[data-hqs],[data-hqe]").forEach(inp=>inp.onchange=async()=>{ const id=inp.dataset.hqs||inp.dataset.hqe, a=box.querySelector(`[data-hqs="${id}"]`).value, e=box.querySelector(`[data-hqe="${id}"]`).value;
    if((a&&!e)||(!a&&e)) return; try{ await notifyCall({op:"update",id,quiet:a&&e?{start:a,end:e,tz}:null}); toast(a&&e?`Quiet hours set: ${a}–${e} (${tz}). Urgent alerts in that time are sent combined afterwards.`:"Quiet hours removed."); renderChatAlerts(); }catch(err){ toast(err.message,"error"); } });
  box.querySelectorAll("[data-htest]").forEach(b=>b.onclick=()=>busy(b,$("#hk-st")||box.querySelector(".status"),"Sending…",async()=>{ try{ await notifyCall({op:"test",id:b.dataset.htest}); toast("Test message delivered."); } finally { renderChatAlerts(); } }));
  box.querySelectorAll("[data-hdel]").forEach(b=>b.onclick=async()=>{ if(!confirm("Remove this chat channel?")) return; await notifyCall({op:"remove",id:b.dataset.hdel}); renderChatAlerts(); });
  const add=$("#hk-add"); if(add) add.onclick=()=>busy(add,$("#hk-st"),"Adding…",async()=>{ await notifyCall({op:"add",name:$("#hk-name").value.trim(),url:$("#hk-url").value.trim(),events:{weekly:$("#hk-weekly").checked,urgent:$("#hk-urgent").checked,approval:$("#hk-approval").checked}}); $("#hk-url").value=""; await renderChatAlerts(); toast("Channel added. Send a test message to check it."); });
}

// ---------- voiceover preview (video scripts) ----------
let VO_CTRL=null;
async function bindVoice(box,item,f){
  const host=box.querySelector("[data-vo]"); if(!host) return; const lang=item.lang||"en", scenes=f.scenes, measured={}, saved=VOICE.recall(lang);
  const vs=await VOICE.voices(lang), can=VOICE.supported()&&vs.length>0;
  host.innerHTML=`<div class="panel" style="margin:8px 0;padding:12px"><div class="row" style="justify-content:space-between;align-items:flex-start">
      <div data-voframe style="flex:1;min-width:220px;aspect-ratio:16/9;max-width:420px;border-radius:10px;background:#0f172a;color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:14px;text-align:center">
        <div data-voscreen style="font-size:22px;font-weight:700;line-height:1.25">${esc(scenes[0]?.on_screen||f.title||"")}</div><div data-voshow style="font-size:12px;opacity:.7;margin-top:8px">${esc(scenes[0]?.show||"")}</div><div data-vowords style="font-size:13px;margin-top:10px;line-height:1.5;opacity:.95"></div></div>
      <div style="flex:1;min-width:220px">${can?`<div class="field" style="margin:0 0 8px"><label>Voice</label><select data-vovoice>${vs.slice(0,40).map((v,i)=>`<option value="${i}" ${saved&&saved.voice===v.name?"selected":""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</select></div>`:`<p class="status" style="margin-top:0">${VOICE.supported()?"This browser has no voices installed, so the script can't be played here (Chrome, Edge and Safari include voices).":"This browser can't speak text aloud. Try Chrome, Edge or Safari."} The timing check below still works.</p>`}
        <div class="field" style="margin:0 0 8px"><label>Speed <span data-vorate-l>1.0×</span></label><input type="range" data-vorate min="0.8" max="1.3" step="0.05" value="${saved?.rate||1}" aria-label="Speaking speed"></div>
        ${can?`<div class="row"><button class="btn small" data-voall>▶ Play all</button><button class="btn ghost small" data-vostop disabled>Stop</button></div>`:""}
        <div class="row" style="margin-top:6px"><button class="btn ghost small" data-vosrt>Download subtitles (SRT)</button></div>
        <p class="status" data-vosum style="margin:8px 0 0"></p></div></div></div>`;
  if(!can) host.closest(".ans")?.querySelectorAll("[data-voplay]").forEach(b=>b.disabled=true);
  const rate=()=>+host.querySelector("[data-vorate]").value;
  const showTiming=()=>{ const t=VOICE.timing(scenes,lang,rate());
    t.rows.forEach(r=>{ const c=box.querySelector(`[data-voest="${r.i}"]`); if(!c) return; const m=measured[r.i], v=m??r.est, over=r.plan>0&&v>r.plan*1.2&&v-r.plan>=2;
      c.innerHTML=`<span class="${over?"fail":"pass"}">${v.toFixed(1)} s</span>${m!=null?"":` <span class="status">est.</span>`}${over?`<br><span class="status">shorten it</span>`:""}`; });
    const total=Object.keys(measured).length===scenes.length?Math.round(Object.values(measured).reduce((a,b)=>a+b,0)):t.total, n=t.rows.filter(r=>(measured[r.i]??r.est)>r.plan*1.2&&(measured[r.i]??r.est)-r.plan>=2).length;
    host.querySelector("[data-vosum]").innerHTML=`Spoken length: <b>${total} s</b> (planned ${t.planned} s)${total>95?` · <span class="warn">long for social video; aim for 60-90 s</span>`:total<25?` · <span class="warn">very short</span>`:""}${n?` · <span class="fail">${n} scene${n>1?"s run":" runs"} long</span>`:""}`; };
  showTiming();
  const keep=()=>{ const sel=host.querySelector("[data-vovoice]"); VOICE.remember(lang,{voice:sel?vs[+sel.value]?.name:null,rate:rate()}); };
  { const sel=host.querySelector("[data-vovoice]"); if(sel) sel.addEventListener("change",keep); host.querySelector("[data-vorate]").addEventListener("change",keep); }
  if(saved?.rate) host.querySelector("[data-vorate-l]").textContent=`${(+saved.rate).toFixed(2).replace(/0$/,"")}×`;
  // subtitles: measured scene lengths when played, otherwise estimates at the chosen speed
  host.querySelector("[data-vosrt]").onclick=()=>{ const t=VOICE.timing(scenes,lang,rate()), dur=t.rows.map(r=>measured[r.i]??r.est);
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([VOICE.srt(scenes,dur)],{type:"application/octet-stream"})); a.download=`${(item.slug||"video-script").slice(0,60)}.srt`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
  host.querySelector("[data-vorate]").oninput=e=>{ host.querySelector("[data-vorate-l]").textContent=`${(+e.target.value).toFixed(2).replace(/0$/,"")}×`; for(const k in measured) delete measured[k]; showTiming(); };
  const wordsEl=host.querySelector("[data-vowords]");
  const mark=i=>{ box.querySelectorAll("[data-vorow]").forEach(r=>r.style.background=+r.dataset.vorow===i?"var(--soft)":""); if(i>=0&&scenes[i]){ host.querySelector("[data-voscreen]").textContent=scenes[i].on_screen||""; host.querySelector("[data-voshow]").textContent=scenes[i].show||"";
      wordsEl.innerHTML=String(scenes[i].voiceover||"").split(/\s+/).filter(Boolean).map((w,k)=>`<span data-vw="${k}">${esc(w)}</span>`).join(" "); } else wordsEl.innerHTML=""; };
  const word=(i,k)=>{ wordsEl.querySelectorAll("[data-vw]").forEach(sp=>{ const on=+sp.dataset.vw===k; sp.style.background=on?"#facc15":""; sp.style.color=on?"#0f172a":""; sp.style.borderRadius=on?"3px":""; }); };
  const start=(from,only)=>{ if(VO_CTRL) VO_CTRL.stop(); const sel=host.querySelector("[data-vovoice]"), stopB=host.querySelector("[data-vostop]"); if(stopB) stopB.disabled=false;
    VO_CTRL=VOICE.play(scenes,{voice:sel?vs[+sel.value]:null,rate:rate(),lang,from,only,onScene:mark,onWord:word,onSceneEnd:(i,secs)=>{ if(secs!=null){ measured[i]=secs; showTiming(); } },onDone:()=>{ mark(-1); if(stopB) stopB.disabled=true; VO_CTRL=null; }}); };
  const all=host.querySelector("[data-voall]"); if(all) all.onclick=()=>start(0,false);
  const stop=host.querySelector("[data-vostop]"); if(stop) stop.onclick=()=>{ if(VO_CTRL) VO_CTRL.stop(); };
  box.querySelectorAll("[data-voplay]").forEach(b=>b.onclick=()=>start(+b.dataset.voplay,true));
}

// ---------- site migration ----------
const MG_KIND={same:["pass","Same address"],slug:["pass","Same page name"],title:["pass","Same title"],similar:["warn","Similar words"],parent:["warn","Parent section"],none:["fail","No good match"],edited:["pass","Set by you"]};
const MG_VERDICT={ok:"pass",chain:"warn",temporary:"warn",missing:"fail",wrong:"fail",dead:"fail",loop:"fail",skipped:""};
let MG_FILTER="attention";
async function loadMigration(){
  if(!SITE_ID){ $("#mg-out").innerHTML=`<div class="panel">${emptyBox("Add a website first","The migration plan starts from your current site.","site","Add a website")}</div>`; bindGo($("#mg-out")); return; }
  const m=await api(`/api/sites/${SITE_ID}/migration`), short=u=>esc(MIG.pathOf(u));
  $("#mg-old-st").textContent=m.old.length?`${fmtN(m.old.length)} current pages (${fmtN(m.old.filter(o=>o.clicks>0).length)} with Google traffic).`:"";
  $("#mg-new-st").textContent=m.new.length?`${fmtN(m.new.length)} new addresses.`:"";
  if(!m.rows.length){ $("#mg-out").innerHTML=m.old.length&&m.new.length?`<div class="panel"><h2>3. Match</h2><button class="btn" id="mg-match">Match old pages to new addresses</button><span class="status" id="mg-mst" role="status"></span></div>`:""; const mb=$("#mg-match"); if(mb) mb.onclick=()=>busy(mb,$("#mg-mst"),"Matching…",async()=>{ await api(`/api/sites/${SITE_ID}/migration/match`,{method:"POST",body:"{}",onProgress:t=>{ const e=$("#mg-mst"); if(e) e.textContent=t; }}); loadMigration(); }); return; }
  const R=m.rows, att=r=>!r.gone&&(r.kind==="none"||r.kind==="parent"||(r.kind==="similar"&&r.confidence<0.6)), nAtt=R.filter(att).length, nTraffic=R.filter(r=>att(r)&&r.clicks>0).length;
  const shown=(MG_FILTER==="attention"?R.filter(att):MG_FILTER==="traffic"?R.filter(r=>r.clicks>0):R).slice(0,400);
  const ck=m.checks, ckBy=new Map((ck?.results||[]).map(x=>[x.url,x])), bad=(ck?.results||[]).filter(x=>!["ok","skipped"].includes(x.verdict));
  const rulesN=R.filter(r=>r.gone||(r.target&&MIG.pathOf(r.url)!==MIG.pathOf(r.target))).length, okN=(ck?.results||[]).filter(x=>x.verdict==="ok").length, unchecked=Math.max(0,R.filter(r=>r.target||r.gone).length-(ck?.results||[]).length);
  const titleable=R.filter(r=>!r.edited&&!r.gone&&["none","parent"].includes(r.kind)&&r.title&&(r.clicks||0)>0).length;
  $("#mg-out").innerHTML=`${ck?`<div class="panel"><h2 style="margin-top:0">Migration progress</h2><div class="grid4"><div class="panel kpi"><div><div class="num">${fmtN(rulesN)}</div><div class="lbl">redirects planned</div></div></div>
      <div class="panel kpi"><div><div class="num pass">${fmtN(okN)}</div><div class="lbl">checked and working</div></div></div><div class="panel kpi"><div><div class="num ${bad.length?"fail":""}">${fmtN(bad.length)}</div><div class="lbl">problems</div></div></div>
      <div class="panel kpi"><div><div class="num">${fmtN(unchecked)}</div><div class="lbl">not checked yet</div></div></div></div></div>`:""}
    <div class="panel"><div class="row" style="justify-content:space-between"><h2 style="margin:0">3. Review the matches</h2>${READONLY?"":`<span class="row">${titleable?`<button class="btn ghost small" id="mg-titles" title="Reads the titles of the likeliest new pages (up to 100)">Improve ${titleable} match${titleable>1?"es":""} using page titles</button>`:""}<button class="btn ghost small" id="mg-rematch">Match again</button></span>`}</div>
    <div class="grid4" style="margin:10px 0"><div class="panel kpi"><div><div class="num">${fmtN(R.length)}</div><div class="lbl">current pages</div></div></div>
      <div class="panel kpi"><div><div class="num pass">${fmtN(R.filter(r=>["same","slug","edited"].includes(r.kind)).length)}</div><div class="lbl">confident matches</div></div></div>
      <div class="panel kpi"><div><div class="num ${nAtt?"warn":""}">${fmtN(nAtt)}</div><div class="lbl">need a look</div></div></div>
      <div class="panel kpi"><div><div class="num ${nTraffic?"fail":""}">${fmtN(nTraffic)}</div><div class="lbl">of those have Google traffic</div></div></div></div>
    <div class="row" role="group" aria-label="Show"><button class="btn ghost small" data-mgf="attention" aria-pressed="${MG_FILTER==="attention"}">Need a look (${nAtt})</button><button class="btn ghost small" data-mgf="traffic" aria-pressed="${MG_FILTER==="traffic"}">With Google traffic</button><button class="btn ghost small" data-mgf="all" aria-pressed="${MG_FILTER==="all"}">All</button></div>
    <datalist id="mg-newlist">${m.new.slice(0,3000).map(u=>`<option value="${esc(u)}">`).join("")}</datalist>
    <div class="tw" style="margin-top:8px;max-height:520px;overflow:auto"><table><tr><th>Current page</th><th>Google clicks</th><th>New address</th><th>Match</th>${ck?"<th>After launch</th>":""}</tr>
      ${shown.map(r=>{ const c=ckBy.get(r.url), k=MG_KIND[r.kind]||MG_KIND.none; return `<tr><td><span class="url">${short(r.url)}</span>${r.title?`<br><span class="status">${esc(r.title.slice(0,60))}</span>`:""}</td><td>${fmtN(r.clicks||0)}</td>
        <td>${READONLY?`<span class="url">${r.gone?"(gone)":short(r.target)}</span>`:`<input data-mgt="${esc(r.url)}" list="mg-newlist" value="${esc(r.target||"")}" ${r.gone?"disabled":""} aria-label="New address for ${esc(MIG.pathOf(r.url))}" style="min-width:260px"><label class="check" style="margin:4px 0 0"><input type="checkbox" data-mgg="${esc(r.url)}" ${r.gone?"checked":""}> Gone (410)</label>`}${r.suggestion&&r.kind!=="similar"?`<br><span class="status">Closest words: <button class="linkbtn" data-mgs="${esc(r.url)}" data-to="${esc(r.suggestion)}">${short(r.suggestion)}</button></span>`:""}</td>
        <td><span class="pill ${k[0]}">${r.gone?"Gone":k[1]}</span>${r.kind==="similar"?`<br><span class="status">${Math.round(r.confidence*100)}%</span>`:""}</td>${ck?`<td>${c?`<span class="${MG_VERDICT[c.verdict]}">${esc(c.text)}</span>`:"–"}</td>`:""}</tr>`; }).join("")}</table></div>
    ${shown.length===400?`<p class="status">Showing the first 400. Use the filters, or export to see all.</p>`:""}</div>
    <div class="panel"><h2>4. Export the redirects</h2><div class="row"><select id="mg-fmt" aria-label="Format" style="width:auto"><option value="netlify">Netlify (_redirects)</option><option value="apache">Apache (.htaccess)</option><option value="nginx">Nginx</option><option value="redirection">WordPress Redirection plugin (CSV)</option><option value="csv">CSV (old, new, status)</option></select>
      <button class="btn" id="mg-dl">Download</button><button class="btn ghost" id="mg-copy">Copy</button><span class="status" id="mg-ex-st" role="status">${fmtN(R.filter(r=>r.gone||(r.target&&MIG.pathOf(r.url)!==MIG.pathOf(r.target))).length)} rules (pages keeping their address need none).</span></div></div>
    <div class="panel"><h2>5. After launch: check the redirects</h2><p class="status" style="margin-top:0">Follows every old address hop by hop and checks it ends at the planned page: wrong targets, chains, temporary (302) redirects, loops and dead ends.</p>
      <div class="row">${READONLY?"":`<button class="btn" id="mg-check">${ck?"Check again (problems and edits only)":"Check the redirects"}</button>${ck?`<label class="check" style="margin:0"><input type="checkbox" id="mg-all"> check everything</label>`:""}`}<span class="status" id="mg-ck-st" role="status">${ck?`Checked ${esc(fmtDate(ck.at))}${ck.rechecked!=null&&ck.rechecked<ck.total?` (${fmtN(ck.rechecked)} re-tested, the rest unchanged)`:""}: <b class="${bad.length?"fail":"pass"}">${bad.length?`${bad.length} problem${bad.length>1?"s":""}`:"all redirects work"}</b> of ${fmtN(ck.results.length)}.`:""}</span></div>
      ${bad.length?`<div class="tw" style="margin-top:8px"><table><tr><th>Old address</th><th>Clicks</th><th>Problem</th><th>Path</th></tr>${bad.sort((a,b)=>(b.clicks||0)-(a.clicks||0)).slice(0,100).map(x=>`<tr><td><span class="url">${short(x.url)}</span></td><td>${fmtN(x.clicks||0)}</td><td class="${MG_VERDICT[x.verdict]}">${esc(x.text)}</td><td class="status">${x.hops.map(h=>`${h.status||"✕"}`).join(" → ")}</td></tr>`).join("")}</table></div>`:""}</div>`;
  const edit=(url,body)=>api(`/api/sites/${SITE_ID}/migration/edit`,{method:"POST",body:JSON.stringify({url,...body})});
  $("#mg-out").querySelectorAll("[data-mgt]").forEach(i=>i.onchange=async()=>{ try{ await edit(i.dataset.mgt,{target:i.value.trim()}); loadMigration(); }catch(e){ toast(e.message,"error"); } });
  $("#mg-out").querySelectorAll("[data-mgg]").forEach(i=>i.onchange=async()=>{ await edit(i.dataset.mgg,{gone:i.checked}); loadMigration(); });
  $("#mg-out").querySelectorAll("[data-mgs]").forEach(b=>b.onclick=async()=>{ await edit(b.dataset.mgs,{target:b.dataset.to}); loadMigration(); });
  $("#mg-out").querySelectorAll("[data-mgf]").forEach(b=>b.onclick=()=>{ MG_FILTER=b.dataset.mgf; loadMigration(); });
  const tb=$("#mg-titles"); if(tb) tb.onclick=()=>busy(tb,$("#mg-ex-st"),"Reading new pages…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/migration/titles`,{method:"POST",body:"{}",onProgress:t=>{ const e=$("#mg-ex-st"); if(e) e.textContent=t; }}); await loadMigration(); toast(`${r.improved} match${r.improved===1?"":"es"} improved from ${r.read} page titles.`); });
  const rm=$("#mg-rematch"); if(rm) rm.onclick=()=>busy(rm,$("#mg-ex-st"),"Matching…",async()=>{ await api(`/api/sites/${SITE_ID}/migration/match`,{method:"POST",body:"{}"}); loadMigration(); });
  const rules=()=>MIG.exportRules(R,$("#mg-fmt").value,window._siteUrl);
  $("#mg-dl").onclick=()=>{ const f=$("#mg-fmt").value, name={netlify:"_redirects",apache:"redirects.htaccess",nginx:"redirects.nginx.conf",redirection:"redirection-import.csv",csv:"redirects.csv"}[f];
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([rules()],{type:"application/octet-stream"})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
  $("#mg-copy").onclick=async()=>{ try{ await navigator.clipboard.writeText(rules()); $("#mg-ex-st").textContent="Copied."; }catch{} };
  const chk=$("#mg-check"); if(chk) chk.onclick=()=>busy(chk,$("#mg-ck-st"),"Checking…",async()=>{ const tok=LLM.getSettings().crawlToken;
    await api(`/api/sites/${SITE_ID}/migration/check`,{method:"POST",body:JSON.stringify({all:!!($("#mg-all")&&$("#mg-all").checked)}),onProgress:t=>{ const e=$("#mg-ck-st"); if(e) e.textContent=t; },
      traceFn:async urls=>{ const r=await fetch("/api/redirects",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",...(tok?{"x-crawl-token":tok}:{})},body:JSON.stringify({urls})}); const d=await r.json().catch(()=>({}));
        if(r.status===404&&!d.error) throw new Error("The redirect checker isn't deployed yet. Push the latest code to GitHub."); if(!r.ok) throw new Error(d.error||`Redirect check failed (${r.status})`); return d.results; }}); await loadMigration(); });
}
$("#mg-old").onclick=()=>{ if(!needSite($("#mg-old-st"))) return; busy($("#mg-old"),$("#mg-old-st"),"Loading…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/migration/old`,{method:"POST",body:"{}",onProgress:t=>{ $("#mg-old-st").textContent=t; }}); await loadMigration(); $("#mg-old-st").textContent=`${fmtN(r.count)} current pages: ${fmtN(r.from_sitemap)} from the sitemap${r.capped?" (the first 10,000; every page with Google traffic is included as well)":""}, ${fmtN(r.with_traffic)} with Google traffic.`; }); };
$("#mg-new-file").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; const t=await f.text(); $("#mg-new").value=[...t.matchAll(/https?:\/\/[^\s,"';]+/g)].map(m=>m[0]).join("\n"); };
$("#mg-new-go").onclick=()=>{ if(!needSite($("#mg-new-st"))) return; busy($("#mg-new-go"),$("#mg-new-st"),"Reading…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/migration/new`,{method:"POST",body:JSON.stringify({urls:$("#mg-new").value.split(/\s+/).filter(Boolean),sitemap:$("#mg-sitemap").value.trim()}),onProgress:t=>{ $("#mg-new-st").textContent=t; }}); await loadMigration(); $("#mg-new-st").textContent=`${fmtN(r.count)} new addresses.`; }); };

// ---------- competitors ----------
const OVERLAP={keyword_gap:["fail",o=>`Your keyword “${o.keyword}”: no page yet`],keyword_covered:["warn",o=>`Your keyword “${o.keyword}”: you have a page`],covered:["pass",()=>"You cover this"],new_topic:["",()=>"New topic for you"]};
async function loadCompetitors(){
  if(!SITE_ID){ $("#cp-out").innerHTML=`<div class="panel">${emptyBox("Add a website first","Competitors are tracked per website.","site","Add a website")}</div>`; bindGo($("#cp-out")); return; }
  const list=await api(`/api/sites/${SITE_ID}/competitors`), short=u=>esc(u.replace(/^https?:\/\/[^/]+/,"")||"/"), ins=list.length?await api(`/api/sites/${SITE_ID}/competitor-insights`).catch(()=>({per:[],feed:[]})):{per:[],feed:[]};
  const tchips=ts=>ts.length?ts.map(t=>`<span class="pill ${t.yours?"warn":""}" title="${t.yours?"one of your keywords":""}">${esc(t.topic)} · ${t.pages}</span>`).join(" "):`<span class="status">not enough new pages yet</span>`;
  $("#cp-out").innerHTML=list.length?`${READONLY?"":`<div class="row" style="margin-bottom:10px"><button class="btn ghost" id="cp-all">Check all now</button><span class="status" id="cp-allst" role="status"></span></div>`}
    ${ins.feed.length?`<div class="panel"><h2>New pages from all competitors <span class="status" style="font-weight:400">(last 30 days, most relevant to you first)</span></h2><div class="tw"><table><tr><th>New page</th><th>Competitor</th><th>Your topics</th></tr>${ins.feed.slice(0,25).map(x=>{ const o=OVERLAP[x.overlap?.kind]||OVERLAP.new_topic; return `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title||short(x.url))}</a><br><span class="status">${esc(fmtDate(x.at))}</span></td><td>${esc(x.competitor)}</td><td><span class="pill ${o[0]}">${esc(o[1](x.overlap||{}))}</span>${x.overlap?.kind==="keyword_gap"&&!READONLY?`<br><button class="linkbtn" data-cpkw="${esc(x.overlap.keyword)}">Check this keyword</button>`:""}</td></tr>`; }).join("")}</table></div></div>`:""}
    ${list.map(c=>{ const h=(c.history||[])[0];
      return `<div class="panel"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(c.name)}</h2><span class="status">${esc(c.url)} · ${c.tracked?`${fmtN(c.tracked)} pages tracked${c.capped?" (first 10,000)":""}`:"not checked yet"}${c.last_check?` · checked ${esc(fmtDate(c.last_check))}`:""}</span></div>
        ${READONLY?"":`<div class="row"><button class="btn ghost small" data-cpcheck="${c.id}">Check now</button><button class="btn ghost small" data-cpdel="${c.id}">Remove</button></div>`}</div>
        <span class="status" data-cpst="${c.id}" role="status"></span>
        ${(()=>{ const t=ins.per.find(x=>x.id===c.id); return t&&(t.topics30.length||t.topics90.length)?`<div style="margin:6px 0"><span class="status">Publishing about, last 30 days:</span> ${tchips(t.topics30)}<br><span class="status">Last 90 days:</span> ${tchips(t.topics90)}</div>`:""; })()}
        ${!h?`<p class="status">Click “Check now” to start tracking.</p>`:h.baseline?`<p class="status">Started tracking ${fmtN(h.tracked)} pages on ${esc(fmtDate(h.at))}. New, updated and removed pages will show from the next check (the weekly check does this automatically).</p>`
          :`<p style="margin:8px 0"><b>${h.added_count||0}</b> new · <b>${h.updated_count||0}</b> updated · <b>${h.removed_count||0}</b> removed <span class="status">since the previous check (${esc(fmtDate(h.at))})${h.files_reused?` · ${h.files_reused} unchanged sitemap file${h.files_reused>1?"s":""} reused, ${h.files_fetched} read`:""}</span></p>
          ${(h.added||[]).length?`<div class="tw"><table><tr><th>New page</th><th>Your topics</th></tr>${h.added.map(x=>{ const o=OVERLAP[x.overlap?.kind]||OVERLAP.new_topic; return `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title||short(x.url))}</a><br><span class="url">${short(x.url)}</span></td><td><span class="pill ${o[0]}">${esc(o[1](x.overlap||{}))}</span>${x.overlap?.your_page?`<br><span class="url">${short(x.overlap.your_page)}</span>`:""}${x.overlap?.kind==="keyword_gap"&&!READONLY?`<br><button class="linkbtn" data-cpkw="${esc(x.overlap.keyword)}">Check this keyword</button>`:""}</td></tr>`; }).join("")}</table></div>${h.added_count>h.added.length?`<p class="status">…and ${h.added_count-h.added.length} more.</p>`:""}`:""}
          ${(h.updated||[]).length?`<details><summary class="status">Updated pages (${h.updated_count})</summary><ul class="clean">${h.updated.map(u=>`<li><a href="${esc(u)}" target="_blank" rel="noopener">${short(u)}</a></li>`).join("")}</ul></details>`:""}
          ${(h.removed||[]).length?`<details><summary class="status">Removed pages (${h.removed_count})</summary><ul class="clean">${h.removed.map(u=>`<li class="status">${short(u)}</li>`).join("")}</ul></details>`:""}`}</div>`; }).join("")}`
    :`<div class="panel">${emptyBox("No competitors yet","Add a competitor's website above to see what they publish.")}</div>`;
  const check=(cid,btn)=>busy(btn,$(`[data-cpst="${cid}"]`),"Checking…",async()=>{ await api(`/api/sites/${SITE_ID}/competitors/${cid}/check`,{method:"POST",body:"{}",onProgress:t=>{ const e=$(`[data-cpst="${cid}"]`); if(e) e.textContent=t; }}); await loadCompetitors(); });
  $("#cp-out").querySelectorAll("[data-cpcheck]").forEach(b=>b.onclick=()=>check(+b.dataset.cpcheck,b));
  $("#cp-out").querySelectorAll("[data-cpdel]").forEach(b=>b.onclick=async()=>{ if(!confirm("Stop tracking this competitor?")) return; await api(`/api/sites/${SITE_ID}/competitors/${b.dataset.cpdel}`,{method:"DELETE"}); loadCompetitors(); });
  $("#cp-out").querySelectorAll("[data-cpkw]").forEach(b=>b.onclick=()=>openCheck(b.dataset.cpkw));
  const all=$("#cp-all"); if(all) all.onclick=()=>busy(all,$("#cp-allst"),"Checking competitors…",async()=>{ for(const c of list){ $("#cp-allst").textContent=`Checking ${c.name}…`; try{ await api(`/api/sites/${SITE_ID}/competitors/${c.id}/check`,{method:"POST",body:"{}"}); }catch(e){ toast(`${c.name}: ${e.message}`); } } await loadCompetitors(); });
}
$("#cp-add").onclick=()=>{ if(!needSite($("#cp-status"))) return; busy($("#cp-add"),$("#cp-status"),"Adding…",async()=>{ const c=await api(`/api/sites/${SITE_ID}/competitors`,{method:"POST",body:JSON.stringify({url:$("#cp-url").value.trim(),name:$("#cp-name").value.trim()})}); $("#cp-url").value=$("#cp-name").value=""; await loadCompetitors(); $("#cp-status").textContent=`Tracking ${c.name}. Click “Check now” to take the first snapshot.`; }); };

// ---------- Google Analytics 4 (Performance screen) ----------
let GA4_OPT={days:28,organic:true};
async function renderGa4(){
  const box=$("#ga4-panel"); if(!box||!SITE_ID) return; const id=SITE_ID, c=await GA4.get(id), st=await GSCC.status();
  if(!c){ box.innerHTML=`<h2>Google Analytics <span class="pill">conversions</span></h2><p class="lead" style="margin:0 0 10px">See which pages lead to sign-ups, sales, enquiries or other key events, not just clicks. Read-only; the permission is stored encrypted.</p>
    ${st.configured?(READONLY?"":`<button class="btn" id="ga4-go">Connect Google Analytics</button>`):`<p class="status">This uses the same Google setup as Search Console: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify, and enable the Google Analytics Data API and Admin API (see the README).</p>`} <span class="status" id="ga4-st" role="status"></span>`;
    const g=$("#ga4-go"); if(g) g.onclick=()=>busy(g,$("#ga4-st"),"Opening Google…",()=>GA4.start(id)); return; }
  const d=await GA4.report(id), gRows=(await (await import("./store.js")).get(`gsc:${id}`,[]))?.[0]?.rows||[], a=GA4.analyse(d,gRows), cur=d?.currency?` ${d.currency}`:"";
  const short=p=>esc(p||"/"), pct=x=>`${(x*100).toFixed(x<0.1?1:0)}%`;
  const delta=(now,before)=>{ const c=GA4.change(now,before); return c==null||!isFinite(c)?"":` <span class="${c>=0?"pass":"fail"}" style="font-size:13px">${c>=0?"▲":"▼"} ${Math.abs(c)}%</span>`; };
  if(c.property&&!c.events&&!READONLY) GA4.events(id).then(()=>renderGa4()).catch(()=>{});
  // refresh automatically once a day when the screen is opened
  if(c.property&&!READONLY&&(!d||Date.now()-d.at>864e5)&&!renderGa4._busy){ renderGa4._busy=true; GA4.refresh(id,d?{days:d.days,organic:d.organic}:GA4_OPT).then(()=>{ renderGa4._busy=false; renderGa4(); }).catch(()=>{ renderGa4._busy=false; }); }
  box.innerHTML=`<div class="row" style="justify-content:space-between"><h2 style="margin:0">Google Analytics <span class="pill">conversions</span></h2>${READONLY?"":`<span class="row"><button class="btn ghost small" id="ga4-refresh">Refresh</button><button class="btn ghost small" id="ga4-off">Disconnect</button></span>`}</div>
    <div class="row" style="margin:8px 0">${c.properties.length?`<select id="ga4-prop" aria-label="Google Analytics property" style="width:auto">${c.property?"":`<option value="">Choose the property…</option>`}${c.properties.map(p=>`<option value="${esc(p.id)}" ${p.id===c.property?"selected":""}>${esc(p.name)} (${esc(p.account)})</option>`).join("")}</select>`:`<span class="warn">No Google Analytics properties found for this Google account.</span>`}
      <select id="ga4-days" aria-label="Period" style="width:auto">${[28,90,180].map(n=>`<option value="${n}" ${n===(d?.days||GA4_OPT.days)?"selected":""}>Last ${n} days</option>`).join("")}</select>
      <label class="check" style="margin:0"><input type="checkbox" id="ga4-org" ${(d?d.organic:GA4_OPT.organic)?"checked":""}> Organic search only</label>
      ${(c.events||[]).length?`<select id="ga4-ev" aria-label="Which key event counts as a conversion" style="width:auto"><option value="">All key events</option>${c.events.map(e=>`<option value="${esc(e)}" ${e===(c.event||"")?"selected":""}>Only “${esc(e)}”</option>`).join("")}</select>`:""}
      <span class="status" id="ga4-st" role="status">${d?`Updated ${esc(fmtDate(d.at))}.`:""}</span></div>
    ${!d?`<p class="status">${c.property?"Click Refresh to get your landing pages.":"Choose the property for this website."}</p>`:`
    <div class="grid4" style="margin-bottom:6px"><div class="panel kpi"><div><div class="num">${fmtN(d.totals.sessions)}${delta(d.totals.sessions,d.prev_totals?.sessions)}</div><div class="lbl">${d.organic?"sessions from search":"sessions"}</div></div></div>
      <div class="panel kpi"><div><div class="num">${fmtN(Math.round(d.totals.conversions))}${delta(d.totals.conversions,d.prev_totals?.conversions)}</div><div class="lbl">${d.event?`“${esc(d.event)}” events`:"key events (conversions)"}</div></div></div>
      <div class="panel kpi"><div><div class="num">${a.avg_rate?pct(a.avg_rate):"–"}</div><div class="lbl">conversion rate${d.prev_totals?.sessions?` (was ${pct(d.prev_totals.conversions/d.prev_totals.sessions)})`:""}</div></div></div>
      <div class="panel kpi"><div><div class="num">${d.totals.revenue?fmtN(Math.round(d.totals.revenue))+cur:"–"}${d.totals.revenue?delta(d.totals.revenue,d.prev_totals?.revenue):""}</div><div class="lbl">revenue</div></div></div></div>
    <p class="status" style="margin:0 0 10px">Compared with the ${d.days} days before.</p>
    ${!d.totals.conversions?`<p class="warn">No key events recorded in this period. Mark your important actions (sign-ups, purchases, form sends) as key events in Google Analytics to see which pages lead to them.</p>`:""}
    <div class="tw"><table><tr><th>Landing page</th><th>Sessions</th><th>Engaged</th><th>Conversions</th><th>Rate</th>${d.totals.revenue?"<th>Revenue</th>":""}<th>Google clicks</th></tr>
      ${a.pages.slice(0,25).map(p=>`<tr><td><span class="url">${short(p.path)}</span></td><td>${fmtN(p.sessions)}</td><td>${pct(p.engagement)}</td><td>${fmtN(Math.round(p.conversions))}</td><td>${p.sessions?pct(p.rate):"–"}</td>${d.totals.revenue?`<td>${fmtN(Math.round(p.revenue))}</td>`:""}<td>${p.google_clicks==null?"–":fmtN(p.google_clicks)}</td></tr>`).join("")}</table></div>
    ${a.fell.length||a.rose.length?`<div class="grid2" style="margin-top:12px"><div><h3 style="font-size:14px">Conversions fell most</h3>${a.fell.length?`<ul class="clean">${a.fell.map(p=>`<li><span class="url">${short(p.path)}</span> <span class="fail">${Math.round(p.prev_conversions)} → ${Math.round(p.conversions)}</span></li>`).join("")}</ul>`:`<p class="status">None.</p>`}</div>
      <div><h3 style="font-size:14px">Conversions rose most</h3>${a.rose.length?`<ul class="clean">${a.rose.map(p=>`<li><span class="url">${short(p.path)}</span> <span class="pass">${Math.round(p.prev_conversions)} → ${Math.round(p.conversions)}</span></li>`).join("")}</ul>`:`<p class="status">None.</p>`}</div></div>`:""}
    ${(d.ai||[]).length?`<h3 style="font-size:14px;margin-top:12px">Visitors from AI assistants <span class="status" style="font-weight:400">(all traffic, not only search)</span></h3><div class="tw"><table><tr><th>Source</th><th>Sessions</th><th>Before</th><th>Conversions</th></tr>${d.ai.slice(0,10).map(x=>`<tr><td>${esc(x.source)}</td><td>${fmtN(x.sessions)}${delta(x.sessions,x.prev_sessions)}</td><td>${fmtN(x.prev_sessions)}</td><td>${fmtN(Math.round(x.conversions))}</td></tr>`).join("")}</table></div>`:`<p class="status" style="margin-top:12px">No visitors from AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Claude…) in this period.</p>`}
    ${a.promote.length||a.improve.length?`<div class="grid2" style="margin-top:12px">
      <div><h3 style="font-size:14px">Convert well, but few visitors: promote these</h3>${a.promote.length?`<ul class="clean">${a.promote.map(p=>`<li><span class="url">${short(p.path)}</span> <span class="status">${pct(p.rate)} convert (site average ${pct(a.avg_rate)}), ${fmtN(p.sessions)} sessions</span></li>`).join("")}</ul><p class="status">Link to them from popular pages, target more searches with them, and feature them in navigation.</p>`:`<p class="status">None found.</p>`}</div>
      <div><h3 style="font-size:14px">Lots of visitors, few conversions: improve these</h3>${a.improve.length?`<ul class="clean">${a.improve.map(p=>`<li><span class="url">${short(p.path)}</span> <span class="status">${fmtN(p.sessions)} sessions, ${pct(p.rate)} convert</span></li>`).join("")}</ul><p class="status">Check the page matches what searchers want, and add a clear next step (call to action) near the top.</p>`:`<p class="status">None found.</p>`}</div></div>`:""}`}`;
  const rf=$("#ga4-refresh"); if(rf) rf.onclick=()=>busy(rf,$("#ga4-st"),"Getting landing pages from Google Analytics…",async()=>{ GA4_OPT={days:+$("#ga4-days").value,organic:$("#ga4-org").checked}; await GA4.refresh(id,GA4_OPT); await renderGa4(); });
  const ps=$("#ga4-prop"); if(ps) ps.onchange=async()=>{ if(!ps.value) return; await GA4.setProperty(id,ps.value); busy(rf||ps,$("#ga4-st"),"Getting landing pages…",async()=>{ await GA4.refresh(id,GA4_OPT); await renderGa4(); }); };
  const evs=$("#ga4-ev"); if(evs) evs.onchange=async()=>{ await GA4.setEvent(id,evs.value); if(rf) rf.click(); };
  ["#ga4-days","#ga4-org"].forEach(sel=>{ const e=$(sel); if(e) e.onchange=()=>{ if(rf) rf.click(); }; });
  const off=$("#ga4-off"); if(off) off.onclick=async()=>{ if(!confirm("Disconnect Google Analytics for this website?")) return; await GA4.disconnect(id); renderGa4(); };
}

// ---------- editorial calendar ----------
const STAGE_LABEL={idea:"Idea",brief:"Brief",writing:"Writing",review:"Review",approved:"Approved",published:"Published"}, STAGES_UI=Object.keys(STAGE_LABEL);
let CAL_VIEW="board", CAL_MONTH=new Date().toISOString().slice(0,7), CAL_F={owner:"",overdue:false}, CAL_EDIT=null;
const today=()=>new Date().toISOString().slice(0,10);
async function loadCalendar(){
  if(!SITE_ID){ $("#cal-out").innerHTML=`<div class="panel">${emptyBox("Add a website first","The calendar is kept per website.","site","Add a website")}</div>`; bindGo($("#cal-out")); return; }
  const {cards:allCards}=await api(`/api/sites/${SITE_ID}/calendar`), me=(SYNC.syncSettings().name||"").trim();
  const owners=[...new Set(allCards.map(c=>c.owner).filter(Boolean))].sort();
  const cards=allCards.filter(c=>(!CAL_F.owner||(CAL_F.owner==="__me"?c.owner&&me&&c.owner.toLowerCase()===me.toLowerCase():c.owner===CAL_F.owner))&&(!CAL_F.overdue||(c.due&&c.due<today()&&c.stage!=="published")));
  $("#cal-owners").innerHTML=owners.map(o=>`<option value="${esc(o)}">`).join("");
  const filters=`<div class="row" style="margin-bottom:8px"><select id="cal-fo" aria-label="Filter by owner" style="width:auto"><option value="">Everyone</option>${me?`<option value="__me" ${CAL_F.owner==="__me"?"selected":""}>Mine (${esc(me)})</option>`:""}${owners.map(o=>`<option value="${esc(o)}" ${CAL_F.owner===o?"selected":""}>${esc(o)}</option>`).join("")}</select>
    <label class="check" style="margin:0"><input type="checkbox" id="cal-fov" ${CAL_F.overdue?"checked":""}> Overdue only</label><span class="status">${cards.length} of ${allCards.length} cards</span>
    <button class="btn ghost small" id="cal-ics" title="Due dates as a calendar file for Google Calendar, Outlook or Apple Calendar">Download calendar (.ics)</button></div>`;
  document.querySelectorAll("[data-calv]").forEach(b=>{ const on=b.dataset.calv===CAL_VIEW; b.setAttribute("aria-pressed",String(on)); b.classList.toggle("ghost",!on); });
  const card=c=>{ const linked=!!c.content_id, overdue=c.due&&c.due<today()&&c.stage!=="published";
    return `<div class="cal-card" draggable="${linked||READONLY?"false":"true"}" data-cid="${c.id}"><b>${esc(c.title||c.keyword)}</b>${c.title&&c.title.toLowerCase()!==c.keyword?`<div class="meta">${esc(c.keyword)}</div>`:""}
      <div class="meta">${c.owner?`👤 ${esc(c.owner)} `:""}${c.due?`<span class="${overdue?"fail":""}">📅 ${esc(c.due)}${overdue?" (overdue)":""}</span>`:""}${linked?` · <span title="Follows its page's status">linked page</span>`:""}</div>
      ${READONLY?"":`<div class="row" style="gap:4px;margin-top:6px">${linked?`<button class="btn ghost small" data-copen="${c.content_id}">Open page</button>`:`<button class="btn ghost small" data-cbrief="${esc(c.keyword)}">${c.brief_id?"Open brief":"Brief"}</button><button class="btn ghost small" data-cwrite="${c.id}">Write this page</button>
        <select data-cmove="${c.id}" aria-label="Move “${esc(c.title||c.keyword)}” to" style="width:auto;font-size:12px">${STAGES_UI.filter(x=>x!=="published"&&x!=="approved"&&x!=="review").map(x=>`<option value="${x}" ${x===c.stage?"selected":""}>${STAGE_LABEL[x]}</option>`).join("")}</select>`}
        <button class="btn ghost small" data-cedit="${c.id}" aria-label="Owner and due date">✎</button></div>
      ${CAL_EDIT===c.id?`<div style="margin-top:6px"><input data-ceo value="${esc(c.owner||"")}" list="cal-owners" placeholder="Owner" aria-label="Owner" style="width:100%;margin-bottom:4px"><input data-ced type="date" value="${esc(c.due||"")}" aria-label="Due date" style="width:100%;margin-bottom:4px"><div class="row" style="gap:4px"><button class="btn small" data-cesave="${c.id}">Save</button><button class="btn ghost small" data-cecancel>Cancel</button></div></div>`:""}`}</div>`; };
  if(CAL_VIEW==="board"){
    $("#cal-out").innerHTML=`${filters}<div class="cal-board">${STAGES_UI.map(st=>{ const list=cards.filter(c=>c.stage===st).sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999"));
      return `<div class="cal-col" data-stage="${st}"><h3><span>${STAGE_LABEL[st]}</span><span class="status">${list.length}</span></h3>${list.map(card).join("")||`<p class="status" style="margin:4px">Nothing here</p>`}</div>`; }).join("")}</div>
      <p class="status">Drag Idea, Brief and Writing cards between those columns (or use their menu). Cards for written pages move by themselves as the page is reviewed, approved and published.</p>`;
  } else {
    const [y,m]=CAL_MONTH.split("-").map(Number), first=new Date(Date.UTC(y,m-1,1)), days=new Date(Date.UTC(y,m,0)).getUTCDate(), lead=(first.getUTCDay()+6)%7;
    const cells=[...Array(lead).fill(null),...Array.from({length:days},(_,i)=>`${CAL_MONTH}-${String(i+1).padStart(2,"0")}`)];
    const noDue=cards.filter(c=>!c.due&&c.stage!=="published");
    $("#cal-out").innerHTML=`${filters}<div class="panel"><div class="row" style="justify-content:space-between"><button class="btn ghost small" data-cm="-1">‹ Previous</button><b>${first.toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"})}</b><button class="btn ghost small" data-cm="1">Next ›</button></div>
      <div class="cal-month" style="margin-top:8px">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="status" style="text-align:center">${d}</div>`).join("")}
      ${cells.map(d=>d?`<div class="cal-day ${d===today()?"today":""}"><span class="d">${+d.slice(8)}</span>${cards.filter(c=>c.due===d).map(c=>`<span class="cal-chip ${c.due<today()&&c.stage!=="published"?"fail":""}" title="${esc(STAGE_LABEL[c.stage])}: ${esc(c.title||c.keyword)}">${esc(c.title||c.keyword)}</span>`).join("")}</div>`:`<div></div>`).join("")}</div>
      ${noDue.length?`<p class="status" style="margin-top:8px">${noDue.length} card${noDue.length>1?"s have":" has"} no due date (set one with ✎ on the board).</p>`:""}</div>`;
    $("#cal-out").querySelectorAll("[data-cm]").forEach(b=>b.onclick=()=>{ const d=new Date(Date.UTC(y,m-1+(+b.dataset.cm),1)); CAL_MONTH=d.toISOString().slice(0,7); loadCalendar(); });
  }
  const patch=(pid,body)=>api(`/api/sites/${SITE_ID}/plan/${pid}`,{method:"PATCH",body:JSON.stringify(body)});
  $("#cal-out").querySelectorAll("[data-cmove]").forEach(sel=>sel.onchange=async()=>{ await patch(sel.dataset.cmove,{stage:sel.value}); loadCalendar(); });
  $("#cal-out").querySelectorAll("[data-copen]").forEach(b=>b.onclick=()=>openItem(+b.dataset.copen));
  $("#cal-out").querySelectorAll("[data-cbrief]").forEach(b=>b.onclick=()=>briefFor(b.dataset.cbrief,b));
  loadBriefs().catch(()=>{});
  $("#cal-out").querySelectorAll("[data-cwrite]").forEach(b=>b.onclick=async()=>{ const c=cards.find(x=>x.id===+b.dataset.cwrite); await patch(c.id,{stage:"writing"}); prefillWrite(c.keyword,c.intent||"informational"); show("generate"); });
  $("#cal-out").querySelectorAll("[data-cedit]").forEach(b=>b.onclick=()=>{ CAL_EDIT=+b.dataset.cedit; loadCalendar(); });
  $("#cal-out").querySelectorAll("[data-cecancel]").forEach(b=>b.onclick=()=>{ CAL_EDIT=null; loadCalendar(); });
  $("#cal-out").querySelectorAll("[data-cesave]").forEach(b=>b.onclick=async()=>{ const box=b.closest(".cal-card"); try{ await patch(b.dataset.cesave,{owner:box.querySelector("[data-ceo]").value.trim(),due:box.querySelector("[data-ced]").value}); CAL_EDIT=null; loadCalendar(); }catch(e){ toast(e.message,"error"); } });
  { const fo=$("#cal-fo"); if(fo) fo.onchange=()=>{ CAL_F.owner=fo.value; loadCalendar(); }; const fv=$("#cal-fov"); if(fv) fv.onchange=()=>{ CAL_F.overdue=fv.checked; loadCalendar(); };
    const ics=$("#cal-ics"); if(ics) ics.onclick=()=>api(`/api/sites/${SITE_ID}/calendar.ics`).catch(e=>toast(e.message,"error")); }
  // drag and drop between Idea, Brief and Writing
  $("#cal-out").querySelectorAll(".cal-card[draggable=true]").forEach(cd=>cd.addEventListener("dragstart",e=>{ e.dataTransfer.setData("text/plain",cd.dataset.cid); }));
  $("#cal-out").querySelectorAll(".cal-col").forEach(col=>{ const ok=["idea","brief","writing"].includes(col.dataset.stage);
    col.addEventListener("dragover",e=>{ if(ok){ e.preventDefault(); col.classList.add("drop"); } }); col.addEventListener("dragleave",()=>col.classList.remove("drop"));
    col.addEventListener("drop",async e=>{ e.preventDefault(); col.classList.remove("drop"); if(!ok) return; const id=e.dataTransfer.getData("text/plain"); if(id){ await patch(id,{stage:col.dataset.stage}); loadCalendar(); } }); });
}
document.querySelectorAll("[data-calv]").forEach(b=>b.onclick=()=>{ CAL_VIEW=b.dataset.calv; loadCalendar(); });
$("#cal-add").onclick=()=>{ if(!needSite($("#cal-st"))) return; const t=$("#cal-title").value.trim(); if(!t){ $("#cal-st").textContent="Type a title or keyword."; return; }
  busy($("#cal-add"),$("#cal-st"),"Adding…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/plan`,{method:"POST",body:JSON.stringify({items:[{keyword:t,title:t}]})});
    if(!r.added){ $("#cal-st").textContent="That's already on the calendar."; return; }
    const {cards}=await api(`/api/sites/${SITE_ID}/calendar`), c=cards.find(x=>x.keyword===t.toLowerCase());
    if(c&&($("#cal-owner").value||$("#cal-due").value)) await api(`/api/sites/${SITE_ID}/plan/${c.id}`,{method:"PATCH",body:JSON.stringify({owner:$("#cal-owner").value.trim(),due:$("#cal-due").value,stage:"idea"})});
    $("#cal-title").value=""; await loadCalendar(); $("#cal-st").textContent="Added to Idea."; }); };

// ---------- AI-answer readiness (AI answers screen) ----------
async function renderAiReady(){
  const box=$("#air-panel"); if(!box||!SITE_ID) return; const d=await api(`/api/sites/${SITE_ID}/ai-readiness`);
  const head=`<div class="row" style="justify-content:space-between"><h2 style="margin:0">Ready to be cited by AI?</h2>${READONLY?"":`<button class="btn ${d?"ghost ":""}small" id="air-run">${d?"Check again":"Check AI-answer readiness"}</button>`}</div>`;
  if(!d){ box.innerHTML=`${head}<p class="lead" style="margin:6px 0 0">Checks which AI crawlers may read your site, creates an llms.txt for it, and checks your top pages for what AI answers tend to quote: a direct answer, question headings, facts, a date, an author and structured data.</p><span class="status" id="air-st" role="status"></span>`; bindAir(); return; }
  const search=d.bots.filter(b=>b.kind==="search"), train=d.bots.filter(b=>b.kind==="training"), blockedSearch=search.filter(b=>!b.allowed);
  const botRow=b=>`<tr><td><b>${esc(b.agent)}</b> <span class="status">${esc(b.owner)}</span></td><td>${esc(b.note)}</td><td>${b.allowed?`<span class="pass">✓ allowed</span>`:b.partial?`<span class="warn">partly blocked</span><br><span class="status">${b.blocked_paths.map(esc).join(", ")}</span>`:`<span class="fail">✗ blocked</span>`}</td><td class="status">${esc(b.by)}${b.rule?`: ${esc(b.rule)}`:""}</td></tr>`;
  box.innerHTML=`${head}<p class="status" style="margin:4px 0 10px">Checked ${esc(fmtDate(d.at))}. <span id="air-st" role="status"></span></p>
    <div class="grid3" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num ${blockedSearch.length?"fail":"pass"}">${search.length-blockedSearch.length}/${search.length}</div><div class="lbl">answer and search bots allowed</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.llms_found?"pass":"warn"}">${d.llms_found?"Yes":"No"}</div><div class="lbl">llms.txt on your site</div></div></div>
      <div class="panel kpi"><div><div class="num">${d.score??"–"}</div><div class="lbl">page readiness (top ${d.pages.length} pages)</div></div></div></div>
    ${blockedSearch.length?`<div class="verdict update" style="margin-bottom:8px"><b>${blockedSearch.map(b=>esc(b.agent)).join(", ")} ${blockedSearch.length>1?"are":"is"} blocked.</b> These fetch pages to cite them in answers, so blocking them keeps you out of those answers. Check your robots.txt.</div>`:""}
    ${!d.robots_found?`<p class="status">No robots.txt found: every crawler may read the site.</p>`:""}
    <details ${blockedSearch.length?"open":""}><summary><b>AI crawlers</b> (answer and search bots first; blocking training bots is a business choice and doesn't stop citations)</summary>
      <div class="tw"><table><tr><th>Crawler</th><th>Used for</th><th>Your robots.txt</th><th>Why</th></tr>${search.map(botRow).join("")}<tr><td colspan="4" class="status"><b>Training bots</b></td></tr>${train.map(botRow).join("")}</table></div></details>
    ${d.llms_compare&&(d.llms_compare.missing.length||(d.llms_compare.broken||[]).length)?`<div class="verdict related" style="margin:8px 0"><b>Your llms.txt could be updated:</b> ${d.llms_compare.missing.length?`${d.llms_compare.missing.length>=20?"20 or more":d.llms_compare.missing.length} of your top pages ${d.llms_compare.missing.length>1?"are":"is"} missing from it`:""}${d.llms_compare.missing.length&&(d.llms_compare.broken||[]).length?"; ":""}${(d.llms_compare.broken||[]).length?`<b class="fail">${d.llms_compare.broken.length} link${d.llms_compare.broken.length>1?"s are":" is"} broken</b>`:""}.
      <details><summary class="status">Show them</summary>${d.llms_compare.missing.length?`<p class="status" style="margin:4px 0"><b>Missing:</b> ${d.llms_compare.missing.map(u=>esc(u.replace(/^https?:\/\/[^/]+/,"")||"/")).join(", ")}</p>`:""}${(d.llms_compare.broken||[]).length?`<p class="status" style="margin:4px 0"><b>Broken:</b> ${d.llms_compare.broken.map(b=>`${esc(b.url.replace(/^https?:\/\/[^/]+/,"")||"/")} (${b.status||"no answer"})`).join(", ")}</p>`:""}</details></div>`:""}
    ${(d.history||[]).length>1?`<p class="status">Readiness over time: ${d.history.slice(-8).map(h=>`<b>${h.score??"–"}</b> <span style="font-size:11px">(${esc(fmtDate(h.at).split(",")[0])})</span>`).join(" → ")}</p>`:""}
    <details style="margin-top:8px"><summary><b>llms.txt</b> ${d.llms_found?"(you have one; compare it with a fresh version)":"(you don't have one yet)"}</summary>
      <p class="status">A short Markdown file at <code>/llms.txt</code> that summarises your site and lists its key pages for AI tools (llmstxt.org). Download it, check the wording, and upload it to your website's root folder.</p>
      <div class="row" style="margin:6px 0"><button class="btn ghost small" id="air-dl">Download llms.txt</button><button class="btn ghost small" id="air-copy">Copy</button></div>
      <pre class="code" style="white-space:pre-wrap;max-height:300px;overflow:auto">${esc(d.llms_generated)}</pre></details>
    <h3 style="font-size:15px;margin-top:14px">Your top pages</h3>
    <div class="tw"><table><tr><th>Page</th><th>Score</th><th>To improve</th></tr>${d.pages.map(p=>`<tr><td><span class="url">${esc(p.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span>${p.clicks?`<br><span class="status">${fmtN(p.clicks)} Google clicks</span>`:""}</td><td><b class="${p.score>=70?"pass":p.score>=45?"warn":"fail"}">${p.score}</b></td>
      <td>${p.checks.filter(c=>!c.ok).map(c=>`<details><summary>${esc(c.label)}</summary><span class="status">${esc(c.fix)}</span></details>`).join("")||`<span class="pass">All good</span>`}
        ${p.checks.some(c=>!c.ok&&["answer","questions","facts"].includes(c.id))&&!READONLY?`<button class="btn ghost small" data-airfix="${esc(p.url)}" style="margin-top:4px">Suggest fixes</button>`:""}
        ${p.fixes?`<div class="ans" style="margin-top:6px">${p.fixes.answer_opening?`<p style="margin:2px 0"><b>Open with:</b> ${esc(p.fixes.answer_opening)}</p>`:""}${(p.fixes.question_headings||[]).length?`<p style="margin:2px 0"><b>Headings as questions:</b> ${p.fixes.question_headings.map(h=>`“${esc(h.from)}” → “${esc(h.to)}”`).join("; ")}</p>`:""}${(p.fixes.facts_to_add||[]).length?`<p style="margin:2px 0"><b>Facts to state clearly:</b> ${p.fixes.facts_to_add.map(esc).join("; ")}</p>`:""}</div>`:""}</td></tr>`).join("")}</table></div>`;
  bindAir(d);
}
function bindAir(d){
  const run=$("#air-run"); if(run) run.onclick=()=>{ if(!needSite($("#air-st"))) return; busy(run,$("#air-st"),"Checking…",async()=>{ await api(`/api/sites/${SITE_ID}/ai-readiness`,{method:"POST",body:"{}",onProgress:t=>{ const e=$("#air-st"); if(e) e.textContent=t; }}); await renderAiReady(); }); };
  if(!d) return;
  document.querySelectorAll("#air-panel [data-airfix]").forEach(b=>b.onclick=()=>{ if(!needAI($("#air-st"))) return; busy(b,$("#air-st"),"Reading the page and writing suggestions…",async()=>{ await api(`/api/sites/${SITE_ID}/ai-readiness/fixes`,{method:"POST",body:JSON.stringify({url:b.dataset.airfix})}); await renderAiReady(); }); });
  $("#air-dl").onclick=()=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([d.llms_generated],{type:"application/octet-stream"})); a.download="llms.txt"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
  $("#air-copy").onclick=async()=>{ try{ await navigator.clipboard.writeText(d.llms_generated); $("#air-copy").textContent="Copied"; }catch{} };
}

// ---------- annotations box (under the Google search chart) ----------
const NOTE_KIND={note:"Note",published:"Published",refreshed:"Refreshed",competitor:"Competitor",migration:"Migration"};
async function renderNotesBox(){
  const box=document.querySelector("[data-notes-box]"); if(!box||!SITE_ID) return; await loadAnn(); const list=ANN_ALL, me=(SYNC.syncSettings().name||"").trim(), kinds=annShown();
  box.innerHTML=`<details style="margin-top:6px" ${list.length?"":"open"}><summary class="status"><b>Notes on the chart</b> (${list.length}): what happened when, so changes can be explained</summary>
    <div class="row" style="margin:8px 0 0">${Object.keys(NOTE_KIND).map(k=>`<label class="check" style="margin:0 10px 0 0"><input type="checkbox" data-ntk="${k}" ${kinds[k]?"checked":""}> <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${NOTE_COLOR[k]}"></span> ${NOTE_KIND[k]}</label>`).join("")}</div>
    <p class="status" style="margin:4px 0">Tip: click the chart to add a note on that day.</p>
    ${READONLY?"":`<div class="row" style="margin:8px 0"><input type="date" id="nt-date" aria-label="Date" style="width:auto" value="${new Date().toISOString().slice(0,10)}"><input id="nt-text" placeholder="What happened, e.g. redesigned the pricing page" aria-label="What happened" style="flex:1;min-width:240px"><button class="btn small" id="nt-add">Add note</button><span class="status" id="nt-st" role="status"></span></div>`}
    ${list.length?`<div class="tw"><table><tr><th>Date</th><th>What</th><th>Google clicks after (14 days)</th><th>Type</th><th><span class="sr-only">Actions</span></th></tr>${[...list].reverse().slice(0,40).map(n=>`<tr><td>${esc(n.date)}</td><td>${esc(n.text)}${n.by?` <span class="status">(${esc(n.by)})</span>`:""}</td><td>${n.impact==null?`<span class="status">–</span>`:`<b class="${n.impact>=0?"pass":"fail"}">${n.impact>=0?"+":""}${n.impact}%</b>`}</td><td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${NOTE_COLOR[n.kind]||"var(--c6)"};margin-right:4px"></span>${esc(NOTE_KIND[n.kind]||n.kind)}${n.kind==="note"?"":` <span class="status">(automatic)</span>`}</td><td>${n.kind==="note"&&!READONLY?`<button class="btn ghost small" data-ntdel="${n.id}">Delete</button>`:""}</td></tr>`).join("")}</table></div>`:`<p class="status">No notes yet. Pages you publish or refresh, competitor publishing bursts and site migrations are added automatically.</p>`}</details>`;
  const add=$("#nt-add"); if(add) add.onclick=()=>busy(add,$("#nt-st"),"Adding…",async()=>{ await api(`/api/sites/${SITE_ID}/notes`,{method:"POST",body:JSON.stringify({date:$("#nt-date").value,text:$("#nt-text").value,by:me})}); await loadGsc(); });
  box.querySelectorAll("[data-ntk]").forEach(c=>c.onchange=()=>{ const k=annShown(); k[c.dataset.ntk]=c.checked?1:0; localStorage.setItem("ce-ann-kinds",JSON.stringify(k)); loadGsc(); });
  // click the Google search chart to add a note on that day
  const svg=document.querySelector("section[data-view=gsc] .line-chart svg"), pts=(window._gscDaily||[]);
  if(svg&&pts.length>1&&!READONLY) { svg.style.cursor="crosshair"; svg.onclick=e=>{ const r=svg.getBoundingClientRect(), W=760,L=44,Rp=10, x=(e.clientX-r.left)/r.width*W, i=Math.max(0,Math.min(pts.length-1,Math.round((x-L)/(W-L-Rp)*(pts.length-1))));
    box.querySelector("details").open=true; $("#nt-date").value=pts[i]; $("#nt-text").focus(); $("#nt-st").textContent=`Adding a note for ${pts[i]}.`; }; }
  box.querySelectorAll("[data-ntdel]").forEach(b=>b.onclick=async()=>{ await api(`/api/sites/${SITE_ID}/notes/${b.dataset.ntdel}`,{method:"DELETE"}); await loadGsc(); });
}

// ---------- daily rank tracking (Performance → Rankings) ----------
let RK_OPEN=null;
const rkSpark=(pts,w=110,h=28)=>{ const v=pts.filter(p=>p.pos!=null); if(v.length<2) return `<span class="status">–</span>`; const max=Math.max(...v.map(p=>p.pos),10), x0=Date.parse(pts[0].d), span=Math.max(1,Date.parse(pts[pts.length-1].d)-x0);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Position over 90 days"><polyline points="${v.map(p=>`${((Date.parse(p.d)-x0)/span*(w-2)+1).toFixed(1)},${(2+(p.pos-1)/(max-1||1)*(h-4)).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--c1)" stroke-width="1.6"/></svg>`; };
const rkChg=c=>c==null?"–":c===0?"0":`<span class="${c>0?"pass":"fail"}">${c>0?"▲":"▼"} ${Math.abs(c)}</span>`;
async function loadRanks(force=false){ await loadAnn();
  const box=$("#rk-out"); if(!SITE_ID) return; const id=SITE_ID, conn=await GSCC.get(id);
  if(!conn||!conn.property){ box.innerHTML=`<div class="panel">${emptyBox("Connect Search Console","Daily positions come from your Search Console connection (zip exports don't include daily data per search).")}<p style="margin:0"><button class="btn" data-rkconn>Connect under Import &amp; connect</button></p></div>`; box.querySelector("[data-rkconn]").onclick=()=>gsTab("import"); return; }
  let snap=await RANKS.get(id);
  const topOn=localStorage.getItem(`ce-rk-top:${id}`)==="1";
  let kws=(await api(`/api/sites/${id}/keywords`).catch(()=>[])).map(k=>k.keyword);
  if(topOn){ const g=(await (await import("./store.js")).get(`gsc:${id}`,[]))?.[0]?.rows||[]; kws=[...new Set([...kws,...g.filter(r=>r.kind==="query"&&r.query).sort((a,b)=>(b.impressions||0)-(a.impressions||0)).slice(0,50).map(r=>r.query.toLowerCase())])]; }
  if(!READONLY&&(force||!snap||Date.now()-snap.at>864e5||kws.some(k=>!snap.keywords.includes(k)))){
    box.innerHTML=`<p class="status spin">Getting daily positions from Search Console…</p>`;
    snap=await RANKS.refresh(id,kws,(dims,from,to,re)=>GSCC.queryRange(id,dims,from,to,{queryRegex:re,rowLimit:25000}).then(rows=>rows.map(r=>({keys:r.keys,clicks:r.clicks,impressions:r.impressions,position:r.position})))); }
  if(!snap){ box.innerHTML=`<p class="status">No ranking data yet.</p>`; return; }
  const rows=RANKS.table(snap), mv=RANKS.movers(rows), short=u=>esc(String(u||"").replace(/^https?:\/\/[^/]+/,"")||"/"), ranked=rows.filter(r=>r.pos!=null);
  box.innerHTML=`<div class="panel"><div class="row" style="justify-content:space-between"><p class="lead" style="margin:0">Average Google position per keyword, day by day, from Search Console (${esc(snap.from)} to ${esc(snap.to)}; the newest days arrive about 3 days late).</p><span class="row">${READONLY?"":`<button class="btn ghost small" id="rk-refresh">Refresh</button>`}<button class="btn ghost small" id="rk-csv">Download CSV</button></span></div>
    <label class="check" style="margin:6px 0 0"><input type="checkbox" id="rk-top" ${topOn?"checked":""}> Also track my 50 most-shown Google searches (from Search Console), not only my keywords</label>
    ${(()=>{ const bd=RANKS.bands(snap); if(bd.length<2) return ""; const mx=Math.max(...bd.map(w=>w.top3+w.top10+w.top20+w.beyond),1), C=[["top3","var(--good)","Top 3"],["top10","var(--c1)","4–10"],["top20","var(--c3)","11–20"],["beyond","var(--c5)","21+"]];
      return `<h3 style="font-size:14px;margin:12px 0 4px">Keywords by position band, week by week</h3><div class="row" style="align-items:flex-end;gap:4px;height:110px" aria-label="Keywords per position band by week">${bd.map(w=>`<div style="flex:1;max-width:44px;display:flex;flex-direction:column-reverse;height:90px" title="Week to ${esc(w.week)}: ${w.top3} in top 3, ${w.top10} in 4–10, ${w.top20} in 11–20, ${w.beyond} beyond">${C.map(([k,c])=>`<div style="background:${c};height:${(w[k]/mx*88).toFixed(1)}px"></div>`).join("")}</div>`).join("")}</div>
        <p class="status" style="margin:2px 0 0">${C.map(([,c,l])=>`<span style="display:inline-block;width:10px;height:10px;background:${c};margin:0 4px 0 10px"></span>${l}`).join("")} · latest week: ${bd[bd.length-1].top3} in the top 3, ${bd[bd.length-1].top10} in 4–10</p>`; })()}
    <p class="status">${ranked.length} of ${rows.length} keywords appeared in Google in the last 90 days. Updated ${esc(fmtDate(snap.at))}.</p>
    ${mv.up.length||mv.down.length?`<div class="grid2"><div><h3 style="font-size:14px">Moved up this week</h3>${mv.up.map(r=>`<div>${esc(r.keyword)} ${rkChg(r.change7)} <span class="status">now ${r.pos}</span></div>`).join("")||`<p class="status">None</p>`}</div>
      <div><h3 style="font-size:14px">Moved down this week</h3>${mv.down.map(r=>`<div>${esc(r.keyword)} ${rkChg(r.change7)} <span class="status">now ${r.pos}</span></div>`).join("")||`<p class="status">None</p>`}</div></div>`:""}
    <div class="tw" style="margin-top:10px"><table><tr><th>Keyword</th><th>Position (7 days)</th><th>Change 7 days</th><th>Change 28 days</th><th>90 days</th><th>Clicks (28 days)</th><th>Ranking page</th></tr>
      ${rows.map((r,i)=>`<tr data-rk="${i}" style="cursor:pointer"><td><b>${esc(r.keyword)}</b></td><td>${r.pos??`<span class="status">not in Google</span>`}</td><td>${rkChg(r.change7)}</td><td>${rkChg(r.change28)}</td><td>${rkSpark(r.points)}</td><td>${fmtN(r.clicks28)}</td>
        <td><span class="url">${short(r.page)}</span>${r.competing?`<br><span class="pill warn" title="${esc(r.competing.join(", "))}">${r.competing.length} pages compete</span>`:""}</td></tr>`).join("")}</table></div>
    <p class="status">Positions are averages weighted by how often each page appeared, as Search Console reports them; a change of ▲ 2 means two places higher. Click a keyword for its chart.</p></div><div id="rk-detail"></div>`;
  const rf=$("#rk-refresh"); if(rf) rf.onclick=()=>loadRanks(true);
  $("#rk-top").onchange=e=>{ localStorage.setItem(`ce-rk-top:${id}`,e.target.checked?"1":"0"); loadRanks(true); };
  $("#rk-csv").onclick=()=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([RANKS.toCsv(rows)],{type:"application/octet-stream"})); a.download="rankings.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
  box.querySelectorAll("[data-rk]").forEach(tr=>tr.onclick=()=>{ RK_OPEN=rows[+tr.dataset.rk]; rkDetail(RK_OPEN,snap); });
  if(RK_OPEN){ const again=rows.find(r=>r.keyword===RK_OPEN.keyword); if(again) rkDetail(again,snap); }
}
function rkDetail(r,snap){
  const W=720,H=220,P=34, pts=r.points.filter(p=>p.pos!=null), box=$("#rk-detail"); if(!box) return;
  if(pts.length<2){ box.innerHTML=`<div class="panel"><h2>${esc(r.keyword)}</h2><p class="status">Not enough days in Google to draw a chart.</p></div>`; return; }
  const max=Math.max(...pts.map(p=>p.pos),10), x0=Date.parse(snap.from), span=Date.parse(snap.to)-x0, X=d=>P+(Date.parse(d)-x0)/span*(W-P-10), Y=v=>10+(v-1)/(max-1)*(H-34);
  const pages=[...new Set(pts.map(p=>p.page))], col=pg=>SEC_COLORS[pages.indexOf(pg)%SEC_COLORS.length], ticks=[1,3,10,20,50].filter(t=>t<=max);
  box.innerHTML=`<div class="panel"><h2 style="margin-top:0">${esc(r.keyword)} <span class="status" style="font-weight:400">· now ${r.pos??"–"} · ${rkChg(r.change28)} in 28 days</span></h2>
    <div class="tw"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="Daily position for ${esc(r.keyword)}">
      ${ticks.map(t=>`<line x1="${P}" x2="${W-10}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${P-6}" y="${Y(t)+4}" font-size="11" text-anchor="end" fill="var(--muted)">${t}</text>`).join("")}
      <polyline points="${pts.map(p=>`${X(p.d).toFixed(1)},${Y(p.pos).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--line)" stroke-width="1.5"/>
      ${(ANN||[]).filter(n=>n.date>=snap.from&&n.date<=snap.to).map(n=>`<g><line x1="${X(n.date).toFixed(1)}" x2="${X(n.date).toFixed(1)}" y1="6" y2="${H-24}" stroke="${NOTE_COLOR[n.kind]||"var(--c6)"}" stroke-dasharray="2 3"/><circle cx="${X(n.date).toFixed(1)}" cy="6" r="4.5" fill="${NOTE_COLOR[n.kind]||"var(--c6)"}"/><title>${esc(n.date)}: ${esc(n.text)}</title></g>`).join("")}
      ${pts.map(p=>`<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.pos).toFixed(1)}" r="2.6" fill="${col(p.page)}"><title>${esc(p.d)}: position ${p.pos}, ${p.clicks} clicks (${esc(p.page.replace(/^https?:\/\/[^/]+/,"")||"/")})</title></circle>`).join("")}
      <text x="${P}" y="${H-4}" font-size="11" fill="var(--muted)">${esc(snap.from)}</text><text x="${W-10}" y="${H-4}" font-size="11" fill="var(--muted)" text-anchor="end">${esc(snap.to)}</text></svg></div>
    <p class="status">Higher on the chart = higher in Google. Dot colour = the page that ranked that day: ${pages.map(pg=>`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${col(pg)};margin:0 4px 0 8px"></span>${esc(pg.replace(/^https?:\/\/[^/]+/,"")||"/")}`).join("")}${r.competing?` · <b class="warn">These pages take turns ranking: consider merging them or making one clearly the main page.</b>`:""}</p></div>`;
  box.scrollIntoView({behavior:"smooth",block:"start"});
}

// ---------- content briefs ----------
let BRIEF_OPEN=null;
async function briefFor(keyword,btn){ const list=await api(`/api/sites/${SITE_ID}/briefs`), have=list.find(b=>b.keyword===keyword.toLowerCase().trim());
  if(have){ BRIEF_OPEN=have.id; show("calendar"); await loadCalendar(); $("#cal-briefs").scrollIntoView({behavior:"smooth",block:"start"}); return; }
  const st=$("#cal-st"); if(!needAI(st)){ show("calendar"); return; }
  await busy(btn,st,"Creating the brief…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/briefs`,{method:"POST",body:JSON.stringify({keyword}),onProgress:t=>{ if(st) st.textContent=t; }}); BRIEF_OPEN=r.id; show("calendar"); await loadCalendar(); $("#cal-briefs").scrollIntoView({behavior:"smooth",block:"start"}); toast("Brief ready. The calendar card moved to Brief."); }); }
async function loadBriefs(){
  const box=$("#cal-briefs"); if(!box||!SITE_ID) return; const list=await api(`/api/sites/${SITE_ID}/briefs`);
  if(!list.length){ box.innerHTML=`<h2>Briefs</h2><p class="status" style="margin:0">Create a brief from a card (Brief) or a keyword, to hand a page to a writer with everything they need.</p>`; return; }
  if(!BRIEF_OPEN||!list.some(b=>b.id===BRIEF_OPEN)) BRIEF_OPEN=list[0].id;
  const md=await api(`/api/sites/${SITE_ID}/briefs/${BRIEF_OPEN}/md`), cur=md.brief;
  box.innerHTML=`<div class="row" style="justify-content:space-between"><h2 style="margin:0">Briefs</h2><select id="br-pick" aria-label="Open a brief" style="width:auto">${list.map(b=>`<option value="${b.id}" ${b.id===BRIEF_OPEN?"selected":""}>${esc(b.keyword)} · ${esc(fmtDate(b.created_at))}</option>`).join("")}</select></div>
    <p class="status">Built from: ${[cur.sources.ranking&&"what currently ranks",cur.sources.wikipedia&&"Wikipedia subtopics",cur.sources.questions&&`${cur.sources.questions} real questions`,cur.sources.searches&&`${cur.sources.searches} related searches`,cur.sources.knowledge&&"your knowledge base"].filter(Boolean).join(", ")||"the keyword and your website"}.</p>
    ${md.owner||md.due?`<p class="status" style="margin:0">From the calendar card: ${md.owner?`writer <b>${esc(md.owner)}</b>`:""}${md.owner&&md.due?", ":""}${md.due?`due <b>${esc(md.due)}</b>`:""}.</p>`:""}
    <div class="row" style="margin:8px 0"><button class="btn ghost small" id="br-copy">Copy</button><button class="btn ghost small" id="br-dl">Download (.md)</button>${READONLY?"":`<button class="btn ghost small" id="br-share">Share link for the writer</button><button class="btn ghost small" id="br-edit">Edit</button><button class="btn small" id="br-write">Write a page from this brief</button><button class="btn ghost small" id="br-del">Delete</button>`}<span class="status" id="br-st" role="status"></span></div>
    <div id="br-body"><div class="preview" style="border:1px solid var(--line);border-radius:10px;padding:14px;max-height:560px;overflow:auto">${mdToHtmlSafe(md.markdown)}</div></div>${cur.edited_md?`<p class="status">Edited by your team.</p>`:""}`;
  $("#br-pick").onchange=e=>{ BRIEF_OPEN=+e.target.value; loadBriefs(); };
  $("#br-copy").onclick=async()=>{ try{ await navigator.clipboard.writeText(md.markdown); $("#br-copy").textContent="Copied"; }catch{} };
  $("#br-dl").onclick=()=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([md.markdown],{type:"application/octet-stream"})); a.download=`brief-${cur.keyword.replace(/[^a-z0-9]+/gi,"-").slice(0,60)}.md`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
  const w=$("#br-write"); if(w) w.onclick=()=>{ prefillWrite(cur.keyword,cur.intent); show("generate"); const t=$("#g-type"); if(t&&[...t.options].some(o=>o.value===cur.page_type)) t.value=cur.page_type; $("#g-notes").value=md.markdown.slice(0,6000); toast("The brief is in the notes. Check the details and write the page."); };
  const ed=$("#br-edit"); if(ed) ed.onclick=()=>{ $("#br-body").innerHTML=`<textarea id="br-ta" style="width:100%;min-height:420px;font-family:ui-monospace,monospace;font-size:13px">${esc(md.markdown)}</textarea><div class="row" style="margin-top:6px"><button class="btn small" id="br-save">Save</button><button class="btn ghost small" id="br-cancel">Cancel</button></div>`;
    $("#br-save").onclick=async()=>{ await api(`/api/sites/${SITE_ID}/briefs/${cur.id}`,{method:"PATCH",body:JSON.stringify({markdown:$("#br-ta").value})}); loadBriefs(); toast("Brief saved."); }; $("#br-cancel").onclick=()=>loadBriefs(); };
  const sh=$("#br-share"); if(sh) sh.onclick=()=>busy(sh,$("#br-st"),"Creating the link…",async()=>{
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Brief: ${esc(cur.keyword)}</title><style>body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111827}h1{font-size:26px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}h3{font-size:16px;margin-bottom:2px}li{margin:4px 0}</style></head><body>${mdToHtmlSafe(md.markdown)}</body></html>`;
    const r=await fetch("/api/report",{method:"POST",credentials:"same-origin",headers:shareHeaders(),body:JSON.stringify({html,title:`Brief: ${cur.keyword}`,days:60})}); const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(r.status===404?"Share links need the latest deploy.":d.error||`Couldn't create the link (${r.status})`);
    const url=location.origin+d.url; $("#br-st").innerHTML=`Link (valid 60 days, revocable in Reports): <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`; try{ await navigator.clipboard.writeText(url); toast("Link copied."); }catch{} });
  const del=$("#br-del"); if(del) del.onclick=async()=>{ if(!confirm("Delete this brief?")) return; await api(`/api/sites/${SITE_ID}/briefs/${cur.id}`,{method:"DELETE"}); BRIEF_OPEN=null; loadBriefs(); };
}

// ---------- comments, suggestions and approval steps (My pages) ----------
const myName=()=>((AUTH.state().user||{}).name||SYNC.syncSettings().name||localStorage.getItem("ce-reviewer")||"").trim();
// tell the chat channel when someone is @mentioned
function mentionAlert(item,by,text){ const m=[...String(text||"").matchAll(/@([\p{L}][\p{L}.'-]*)/gu)].map(x=>x[1]); if(m.length) chatEvent("approval",`${by} mentioned ${m.map(x=>"@"+x).join(", ")} on “${item.title||item.keyword}”`,[String(text).slice(0,280)]); }
async function renderCollab(item,el){
  const box=el.querySelector("[data-review-panel]"); if(!box||!SITE_ID) return;
  const [wf,list]=await Promise.all([api(`/api/sites/${SITE_ID}/workflow`),api(`/api/sites/${SITE_ID}/contents/${item.id}/comments`)]);
  const blocks=TD.blocks(item.payload.body_markdown||""), keyOf=b=>{ let h=2166136261; const x=String(b||"").replace(/\s+/g," ").trim(); for(let i=0;i<x.length;i++){ h^=x.charCodeAt(i); h=Math.imul(h,16777619)>>>0; } return h.toString(36); };
  const keys=blocks.map(keyOf), threads=list.filter(c=>!c.parent), replies=p=>list.filter(c=>c.parent===p.id).sort((a,b)=>a.at-b.at), open=threads.filter(t=>!t.resolved);
  const signed=new Map((item.signoffs||[]).map(x=>[x.step,x])), next=wf.steps.find(st=>!signed.has(st.name)), me=myName();
  const wd=(a,b)=>TD.words(a,b).map(([op,t])=>op==="="?esc(t):op==="-"?`<del style="background:#fde2e1;color:#9b1c1c">${esc(t)}</del>`:`<ins style="background:#dcfce7;color:#14532d;text-decoration:none">${esc(t)}</ins>`).join("");
  const thread=t=>`<div class="ans" style="margin:6px 0 6px 14px;${t.resolved?"opacity:.6":""}"><div class="row" style="justify-content:space-between"><span><b>${esc(t.by)}</b> <span class="status">${esc(fmtDate(t.at))}${t.kind==="suggestion"?" · suggested a change":""}${t.resolved?` · ${t.status&&t.status!=="open"?esc(t.status):"resolved"}`:""}</span></span>
      ${READONLY?"":`<span class="row" style="gap:4px">${t.kind==="suggestion"&&t.status==="open"?`<button class="btn small" data-cdec="${t.id}:1">✓ Accept</button><button class="btn ghost small" data-cdec="${t.id}:0">✕ Reject</button>`:`<button class="btn ghost small" data-cres="${t.id}:${t.resolved?0:1}">${t.resolved?"Reopen":"Resolve"}</button>`}</span>`}</div>
    ${t.kind==="suggestion"?`<p style="margin:4px 0">${wd(t.suggestion.from,t.suggestion.to)}</p>`:""}${t.text?`<p style="margin:4px 0">${esc(t.text)}</p>`:""}
    ${replies(t).map(r=>`<p style="margin:4px 0 4px 12px"><b>${esc(r.by)}</b> <span class="status">${esc(fmtDate(r.at))}</span><br>${esc(r.text)}</p>`).join("")}
    ${READONLY||t.resolved?"":`<div class="row" style="margin-top:4px"><input data-crep-in="${t.id}" placeholder="Reply" aria-label="Reply" style="flex:1"><button class="btn ghost small" data-crep="${t.id}">Reply</button></div>`}</div>`;
  const orphans=threads.filter(t=>t.block_key&&!keys.includes(t.block_key));
  box.innerHTML=`<div class="approve-box" style="margin-bottom:10px">
    <div class="row" style="justify-content:space-between"><b>Approval steps</b>${READONLY?"":`<button class="linkbtn" data-wfedit>${wf.steps.length?"Edit steps":"Add approval steps"}</button>`}</div>
    ${wf.steps.length?`<div class="row" style="margin:6px 0;gap:6px">${wf.steps.map((st,k)=>{ const so=signed.get(st.name); return `<span class="pill ${so?"pass":st===next?"warn":""}">${k+1}. ${esc(st.name)}${st.who&&!so?` (${esc(st.who)})`:""}${so?` ✓ ${esc(so.by)}, ${esc(fmtDate(so.at).split(",")[0])}`:st===next?" (next)":""}</span>`; }).join("<span>→</span>")}</div>
      ${next&&!READONLY?`<div class="row"><input data-so-name value="${esc(me)}" placeholder="Your name" aria-label="Your name" style="width:180px"><input data-so-note placeholder="Note (optional)" aria-label="Note" style="flex:1;min-width:160px"><button class="btn small" data-so>Sign off as ${esc(next.name)}</button><span class="status" data-so-st role="status"></span></div>`:!next?`<p class="pass" style="margin:4px 0">Every step is signed off. The page can be approved.</p>`:""}
      ${item.signoffs_cleared&&!(item.signoffs||[]).length?`<p class="status" style="margin:4px 0">Earlier sign-offs were cleared on ${esc(fmtDate(item.signoffs_cleared.at))} because the page was edited.</p>`:""}`
      :`<p class="status" style="margin:4px 0">No approval steps. Add steps such as Expert, Legal, Marketing: each signs off in order before the page can be approved.</p>`}
    <div data-wfbox></div></div>
    <details ${open.length?"open":""}><summary><b>Comments and suggestions</b> (${open.length} open${threads.length>open.length?`, ${threads.length-open.length} resolved`:""}): click Comment or Suggest on any paragraph</summary>
      ${blocks.map((b,k)=>{ const ts=threads.filter(t=>t.block_key===keys[k]); return `<div style="border-left:3px solid ${ts.some(t=>!t.resolved)?"var(--c6)":"var(--line)"};padding:4px 8px;margin:6px 0"><div class="row" style="justify-content:space-between;align-items:flex-start"><span style="flex:1;${/^#/.test(b)?"font-weight:600":""}">${esc(b.replace(/^#+\s*/,"").slice(0,260))}${b.length>260?"…":""}</span>
        ${READONLY?"":`<span class="row" style="gap:4px"><button class="btn ghost small" data-cnew="${k}:c">Comment</button><button class="btn ghost small" data-cnew="${k}:s">Suggest</button></span>`}</div><div data-cform="${k}"></div>${ts.map(thread).join("")}</div>`; }).join("")}
      ${orphans.length?`<h4 style="margin:12px 0 4px">On text that has since changed</h4>${orphans.map(t=>`<p class="status" style="margin:2px 0 0 14px">“${esc(t.quote)}”</p>${thread(t)}`).join("")}`:""}</details>`;
  const reload=()=>renderCollab(item,el), post=(u,b)=>api(`/api/sites/${SITE_ID}/${u}`,{method:"POST",body:JSON.stringify(b)});
  box.querySelectorAll("[data-cnew]").forEach(b=>b.onclick=()=>{ const [k,kind]=b.dataset.cnew.split(":"), f=box.querySelector(`[data-cform="${k}"]`);
    f.innerHTML=`<div style="margin:6px 0 6px 14px"><textarea data-cf-text style="width:100%;min-height:${kind==="s"?110:60}px" aria-label="${kind==="s"?"Suggested wording":"Comment"}" placeholder="${kind==="s"?"Your suggested wording for this paragraph":"Your comment"}">${kind==="s"?esc(blocks[+k]):""}</textarea>${kind==="s"?`<input data-cf-why placeholder="Why (optional)" style="width:100%;margin-top:4px">`:""}
      <div class="row" style="margin-top:4px"><input data-cf-by value="${esc(me)}" placeholder="Your name" aria-label="Your name" style="width:160px"><button class="btn small" data-cf-save>${kind==="s"?"Suggest":"Comment"}</button><button class="btn ghost small" data-cf-cancel>Cancel</button><span class="status" data-cf-st role="status"></span></div></div>`;
    f.querySelector("[data-cf-cancel]").onclick=()=>{ f.innerHTML=""; };
    f.querySelector("[data-cf-save]").onclick=async()=>{ const by=f.querySelector("[data-cf-by]").value.trim(), txt=f.querySelector("[data-cf-text]").value; localStorage.setItem("ce-reviewer",by);
      try{ await post(`contents/${item.id}/comments`,kind==="s"?{block:blocks[+k],suggestion:txt,text:f.querySelector("[data-cf-why]").value,by}:{block:blocks[+k],text:txt,by}); mentionAlert(item,by,kind==="s"?f.querySelector("[data-cf-why]").value:txt); reload(); }catch(e){ f.querySelector("[data-cf-st]").textContent=e.message; } }; });
  box.querySelectorAll("[data-crep]").forEach(b=>b.onclick=async()=>{ const t=box.querySelector(`[data-crep-in="${b.dataset.crep}"]`).value; if(!t.trim()) return; const by=myName()||prompt("Your name")||""; try{ await post(`contents/${item.id}/comments`,{parent:+b.dataset.crep,text:t,by}); mentionAlert(item,by,t); reload(); }catch(e){ toast(e.message,"error"); } });
  box.querySelectorAll("[data-cres]").forEach(b=>b.onclick=async()=>{ const [id,v]=b.dataset.cres.split(":"); await post(`comments/${id}/resolve`,{resolved:v==="1"}); reload(); });
  box.querySelectorAll("[data-cdec]").forEach(b=>b.onclick=async()=>{ const [id,v]=b.dataset.cdec.split(":"); try{ await post(`comments/${id}/decide`,{accept:v==="1",by:myName()}); if(v==="1"){ await openItem(item.id); toast("Suggestion accepted: the paragraph was changed and the page checked again."); } else reload(); }catch(e){ toast(e.message,"error"); } });
  const so=box.querySelector("[data-so]"); if(so) so.onclick=async()=>{ const by=box.querySelector("[data-so-name]").value.trim(); localStorage.setItem("ce-reviewer",by);
    try{ await post(`contents/${item.id}/signoff`,{step:next.name,by,note:box.querySelector("[data-so-note]").value});
      const after=wf.steps[wf.steps.indexOf(next)+1]; chatEvent("approval",`${by} signed off “${item.title||item.keyword}” (${next.name})`,[after?`Next: ${after.name}${after.who?` (${after.who})`:""}`:"Every step is signed off: ready to approve."]);
      await openItem(item.id); }catch(e){ box.querySelector("[data-so-st]").textContent=e.message; } };
  const we=box.querySelector("[data-wfedit]"); if(we) we.onclick=()=>{ const f=box.querySelector("[data-wfbox]"); f.innerHTML=`<div class="row" style="margin-top:6px"><input data-wf-in value="${esc(wf.steps.map(x=>x.who?`${x.name} (${x.who})`:x.name).join(", "))}" placeholder="e.g. Expert (Priya), Legal (Rahul), Marketing" aria-label="Approval steps, in order, separated by commas" style="flex:1"><button class="btn small" data-wf-save>Save steps</button></div><label class="check" style="margin:4px 0"><input type="checkbox" data-wf-rf ${wf.resolve_first?"checked":""}> Resolve all comments before a page can be approved</label><p class="status" style="margin:4px 0">In order, separated by commas; add a name in brackets to say who signs off that step. These apply to every page on this website.</p>`;
    f.querySelector("[data-wf-save]").onclick=async()=>{ await api(`/api/sites/${SITE_ID}/workflow`,{method:"PUT",body:JSON.stringify({steps:f.querySelector("[data-wf-in]").value.split(","),resolve_first:f.querySelector("[data-wf-rf]").checked})}); reload(); }; };
}

// ---------- refresh drafts: tracked changes ----------
function refreshFrom(url,btn,st){ busy(btn,st,"Reading the page and writing the update…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/refresh-draft`,{method:"POST",body:JSON.stringify({url}),onProgress:t=>{ if(st) st.textContent=t; }});
  await openItem(r.id); toast(`Refresh draft ready: ${r.changes} change${r.changes===1?"":"s"} to review.`); }); }
function renderRefresh(item,el){
  const box=el.querySelector("[data-refresh-panel]"); if(!box) return; const R=item.refresh;
  if(R.applied){ const n=TD.changes(TD.diff(R.original.markdown,R.updated)), acc=n.filter(c=>(R.decisions||{})[c.id]!=="reject").length;
    box.innerHTML=`<div class="verdict create" style="margin:8px 0">Refresh of <span class="url">${esc(R.source_url)}</span>: ${acc} of ${n.length} changes accepted on ${esc(fmtDate(R.applied_at))}. The original is kept in Version history.</div>`; return; }
  const seq=TD.diff(R.original.markdown,R.updated), ch=TD.changes(seq), dec={}, edits={}; let titleD="accept", metaD="accept", editing=null;
  const md=t=>esc(t).replace(/^(#{1,6}) /,"$1 ");
  const show=c=>{ if(c.del.length===1&&c.ins.length===1&&!/^#/.test(c.del[0])) return `<p style="margin:4px 0">${TD.words(c.del[0],c.ins[0]).map(([op,t])=>op==="="?esc(t):op==="-"?`<del style="background:#fde2e1;color:#9b1c1c">${esc(t)}</del>`:`<ins style="background:#dcfce7;color:#14532d;text-decoration:none">${esc(t)}</ins>`).join("")}</p>`;
    return `${c.del.map(x=>`<p style="margin:4px 0"><del style="background:#fde2e1;color:#9b1c1c">${md(x)}</del></p>`).join("")}${c.ins.map(x=>`<p style="margin:4px 0"><ins style="background:#dcfce7;color:#14532d;text-decoration:none">${md(x)}</ins></p>`).join("")}`; };
  const tchg=R.original.title_tag!==item.payload.title_tag, mchg=R.original.meta_description!==item.payload.meta_description;
  const draw=()=>{ box.innerHTML=`<div class="approve-box"><h3 style="font-size:16px;margin-top:0">Review the changes <span class="status" style="font-weight:400">(refresh of <span class="url">${esc(R.source_url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span>${R.decline?`, which lost ${R.decline}% of its Google clicks`:""})</span></h3>
    ${R.compare?`<div class="panel" style="margin:0 0 8px;padding:10px 12px"><b>Before → after:</b> ${fmtN(R.compare.words_before)} → ${fmtN(R.compare.words_after)} words${R.compare.lost.length?` · lost searches covered: <b>${R.compare.lost.filter(x=>x.before).length} → ${R.compare.lost.filter(x=>x.after).length}</b> of ${R.compare.lost.length}
      <div style="margin-top:6px">${R.compare.lost.map(x=>`<span class="pill ${x.after?"pass":"warn"}" title="${x.before?"already covered":"not covered before"}">${esc(x.query)} ${x.before?"✓":"✗"}→${x.after?"✓":"✗"}</span>`).join(" ")}</div>`:""}</div>`:""}
    ${(R.changes_ai||[]).length?`<p class="status" style="margin:0 0 8px">What the AI changed and why: ${R.changes_ai.map(c=>`<b>${esc(c.what)}</b> (${esc(c.why)})`).join("; ")}.</p>`:""}
    ${tchg?`<div class="ans" style="margin:6px 0"><div class="row" style="justify-content:space-between"><b>Title</b>${btns("title",titleD)}</div><p style="margin:4px 0">${TD.words(R.original.title_tag,item.payload.title_tag).map(([op,t])=>op==="="?esc(t):op==="-"?`<del style="background:#fde2e1;color:#9b1c1c">${esc(t)}</del>`:`<ins style="background:#dcfce7;color:#14532d;text-decoration:none">${esc(t)}</ins>`).join("")}</p></div>`:""}
    ${mchg?`<div class="ans" style="margin:6px 0"><div class="row" style="justify-content:space-between"><b>Meta description</b>${btns("meta",metaD)}</div><p style="margin:4px 0"><del style="background:#fde2e1;color:#9b1c1c">${esc(R.original.meta_description)}</del><br><ins style="background:#dcfce7;color:#14532d;text-decoration:none">${esc(item.payload.meta_description)}</ins></p></div>`:""}
    ${ch.map((c,k)=>`<div class="ans" style="margin:6px 0;${dec[c.id]==="reject"?"opacity:.55":""}"><div class="row" style="justify-content:space-between"><b>Change ${k+1} of ${ch.length}</b> <span class="status">${!c.del.length?"added":!c.ins.length?"removed":"changed"}${typeof edits[c.id]==="string"?" · edited by you":""}</span><span class="row" style="gap:4px">${c.ins.length&&!READONLY?`<button class="btn ghost small" data-rfedit="${c.id}">Edit</button>`:""}${btns(c.id,dec[c.id]||"accept")}</span></div>
      ${editing===c.id?`<textarea data-rfta style="min-height:120px;width:100%">${esc(typeof edits[c.id]==="string"?edits[c.id]:c.ins.join("\n\n"))}</textarea><div class="row" style="margin-top:4px"><button class="btn small" data-rfsave="${c.id}">Use my text</button><button class="btn ghost small" data-rfcancel>Cancel</button></div>`
        :typeof edits[c.id]==="string"?`${c.del.map(x=>`<p style="margin:4px 0"><del style="background:#fde2e1;color:#9b1c1c">${md(x)}</del></p>`).join("")}<p style="margin:4px 0;white-space:pre-wrap"><ins style="background:#dcfce7;color:#14532d;text-decoration:none">${esc(edits[c.id])}</ins></p>`:show(c)}</div>`).join("")||`<p class="status">No changes to the text.</p>`}
    ${READONLY?"":`<div class="row" style="margin-top:10px"><button class="btn ghost small" data-rfall="accept">Accept all</button><button class="btn ghost small" data-rfall="reject">Reject all</button><button class="btn" data-rfapply>Apply my decisions</button><span class="status" data-rfst role="status">${ch.filter(c=>dec[c.id]!=="reject").length} of ${ch.length} changes accepted</span></div>`}</div>`;
    box.querySelectorAll("[data-rfd]").forEach(b=>b.onclick=()=>{ const [k,v]=b.dataset.rfd.split(":"); if(k==="title") titleD=v; else if(k==="meta") metaD=v; else dec[k]=v; draw(); });
    box.querySelectorAll("[data-rfedit]").forEach(b=>b.onclick=()=>{ editing=b.dataset.rfedit; draw(); const ta=box.querySelector("[data-rfta]"); if(ta) ta.focus(); });
    box.querySelectorAll("[data-rfsave]").forEach(b=>b.onclick=()=>{ edits[b.dataset.rfsave]=box.querySelector("[data-rfta]").value; dec[b.dataset.rfsave]="accept"; editing=null; draw(); });
    box.querySelectorAll("[data-rfcancel]").forEach(b=>b.onclick=()=>{ editing=null; draw(); });
    box.querySelectorAll("[data-rfall]").forEach(b=>b.onclick=()=>{ for(const c of ch) dec[c.id]=b.dataset.rfall; titleD=metaD=b.dataset.rfall; draw(); });
    const ap=box.querySelector("[data-rfapply]"); if(ap) ap.onclick=()=>busy(ap,box.querySelector("[data-rfst]"),"Applying and checking…",async()=>{ await api(`/api/sites/${SITE_ID}/contents/${item.id}/refresh-apply`,{method:"POST",body:JSON.stringify({decisions:dec,title:titleD,meta:metaD,edits})}); await openItem(item.id); toast("Applied. The page was checked again; the original is in Version history."); }); };
  const btns=(k,v)=>READONLY?"":`<span class="row" style="gap:4px"><button class="btn ${v==="accept"?"":"ghost "}small" data-rfd="${k}:accept" aria-pressed="${v==="accept"}">✓ Accept</button><button class="btn ${v==="reject"?"":"ghost "}small" data-rfd="${k}:reject" aria-pressed="${v==="reject"}">✕ Reject</button></span>`;
  draw();
}

// ---------- content decay (Performance screen) ----------
const spark=v=>{ const w=110,h=28,max=Math.max(...v,1),dx=w/Math.max(v.length-1,1); const pts=v.map((x,i)=>`${(i*dx).toFixed(1)},${(h-3-(x/max)*(h-6)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Clicks by month: ${v.join(", ")}"><polyline points="${pts}" fill="none" stroke="var(--bad)" stroke-width="2"/></svg>`; };
async function renderDecay(){
  const box=$("#decay-panel"); if(!box||!SITE_ID) return; const id=SITE_ID, d=await DECAY.get(id), conn=await GSCC.get(id), live=!!(conn&&conn.property);
  box.innerHTML=`<div class="row" style="justify-content:space-between"><h2 style="margin:0">Content decay</h2>${READONLY?"":`<span class="row">${d&&d.pages.filter(p=>p.level!=="early").length?`<button class="btn small" id="dc-top">Refresh the top ${Math.min(3,d.pages.filter(p=>p.level!=="early").length)}</button>`:""}<button class="btn ${d?"ghost ":""}small" id="dc-run">${d?"Check again":"Check for declining pages"}</button></span>`}</div>
    <p class="status" style="margin:4px 0 10px">Pages losing Google clicks ${live?"month after month (the last 6 full months, from your Search Console connection)":"between your two latest Search Console imports (connect Search Console for month-by-month data)"}. Catch them early, before they drop off page one. ${d&&d.source==="live"&&d.fetched!=null?`Last check fetched ${d.fetched} month${d.fetched===1?"":"s"} (the rest reused). `:""}${d&&d.by==="schedule"?"Checked automatically by the weekly check. ":""}<span id="dc-st" role="status"></span></p>
    ${d?(d.pages.length?`<div class="tw"><table><tr><th>Page</th><th>Clicks by period</th><th>Change</th><th>Likely cause</th><th><span class="sr-only">Actions</span></th></tr>
      ${d.pages.slice(0,30).map((x,i)=>`<tr><td><span class="url">${esc(x.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span>${x.title?`<br><span class="status">${esc(x.title.slice(0,70))}</span>`:""}</td>
        <td>${spark(x.series)}<br><span class="status">${esc(d.months[0])} → ${esc(d.months[d.months.length-1])}</span></td>
        <td>${x.level==="early"?`<span class="pill warn">Early warning</span><br>`:""}<b class="${x.level==="early"?"warn":"fail"}">−${x.decline}%</b><br><span class="status">${fmtN(x.peak)} → ${fmtN(x.last)} a ${d.source==="live"?"month":"period"}${x.start_label?`, falling since ${esc(x.start_label)}`:""}</span></td>
        <td>${x.causes.length?x.causes.map(c=>`<div style="margin:2px 0">• ${esc(c.text)}</div>`).join(""):`<span class="status">No clear pattern; compare with what ranks now</span>`}<div data-dclost="${i}"></div></td>
        <td>${live?`<button class="btn ghost small" data-dcq="${i}">Which searches were lost?</button>`:""}${READONLY?"":`<button class="btn small" data-dcref="${i}">Create a refresh draft</button><button class="btn ghost small" data-dcfix="${i}">Check the keyword</button>`}<button class="btn ghost small" data-dch="${i}">See history</button></td></tr>`).join("")}</table></div>`
      :`<p class="pass">No pages are losing clicks. Checked ${esc(fmtDate(d.at))}.</p>`):`<p class="status">Not checked yet.</p>`}`;
  const top=$("#dc-top"); if(top) top.onclick=()=>{ if(!needAI($("#dc-st"))) return; busy(top,$("#dc-st"),"Creating refresh drafts…",async()=>{ const r=await api(`/api/sites/${id}/refresh-top`,{method:"POST",body:JSON.stringify({n:3}),onProgress:t=>{ const e=$("#dc-st"); if(e) e.textContent=t; }});
    const ok=r.filter(x=>x.id); toast(`${ok.length} refresh draft${ok.length===1?"":"s"} ready in My pages${r.length>ok.length?` (${r.length-ok.length} couldn't be read)`:""}.`); if(ok[0]) await openItem(ok[0].id); }); };
  const run=$("#dc-run"); if(run) run.onclick=()=>busy(run,$("#dc-st"),"Checking…",async()=>{ await api(`/api/sites/${id}/decay/run`,{method:"POST",body:"{}",onProgress:t=>{ const e=$("#dc-st"); if(e) e.textContent=t; },
    monthFetch: live?((from,to)=>GSCC.queryRange(id,["page"],from,to,{rowLimit:5000}).then(rows=>rows.map(r=>({page:r.keys[0],clicks:r.clicks,impressions:r.impressions,position:r.position})))):null}); await renderDecay(); });
  if(!d) return;
  box.querySelectorAll("[data-dcq]").forEach(b=>b.onclick=()=>busy(b,$("#dc-st"),"Asking Search Console…",async()=>{ const x=d.pages[+b.dataset.dcq];
    const [before,after]=await Promise.all([GSCC.queryRange(id,["query"],x.peak_period.from,x.peak_period.to,{page:x.url,rowLimit:200}),GSCC.queryRange(id,["query"],x.last_period.from,x.last_period.to,{page:x.url,rowLimit:200})]);
    const lost=DECAY.lostQueries(before,after); x.lost_queries=lost;
    box.querySelector(`[data-dclost="${b.dataset.dcq}"]`).innerHTML=lost.length?`<div class="status" style="margin-top:6px"><b>Searches lost (${esc(x.peak_label)} → ${esc(d.months[d.months.length-1])}):</b> ${lost.map(q=>`${esc(q.query)} ${q.before}→${q.after}${q.pos_before&&q.pos_after?` (pos ${q.pos_before}→${q.pos_after})`:""}`).join("; ")}</div>`:`<div class="status">No single search lost much; the drop is spread across many.</div>`; }));
  box.querySelectorAll("[data-dcfix]").forEach(b=>b.onclick=()=>{ const x=d.pages[+b.dataset.dcfix], kw=(x.lost_queries&&x.lost_queries[0]?.query)||String(x.title||"").split(/\s[|\-–—]\s/)[0]||x.url;
    openCheck(kw.toLowerCase()); toast("Check this keyword, then use “Get an update plan” for the page."); });
  box.querySelectorAll("[data-dcref]").forEach(b=>b.onclick=()=>{ if(!needAI($("#dc-st"))) return; refreshFrom(d.pages[+b.dataset.dcref].url,b,$("#dc-st")); });
  box.querySelectorAll("[data-dch]").forEach(b=>b.onclick=()=>{ const x=d.pages[+b.dataset.dch]; window._openHistory(x.url,x.start_from?{from:x.start_from,label:x.start_label,decline:x.decline}:null); });
}

// ---------- Bing Webmaster Tools (Performance screen) ----------
const BING_SITE_KEY=id=>`ce-bing-site:${store.dbName()}:${id}`;
async function renderBing(autoRefresh=true){
  const box=$("#bing-panel"); if(!box||!SITE_ID) return; const id=SITE_ID;
  if(!BING.configured()){ box.innerHTML=`<h2>Bing <span class="pill">optional, free</span></h2><p class="lead" style="margin:0">Bing also powers ChatGPT search and Copilot. Add your free Bing Webmaster API key under <button class="linkbtn" data-go="settings">Settings → Google &amp; Bing</button> to see Bing searches, clicks and crawl errors here.</p>`; bindGo(box); return; }
  const d=await BING.get(id), chosen=d?.site||localStorage.getItem(BING_SITE_KEY(id))||"";
  if(!chosen){ box.innerHTML=`<h2>Bing</h2><div class="row"><button class="btn" id="bing-find">Find my website in Bing</button><span class="status" id="bing-st" role="status"></span></div>`;
    $("#bing-find").onclick=()=>busy($("#bing-find"),$("#bing-st"),"Asking Bing…",async()=>{ const list=await BING.sites(); const pick=BING.pickSite(list,window._siteUrl||"");
      if(!list.length) throw new Error("Your Bing account has no websites yet. Add this one in Bing Webmaster Tools (or import from Google Search Console).");
      if(!pick){ $("#bing-st").innerHTML=`This website isn't in your Bing account. Found: ${esc(list.map(x=>x.url).join(", "))}`; return; }
      localStorage.setItem(BING_SITE_KEY(id),pick); await BING.refresh(id,pick,t=>{ $("#bing-st").textContent=t; }); await renderBing(false); }); return; }
  const gRows=(await (await import("./store.js")).get(`gsc:${id}`,[]))?.[0]?.rows||[];
  const per=d?BING.period(d.daily):null, only=d?BING.bingOnly(d.queries,gRows):[], hm=BING.months(await BING.history(id)), vs=d?BING.versusGoogle(d.pages,gRows):{ready:false};
  box.innerHTML=`<div class="row" style="justify-content:space-between"><h2 style="margin:0">Bing <span class="status" style="font-weight:400">· ${esc(chosen)}</span></h2>
      <div class="row">${READONLY?"":`<button class="btn ghost small" id="bing-refresh">Refresh</button><button class="btn ghost small" id="bing-change">Change website</button>`}</div></div>
    <p class="status" style="margin:4px 0 10px">Bing also powers ChatGPT search and Copilot. ${d?`Updated ${esc(fmtDate(d.at))}${d.requests?` with ${d.requests} requests`:""} (crawl data refreshes every 3 days)${d.history_days?` · ${fmtN(d.history_days)} days of history kept`:""}.`:""} <span id="bing-st" role="status"></span></p>
    ${d?`${per?`<div class="grid3" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num">${fmtN(per.clicks)}</div><div class="lbl">Bing clicks, last 28 days${per.clicks_change!=null?` <span class="${per.clicks_change>=0?"pass":"fail"}">${per.clicks_change>=0?"▲":"▼"} ${Math.abs(per.clicks_change)}%</span>`:""}</div></div></div>
        <div class="panel kpi"><div><div class="num">${fmtN(per.impressions)}</div><div class="lbl">times shown in Bing${per.impressions_change!=null?` <span class="${per.impressions_change>=0?"pass":"fail"}">${per.impressions_change>=0?"▲":"▼"} ${Math.abs(per.impressions_change)}%</span>`:""}</div></div></div>
        <div class="panel kpi"><div><div class="num">${d.crawl?fmtN(d.crawl.in_index):"–"}</div><div class="lbl">pages in Bing's index${d.crawl&&(d.crawl.c4xx||d.crawl.c5xx)?` · <span class="warn">${fmtN(d.crawl.c4xx+d.crawl.c5xx)} errors</span>`:""}</div></div></div></div>`:""}
      ${d.daily.length>6?lineChartSimple(d.daily.slice(-90).map(x=>({label:x.date,v:x.clicks}))):""}
      <div class="grid2" style="margin-top:10px"><div><h3 style="font-size:14px">Top Bing searches</h3><div class="tw"><table><tr><th>Search</th><th>Clicks</th><th>Shown</th><th>Position</th></tr>${d.queries.slice(0,10).map(q=>`<tr><td>${esc(q.query)}</td><td>${fmtN(q.clicks)}</td><td>${fmtN(q.impressions)}</td><td>${q.position??"–"}</td></tr>`).join("")||"<tr><td colspan=4 class=status>No data yet</td></tr>"}</table></div></div>
        <div><h3 style="font-size:14px">Top pages on Bing</h3><div class="tw"><table><tr><th>Page</th><th>Clicks</th></tr>${d.pages.slice(0,10).map(p=>`<tr><td><span class="url">${esc(p.page.replace(/^https?:\/\/[^/]+/,"")||"/")}</span></td><td>${fmtN(p.clicks)}</td></tr>`).join("")||"<tr><td colspan=2 class=status>No data yet</td></tr>"}</table></div></div></div>
      ${hm.length>1?`<h3 style="font-size:14px;margin-top:12px">Bing clicks by month</h3><div class="row" style="align-items:flex-end;gap:6px;height:90px" aria-label="Bing clicks by month">${hm.map(m=>`<div style="text-align:center;flex:1;max-width:60px"><div style="font-size:11px" class="status">${fmtN(m.clicks)}</div><div style="background:var(--c2);opacity:.8;height:${Math.max(3,56*m.clicks/Math.max(...hm.map(x=>x.clicks),1))}px;border-radius:4px 4px 0 0" title="${esc(m.month)}: ${m.clicks} clicks${m.days<25?` (${m.days} days of data)`:""}"></div><span class="status" style="font-size:11px">${esc(m.month.slice(2))}</span></div>`).join("")}</div>`:""}
      ${vs.ready&&(vs.bing_strong.length||vs.google_strong.length)?`<h3 style="font-size:14px;margin-top:12px">Bing vs Google, per page</h3><p class="status" style="margin-top:0">Each page's share of that search engine's clicks. A page much stronger on one engine usually has a fixable problem on the other.</p><div class="grid2">
        <div><b>Strong on Bing, weak on Google</b>${vs.bing_strong.length?`<div class="tw"><table><tr><th>Page</th><th>Bing</th><th>Google</th></tr>${vs.bing_strong.map(r=>`<tr><td><span class="url">${esc(r.page.replace(/^[^/]+/,"")||"/")}</span></td><td>${(r.sb*100).toFixed(1)}%</td><td>${(r.sg*100).toFixed(1)}%</td></tr>`).join("")}</table></div><p class="status">Check these in Site health → In Google, and compare with what ranks on Google (Check a keyword).</p>`:`<p class="status">None.</p>`}</div>
        <div><b>Strong on Google, weak on Bing</b>${vs.google_strong.length?`<div class="tw"><table><tr><th>Page</th><th>Google</th><th>Bing</th></tr>${vs.google_strong.map(r=>`<tr><td><span class="url">${esc(r.page.replace(/^[^/]+/,"")||"/")}</span></td><td>${(r.sg*100).toFixed(1)}%</td><td>${(r.sb*100).toFixed(1)}%</td></tr>`).join("")}</table></div><p class="status">Bing may not have picked these up: submit them with IndexNow (Websites → Instant indexing).</p>`:`<p class="status">None.</p>`}</div></div>`:vs.ready?`<p class="status" style="margin-top:12px"><b>Bing vs Google, per page:</b> no big differences. Your pages get similar shares of clicks on both.</p>`:""}
      ${only.length?`<h3 style="font-size:14px;margin-top:12px">Bing sends visitors for these, Google doesn't</h3><p class="status" style="margin-top:0">Worth a look: you rank on Bing but not Google, so the page may need work for Google, or a page for the topic is missing.</p><p>${only.map(q=>`<span class="pill">${esc(q.query)} · ${q.clicks}</span>`).join(" ")}</p>`:""}
      ${d.issues.filter(x=>x.http>=400).length?`<h3 style="font-size:14px;margin-top:12px">Pages Bing couldn't read</h3><div class="tw"><table><tr><th>Page</th><th>Error</th><th>Links to it</th></tr>${d.issues.filter(x=>x.http>=400).slice(0,15).map(x=>`<tr><td><span class="url">${esc(x.url)}</span></td><td class="fail">${x.http}</td><td>${x.inlinks}</td></tr>`).join("")}</table></div>`:""}
      ${d.quota?`<p class="status">Bing URL submissions left today: ${d.quota.daily??"–"} (this month: ${d.quota.monthly??"–"}). IndexNow submissions don't use this allowance.</p>`:""}`
    :`<p class="status">Not loaded yet.</p>`}`;
  const rf=$("#bing-refresh"); if(rf) rf.onclick=()=>busy(rf,$("#bing-st"),"Getting Bing data…",async()=>{ await BING.refresh(id,chosen,t=>{ const e=$("#bing-st"); if(e) e.textContent=t; },{full:true}); await renderBing(false); });
  const ch=$("#bing-change"); if(ch) ch.onclick=async()=>{ localStorage.removeItem(BING_SITE_KEY(id)); await store.del(`bing:${id}`); renderBing(false); };
  if(autoRefresh&&!READONLY&&(!d||Date.now()-d.at>864e5)) BING.refresh(id,chosen).then(()=>renderBing(false)).catch(e=>{ const s2=$("#bing-st"); if(s2){ s2.className="err"; s2.textContent=e.message; } });
}
function lineChartSimple(points){ const w=640,h=120,max=Math.max(...points.map(p=>p.v),1),dx=w/Math.max(points.length-1,1), marks=noteMarks(ANN,points.map(p=>p.label),i=>i*dx,6,h-14);
  const pts=points.map((p,i)=>`${(i*dx).toFixed(1)},${(h-14-(p.v/max)*(h-24)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Bing clicks per day">${marks}<polyline points="${pts}" fill="none" stroke="var(--c2)" stroke-width="2"/><text x="0" y="${h-1}" font-size="11" fill="var(--muted)">${esc(points[0].label)}</text><text x="${w}" y="${h-1}" font-size="11" fill="var(--muted)" text-anchor="end">${esc(points[points.length-1].label)}</text></svg>`; }

// ---------- instant indexing (IndexNow) ----------
async function renderIndexNow(site){
  const box=$("#inow-form"); if(!box) return; const v=await INOW.get(site.id), origin=new URL(site.url).origin;
  const fileUrl=v.key?(v.key_location||`${origin}/${v.key}.txt`):"";
  box.innerHTML=`<p class="status" style="margin-top:0">IndexNow tells Bing, Yandex, Seznam, Naver and other participating search engines about new or changed pages straight away (Bing's index also feeds ChatGPT search and Copilot). <b>Google doesn't use IndexNow</b>: it finds changes through your sitemap and the Search Console connection.</p>
    ${!v.key?(READONLY?`<p class="status">Not set up yet.</p>`:`<button class="btn" id="inow-new">Create my IndexNow key</button>`):`
    <ol class="steps"><li><span class="n">1</span><span class="t">Put this file on your website so it opens at <span class="url">${esc(fileUrl)}</span>. The file contains only the key.<br>
      <code>${esc(v.key)}</code> <button class="btn ghost small" id="inow-dl">Download the key file</button></span></li>
      <li><span class="n">2</span><span class="t"><b>WordPress:</b> upload it to your site's main folder with your host's file manager or an FTP app, or install Microsoft's free <b>IndexNow</b> plugin, which handles the key for you. <b>Other platforms:</b> upload it to the site root. Shopify and Webflow don't allow files at the site root, so IndexNow can't be used there; search engines still find your pages through your sitemap.</span></li>
      <li><span class="n">3</span><span class="t">Click <b>Verify</b>.</span></li></ol>
    <div class="row">${READONLY?"":`<button class="btn" id="inow-verify">Verify</button>`}<span class="status" id="inow-vst" role="status">${v.verified?`<span class="${v.verified.ok?"pass":"fail"}">${esc(v.verified.message)}</span> (checked ${esc(fmtDate(v.verified.at))})`:"Not verified yet."}</span></div>
    ${(()=>{ const pend=v.pending||[]; return `<h3 style="font-size:14px;margin:16px 0 6px">Waiting to be sent (${pend.length})</h3>
      ${pend.length?`<ul class="clean" style="margin:0 0 8px">${pend.slice(0,30).map(p=>`<li><span class="url">${esc(p.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span> <span class="status">${esc(p.reason)}</span></li>`).join("")}</ul>`:`<p class="status" style="margin:0 0 8px">Pages are added here automatically when they get a live address, are approved again after changes, or are updated on WordPress.</p>`}
      ${READONLY?"":`<div class="row">${pend.length?`<button class="btn" id="inow-all" ${v.verified?.ok?"":"disabled"}>Submit all (${pend.length}) in one request</button>`:""}<label class="check" style="margin:0"><input type="checkbox" id="inow-auto" ${v.auto?"checked":""} ${v.verified?.ok?"":"disabled"}> Notify automatically</label><span class="status" id="inow-pst" role="status">${v.auto?"Pages are sent as soon as they're added.":""}</span></div>`}`; })()}
    ${READONLY?"":`<h3 style="font-size:14px;margin:16px 0 6px">Submit other pages</h3>
    <textarea id="inow-urls" style="min-height:80px" placeholder="One page address per line, e.g. ${esc(origin)}/blog/new-guide"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn ghost small" id="inow-recent">Add pages changed in the last 7 days</button><button class="btn" id="inow-go" ${v.verified?.ok?"":"disabled"}>Notify search engines</button><span class="status" id="inow-st" role="status">${v.verified?.ok?"Only submit pages that are new or actually changed.":"Verify the key first."}</span></div>`}
    ${(v.log||[]).length?`<details style="margin-top:12px"><summary class="status">Submission log (${v.log.length})</summary><div class="tw"><table><tr><th>When</th><th>Pages</th><th>Result</th></tr>${v.log.map(l=>`<tr><td class="status">${esc(fmtDate(l.at))}</td><td>${l.count}<br><span class="status">${esc(l.urls.map(u=>u.replace(/^https?:\/\/[^/]+/,"")).join(", ").slice(0,90))}</span></td><td><span class="${l.accepted?"pass":"fail"}">${l.status}</span> ${esc(l.message)}</td></tr>`).join("")}</table></div></details>`:""}`}`;
  const nw=$("#inow-new"); if(nw) nw.onclick=async()=>{ await INOW.ensureKey(site.id); await renderIndexNow(site); $("#inow-box").open=true; };
  const dl=$("#inow-dl"); if(dl) dl.onclick=()=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([v.key],{type:"text/plain"})); a.download=`${v.key}.txt`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
  const vf=$("#inow-verify"); if(vf) vf.onclick=()=>busy(vf,$("#inow-vst"),"Checking your site for the key file…",async()=>{ await INOW.verify(site.id,site.url); await renderIndexNow(site); $("#inow-box").open=true; });
  const allb=$("#inow-all"); if(allb) allb.onclick=()=>busy(allb,$("#inow-pst"),"Sending…",async()=>{ const r=await INOW.sendPending(site.id,site.url); await renderIndexNow(site); $("#inow-box").open=true; const st=$("#inow-pst"); if(st){ st.className=r.accepted||r.submitted===0?"status pass":"status err"; st.textContent=`${r.submitted?`${r.submitted} page${r.submitted>1?"s":""}: ${r.message}`:r.message}${r.skipped?` (${r.skipped} skipped: sent in the last 24 hours)`:""}`; } });
  const au=$("#inow-auto"); if(au) au.onchange=async()=>{ await INOW.setAuto(site.id,au.checked); if(au.checked&&(v.pending||[]).length) await INOW.sendPending(site.id,site.url).catch(()=>{}); await renderIndexNow(site); $("#inow-box").open=true; };
  const rc=$("#inow-recent"); if(rc) rc.onclick=async()=>{ const u=await api(`/api/sites/${site.id}/recent-urls`); const ta=$("#inow-urls"); ta.value=[...new Set([...ta.value.split("\n").map(x=>x.trim()).filter(Boolean),...u])].join("\n"); $("#inow-st").textContent=u.length?`Added ${u.length} page${u.length>1?"s":""} with a live address.`:"No pages with a live address changed in the last 7 days (add the page address under Language versions, or send pages to WordPress)."; };
  const go=$("#inow-go"); if(go) go.onclick=()=>busy(go,$("#inow-st"),"Notifying search engines…",async()=>{ const urls=$("#inow-urls").value.split("\n").map(x=>x.trim()).filter(Boolean);
    const r=await INOW.submit(site.id,site.url,urls); await renderIndexNow(site); $("#inow-box").open=true; const st=$("#inow-st"); if(st){ st.className=r.accepted?"status pass":"status err"; st.textContent=`${r.submitted} page${r.submitted>1?"s":""}: ${r.message}`; } });
}

// ---------- page speed (Site health → Speed) ----------
const RATE_LABEL={good:"Good",needs_work:"Needs work",poor:"Poor"}, RATE_CLASS={good:"pass",needs_work:"warn",poor:"fail"};
const ms=v=>v==null?"–":v>=1000?`${(v/1000).toFixed(1)} s`:`${Math.round(v)} ms`;
const metricCell=(m,v)=>{ if(v==null) return `<td class="status">no data</td>`; const r=SPEED.rate(m,v); return `<td><span class="pill ${RATE_CLASS[r]}">${RATE_LABEL[r]}</span> ${m==="cls"?v.toFixed(2):ms(v)}</td>`; };
let SPEED_CTRL=null, SPEED_STRATEGY="mobile";
const trendSvg=v=>{ const w=48,h=16,mx=100,dx=w/Math.max(v.length-1,1); return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Score history: ${v.join(", ")}" style="vertical-align:middle"><polyline points="${v.map((x,i)=>`${(i*dx).toFixed(1)},${(h-2-(x/mx)*(h-4)).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--c2)" stroke-width="1.5"/></svg>`; };
async function renderSpeed(){taCountsSoon();
  const box=$("#ta-speed"); if(!box||!SITE_ID) return; const d=await SPEED.get(SITE_ID), hasKey=!!(LLM.getSettings().googleKey||"").trim();
  const rows=(d?.pages||[]).filter(p=>p.strategy===SPEED_STRATEGY), site=d?.site?.[SPEED_STRATEGY];
  const cwvPass=site&&["lcp","inp","cls"].every(m=>site[m]==null||SPEED.rate(m,site[m])==="good");
  box.innerHTML=`<p class="lead" style="margin-top:0">How fast your important pages load for real visitors, using Google's free PageSpeed Insights. Google uses the three Core Web Vitals (loading, responsiveness, visual stability) in ranking.</p>
    ${hasKey?"":`<div class="verdict related">Without a free Google API key, Google limits these tests heavily. Add one under Settings → Google &amp; Bing (takes 5 minutes).</div>`}
    ${site?`<div class="panel" style="margin:10px 0"><b>Whole site, real ${SPEED_STRATEGY} visitors (last 28 days):</b> <span class="pill ${cwvPass?"pass":"fail"}">${cwvPass?"Passes Core Web Vitals":"Doesn't pass Core Web Vitals"}</span>
      <div class="tw" style="margin-top:8px"><table><tr><th>Loading (LCP)</th><th>Responsiveness (INP)</th><th>Visual stability (CLS)</th></tr><tr>${metricCell("lcp",site.lcp)}${metricCell("inp",site.inp)}${metricCell("cls",site.cls)}</tr></table></div></div>`:""}
    <div class="row" style="margin:10px 0">${READONLY?"":`<select id="sp-strat" aria-label="Device" style="width:auto"><option value="mobile" ${SPEED_STRATEGY==="mobile"?"selected":""}>Mobile</option><option value="desktop" ${SPEED_STRATEGY==="desktop"?"selected":""}>Desktop</option></select>
      <select id="sp-count" aria-label="How many pages" style="width:auto"><option value="5">5 pages</option><option value="10" selected>10 pages</option><option value="20">20 pages</option></select>
      <button class="btn" id="sp-quick" title="Real-visitor numbers for up to 50 pages in seconds (Chrome UX Report)">Quick check (real visitors)</button>
      <button class="btn ghost" id="sp-run" title="Lab test with specific fixes; 10-30 seconds a page">Full test (with fixes)</button><label class="check" style="margin:0"><input type="checkbox" id="sp-force"> test again even if tested today</label><button class="btn ghost hidden" id="sp-stop">Stop</button>`}
      <span class="status" id="sp-status" role="status">${d?`Last tested ${esc(fmtDate(d.at))}.`:""}</span></div>
    ${(d?.errors||[]).length?`<p class="warn">${d.errors.length} page${d.errors.length>1?"s":""} couldn't be tested: ${esc(d.errors[0].error)}</p>`:""}
    ${(()=>{ const fx=SPEED.topFixes(rows).filter(f=>f.pages>=2).slice(0,6); return fx.length?`<h3 style="font-size:15px">Fixes that help most pages</h3><p class="status" style="margin-top:0">Usually one change to your theme or site settings fixes these everywhere at once.</p><div class="tw"><table><tr><th>Fix</th><th>Pages</th><th>Time saved (all pages)</th></tr>${fx.map(f=>`<tr><td><b>${esc(f.title)}</b><br><span class="status">${esc(f.how)}</span></td><td>${f.pages} of ${rows.filter(r=>r.score!=null).length}</td><td>~${(f.savings_ms/1000).toFixed(1)} s</td></tr>`).join("")}</table></div>`:""; })()}
    ${rows.length?`<div class="tw"><table><tr><th>Page</th><th>Speed score (test)</th><th>Loading (LCP)</th><th>Responsiveness (INP)</th><th>Visual stability (CLS)</th><th>Biggest fix</th></tr>
      ${rows.sort((a,b)=>(a.score??101)-(b.score??101)||(SPEED.rate("lcp",b.field?.lcp)==="poor")-(SPEED.rate("lcp",a.field?.lcp)==="poor")).map((r,i)=>`<tr><td><span class="url">${esc(r.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span></td>
        <td>${r.score!=null?`<b class="${r.score>=90?"pass":r.score>=50?"warn":"fail"}">${r.score}</b>${(r.history||[]).length>1?` ${trendSvg(r.history.map(h=>h.score))}`:r.prev_score!=null&&r.prev_score!==r.score?` <span class="status">(was ${r.prev_score})</span>`:""}`:`<span class="status">no lab test yet</span>`}</td>
        ${r.field?metricCell("lcp",r.field.lcp)+metricCell("inp",r.field.inp)+metricCell("cls",r.field.cls):`<td colspan="3" class="status">Not enough real-visitor data for this page yet (test: loading ${ms(r.lab.lcp)}, CLS ${r.lab.cls!=null?r.lab.cls.toFixed(2):"–"})</td>`}
        <td>${!r.opportunities.length&&r.score==null?`<span class="status">Run the full test for fixes</span>`:r.opportunities[0]?`${esc(r.opportunities[0].title)} <span class="status">(saves ~${(r.opportunities[0].savings_ms/1000).toFixed(1)} s)</span>${r.opportunities.length>1?`<details><summary class="status">${r.opportunities.length-1} more fixes</summary><ul class="clean">${r.opportunities.slice(1).map(o=>`<li>${esc(o.title)} <span class="status">(~${(o.savings_ms/1000).toFixed(1)} s)</span><br><span class="status">${esc(o.how)}</span></li>`).join("")}</ul></details>`:""}`:`<span class="status">No big fixes found</span>`}</td></tr>`).join("")}</table></div>
      <p class="status">Real-visitor data comes from Chrome users over the last 28 days (pages with little traffic don't have any). The speed score is a single lab test and varies a little between runs.</p>`
      :`<p class="status">Not tested yet. The test checks your homepage and the pages Google sends the most visitors to.</p>`}`;
  const sel=$("#sp-strat"); if(sel) sel.onchange=()=>{ SPEED_STRATEGY=sel.value; renderSpeed(); };
  const qk=$("#sp-quick"); if(qk) qk.onclick=()=>{ SPEED_CTRL=new AbortController(); $("#sp-stop").classList.remove("hidden");
    busy(qk,$("#sp-status"),"Getting real-visitor numbers…",async()=>{ try{ await api(`/api/sites/${SITE_ID}/speed/quick`,{method:"POST",body:JSON.stringify({strategy:$("#sp-strat").value,count:50}),
      onProgress:t=>{ const e=$("#sp-status"); if(e) e.textContent=t; }, signal:SPEED_CTRL.signal}); } finally { SPEED_CTRL=null; } await renderSpeed(); }); };
  const run=$("#sp-run"); if(run) run.onclick=()=>{ SPEED_CTRL=new AbortController(); $("#sp-stop").classList.remove("hidden");
    busy(run,$("#sp-status"),"Starting speed tests…",async()=>{ try{ await api(`/api/sites/${SITE_ID}/speed/run`,{method:"POST",body:JSON.stringify({strategy:$("#sp-strat").value,count:+$("#sp-count").value,force:$("#sp-force").checked}),
      onProgress:t=>{ const e=$("#sp-status"); if(e) e.textContent=t; }, signal:SPEED_CTRL.signal}); } finally { SPEED_CTRL=null; }
      await renderSpeed(); }); };
  const stop=$("#sp-stop"); if(stop) stop.onclick=()=>{ if(SPEED_CTRL) SPEED_CTRL.abort(); };
}

$("#bk-save").onclick=()=>{ const st=LLM.getSettings(), k=$("#bk-key").value.trim(); if(k&&!/^[A-Za-z0-9]{16,64}$/.test(k)){ $("#bk-status").textContent="That doesn't look like a Bing API key (32 letters and numbers)."; return; } st.bingKey=k; LLM.saveSettings(st); $("#bk-status").textContent=k?"Saved. Open Performance → Bing to connect your Bing website.":"Removed."; };
$("#gk-save").onclick=()=>{ const st=LLM.getSettings(), k=$("#gk-key").value.trim(); if(k&&!/^AIza[\w-]{30,}$/.test(k)){ $("#gk-status").textContent="That doesn't look like a Google API key (they start with AIza)."; return; } st.googleKey=k; LLM.saveSettings(st); $("#gk-status").textContent=k?"Saved. Speed tests now use your free Google allowance.":"Removed."; };
// ---------- external links (Site health → External links) ----------
const EXT_LABEL={domain:["fail","Different website now"],broken:["fail","Broken"],removed:["fail","Page removed"],server:["warn","Server error"],moved:["warn","Moved"],blocked:["","Couldn't check"],skipped:["","Not checked"],ok:["pass","Works"]};
async function traceUrls(urls,opts={}){ const tok=LLM.getSettings().crawlToken; const r=await fetch("/api/redirects",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",...(tok?{"x-crawl-token":tok}:{})},body:JSON.stringify({urls,...(opts.sizes?{sizes:true}:{})})});
  const d=await r.json().catch(()=>({})); if(r.status===404&&!d.error) throw new Error("The link checker isn't deployed yet. Push the latest code to GitHub."); if(!r.ok) throw new Error(d.error||`Link check failed (${r.status})`); return d.results; }
const IMG_KIND={broken:"Doesn't load",unchecked:"Couldn't check",alt_missing:"No alt text",alt_poor:"Poor alt text",big:"Large file",format:"Old format",dims:"No width/height",lazy_first:"First image lazy-loaded"};
let IMG_F="";
async function renderImages(){taCountsSoon();
  const box=$("#ta-images"); if(!box||!SITE_ID) return; const d=await api(`/api/sites/${SITE_ID}/images`), short=u=>esc(String(u).replace(/^https?:\/\/[^/]+/,"")||"/");
  const head=`<div class="row" style="justify-content:space-between"><p class="lead" style="margin:0">Images on the pages read: alt text (image search and accessibility), file size, format, width and height, and loading. Sizes come from a headers-only check; nothing is downloaded.</p>${READONLY?"":`<span class="row"><button class="btn ${d?"ghost ":""}small" id="im-run">${d?"Check again":"Check images"}</button>${d?`<label class="check" style="margin:0"><input type="checkbox" id="im-all"> check everything</label>`:""}</span>`}</div><span class="status" id="im-st" role="status">${d?`Checked ${esc(fmtDate(d.at))}: ${fmtN(d.checked)} of ${fmtN(d.total)} images on ${d.pages} pages${d.reused?` (${fmtN(d.reused)} checked in the last 7 days, reused)`:""}.`:""}</span>`;
  if(!d){ box.innerHTML=head; bindImg(); return; }
  const list=d.images.filter(i=>!IMG_F||i.issues.some(x=>x.kind===IMG_F)), needAlt=d.images.filter(i=>i.issues.some(x=>x.kind==="alt_missing"||x.kind==="alt_poor"));
  box.innerHTML=`${head}
    <div class="row" style="margin:10px 0;flex-wrap:wrap">${Object.entries(IMG_KIND).filter(([k])=>k!=="unchecked"||d.unchecked).map(([k,l])=>`<button class="btn ${IMG_F===k?"":"ghost "}small" data-imf="${k}">${l}: <b>${k==="unchecked"?d.unchecked:d.counts[k]}</b></button>`).join("")}${IMG_F?`<button class="btn ghost small" data-imf="">Show all</button>`:""}</div>
    ${d.savings_kb>=100?`<div class="verdict related" style="margin:6px 0">Estimated saving: about <b>${d.savings_kb>=1024?`${(d.savings_kb/1024).toFixed(1)} MB`:`${fmtN(d.savings_kb)} KB`}</b> across these images by compressing large files and using WebP or AVIF (an estimate: WebP/AVIF is typically 25-50% smaller than JPEG/PNG).</div>`:""}
    ${d.heavy_kb?`<p class="status">Images over 300 KB with no smaller versions add up to <b>${fmtN(Math.round(d.heavy_kb/1024*10)/10)} MB</b>; compressing them and using WebP or AVIF speeds up those pages.</p>`:""}${d.heavy_kb_srcset?`<p class="status">Another ${fmtN(Math.round(d.heavy_kb_srcset/1024*10)/10)} MB of large originals have smaller versions (srcset), so most visitors download less; compressing the originals still helps.</p>`:""}
    ${needAlt.length&&!READONLY?`<div class="row" style="margin:6px 0"><button class="btn small" id="im-alt">Write alt text for ${Math.min(20,needAlt.filter(i=>!d.alts[i.src]).length)||needAlt.length} image${needAlt.length>1?"s":""}</button>${Object.keys(d.alts||{}).length?`<button class="btn ghost small" id="im-altcsv">Download alt text (CSV)</button>`:""}<span class="status">Written from the file name and the text around each image (the image itself isn't sent): check each one matches.</span></div>`:""}
    ${list.length?`<div class="tw"><table><tr><th style="width:64px"><span class="sr-only">Preview</span></th><th>Image</th><th>Problems</th><th>Pages</th></tr>${list.slice(0,100).map(i=>`<tr><td><img src="${esc(i.src)}" alt="" loading="lazy" style="width:56px;height:40px;object-fit:cover;border-radius:4px;background:var(--soft)" referrerpolicy="no-referrer"></td>
      <td><span class="url" title="${esc(i.src)}">${esc(decodeURIComponent(i.src.split("/").pop().split("?")[0]).slice(0,60))}</span><br><span class="status">${i.bytes?`${fmtN(Math.round(i.bytes/1024))} KB`:"size unknown"}${i.type?` · ${esc(i.type)}`:""}</span>
        ${d.alts?.[i.src]?`<div class="ans" style="margin-top:4px;padding:4px 8px"><b>Suggested alt:</b> ${esc(d.alts[i.src].alt)}${d.alts[i.src].check?` <span class="pill warn">check it</span>`:""} <button class="linkbtn" data-imcopy="${esc(d.alts[i.src].alt)}">Copy</button></div>`:""}</td>
      <td>${i.issues.map(x=>`<div class="${x.level}">${esc(IMG_KIND[x.kind])}: <span class="status">${esc(x.text)}</span></div>`).join("")}</td><td>${i.pages.slice(0,3).map(u=>`<span class="url">${short(u)}</span>`).join("<br>")}${i.pages.length>3?`<br><span class="status">+${i.pages.length-3} more</span>`:""}</td></tr>`).join("")}</table></div>`:`<p class="pass">No image problems${IMG_F?" of this kind":""}.</p>`}`;
  bindImg(d,needAlt);
}
function bindImg(d,needAlt){
  const run=$("#im-run"); if(run) run.onclick=()=>busy(run,$("#im-st"),"Checking images…",async()=>{ await api(`/api/sites/${SITE_ID}/images/run`,{method:"POST",body:JSON.stringify({all:!!($("#im-all")&&$("#im-all").checked)}),onProgress:t=>{ const e=$("#im-st"); if(e) e.textContent=t; },traceFn:traceUrls}); await renderImages(); });
  if(!d) return;
  document.querySelectorAll("#ta-images [data-imf]").forEach(b=>b.onclick=()=>{ IMG_F=b.dataset.imf; renderImages(); });
  document.querySelectorAll("#ta-images [data-imcopy]").forEach(b=>b.onclick=async()=>{ try{ await navigator.clipboard.writeText(b.dataset.imcopy); b.textContent="Copied"; }catch{} });
  const alt=$("#im-alt"); if(alt) alt.onclick=()=>{ if(!needAI($("#im-st"))) return; const srcs=needAlt.filter(i=>!d.alts[i.src]).slice(0,20).map(i=>i.src); busy(alt,$("#im-st"),"Writing alt text…",async()=>{ await api(`/api/sites/${SITE_ID}/images/alt`,{method:"POST",body:JSON.stringify({srcs:srcs.length?srcs:needAlt.slice(0,20).map(i=>i.src)})}); IMG_F="alt_missing"; await renderImages(); }); };
  const csv=$("#im-altcsv"); if(csv) csv.onclick=()=>{ const q=v=>`"${String(v).replace(/"/g,'""')}"`; const rows=Object.entries(d.alts).map(([src,a])=>[src,a.alt,a.check?"check":"",(d.images.find(i=>i.src===src)?.pages||[]).join(" ")].map(q).join(","));
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["image,alt_text,needs_check,pages\n"+rows.join("\n")+"\n"],{type:"application/octet-stream"})); a.download="alt-text.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
}
async function renderSitemaps(){taCountsSoon();
  const box=$("#ta-sitemaps"); if(!box||!SITE_ID) return; const d=await api(`/api/sites/${SITE_ID}/sitemap-check`), short=u=>esc(String(u).replace(/^https?:\/\/[^/]+/,"")||"/");
  const head=`<div class="row" style="justify-content:space-between"><p class="lead" style="margin:0">Do your sitemaps list the right pages, and does robots.txt let Google read them?</p>${READONLY?"":`<button class="btn ${d?"ghost ":""}small" id="sm-run">${d?"Check again":"Check sitemaps and robots.txt"}</button>`}</div><span class="status" id="sm-st" role="status">${d?`Checked ${esc(fmtDate(d.at))}.`:""}</span>`;
  if(!d){ box.innerHTML=head; bindSm(); return; }
  const WHY={noindex:"Marked noindex",canonical:"Canonical points elsewhere",error:"Returns an error",redirect:"Redirects"};
  const dt=d.dates, notes=[];
  if(!d.robots_found) notes.push(["warn","No robots.txt found. Add one that lists your sitemap."]); else if(!d.sitemaps_in_robots.length) notes.push(["warn","robots.txt doesn't list your sitemap. Add a line like <code>Sitemap: https://yoursite/sitemap.xml</code> so every search engine finds it."]);
  if(!d.total) notes.push(["fail","No sitemap found (or it couldn't be read)."]);
  if(d.files.some(f=>f.over_limit)) notes.push(["fail","A sitemap file has more than 50,000 addresses, the limit: split it."]);
  if(dt.total&&dt.with<dt.total*0.5) notes.push(["warn",`Only ${dt.with} of ${dt.total} entries have a last-changed date (lastmod). Google uses it to decide what to re-read.`]);
  if(dt.future) notes.push(["warn",`${dt.future} entr${dt.future>1?"ies have":"y has"} a last-changed date in the future.`]);
  if(dt.same) notes.push(["warn",`${fmtN(dt.same.count)} entries share the same last-changed date (${esc(dt.same.date)}): it looks stamped automatically, so Google may ignore it. Use each page's real update date.`]);
  if(dt.stale_count) notes.push(["warn",`${dt.stale_count} page${dt.stale_count>1?"s were":" was"} updated after the date in the sitemap: the sitemap isn't being updated when pages change.`]);
  if(d.skipped_gz) notes.push(["info",`${d.skipped_gz} compressed sitemap file${d.skipped_gz>1?"s were":" was"} skipped.`]); if(d.capped||d.incomplete) notes.push(["info","Your sitemaps are very large: only part was read."]);
  box.innerHTML=`${head}
    <div class="grid4" style="margin:10px 0"><div class="panel kpi"><div><div class="num">${fmtN(d.total)}</div><div class="lbl">addresses in ${d.files.length} sitemap file${d.files.length===1?"":"s"}</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.missing_count?"warn":"pass"}">${fmtN(d.missing_count)}</div><div class="lbl">important pages missing</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.bad_count?"warn":"pass"}">${fmtN(d.bad_count)}</div><div class="lbl">entries that shouldn't be there</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.blocked.length?"fail":"pass"}">${fmtN(d.blocked.length)}</div><div class="lbl">blocked for Google by robots.txt</div></div></div></div>
    ${notes.map(([l,t])=>`<p class="${l}" style="margin:4px 0">${t}</p>`).join("")}
    ${d.missing_count||d.bad_count||dt.stale_count?`<p style="margin:8px 0"><button class="btn ghost small" id="sm-csv">Download fixes for your developer (CSV)</button></p>`:""}
    ${d.google?`<h3 style="font-size:15px">What Google has (Search Console)</h3>${d.google.sitemaps.length?`<div class="tw"><table><tr><th>Sitemap</th><th>Last read by Google</th><th>Addresses</th><th>Errors / warnings</th></tr>${d.google.sitemaps.map(g=>`<tr><td><span class="url">${short(g.path)}</span>${g.pending?` <span class="pill">pending</span>`:""}</td><td>${g.last_read?esc(g.last_read.slice(0,10)):`<span class="warn">not yet</span>`}${g.last_read&&Date.now()-Date.parse(g.last_read)>30*864e5?` <span class="warn">(over a month ago)</span>`:""}</td><td>${g.submitted?fmtN(g.submitted):"–"}</td><td>${g.errors?`<b class="fail">${g.errors} errors</b>`:"0 errors"}${g.warnings?`, <span class="warn">${g.warnings} warnings</span>`:""}</td></tr>`).join("")}</table></div>`:`<p class="warn">Google hasn't been given any sitemap for this property. Submit it in Search Console → Sitemaps.</p>`}
      ${d.google.not_submitted.length?`<p class="warn">Listed in robots.txt but not submitted in Search Console: ${d.google.not_submitted.map(u=>`<span class="url">${short(u)}</span>`).join(", ")} (Google may still find it through robots.txt; submitting shows you its errors).</p>`:""}
      ${d.google.unknown.length?`<p class="warn">Submitted in Search Console but not found on your site now: ${d.google.unknown.map(u=>`<span class="url">${short(u)}</span>`).join(", ")}. Remove old submissions.</p>`:""}`:`<p class="status">Connect Search Console (Performance screen) to also see which sitemaps Google has, when it last read them, and any errors it found.</p>`}
    ${d.blocked.length?`<h3 style="font-size:15px">Blocked for Google by robots.txt</h3><div class="tw"><table><tr><th>Page</th><th>Rule</th></tr>${d.blocked.slice(0,20).map(b=>`<tr><td><span class="url">${short(b.url)}</span></td><td><code>${esc(b.rule||"")}</code></td></tr>`).join("")}</table></div>`:""}
    ${d.resources.length?`<p class="fail">robots.txt blocks files Google needs to display your pages: ${d.resources.map(r=>`<code>${esc(r.path)}</code> (${esc(r.rule)})`).join(", ")}. Allow CSS and JavaScript.</p>`:""}
    ${d.missing.length?`<h3 style="font-size:15px">Important pages missing from your sitemaps</h3><p class="status" style="margin-top:0">Pages with Google clicks or several internal links that no sitemap lists.</p><div class="tw"><table><tr><th>Page</th><th>Google clicks</th><th>Internal links</th></tr>${d.missing.slice(0,30).map(m=>`<tr><td><span class="url">${short(m.url)}</span></td><td>${fmtN(m.clicks)}</td><td>${m.inbound}</td></tr>`).join("")}</table></div>`:""}
    ${d.bad.length?`<h3 style="font-size:15px">Entries that shouldn't be in the sitemap</h3><p class="status" style="margin-top:0">Sitemaps should only list pages you want in Google, at their final address (${d.checked} addresses checked).</p><div class="tw"><table><tr><th>Address</th><th>Problem</th></tr>${d.bad.slice(0,40).map(b=>`<tr><td><span class="url">${short(b.url)}</span></td><td><b>${esc(WHY[b.why])}</b>: <span class="status">${esc(b.text)}</span></td></tr>`).join("")}</table></div>`:""}
    <details style="margin-top:10px"><summary class="status">Sitemap files (${d.files.length})${d.sitemaps_in_robots.length?` · listed in robots.txt: ${d.sitemaps_in_robots.length}`:""}</summary><ul class="clean">${d.files.map(f=>`<li><span class="url">${esc(f.url)}</span> <span class="status">${fmtN(f.count)} addresses</span></li>`).join("")}</ul></details>`;
  bindSm();
}
function bindSm(){ const csv=$("#sm-csv"); if(csv) csv.onclick=()=>api(`/api/sites/${SITE_ID}/sitemap-fixes.csv`).catch(e=>toast(e.message,"error")); const run=$("#sm-run"); if(run) run.onclick=()=>busy(run,$("#sm-st"),"Checking…",async()=>{ await api(`/api/sites/${SITE_ID}/sitemap-check`,{method:"POST",body:"{}",onProgress:t=>{ const e=$("#sm-st"); if(e) e.textContent=t; },traceFn:traceUrls}); await renderSitemaps(); }); }
async function renderExt(){taCountsSoon();
  const box=$("#ta-ext"); if(!box||!SITE_ID) return; const d=await api(`/api/sites/${SITE_ID}/extlinks`), short=u=>esc(u.replace(/^https?:\/\/[^/]+/,"")||"/");
  const R=d?.results||[], n=k=>R.filter(x=>x.verdict===k).length, problems=R.filter(x=>["domain","broken","removed","server","moved"].includes(x.verdict));
  box.innerHTML=`<p class="lead" style="margin-top:0">Links from your pages to other websites (sources, tools, partners). Broken links hurt readers and trust; a link whose domain changed hands can now point to spam.</p>
    <div class="row" style="margin:10px 0">${READONLY?"":`<button class="btn" id="ex-run">${d?"Check again":"Check external links"}</button>${d?`<label class="check" style="margin:0"><input type="checkbox" id="ex-all"> check everything</label>`:""}`}<span class="status" id="ex-st" role="status">${d?`Checked ${esc(fmtDate(d.at))}: ${fmtN(d.checked)} link${d.checked===1?"":"s"} checked${d.reused?`, ${fmtN(d.reused)} that worked in the last 7 days reused`:""} (${fmtN(d.total)} on the site). New links are checked automatically after the website is read again.`:""}</span></div>
    ${d&&(d.by_website||[]).length?`<div class="verdict related" style="margin:8px 0"><b>Several broken links to the same website</b> (it may have reorganised): ${d.by_website.slice(0,5).map(w=>`<b>${esc(w.host)}</b>: ${w.links} links on ${w.pages} page${w.pages>1?"s":""}`).join(" · ")}</div>`:""}
    ${d?`<div class="grid4" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num ${n("broken")+n("removed")?"fail":""}">${n("broken")+n("removed")}</div><div class="lbl">broken or removed</div></div></div>
      <div class="panel kpi"><div><div class="num ${n("domain")?"fail":""}">${n("domain")}</div><div class="lbl">now lead to a different website</div></div></div>
      <div class="panel kpi"><div><div class="num ${n("moved")?"warn":""}">${n("moved")}</div><div class="lbl">moved (update the link)</div></div></div>
      <div class="panel kpi"><div><div class="num pass">${n("ok")}</div><div class="lbl">work</div></div></div></div>
      ${problems.length?`<div class="tw"><table><tr><th>Link</th><th>Problem</th><th>On your pages</th></tr>${problems.slice(0,200).map(x=>{ const l=EXT_LABEL[x.verdict]; return `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener nofollow">${esc(x.url.replace(/^https?:\/\//,"").slice(0,70))}</a>${x.in_content?"":` <span class="status">(menu/footer)</span>`}</td>
        <td><span class="pill ${l[0]}">${l[1]}</span><br><span class="status">${esc(x.text)}</span>${x.verdict==="moved"&&x.final_url?`<br><span class="status">New address: <span class="url">${esc(x.final_url)}</span></span>`:""}</td>
        <td>${x.pages.length}<details><summary class="status">which</summary><ul class="clean">${x.pages.slice(0,20).map(u=>`<li><span class="url">${short(u)}</span></li>`).join("")}</ul></details></td></tr>`; }).join("")}</table></div>`:`<p class="pass">No problems found with your links to other websites.</p>`}
      ${n("blocked")?`<p class="status">${n("blocked")} link${n("blocked")>1?"s":""} couldn't be checked because the site blocks automated checks (common for LinkedIn, Amazon and others). They're not counted as broken.</p>`:""}`
      :`<p class="status">Not checked yet.</p>`}`;
  const run=$("#ex-run"); if(run) run.onclick=()=>busy(run,$("#ex-st"),"Checking…",async()=>{ await api(`/api/sites/${SITE_ID}/extlinks/run`,{method:"POST",body:JSON.stringify({all:!!($("#ex-all")&&$("#ex-all").checked)}),onProgress:t=>{ const e=$("#ex-st"); if(e) e.textContent=t; },traceFn:traceUrls}); await renderExt(); });
}

// ---------- duplicate content (Site health → Duplicates) ----------
const DUP_ACTION={merge:["fail","Merge or set one main page"],rewrite:["warn","Rewrite or merge"],handled:["pass","Already handled"]};
async function renderDupes(){taCountsSoon();
  const box=$("#ta-dupes"); if(!box||!SITE_ID) return; const d=await api(`/api/sites/${SITE_ID}/duplicates`), short=u=>esc(u.replace(/^https?:\/\/[^/]+/,"")||"/");
  const open=d.groups.filter(g=>g.action.kind!=="handled");
  box.innerHTML=`<p class="lead" style="margin-top:0">Pages that repeat each other compete in Google and split their ranking. This compares the text of the ${fmtN(d.pages)} pages read (no AI)${d.full_text<d.pages?`; <span class="warn">${fmtN(d.pages-d.full_text)} were read before full-text fingerprints existed and are compared on their first ~400 words. Read the website again for full comparisons.</span>`:"."}</p>
    <div class="grid4" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num ${open.length?"fail":""}">${open.length}</div><div class="lbl">groups of near-duplicate pages</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.blocks.length?"warn":""}">${d.blocks.length}</div><div class="lbl">paragraphs repeated across pages</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.titles.length?"warn":""}">${d.titles.length}</div><div class="lbl">titles used more than once</div></div></div>
      <div class="panel kpi"><div><div class="num ${d.descriptions.length?"warn":""}">${d.descriptions.length}</div><div class="lbl">descriptions used more than once</div></div></div></div>
    ${d.template_only?`<p class="status">${fmtN(d.template_only)} pair${d.template_only>1?"s":""} of pages share mostly template text (the same blocks across a section), so they aren't counted as duplicates.</p>`:""}
    ${d.groups.length?`<h3 style="font-size:15px">Near-duplicate pages</h3>${d.groups.slice(0,30).map((g,gi)=>{ const a=DUP_ACTION[g.action.kind]; return `<div class="ans" style="margin:8px 0"><div class="row" style="justify-content:space-between"><b>${g.pages.length} pages, ${g.similarity===g.min_similarity?"":`${g.min_similarity}–`}${g.similarity}% the same${g.template_share&&g.raw_similarity>g.similarity?` <span class="status" style="font-weight:400">(${g.raw_similarity}% including the shared template)</span>`:""}</b><span class="row"><span class="pill ${a[0]}">${a[1]}</span><button class="btn ghost small" data-dcmp="${gi}">Compare side by side</button></span></div>
      <ul class="clean" style="margin:6px 0">${g.pages.map((p,i)=>`<li><span class="url">${short(p.url)}</span> <span class="status">${fmtN(p.words)} words${p.clicks?` · ${fmtN(p.clicks)} Google clicks`:""}${p.canonical&&p.canonical!==p.url?` · canonical → ${short(p.canonical)}`:""}${i===0&&g.action.kind!=="handled"?" · <b>suggested main page</b>":""}</span></li>`).join("")}</ul>
      <p class="status" style="margin:0">${esc(g.action.text)}</p><div data-dcmpout="${gi}"></div></div>`; }).join("")}`:`<p class="pass">No near-duplicate pages found.</p>`}
    ${d.blocks.length?`<details style="margin-top:10px"><summary><b>Paragraphs repeated across pages (${d.blocks.length})</b> <span class="status">(on 3+ pages, not counting menus and footers)</span></summary><div class="tw"><table><tr><th>Paragraph starts with</th><th>Pages</th></tr>${d.blocks.map(b=>`<tr><td>“${esc(b.preview)}…”</td><td>${b.urls.length}<details><summary class="status">which</summary><ul class="clean">${b.urls.slice(0,15).map(u=>`<li><span class="url">${short(u)}</span></li>`).join("")}</ul></details></td></tr>`).join("")}</table></div><p class="status">A repeated sales or promo block is fine; repeated explanations make pages look alike. Keep the shared part short and make the rest of each page unique.</p></details>`:""}
    ${d.titles.length?`<details style="margin-top:8px"><summary><b>Titles used more than once (${d.titles.length})</b></summary><div class="tw"><table><tr><th>Title</th><th>Pages</th></tr>${d.titles.map(t=>`<tr><td>${esc(t.text)}</td><td>${t.urls.map(u=>`<span class="url">${short(u)}</span>`).join("<br>")}</td></tr>`).join("")}</table></div></details>`:""}
    ${d.descriptions.length?`<details style="margin-top:8px"><summary><b>Descriptions used more than once (${d.descriptions.length})</b></summary><div class="tw"><table><tr><th>Description</th><th>Pages</th></tr>${d.descriptions.map(t=>`<tr><td>${esc(t.text.slice(0,140))}</td><td>${t.urls.length}</td></tr>`).join("")}</table></div></details>`:""}`;
  box.querySelectorAll("[data-dcmp]").forEach(b=>b.onclick=()=>{ const g=d.groups[+b.dataset.dcmp], out=box.querySelector(`[data-dcmpout="${b.dataset.dcmp}"]`);
    busy(b,out,"Reading both pages…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/duplicates/compare`,{method:"POST",body:JSON.stringify({a:g.pages[0].url,b:g.pages[1].url})});
      const col=(t,list,cls)=>`<div><b>${t} (${list.length})</b>${list.slice(0,25).map(x=>`<p class="${cls}" style="margin:4px 0;font-size:13.5px">${esc(x)}</p>`).join("")||`<p class="status">None</p>`}${list.length>25?`<p class="status">…and ${list.length-25} more</p>`:""}</div>`;
      out.innerHTML=`<div class="panel" style="margin-top:8px"><p style="margin-top:0"><b>${r.shared_pct}% of their sentences are the same.</b> <span class="status">${short(r.a.url)} vs ${short(r.b.url)}</span></p>
        <div class="grid3">${col("Only on "+(r.a.url.replace(/^https?:\/\/[^/]+/,"")||"/"),r.onlyA,"")}${col("On both",r.shared,"warn")}${col("Only on "+(r.b.url.replace(/^https?:\/\/[^/]+/,"")||"/"),r.onlyB,"")}</div></div>`; }); });
}

// ---------- structured data (Site health → Structured data) ----------
async function renderSchema(){taCountsSoon();
  const box=$("#ta-schema"); if(!box||!SITE_ID) return; const d=await api(`/api/sites/${SITE_ID}/schema`), short=u=>esc(u.replace(/^https?:\/\/[^/]+/,"")||"/");
  const errs=(d?.problems||[]).filter(p=>p.level==="error"), warns=(d?.problems||[]).filter(p=>p.level==="warning");
  box.innerHTML=`<p class="lead" style="margin-top:0">Checks the structured data (JSON-LD) on your homepage and top pages against Google's published requirements for rich results: missing required fields, wrong formats, and which rich results each page qualifies for. (Google's own Rich Results Test has no API; use it to double-check important pages.)</p>
    <div class="row" style="margin:10px 0">${READONLY?"":`<select id="sc-count" aria-label="How many pages" style="width:auto"><option value="10">10 pages</option><option value="30" selected>30 pages</option><option value="50">50 pages</option></select><button class="btn" id="sc-run">${d?"Check again":"Check structured data"}</button>${d?`<label class="check" style="margin:0"><input type="checkbox" id="sc-force"> include pages checked in the last 24 hours</label>`:""}`}<span class="status" id="sc-st" role="status">${d?`Checked ${esc(fmtDate(d.at))} on ${d.pages.length} pages${d.reused?` (${d.reused} reused from the last 24 hours)`:""}${d.changed?` · ${d.changed} page${d.changed>1?"s'":"'s"} markup changed since the previous check`:""}.`:""}</span></div>
    ${d&&(d.fixed_since||[]).length?`<div class="verdict create" style="margin:8px 0">Fixed since the previous check: ${d.fixed_since.slice(0,5).map(f=>`<b>${esc(f.problem.replace(/^[^:]+: /,"").slice(0,70))}</b> on <span class="url">${short(f.url)}</span>`).join("; ")}${d.fixed_since.length>5?` and ${d.fixed_since.length-5} more`:""}.</div>`:""}
    ${d?`${d.types.length?`<h3 style="font-size:15px">Rich results found</h3><div class="tw"><table><tr><th>Type</th><th>Rich result</th><th>Pages</th><th>Qualify</th></tr>${d.types.map(t=>`<tr><td>${esc(t.type)}</td><td>${esc(t.result)}${t.note?`<br><span class="status">${esc(t.note)}</span>`:""}</td><td>${t.pages}</td><td class="${t.note?"":t.eligible===t.pages?"pass":t.eligible?"warn":"fail"}">${t.note?"–":`${t.eligible} of ${t.pages}`}</td></tr>`).join("")}</table></div>`:`<p class="warn">No structured data found on the pages checked. Adding it (Organization on the homepage, Article on posts, Product on product pages, BreadcrumbList everywhere) helps Google understand and display your pages.</p>`}
      ${errs.length?`<h3 style="font-size:15px;margin-top:12px">Errors (block rich results)</h3><div class="tw"><table><tr><th>Problem</th><th>Pages</th></tr>${errs.map(p=>`<tr><td><b>${esc(p.type)}</b>: ${esc(p.message)}</td><td>${p.pages.length}<details><summary class="status">which</summary><ul class="clean">${p.pages.slice(0,20).map(u=>`<li><span class="url">${short(u)}</span></li>`).join("")}</ul></details></td></tr>`).join("")}</table></div>`:d.types.length?`<p class="pass">No errors.</p>`:""}
      ${(()=>{ const ep=d.pages.map((p,i)=>({p,i})).filter(({p})=>(p.items||[]).some(it=>it.raw)); return ep.length?`<h3 style="font-size:15px;margin-top:12px">Pages with errors: ready-to-paste fixes</h3>${ep.slice(0,20).map(({p,i})=>`<div class="ans" style="margin:6px 0"><div class="row" style="justify-content:space-between"><span><span class="url">${short(p.url)}</span>${p.changed?` <span class="pill">markup changed</span>`:""}</span><button class="btn ghost small" data-scfix="${i}">Get fixed JSON-LD</button></div><div data-scfixout="${i}"></div></div>`).join("")}`:""; })()}
      ${warns.length?`<details style="margin-top:8px"><summary><b>Recommendations (${warns.length})</b> <span class="status">(optional fields that improve how results look)</span></summary><div class="tw"><table><tr><th>Suggestion</th><th>Pages</th></tr>${warns.map(p=>`<tr><td><b>${esc(p.type)}</b>: ${esc(p.message)}</td><td>${p.pages.length}</td></tr>`).join("")}</table></div></details>`:""}
      ${(()=>{ const md=d.pages.filter(p=>(p.microdata||0)+(p.rdfa||0)>0&&!(p.items||[]).length).length; return md?`<p class="status">${md} page${md>1?"s use":" uses"} Microdata or RDFa instead of JSON-LD. They're counted but not checked in detail; Google recommends JSON-LD.</p>`:""; })()}
      ${d.pages.filter(p=>p.error).length?`<p class="status">${d.pages.filter(p=>p.error).length} page(s) couldn't be read.</p>`:""}`
      :`<p class="status">Not checked yet.</p>`}`;
  const run=$("#sc-run"); if(run) run.onclick=()=>busy(run,$("#sc-st"),"Reading pages…",async()=>{ await api(`/api/sites/${SITE_ID}/schema/run`,{method:"POST",body:JSON.stringify({count:+$("#sc-count").value,force:!!($("#sc-force")&&$("#sc-force").checked)}),onProgress:t=>{ const e=$("#sc-st"); if(e) e.textContent=t; }}); await renderSchema(); });
  // ready-to-paste fixes, per page
  box.querySelectorAll("[data-scfix]").forEach(b=>b.onclick=()=>{ const pgr=d.pages[+b.dataset.scfix], out=box.querySelector(`[data-scfixout="${b.dataset.scfix}"]`);
    const fixes=(pgr.items||[]).filter(it=>it.raw).map(it=>({type:it.type,...SCHEMA.fixObject(JSON.parse(it.raw),pgr.url)}));
    out.innerHTML=fixes.map((f,k)=>`<div style="margin:8px 0"><b>${esc(f.type)}</b>${f.changes.length?`<ul class="clean" style="margin:4px 0">${f.changes.map(c=>`<li class="pass">✓ ${esc(c)}</li>`).join("")}</ul>`:""}${f.needs.length?`<ul class="clean" style="margin:4px 0">${f.needs.map(c=>`<li class="warn">Needs your input: ${esc(c)}</li>`).join("")}</ul>`:""}
      ${f.changes.length?`<pre class="code" style="white-space:pre-wrap;max-height:260px;overflow:auto">${esc(JSON.stringify({"@context":"https://schema.org",...f.fixed},null,2))}</pre><button class="btn ghost small" data-sccopy="${k}">Copy fixed JSON-LD</button>`:""}</div>`).join("")||`<p class="status">Nothing to fix automatically.</p>`;
    out.querySelectorAll("[data-sccopy]").forEach(c=>c.onclick=async()=>{ try{ await navigator.clipboard.writeText(`<script type="application/ld+json">\n${JSON.stringify({"@context":"https://schema.org",...fixes[+c.dataset.sccopy].fixed},null,2)}\n</script>`); c.textContent="Copied"; }catch{} }); });
}

// ---------- internal link map (Site health → Links) ----------
const SEC_COLORS=["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c6)","var(--c5)"];
async function renderLinks(fresh=false){taCountsSoon();
  const box=$("#ta-links"); if(!box||!SITE_ID) return; const m=await api(`/api/sites/${SITE_ID}/links${fresh?"?fresh=1":""}`);
  if(m.pages<5){ box.innerHTML=emptyBox("Read more pages first","The link map needs at least 5 pages read from your site."); return; }
  const R=m.rows, orphans=R.filter(r=>r.url!==m.home&&r.inbound===0), deep=R.filter(r=>r.depth!=null&&r.depth>=4), unreach=R.filter(r=>r.depth==null&&r.url!==m.home);
  const partial=m.coverage<0.8, orphanLabel=partial?"pages with no links from the pages read":"orphan pages (no links to them)";
  const avgDepth=(()=>{ const d=R.filter(r=>r.depth!=null).map(r=>r.depth); return d.length?(d.reduce((a,b)=>a+b,0)/d.length).toFixed(1):"–"; })();
  const short=u=>esc(u.replace(/^https?:\/\/[^/]+/,"")||"/");
  const L=m.layout, W=900, H=520, col=sec=>SEC_COLORS[L.sections.indexOf(sec)%SEC_COLORS.length];
  box.innerHTML=`<p class="lead" style="margin-top:0">How your pages link to each other, from the ${fmtN(m.pages)} pages read${m.discovered?` (${m.coverage<0.01?"less than 1%":Math.round(m.coverage*100)+"%"} of about ${fmtN(m.discovered)} pages on the site)`:""}. Pages that nothing links to, or that sit many clicks from the homepage, are found and valued less by Google.${partial?` <span class="warn">Only part of the site was read, so some pages listed as unlinked may be linked from pages that weren't read. Read more pages (Websites) for a complete picture; orphan to-dos are only created once at least 80% is read.</span>`:""}${m.has_content_links?"":` <span class="warn">Read the website again to separate links in the content from menu links and get better suggestions.</span>`}</p>
    <p class="status" style="margin-top:-4px">${m.from_cache?`Worked out ${esc(fmtDate(m.computed_at))} and reused until pages are read again.`:"Just worked out."} <button class="linkbtn" data-lrecalc>Recalculate</button></p>
    <div class="grid4" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num ${orphans.length?"fail":""}">${orphans.length}</div><div class="lbl">${orphanLabel}</div></div></div>
      <div class="panel kpi"><div><div class="num ${deep.length?"warn":""}">${deep.length}</div><div class="lbl">pages 4+ clicks from home</div></div></div>
      <div class="panel kpi"><div><div class="num">${avgDepth}</div><div class="lbl">average clicks from home</div></div></div>
      <div class="panel kpi"><div><div class="num">${fmtN(m.edges.length)}</div><div class="lbl">links between pages, in content</div></div></div></div>
    ${m.progress&&m.progress.total?`<div class="verdict ${m.progress.added?"create":"related"}" style="margin:8px 0">Since the previous read: <b>${m.progress.added} of ${m.progress.total}</b> suggested links were added.${m.progress.added?` For example on ${short(m.progress.examples[0].from)} → ${short(m.progress.examples[0].to)}.`:""}</div>`:""}
    ${(()=>{ if(!m.suggestions.length) return ""; const bySrc=new Map(); for(const x of m.suggestions){ const l=bySrc.get(x.from)||[]; l.push(x); bySrc.set(x.from,l); }
      const planned=new Set((m.plans||[]).map(p=>p.from));
      return `<h3 style="font-size:15px">Suggested links to add <span class="status" style="font-weight:400">(grouped by the page to edit; pages that already get Google traffic first)</span></h3>
      ${[...bySrc.entries()].sort((a,b)=>(b[1][0].from_clicks||0)-(a[1][0].from_clicks||0)).map(([from,list],g)=>`<div class="ans" style="margin:8px 0"><div class="row" style="justify-content:space-between"><b>On <span class="url">${short(from)}</span>${list[0].from_clicks?` <span class="status" style="font-weight:400">· ${fmtN(list[0].from_clicks)} Google clicks</span>`:""}</b>
          <span class="row"><button class="btn ghost small" data-lgcopy="${g}">Copy as a list</button>${READONLY?"":planned.has(from)?`<span class="pill pass">To-do added</span>`:`<button class="btn ghost small" data-lgplan="${g}">Make it a to-do</button>`}</span></div>
        <ul class="clean" style="margin:6px 0 0">${list.map(x=>`<li>Link <b>“${esc(x.anchor)}”</b> to <span class="url">${short(x.to)}</span> <span class="status">(${esc(x.reason)})</span>${x.sentence?`<br><span class="status">In: “${esc(x.sentence)}”</span>`:""}</li>`).join("")}</ul></div>`).join("")}`; })()}
    ${orphans.length?`<details ${orphans.length<=15?"open":""}><summary><b>${partial?"Pages with no links from the pages read":"Orphan pages"} (${orphans.length})</b></summary><div class="tw"><table><tr><th>Page</th><th>Google clicks</th><th>Words</th></tr>${orphans.sort((a,b)=>b.clicks-a.clicks).slice(0,100).map(r=>`<tr><td><span class="url">${short(r.url)}</span></td><td>${fmtN(r.clicks)}</td><td>${fmtN(r.words)}</td></tr>`).join("")}</table></div></details>`:""}
    ${deep.length?`<details><summary><b>Pages 4 or more clicks from the homepage (${deep.length})</b></summary><div class="tw"><table><tr><th>Page</th><th>Clicks from home</th><th>Links to it</th></tr>${deep.sort((a,b)=>b.depth-a.depth).slice(0,100).map(r=>`<tr><td><span class="url">${short(r.url)}</span></td><td>${r.depth}</td><td>${r.inbound}</td></tr>`).join("")}</table></div></details>`:""}
    <details><summary><b>Most and least linked pages</b></summary><div class="tw"><table><tr><th>Page</th><th>Links to it (content)</th><th>Links to it (all)</th><th>Links out (content)</th><th>Clicks from home</th></tr>
      ${[...R].sort((a,b)=>b.inbound_content-a.inbound_content).slice(0,15).concat([...R].sort((a,b)=>a.inbound_content-b.inbound_content).slice(0,10)).map(r=>`<tr><td><span class="url">${short(r.url)}</span></td><td>${r.inbound_content}</td><td>${r.inbound}</td><td>${r.outbound_content}</td><td>${r.depth??"not reachable"}</td></tr>`).join("")}</table></div></details>
    <h3 style="font-size:15px;margin-top:14px">Map <span class="status" style="font-weight:400">(the ${L.nodes.length} most linked pages; size = links to it; colour = site section; red outline = orphan)</span></h3>
    <div class="tw"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:600px;display:block" role="img" aria-label="Map of links between your pages">
      ${L.edges.map(([a,b])=>`<line x1="${(L.nodes[a].x*W).toFixed(1)}" y1="${(L.nodes[a].y*H).toFixed(1)}" x2="${(L.nodes[b].x*W).toFixed(1)}" y2="${(L.nodes[b].y*H).toFixed(1)}" stroke="var(--line)" stroke-width="0.8"/>`).join("")}
      ${L.nodes.map((n,i)=>`<circle data-lnode="${i}" cx="${(n.x*W).toFixed(1)}" cy="${(n.y*H).toFixed(1)}" r="${(4+Math.min(14,Math.sqrt(n.inbound_content)*2.2)).toFixed(1)}" fill="${col(n.section)}" fill-opacity=".8" stroke="${n.inbound===0&&n.url!==m.home?"var(--bad)":"var(--panel)"}" stroke-width="${n.inbound===0&&n.url!==m.home?2.5:1}" style="cursor:pointer"><title>${esc(n.title)} (${short(n.url)}): ${n.inbound_content} content links in</title></circle>`).join("")}
    </svg></div>
    <p class="status">${L.sections.slice(0,8).map(sec=>`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${col(sec)};margin:0 4px 0 10px"></span>${esc(sec)}`).join("")}${unreach.length?` · ${unreach.length} pages can't be reached by following links from the homepage.`:""}</p>`;
  const groups=(()=>{ const bySrc=new Map(); for(const x of m.suggestions){ const l=bySrc.get(x.from)||[]; l.push(x); bySrc.set(x.from,l); } return [...bySrc.entries()].sort((a,b)=>(b[1][0].from_clicks||0)-(a[1][0].from_clicks||0)); })();
  box.querySelectorAll("[data-lgcopy]").forEach(b=>b.onclick=async()=>{ const [from,list]=groups[+b.dataset.lgcopy]; const txt=`On ${from}, add these links:\n`+list.map(x=>`- Link "${x.anchor}" to ${x.to}${x.sentence?` in the sentence: "${x.sentence}"`:" (add a sentence where it fits)"}\n  HTML: <a href="${x.to}">${x.anchor}</a>`).join("\n");
    try{ await navigator.clipboard.writeText(txt); b.textContent="Copied"; }catch{} });
  box.querySelectorAll("[data-lgplan]").forEach(b=>b.onclick=async()=>{ const [from,list]=groups[+b.dataset.lgplan]; await api(`/api/sites/${SITE_ID}/link-plans`,{method:"POST",body:JSON.stringify({from,links:list})}); toast("Added to your to-do list. It clears itself once the links are on the page and the site is read again."); renderLinks(); });
  const rc=box.querySelector("[data-lrecalc]"); if(rc) rc.onclick=()=>renderLinks(true);
  box.querySelectorAll("[data-lnode]").forEach(c=>c.onclick=()=>{ TA_TAB="pages"; renderAudit(); openPage(L.nodes[+c.dataset.lnode].url); });
}

// ---------- "Is this page in Google?" (Site health → In Google) ----------
const IDX_PILL={ok:["pass","In Google"],intended:["","Not indexed (on purpose)"],problem:["fail","Not in Google"]};
let IDX_CTRL=null;
async function renderIndex(){taCountsSoon();
  const box=$("#ta-index"); if(!box||!SITE_ID) return; const conn=await GSCC.get(SITE_ID), d=await api(`/api/sites/${SITE_ID}/index`).catch(()=>null);
  if(!conn||!conn.property){ box.innerHTML=`<p class="lead" style="margin-top:0">Check whether your important pages are in Google's index, when Google last read them, and which page Google treats as the main version.</p>
    <div class="verdict related">This uses your Search Console connection. Connect it first under <button class="linkbtn" data-go="gsc">Google search</button> (free, read-only).</div>`; bindGo(box); return; }
  const rs=d?.results||[], n=k=>rs.filter(r=>r.status===k).length, mism=rs.filter(r=>r.canonical_mismatch).length;
  const order={problem:0,intended:1,ok:2};
  box.innerHTML=`<p class="lead" style="margin-top:0">Whether your important pages are in Google, from Search Console's URL Inspection (free, up to 2,000 checks a day). A page that isn't in Google can't get any Google traffic.</p>
    ${rs.length?`<div class="grid3" style="margin-bottom:10px"><div class="panel kpi"><div><div class="num pass">${n("ok")}</div><div class="lbl">in Google</div></div></div><div class="panel kpi"><div><div class="num ${n("problem")?"fail":""}">${n("problem")}</div><div class="lbl">not in Google (problems)</div></div></div><div class="panel kpi"><div><div class="num">${mism}</div><div class="lbl">Google chose a different main page</div></div></div></div>`:""}
    <div class="row" style="margin:10px 0">${READONLY?"":`<select id="ix-count" aria-label="How many pages" style="width:auto"><option value="10">10 pages</option><option value="20" selected>20 pages</option><option value="50">50 pages</option></select>
      <button class="btn" id="ix-run">${rs.length?"Check again":"Check my pages in Google"}</button><label class="check" style="margin:0"><input type="checkbox" id="ix-force"> include pages checked in the last 3 days</label><button class="btn ghost hidden" id="ix-stop">Stop</button>`}
      <span class="status" id="ix-status" role="status">${d?`Last checked ${esc(fmtDate(d.at))} · property ${esc(conn.property)}`:`Property: ${esc(conn.property)}`}</span></div>
    ${(d?.changes||[]).filter(c=>Date.now()-c.at<30*864e5).length?`<div class="panel" style="margin:8px 0"><b>Changes in the last 30 days</b><ul class="clean" style="margin:6px 0 0">${d.changes.filter(c=>Date.now()-c.at<30*864e5).slice(0,15).map(c=>`<li><span class="${c.kind==="dropped"?"fail":c.kind==="fixed"?"pass":"warn"}">${c.kind==="dropped"?"Dropped out of Google":c.kind==="fixed"?"Now in Google":"Status changed"}</span> · <span class="url">${esc(c.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span> <span class="status">${esc(fmtDate(c.at))}: “${esc(c.from)}” → “${esc(c.to)}”</span></li>`).join("")}</ul></div>`:""}
    ${d?.checked!=null?`<p class="status">Last run: ${d.checked} page${d.checked===1?"":"s"} checked${d.skipped?`, ${d.skipped} skipped (checked in the last 3 days; Google's index rarely changes faster)`:""}. Earlier problems, new or changed pages and pages losing traffic are checked first.</p>`:""}
    ${(d?.errors||[]).length?`<p class="warn">${d.errors.length} page${d.errors.length>1?"s":""} couldn't be checked: ${esc(d.errors[0].error)}</p>`:""}
    ${rs.length?`<div class="tw"><table><tr><th>Page</th><th>Status</th><th>What it means</th><th>Last read by Google</th><th><span class="sr-only">Report</span></th></tr>
      ${[...rs].sort((a,b)=>order[a.status]-order[b.status]||(b.canonical_mismatch?1:0)-(a.canonical_mismatch?1:0)).map(r=>`<tr><td><span class="url">${esc(r.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</span></td>
        <td><span class="pill ${IDX_PILL[r.status][0]}">${IDX_PILL[r.status][1]}</span><br><span class="status">${esc(r.coverage)}</span></td>
        <td>${esc(r.meaning)}${r.fix?`<br><b>Fix:</b> ${esc(r.fix)}`:""}${r.canonical_mismatch?`<br><span class="warn">Google chose a different main page: <span class="url">${esc(r.google_canonical)}</span> (yours: <span class="url">${esc(r.user_canonical)}</span>)</span>`:""}
          ${r.rich.some(x=>x.issues.length)?`<br><span class="warn">Rich result issues: ${esc(r.rich.flatMap(x=>x.issues.map(i=>`${x.type}: ${i.message}`)).slice(0,3).join("; "))}</span>`:""}</td>
        <td class="status">${r.last_crawl?esc(fmtDate(Date.parse(r.last_crawl))):"never"}${r.crawled_as?`<br>${esc(r.crawled_as.toLowerCase())}`:""}<br>checked ${esc(fmtDate(r.at))}${r.by==="schedule"?" (weekly)":""}</td>
        <td>${r.link?`<a href="${esc(r.link)}" target="_blank" rel="noopener">Full report</a>`:""}</td></tr>`).join("")}</table></div>`
      :`<p class="status">Not checked yet. The check covers your homepage and the pages Google sends the most visitors to.</p>`}`;
  const run=$("#ix-run"); if(run) run.onclick=()=>{ IDX_CTRL=new AbortController(); $("#ix-stop").classList.remove("hidden"); const id=SITE_ID;
    busy(run,$("#ix-status"),"Asking Google about your pages…",async()=>{ try{ await api(`/api/sites/${id}/index/run`,{method:"POST",body:JSON.stringify({count:+$("#ix-count").value,force:$("#ix-force").checked}),
      onProgress:t=>{ const e=$("#ix-status"); if(e) e.textContent=t; }, signal:IDX_CTRL.signal, inspectFn:url=>GSCC.inspect(id,url)}); } finally { IDX_CTRL=null; } await renderIndex(); }); };
  const stop=$("#ix-stop"); if(stop) stop.onclick=()=>{ if(IDX_CTRL) IDX_CTRL.abort(); };
}

// ---------- weekly monitoring ----------
let MONSTAT=null;
function monHeaders(){ const st=AUTH.state(), h={"content-type":"application/json"}; if(st.accounts&&st.workspace) h["x-workspace"]=st.workspace.id; else { const k=SYNC.syncSettings().teamKey; if(k) h["x-team-key"]=k; } return h; }
function monResultsHtml(list){
  return list.map(r=>{ const serious=r.issues.filter(i=>!i.minor), t=r.traffic;
    return `<div class="ans"><b>${r.needs_attention?"⚠️":"✅"} ${esc(r.site.name)}</b> <span class="status">checked ${esc(fmtDate(r.at))} · ${r.pages_checked} key pages</span>
      <ul style="margin:6px 0 0">${serious.length?serious.slice(0,8).map(i=>`<li class="fail">${esc(i.url)} ${esc(i.detail)}</li>`).join(""):`<li class="pass">All key pages load normally.</li>`}
      ${r.issues.filter(i=>i.minor).map(i=>`<li class="status">${esc(i.url)} ${esc(i.detail)}</li>`).join("")}
      ${t?`<li>Google clicks, last 7 days: <b>${fmtN(t.clicks)}</b>${t.change!=null?` (${t.change>0?"+":""}${t.change}% vs the week before)`:""}${t.drops.length?`; losing clicks: ${t.drops.map(d=>`${esc(d.page)} (${d.before} → ${d.now})`).join(", ")}`:""}</li>`:r.traffic_error?`<li class="fail">Search Console: ${esc(r.traffic_error)}</li>`:`<li class="status">No Search Console connection, so traffic wasn't compared.</li>`}
      ${r.updates.length?`<li>Google updates: ${r.updates.map(u=>esc(u.name)).join(", ")}</li>`:""}
      ${r.approvals.length?`<li>${r.approvals.length} page${r.approvals.length>1?"s":""} ready for approval</li>`:""}${r.overdue.length?`<li class="warn">${r.overdue.length} overdue to-do${r.overdue.length>1?"s":""}</li>`:""}</ul></div>`; }).join("");
}
async function renderMonitoring(){
  if(!$("#mon-panel")) return;
  if(!MONSTAT){ try{ const r=await fetch("/api/monitor?op=status"); MONSTAT=r.ok?await r.json():{missing:true}; }catch{ MONSTAT={missing:true}; } }
  const onServer=AUTH.state().accounts||SYNC.syncSettings().enabled;
  $("#mon-req").innerHTML=MONSTAT.missing?`<span class="warn">The monitoring functions aren't deployed yet. Push the latest code to GitHub.</span>`
    :!onServer?`<span class="warn">Needs team sync or accounts (section 3), so your data is on the server where the weekly check runs.</span>`
    :!MONSTAT.email?`<span class="warn">Checks will run and show here, but emails need an email key: add RESEND_API_KEY (and MONITOR_FROM) in Netlify. See the README.</span>`:`<span class="pass">Ready. Emails come from ${esc(MONSTAT.from)}.</span>`;
  const m=await api("/api/monitor-settings").catch(()=>({})), old=(await store.get("monitor",null))||{};
  const cfg={ enabled:!!(m.enabled??old.enabled), recipients:(m.emails&&m.emails.length?m.emails:old.recipients)||[], day:m.day??old.day??1, sites:m.sites??old.sites??[], only_when_needed:!!(m.only_changes??old.only_when_needed) }, sites=await api("/api/sites");
  { const st=AUTH.state(), shared=st.accounts||SYNC.syncSettings().enabled; const note=$("#mon-note"); if(note) note.innerHTML=shared?"The weekly check runs on Netlify for every chosen website in this workspace, on the chosen day.":`<span class="warn">Automatic weekly checks need team sync or accounts (Team & data), so your data is on the server where the check runs.</span>`; }
  $("#mon-to").value=(cfg.recipients||[]).join(", "); $("#mon-day").value=String(cfg.day??1); $("#mon-quiet").checked=!!cfg.only_when_needed; $("#mon-on").checked=!!cfg.enabled;
  $("#mon-sites").innerHTML=sites.length?sites.map(x=>`<label class="check" style="margin:0 12px 0 0"><input type="checkbox" value="${x.id}" ${(!cfg.sites||!cfg.sites.length||cfg.sites.includes(x.id))?"checked":""}> ${esc(x.name||x.url)}</label>`).join(""):`<span class="status">Add a website first.</span>`;
  const log=(await store.get("monitor-log",null))||[], latest=new Map(); for(const r of log) if(!latest.has(r.site.id)) latest.set(r.site.id,r);
  $("#mon-results").innerHTML=latest.size?`<h3 style="font-size:15px;margin:6px 0">Latest checks</h3>${monResultsHtml([...latest.values()])}`:"";
}
const monRead=()=>({ enabled:$("#mon-on").checked, recipients:$("#mon-to").value.split(/[,;\s]+/).map(x=>x.trim()).filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0,20),
  day:Number($("#mon-day").value), sites:[...document.querySelectorAll("#mon-sites input:checked")].map(x=>+x.value), only_when_needed:$("#mon-quiet").checked });
$("#mon-save").onclick=()=>busy($("#mon-save"),$("#mon-status"),"Saving…",async()=>{ if(READONLY) throw new Error("Your role is view-only.");
  const c=monRead();   // email is optional: results also show on Home and in chat alerts
  await api("/api/monitor-settings",{method:"POST",body:JSON.stringify({enabled:c.enabled,emails:c.recipients,only_changes:c.only_when_needed,day:c.day,sites:c.sites})}); await SYNC.syncNow().catch(()=>{}); setStatus().catch(()=>{});
  $("#mon-status").textContent=c.enabled&&!c.recipients.length?`Saved. Checks run every ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][c.day]}; results show on Home and in chat alerts. Add an email address to also get them by email.`:c.enabled?`Saved. Checks run every ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][c.day]} for ${c.sites.length} website${c.sites.length===1?"":"s"}.`:"Saved. Weekly monitoring is off."; });
$("#mon-run").onclick=()=>busy($("#mon-run"),$("#mon-status"),"Sharing your latest data, then checking…",async()=>{
  const c=monRead(); if(!c.sites.length) throw new Error("Choose at least one website.");
  if(!(AUTH.state().accounts||SYNC.syncSettings().enabled)) throw new Error("Turn on team sync or accounts first (section 3).");
  await store.set("monitor",{...((await store.get("monitor",null))||{}),...c,enabled:(await store.get("monitor",null))?.enabled??false}); await SYNC.syncNow();
  const r=await fetch("/api/monitor",{method:"POST",credentials:"same-origin",headers:monHeaders(),body:JSON.stringify({site_ids:c.sites,email:$("#mon-mail").checked})});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(r.status===404&&!d.error?"The monitoring function isn't deployed yet. Push the latest code to GitHub.":d.error||`Check failed (${r.status})`);
  await SYNC.syncNow().catch(()=>{}); await renderMonitoring();
  $("#mon-status").textContent=`Checked ${d.checked} website${d.checked===1?"":"s"}.${d.mail?.sent?` Email sent to ${d.mail.sent} recipient${d.mail.sent>1?"s":""}.`:d.mail?.skipped?` ${d.mail.skipped}`:d.mail?.error?` ${d.mail.error}`:""}`; });

// ---------- weekly monitoring ----------
const MON_LEVEL={alert:["fail","Needs attention"],watch:["warn","Keep an eye on"],ok:["pass","All good"],good:["pass","Good news"],info:["","For information"]};
async function renderMonitorHome(){
  const box=$("#home-monitor"); if(!box) return; if(!SITE_ID){ box.innerHTML=""; return; }
  const hist=await api(`/api/sites/${SITE_ID}/monitor`).catch(()=>[]), last=hist[0];
  const items=last?last.summary.items:[];
  box.innerHTML=`<div class="panel"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Weekly check ${last?`<span class="pill ${MON_LEVEL[last.summary.level][0]}">${esc(last.summary.headline)}</span>`:""}</h2>
      <div class="row">${READONLY?"":`<button class="btn ghost small" id="monh-run">Run the check now</button>`}<button class="btn ghost small" data-go="settings">Monitoring settings</button></div></div>
    ${last?`<p class="status" style="margin:6px 0 10px">Checked ${esc(fmtDate(last.at))}${last.by==="schedule"?" (automatic)":""} · ${last.pages.checked} important pages${last.google?` · Google: ${last.google.clicks_change!=null?`${last.google.clicks_change>0?"+":""}${last.google.clicks_change}% clicks, last 7 days vs the 7 before`:"compared"} (${esc(last.google_source||"")})`:" · no Google data"}</p>
      ${items.length?`<ul class="clean">${items.slice(0,8).map(i=>`<li><span class="pill ${MON_LEVEL[i.level]?.[0]||""}">${esc(MON_LEVEL[i.level]?.[1]||i.level)}</span> ${esc(i.text)}${i.detail?`<br><span class="status">${esc(i.detail)}</span>`:""}</li>`).join("")}</ul>${items.length>8?`<p class="status">…and ${items.length-8} more.</p>`:""}`:`<p class="pass">Nothing important changed on the pages checked.</p>`}`
    :`<p class="status" style="margin:6px 0 0">See what changed since the website was last read: pages that broke, vanished from Google or lost their text, traffic drops, Google updates and work waiting for you.</p>`}
    <span class="status" id="monh-run-status" role="status"></span></div>`;
  bindGo(box);
  const b=$("#monh-run"); if(b) b.onclick=()=>busy(b,$("#monh-run-status"),"Checking…",async()=>{ const id=SITE_ID;
    const snap=await api(`/api/sites/${id}/monitor/run`,{method:"POST",body:"{}",onProgress:t=>{ const e=$("#monh-run-status"); if(e) e.textContent=t; },gscFetch:()=>GSCC.weekData(id)}); renderMonitorHome();
    if(snap?.summary?.level==="alert") chatEvent("urgent",`Urgent: ${CURRENT_SITE?.name||"your website"}`,(snap.summary.items||[]).filter(i=>i.level==="alert").map(i=>i.text)); });
}
// (one weekly monitoring panel: renderMonitoring loads and saves what the weekly job reads)
// ---------- Search Console connection ----------
async function gscRefresh(manual){ const id=SITE_ID, st=$("#gscc-status");
  const run=async()=>{ const data=await GSCC.refresh(id,t=>{ if(st) st.textContent=t; }); const r=await api(`/api/sites/${id}/gsc/api-import`,{method:"POST",body:JSON.stringify(data)});
    if(SITE_ID===id){ await loadGsc(); const s2=$("#gscc-status"); if(s2) s2.textContent=`Updated: ${fmtN(r.rows)} rows from Google${r.previous?`, plus ${fmtN(r.previous)} for the earlier period`:""}.`; } };
  if(manual) return busy($("#gscc-refresh"),st,"Connecting to Google…",run);
  try{ await run(); }catch(e){ const s2=$("#gscc-status"); if(s2){ s2.className="status err"; s2.textContent=e.message; } } }
async function renderGscConn(){
  const box=$("#gsc-conn"); if(!box||!SITE_ID) return; const st=await GSCC.status(), c=await GSCC.get(SITE_ID);
  if(!st.configured&&!c){ box.innerHTML=`<h2>Connect Google Search Console <span class="pill">optional</span></h2><p class="lead">Connect once and your Google data refreshes itself: no more exports, and the “competing pages” view works. Your site's admin needs to add a Google sign-in client first (about 15 minutes; see “Search Console connection” in the README).</p>`; return; }
  if(!c){ box.innerHTML=`<h2>Connect Google Search Console</h2><p class="lead">Sign in with the Google account that can see this website in Search Console. Access is read-only, and you can disconnect any time.</p>
      <div class="row"><button class="btn" id="gscc-go">Connect with Google</button><span class="status" id="gscc-status" role="status"></span></div>`;
    $("#gscc-go").onclick=()=>busy($("#gscc-go"),$("#gscc-status"),"Opening Google…",()=>GSCC.start(SITE_ID)); return; }
  const props=c.sites||[], ok=!!c.property;
  box.innerHTML=`<h2>Google Search Console <span class="pill pass">connected</span></h2>
    <div class="row" style="flex-wrap:nowrap"><label for="gscc-prop" class="status" style="margin:0;white-space:nowrap">Property for this website</label>
      <select id="gscc-prop" style="max-width:380px">${props.length?`<option value="">Choose…</option>`+props.map(x=>`<option ${x===c.property?"selected":""}>${esc(x)}</option>`).join(""):`<option value="">No properties found for this Google account</option>`}</select>
      <button class="btn ghost small" id="gscc-reload">Reload list</button></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="gscc-refresh" ${ok?"":"disabled"}>Refresh now</button><button class="btn ghost" id="gscc-off">Disconnect</button>
      <span class="status" id="gscc-status" role="status">${c.last_refresh?`Last updated ${esc(fmtDate(c.last_refresh))}${c.range?` (${esc(c.range.from)} to ${esc(c.range.to)})`:""}. Refreshes automatically once a day when you open this screen.`:ok?"Not imported yet.":"Choose the property that matches this website."}</span></div>`;
  $("#gscc-prop").onchange=async()=>{ await GSCC.setProperty(SITE_ID,$("#gscc-prop").value); await renderGscConn(); if($("#gscc-prop").value) gscRefresh(true); };
  $("#gscc-reload").onclick=()=>busy($("#gscc-reload"),$("#gscc-status"),"Loading…",async()=>{ await GSCC.reloadSites(SITE_ID); await renderGscConn(); });
  $("#gscc-refresh").onclick=()=>gscRefresh(true);
  $("#gscc-off").onclick=async()=>{ if(!confirm("Disconnect Search Console for this website? Imported data stays; automatic updates stop.")) return; await GSCC.disconnect(SITE_ID); renderGscConn(); };
  if(ok&&!READONLY&&Date.now()-(c.last_refresh||0)>864e5) gscRefresh(false);   // more than a day old: refresh in the background
}

// open a page from My pages (used by language versions and links)
async function openItem(cid){ show("library"); await loadLibrary(); const c=await api(`/api/contents/${cid}`); renderItem(c,$("#lib-view")); $("#lib-view").scrollIntoView({behavior:"smooth",block:"start"}); }
// ---------- language versions ----------
async function renderLangPanel(item,el){
  const box=el.querySelector("[data-lang-panel]"); if(!box) return;
  const d=await api(`/api/sites/${SITE_ID}/contents/${item.id}/versions`), vs=d.versions, me=vs.find(v=>v.id===item.id)||{lang:"en"};
  const loc=item.report?.localization;
  box.innerHTML=`<details class="approve-box" ${vs.length>1||loc?"open":""}><summary><b>Language versions</b> <span class="status">(${vs.length} · ${esc(vs.map(v=>LANGS[v.lang]||v.lang).join(", "))})</span></summary>
    ${loc?`<p class="status">Adapted from ${esc(LANGS[loc.from]||loc.from)}${loc.market?` for ${esc(loc.market)}`:""}.${(loc.changes||[]).length?` Changes made: ${esc(loc.changes.join("; "))}.`:""}</p>`:""}
    <div style="margin-top:8px">${vs.map(v=>`<div class="member-row"><span><b>${esc(LANGS[v.lang]||v.lang)}${v.market?` (${esc(v.market)})`:""}</b>${v.id===item.id?' <span class="pill">this page</span>':""}${v.source?' <span class="pill">original</span>':""}<br><span class="status">${esc(v.title)} · ${esc(v.approved?"approved":v.status.replace(/_/g," "))}</span></span>
      <input data-vurl="${v.id}" value="${esc(v.url)}" placeholder="Page address once published (https://…)" aria-label="Address of the ${esc(LANGS[v.lang]||v.lang)} version">
      ${v.id===item.id?"<span></span>":`<button class="btn ghost small" data-vopen="${v.id}">Open</button>`}</div>`).join("")}</div>
    ${vs.length>1?`<h3 style="font-size:14px;margin:14px 0 4px">hreflang tags <span class="status">(add to the &lt;head&gt; of every version, or use your SEO plugin's language settings)</span></h3>
      ${d.hreflang.missing?`<p class="warn" style="margin:4px 0">Add the page address of ${d.hreflang.missing} version${d.hreflang.missing>1?"s":""} above to complete the tags.</p>`:""}
      <pre class="code" style="white-space:pre-wrap">${esc(d.hreflang.tags||"(add page addresses above)")}</pre>${d.hreflang.tags?`<button class="btn ghost small" data-hcopy>Copy tags</button>`:""}`:""}
    ${READONLY?"":`<h3 style="font-size:14px;margin:16px 0 6px">Create a version in another language</h3>
    <p class="status" style="margin-top:0">The page is adapted for the market (examples, units, register), not translated word for word, and a fluent speaker must review it before approval. Each version counts towards the daily page limit.</p>
    <div class="grid3" style="margin-bottom:0"><div class="field"><label>Language</label><select data-l-lang>${Object.entries(LANGS).filter(([k])=>k!==me.lang).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <div class="field"><label>Market <span>(country code or name, optional)</span></label><input data-l-market placeholder="e.g. ES, MX, JP"></div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost" data-l-kw>Find the local keyword</button></div></div>
    <div data-l-kws></div>
    <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input data-l-keyword placeholder="Keyword people search for in that language" style="max-width:420px"><button class="btn" data-l-go>Create this version</button></div>
    <span class="status" data-l-status role="status"></span>`}</details>`;
  box.querySelectorAll("[data-vurl]").forEach(i=>i.onchange=async()=>{ try{ await api(`/api/sites/${SITE_ID}/contents/${i.dataset.vurl}/url`,{method:"POST",body:JSON.stringify({url:i.value.trim()})}); renderLangPanel(item,el); }catch(e){ toast(e.message,"error"); } });
  box.querySelectorAll("[data-vopen]").forEach(b=>b.onclick=()=>openItem(+b.dataset.vopen));
  const hc=box.querySelector("[data-hcopy]"); if(hc) hc.onclick=async()=>{ try{ await navigator.clipboard.writeText(d.hreflang.tags); hc.textContent="Copied"; }catch{} };
  if(READONLY) return;
  const st=box.querySelector("[data-l-status]"), q=()=>({lang:box.querySelector("[data-l-lang]").value,market:box.querySelector("[data-l-market]").value.trim()});
  box.querySelector("[data-l-kw]").onclick=e=>busy(e.target,st,"Finding what locals search for…",async()=>{ const r=await api(`/api/sites/${SITE_ID}/contents/${item.id}/local-keywords`,{method:"POST",body:JSON.stringify(q())});
    box.querySelector("[data-l-kws]").innerHTML=r.keywords.length?`<div style="margin:8px 0">${r.keywords.map(k=>`<button class="wz-opt" data-lk="${esc(k.keyword)}" aria-pressed="${k.keyword===r.recommended}"><b>${esc(k.keyword)}</b> <span class="status">· ${esc(k.popularity||"")}</span><br><span class="status">${esc(k.why||"")}</span></button>`).join("")}</div>${r.note?`<p class="status">${esc(r.note)}</p>`:""}${r.searched?"":`<p class="status">Suggested from the AI's knowledge (no live search). Check them in a keyword tool if you can.</p>`}`:"";
    box.querySelector("[data-l-keyword]").value=r.recommended||"";
    box.querySelectorAll("[data-lk]").forEach(b=>b.onclick=()=>{ box.querySelectorAll("[data-lk]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); box.querySelector("[data-l-keyword]").value=b.dataset.lk; }); });
  box.querySelector("[data-l-go]").onclick=e=>{ if(!needAI(st)) return; busy(e.target,st,"Adapting the page…",async()=>{
    try{ const r=await api(`/api/sites/${SITE_ID}/contents/${item.id}/localize`,{method:"POST",body:JSON.stringify({...q(),keyword:box.querySelector("[data-l-keyword]").value.trim()}),onProgress:t=>{ st.textContent=t; }});
      await openItem(r.id); toast("The new language version is ready for review."); }
    catch(err){ if(err.existing){ st.innerHTML=`${esc(err.message)} <button class="linkbtn" data-l-open>Open it</button>`; st.querySelector("[data-l-open]").onclick=()=>openItem(err.existing); return; } throw err; } }); };
}

// ---------- Ask AI (chat) ----------
let CHAT_ID=0;
const CHAT_STARTERS=["Which pages should I update first, and why?","What do people search for that we don't have a page for yet?","Summarise our Google search performance in plain words.","Write 3 LinkedIn post ideas from our knowledge base.","What are the most important technical problems on the site?"];
async function loadChat(){
  if(!SITE_ID){ $("#chat-msgs").innerHTML=emptyBox("Add a website first","Ask AI answers from your website's data.","site","Add a website"); bindGo($("#chat-msgs")); return; }
  const list=await api(`/api/sites/${SITE_ID}/chats`);
  $("#chat-convs").innerHTML=list.length?list.map(c=>`<button class="conv" data-conv="${c.id}" aria-current="${c.id===CHAT_ID}">${esc(c.title)}<br><span class="status">${esc(fmtDate(c.updated_at))}</span></button>`).join(""):`<p class="status">No conversations yet.</p>`;
  $("#chat-convs").querySelectorAll("[data-conv]").forEach(b=>b.onclick=()=>{ CHAT_ID=+b.dataset.conv; loadChat(); });
  const c=CHAT_ID?await api(`/api/sites/${SITE_ID}/chats/${CHAT_ID}`):null; renderChat(c);
}
function renderChat(c){
  const box=$("#chat-msgs");
  if(!c||!c.messages.length){ box.innerHTML=`<p class="status" style="margin-top:0">Try one of these:</p>${CHAT_STARTERS.map(t=>`<button class="wz-opt" data-starter>${esc(t)}</button>`).join("")}`;
    box.querySelectorAll("[data-starter]").forEach(b=>b.onclick=()=>{ $("#chat-text").value=b.textContent; sendChat(); }); return; }
  box.innerHTML=c.messages.map((m,i)=>m.role==="user"?`<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>`
    :`<div class="msg ai"><div class="bubble">${mdToHtmlSafe(m.content)}</div>
      ${(m.sources||[]).length?`<div class="src">Sources: ${m.sources.map(s=>`[${s.n}] ${s.link?`<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.label)}</a>`:esc(s.label)}`).join(" · ")}</div>`:m.all_sources?"":`<div class="src">No matching data in the tool for this question.</div>`}
      <div class="acts"><button class="btn ghost small" data-ccopy="${i}">Copy</button><button class="btn ghost small" data-cpage="${i}">Start a page with this</button>${c.messages.length-1===i?`<button class="btn ghost small" data-cdel>Delete conversation</button>`:""}</div></div>`).join("");
  box.scrollTop=box.scrollHeight;
  box.querySelectorAll("[data-ccopy]").forEach(b=>b.onclick=async()=>{ try{ await navigator.clipboard.writeText(c.messages[+b.dataset.ccopy].content); b.textContent="Copied"; }catch{} });
  box.querySelectorAll("[data-cpage]").forEach(b=>b.onclick=()=>{ show("generate"); $("#g-notes").value=c.messages[+b.dataset.cpage].content.slice(0,4000); $("#g-kw").focus(); toast("The answer is in “Anything the page should include”. Add the keyword and write the page."); });
  const d=box.querySelector("[data-cdel]"); if(d) d.onclick=async()=>{ if(!confirm("Delete this conversation?")) return; await api(`/api/sites/${SITE_ID}/chats/${c.id}`,{method:"DELETE"}); CHAT_ID=0; loadChat(); };
}
const mdToHtmlSafe=md=>{ try{ return DOMPurifyLite(window.marked?window.marked.parse(md):esc(md)); }catch{ return esc(md); } };
function DOMPurifyLite(html){ const t=document.createElement("template"); t.innerHTML=html; t.content.querySelectorAll("script,style,iframe,object,embed,form,input,button,link,meta").forEach(e=>e.remove());
  t.content.querySelectorAll("*").forEach(e=>{ for(const a of [...e.attributes]) if(/^on/i.test(a.name)||(/^(href|src)$/i.test(a.name)&&/^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name); if(e.tagName==="A"){ e.setAttribute("target","_blank"); e.setAttribute("rel","noopener"); } }); return t.innerHTML; }
async function sendChat(){
  const text=$("#chat-text").value.trim(); if(!text||!SITE_ID) return; if(!needAI($("#chat-status"))) return;
  const box=$("#chat-msgs"); if(box.querySelector("[data-starter]")) box.innerHTML="";
  box.insertAdjacentHTML("beforeend",`<div class="msg user"><div class="bubble">${esc(text)}</div></div><div class="msg ai" id="chat-wait"><div class="bubble status spin">Thinking…</div></div>`); box.scrollTop=box.scrollHeight;
  $("#chat-text").value=""; $("#chat-send").disabled=true;
  try{ const c=await api(`/api/sites/${SITE_ID}/chat`,{method:"POST",body:JSON.stringify({chat_id:CHAT_ID,text})}); CHAT_ID=c.id; await loadChat(); $("#chat-status").textContent=""; }
  catch(e){ const w=$("#chat-wait"); if(w) w.remove(); $("#chat-text").value=text; $("#chat-status").className="status err"; $("#chat-status").textContent=e.message; }
  finally{ $("#chat-send").disabled=false; $("#chat-text").focus(); }
}
$("#chat-send").onclick=sendChat;
$("#chat-text").onkeydown=e=>{ if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); sendChat(); } };
$("#chat-new").onclick=()=>{ CHAT_ID=0; loadChat(); $("#chat-text").focus(); };

// ---------- repurposing for other channels ----------
const RP_FORMATS={linkedin:"LinkedIn post",x_thread:"X (Twitter) thread",newsletter:"Newsletter section",video_script:"Short video script",snippets:"Social snippets"};
function rpText(k,f){ if(k==="linkedin") return f.text; if(k==="x_thread") return f.posts.join("\n\n");
  if(k==="newsletter") return `Subject: ${f.subject}\nPreview: ${f.preview}\n\n${f.body}\n\n${f.cta}`;
  if(k==="video_script") return `${f.title} (${f.seconds} seconds)\n\n`+f.scenes.map((x,i)=>`Scene ${i+1} (${x.seconds}s)\nVoiceover: ${x.voiceover}\nOn screen: ${x.on_screen}\nShow: ${x.show}`).join("\n\n");
  if(k==="snippets") return f.items.map(x=>x.text).join("\n\n"); return ""; }
function renderRepurpose(item,el){
  const box=el.querySelector("[data-repurpose-panel]"); if(!box) return; const r=item.repurposed, ok=item.status==="approved";
  const card=(k,f)=>`<div class="ans" style="margin-top:10px"><div class="row" style="justify-content:space-between"><b>${esc(RP_FORMATS[k])}</b><span class="row">
      ${k==="linkedin"?`<span class="status">${fmtN(f.chars)} characters</span>`:""}<button class="btn ghost small" data-rpcopy="${k}">Copy</button>${READONLY?"":`<button class="btn ghost small" data-rpredo="${k}">Redo</button>`}</span></div>
    ${(f.issues||[]).map(i=>`<p class="warn" style="margin:6px 0 0">⚠ ${esc(i)}</p>`).join("")}
    ${k==="x_thread"?f.posts.map(p=>`<p style="margin:8px 0 0;white-space:pre-wrap">${esc(p)}</p>`).join("")
      :k==="video_script"?`<p class="status" style="margin:6px 0">${esc(f.title)} · ${f.seconds} seconds planned</p><div data-vo></div><div class="tw"><table><tr><th>Planned</th><th>Spoken</th><th>Voiceover</th><th>On screen</th><th>Show</th><th><span class="sr-only">Play</span></th></tr>${f.scenes.map((x,i)=>`<tr data-vorow="${i}"><td>${x.seconds} s</td><td data-voest="${i}"></td><td>${esc(x.voiceover)}</td><td>${esc(x.on_screen)}</td><td class="status">${esc(x.show)}</td><td><button class="btn ghost small" data-voplay="${i}" aria-label="Play scene ${i+1}">▶</button></td></tr>`).join("")}</table></div>`
      :k==="snippets"?f.items.map(x=>`<p style="margin:8px 0 0"><b>${esc(x.text)}</b><br><span class="status">From: “${esc(x.from)}”</span></p>`).join("")
      :k==="newsletter"?`<p style="margin:6px 0 0"><b>Subject:</b> ${esc(f.subject)}<br><b>Preview:</b> ${esc(f.preview)}</p><p style="white-space:pre-wrap;margin:8px 0 0">${esc(f.body)}</p><p style="margin:6px 0 0">${esc(f.cta)}</p>`
      :`<p style="white-space:pre-wrap;margin:8px 0 0">${esc(f.text)}</p>`}</div>`;
  box.innerHTML=`<details class="approve-box" ${r?"open":""}><summary><b>Repurpose for other channels</b> <span class="status">${r?`(${Object.keys(r.formats).length} formats, made ${esc(fmtDate(r.at))})`:"(LinkedIn, X, newsletter, video script, snippets)"}</span></summary>
    ${!ok?`<p class="status">Approve the page first, so only checked facts are reused in other channels.</p>`:`
    ${READONLY?"":`<div class="row" style="margin-top:8px">${Object.entries(RP_FORMATS).map(([k,v])=>`<label class="check" style="margin:0 10px 0 0"><input type="checkbox" data-rpf value="${k}" checked> ${esc(v)}</label>`).join("")}</div>
    <div class="row" style="margin-top:8px"><button class="btn" data-rpgo>${r?"Make again":"Create"}</button>${r?`<button class="btn ghost" data-rpall>Download all</button>`:""}<span class="status" data-rpst role="status"></span></div>
    <p class="status" style="margin:6px 0 0">Uses only the facts in this page. Any number that isn't in the page is flagged for you to check.${r&&r.link.startsWith("[")?" Add this page's address under Language versions so the link is filled in.":""}</p>`}
    ${r?Object.entries(r.formats).map(([k,f])=>card(k,f)).join(""):""}`}</details>`;
  if(!ok) return;
  if(r?.formats?.video_script) bindVoice(box,item,r.formats.video_script).catch(()=>{});
  const st=box.querySelector("[data-rpst]"), run=fmts=>busy(box.querySelector("[data-rpgo]"),st,"Writing for other channels…",async()=>{ item.repurposed=await api(`/api/sites/${SITE_ID}/contents/${item.id}/repurpose`,{method:"POST",body:JSON.stringify({formats:fmts})}); renderRepurpose(item,el); });
  const go=box.querySelector("[data-rpgo]"); if(go) go.onclick=()=>run([...box.querySelectorAll("[data-rpf]:checked")].map(x=>x.value));
  box.querySelectorAll("[data-rpredo]").forEach(b=>b.onclick=()=>run([b.dataset.rpredo]));
  box.querySelectorAll("[data-rpcopy]").forEach(b=>b.onclick=async()=>{ try{ await navigator.clipboard.writeText(rpText(b.dataset.rpcopy,r.formats[b.dataset.rpcopy])); b.textContent="Copied"; }catch{ toast("Couldn't copy: select the text instead."); } });
  const all=box.querySelector("[data-rpall]"); if(all) all.onclick=()=>{ const md=`# ${item.title||item.keyword}: other channels\n\n`+Object.entries(r.formats).map(([k,f])=>`## ${RP_FORMATS[k]}\n\n${rpText(k,f)}`).join("\n\n");
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"})); a.download=`${(item.slug||"page").slice(0,60)}-other-channels.md`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
}

// ---------- publishing to WordPress ----------
function renderPublishing(site){
  const box=$("#pub-form"); if(!box) return; const c=CMS.settings(site.id);
  box.innerHTML=`<p class="status" style="margin-top:0">In WordPress, go to <b>Users → Profile → Application Passwords</b>, create one named “Content Engine”, and paste it here. It stays in this browser only, and you can revoke it in WordPress any time. Pages are always sent as drafts; you press Publish in WordPress.</p>
   <div class="grid2" style="margin-bottom:0"><div class="field"><label for="wp-url">WordPress site address</label><input id="wp-url" value="${esc(c.site_url||new URL(site.url).origin)}"></div>
     <div class="field"><label for="wp-user">WordPress username</label><input id="wp-user" autocomplete="off" value="${esc(c.username||"")}"></div></div>
   <div class="grid2" style="margin-bottom:0"><div class="field"><label for="wp-pass">Application password</label><input id="wp-pass" type="password" autocomplete="off" value="${esc(c.app_password||"")}" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"></div>
     <div class="field"><label for="wp-type">Send pages as</label><select id="wp-type"><option value="posts" ${c.post_type!=="pages"?"selected":""}>Posts (blog)</option><option value="pages" ${c.post_type==="pages"?"selected":""}>Pages</option></select></div></div>
   <div class="grid2" style="margin-bottom:0"><div class="field"><label for="wp-status">Status in WordPress</label><select id="wp-status"><option value="draft" ${c.status!=="pending"?"selected":""}>Draft</option><option value="pending" ${c.status==="pending"?"selected":""}>Pending review</option></select></div>
     <div class="field"><label for="wp-cat">Category <span>(posts only; load after testing)</span></label><select id="wp-cat"><option value="">Default category</option>${(c.categories||[]).map(x=>`<option value="${x.id}" ${String(x.id)===String(c.category)?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div></div>
   <label class="check"><input type="checkbox" id="wp-schema" ${c.schema!==false?"checked":""}> Include structured data (schema) so Google understands the page. If your SEO plugin already adds schema, untick this.</label>
   <div class="row" style="margin-top:10px"><button class="btn" id="wp-test">Test and save</button><button class="btn ghost" id="wp-forget">Forget these details</button><span class="status" id="wp-st" role="status"></span></div>`;
  const read=()=>({ platform:"wordpress", site_url:$("#wp-url").value.trim().replace(/\/+$/,""), username:$("#wp-user").value.trim(), app_password:$("#wp-pass").value.trim(),
    post_type:$("#wp-type").value, status:$("#wp-status").value, category:$("#wp-cat").value, schema:$("#wp-schema").checked, categories:CMS.settings(site.id).categories||[] });
  $("#wp-test").onclick=()=>busy($("#wp-test"),$("#wp-st"),"Connecting to WordPress…",async()=>{ const v=read(); const r=await CMS.test(v);
    v.categories=r.categories||[]; CMS.save(site.id,v); renderPublishing(site); $("#pub-box").open=true;
    $("#wp-st").innerHTML=`<span class="pass">Connected as ${esc(r.user.name)}${r.user.roles?.length?` (${esc(r.user.roles.join(", "))})`:""}.</span>${!r.can_publish_posts?' <span class="warn">This user may not be allowed to create posts.</span>':""}`; });
  $("#wp-forget").onclick=()=>{ localStorage.removeItem(`ce-cms:${store.dbName()}:${site.id}`); renderPublishing(site); };
}

// ---------- reports ----------
let RP={data:null,brand:null,html:"",ai:null,key:""};
const dayStart=t=>{ const d=new Date(t); d.setHours(0,0,0,0); return d.getTime(); };
function rpRange(){ const v=$("#rp-period").value, now=new Date();
  if(v==="custom"){ const f=Date.parse($("#rp-from").value), t=Date.parse($("#rp-to").value); return { from:f||Date.now()-30*864e5, to:(t||Date.now())+864e5-1 }; }
  if(v==="this") return { from:new Date(now.getFullYear(),now.getMonth(),1).getTime(), to:Date.now() };
  if(v==="last") return { from:new Date(now.getFullYear(),now.getMonth()-1,1).getTime(), to:new Date(now.getFullYear(),now.getMonth(),1).getTime()-1 };
  return { from:dayStart(Date.now()-Number(v)*864e5), to:Date.now() }; }
function rpSyncDates(){ const r=rpRange(), iso=t=>new Date(t).toISOString().slice(0,10), custom=$("#rp-period").value==="custom";
  if(!custom){ $("#rp-from").value=iso(r.from); $("#rp-to").value=iso(r.to); } $("#rp-from").disabled=$("#rp-to").disabled=!custom; }
function rpRender(){ if(!RP.data) return;
  const sections=Object.fromEntries([...document.querySelectorAll("#rp-secs input")].map(x=>[x.value,x.checked]));
  RP.html=renderReport(RP.data,{ title:$("#rp-title").value.trim(), client:$("#rp-client").value.trim(), summary:$("#rp-summary").value.trim(), highlights:RP.ai?.highlights||[], watch:RP.ai?.watch||[],
    sections, brand:RP.brand?.brand||"", color:RP.brand?.color, logo:RP.brand?.logo });
  $("#rp-frame").srcdoc=RP.html; }
async function loadReports(){
  if(!SITE_ID){ $("#rp-status").textContent="Add a website first."; return; }
  if(!$("#rp-secs").children.length) $("#rp-secs").innerHTML=Object.entries(REPORT_SECTIONS).map(([k,v])=>`<label class="check" style="margin:0 12px 0 0"><input type="checkbox" value="${k}" checked> ${esc(v)}</label>`).join("");
  RP.brand=await api("/api/report-brand"); $("#rp-brand").value=RP.brand.brand||""; $("#rp-color").value=RP.brand.color||"#0f766e";
  rpSyncDates(); await rpBuild(); loadShareLinks().catch(()=>{}); }
async function rpBuild(){ const r=rpRange(), key=`${SITE_ID}|${r.from}|${r.to}`;
  if(RP.key!==key){ RP.data=await api(`/api/sites/${SITE_ID}/report?from=${r.from}&to=${r.to}`); RP.ai=null; RP.key=key;
    $("#rp-summary").value=RP.data.auto_summary||"";
    const monthly=["this","last"].includes($("#rp-period").value), dd=t=>new Date(t).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
    const when=monthly?new Date(r.from).toLocaleDateString("en-GB",{month:"long",year:"numeric"}):`${dd(r.from)} – ${dd(r.to)} ${new Date(r.to).getFullYear()}`;
    if(!$("#rp-title").dataset.touched) $("#rp-title").value=`${RP.data.site.name}: SEO and content report, ${when}`;
    if(!$("#rp-client").dataset.touched) $("#rp-client").value=RP.data.site.name; }
  rpRender(); }
$("#rp-title").oninput=()=>{ $("#rp-title").dataset.touched=1; }; $("#rp-client").oninput=()=>{ $("#rp-client").dataset.touched=1; };
$("#rp-period").onchange=()=>{ rpSyncDates(); rpBuild().catch(e=>toast(e.message,"error")); };
["rp-from","rp-to"].forEach(i=>$("#"+i).onchange=()=>rpBuild().catch(e=>toast(e.message,"error")));
$("#rp-secs").onchange=()=>rpRender();
$("#rp-build").onclick=()=>busy($("#rp-build"),$("#rp-status"),"Updating…",async()=>{ RP.key=""; const keep=$("#rp-summary").value; await rpBuild(); if(keep) { $("#rp-summary").value=keep; rpRender(); } });
$("#rp-ai").onclick=()=>busy($("#rp-ai"),$("#rp-status"),"Writing the summary…",async()=>{ if(!RP.data) await rpBuild();
  RP.ai=await api(`/api/sites/${SITE_ID}/report/summary`,{method:"POST",body:JSON.stringify({data:RP.data})}); $("#rp-summary").value=RP.ai.summary||RP.data.auto_summary; rpRender(); $("#rp-status").textContent="Summary written. Edit it if you like, then click Update preview."; });
$("#rp-summary").onchange=()=>rpRender();
$("#rp-print").onclick=()=>{ if(!RP.html) return; const f=$("#rp-frame"); try{ f.contentWindow.focus(); f.contentWindow.print(); }catch{ toast("Your browser blocked printing. Use Download file, open it, and print from there."); } };
$("#rp-html").onclick=()=>{ if(!RP.html) return; const name=($("#rp-title").value||"report").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"report";
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([RP.html],{type:"text/html"})); a.download=name+".html"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); };
function shareHeaders(){ const st=AUTH.state(), h={"content-type":"application/json"}; if(st.accounts&&st.workspace) h["x-workspace"]=st.workspace.id; else { const k=SYNC.syncSettings().teamKey; if(k) h["x-team-key"]=k; } return h; }
$("#rp-share").onclick=()=>busy($("#rp-share"),$("#rp-share-out"),"Creating link…",async()=>{ if(!RP.html) await rpBuild();
  const r=await fetch("/api/report",{method:"POST",credentials:"same-origin",headers:shareHeaders(),body:JSON.stringify({html:RP.html,title:$("#rp-title").value,days:90})});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(r.status===404&&!d.error?"The share function isn't deployed yet. Push the latest code to GitHub.":d.error||`Couldn't create the link (${r.status})`);
  const link=location.origin+d.url; try{ await navigator.clipboard.writeText(link); }catch{}
  $("#rp-share-out").innerHTML=`Link created and copied (valid until ${esc(fmtDate(d.expires))}). Anyone with the link can view this report; it can't be edited and isn't shown in search engines.<br><span class="url">${esc(link)}</span>`; loadShareLinks().catch(()=>{}); });
async function loadShareLinks(){ if(!(AUTH.state().accounts||SYNC.syncSettings().enabled)){ $("#rp-links-box")?.classList.add("hidden"); return; }   // share links need team sync or accounts; don't ask the server otherwise
  const r=await fetch("/api/report?op=list",{credentials:"same-origin",headers:shareHeaders()}); const d=await r.json().catch(()=>({}));
  if(!r.ok){ $("#rp-links-box").classList.add("hidden"); return; } $("#rp-links-box").classList.remove("hidden");
  $("#rp-links").innerHTML=(d.links||[]).length?d.links.map(x=>`<div class="member-row"><span>${esc(x.title)}<br><span class="status">${esc(x.by)} · created ${esc(fmtDate(x.created))} · expires ${esc(fmtDate(x.expires))}</span></span><button class="btn ghost small" data-rcopy="${esc(x.url)}">Copy link</button><button class="btn ghost small" data-rdel="${esc(x.token)}">Remove</button></div>`).join(""):`<p class="status">No active links.</p>`;
  $("#rp-links").querySelectorAll("[data-rcopy]").forEach(b=>b.onclick=async()=>{ try{ await navigator.clipboard.writeText(location.origin+b.dataset.rcopy); b.textContent="Copied"; }catch{} });
  $("#rp-links").querySelectorAll("[data-rdel]").forEach(b=>b.onclick=async()=>{ if(!confirm("Remove this link? Anyone who has it will no longer be able to open the report.")) return; await fetch(`/api/report?token=${encodeURIComponent(b.dataset.rdel)}`,{method:"DELETE",credentials:"same-origin",headers:shareHeaders()}); loadShareLinks(); }); }
$("#rp-logo").onchange=()=>{ const f=$("#rp-logo").files[0]; if(!f) return; if(f.size>300000){ $("#rp-brand-status").textContent="That logo is over 300 KB. Use a smaller image."; $("#rp-logo").value=""; return; }
  const rd=new FileReader(); rd.onload=()=>{ RP.brand={...RP.brand,logo:String(rd.result)}; rpRender(); $("#rp-brand-status").textContent="Logo added. Click Save branding to keep it."; }; rd.readAsDataURL(f); };
$("#rp-logo-clear").onclick=()=>{ RP.brand={...RP.brand,logo:""}; rpRender(); };
$("#rp-color").oninput=()=>{ RP.brand={...RP.brand,color:$("#rp-color").value}; rpRender(); };
$("#rp-brand").oninput=()=>{ RP.brand={...RP.brand,brand:$("#rp-brand").value}; rpRender(); };
$("#rp-brand-save").onclick=()=>busy($("#rp-brand-save"),$("#rp-brand-status"),"Saving…",async()=>{ RP.brand=await api("/api/report-brand",{method:"POST",body:JSON.stringify(RP.brand)}); rpRender(); $("#rp-brand-status").textContent="Branding saved."; });

// ---------- onboarding wizard: from nothing to a first page in six guided steps ----------
const WZ_KEY="ce-wizard:"+store.dbName(), WZ_STEPS=["ai","site","type","facts","keyword","write"];
const wzGet=()=>{ try{ return JSON.parse(localStorage.getItem(WZ_KEY)||"{}"); }catch{ return {}; } };
const wzSet=p=>{ try{ localStorage.setItem(WZ_KEY,JSON.stringify({...wzGet(),...p})); }catch{} };
const FACT_EXAMPLES={ saas:"Free trial: 14 days, no card needed\nPrice: from $19 per user per month\nCustomers: 2,500+ teams\nIntegrations: Slack, HubSpot, Salesforce",
  ecommerce:"Free shipping: on orders over $50\nReturns: 30 days, free\nDelivery: 2-4 working days in the UK\nMaterials: organic cotton, made in Portugal",
  local:"Area served: Leeds and 15 miles around\nOpening hours: Mon-Fri 8am-6pm, Sat 9am-1pm\nPhone: 0113 000 0000\nPrices: from £60 per visit",
  publisher:"Founded: 2015\nEditorial team: 12 writers and 3 editors\nUpdated: articles reviewed every 6 months",
  agency:"Founded: 2012\nTeam: 25 specialists\nClients: 140+ businesses in 9 countries\nResults: average 3x increase in qualified leads",
  health:"Clinic: registered with the national health regulator\nReviewed by: Dr A Smith, GP, 15 years' experience\nAppointments: same-week, Mon-Sat",
  finance:"Regulated by: the national financial regulator, firm no. 123456\nAdvisers: 8 qualified advisers\nFees: initial consultation free",
  legal:"Jurisdiction: England and Wales\nSolicitors: 6, regulated by the SRA\nFirst consultation: free, 30 minutes",
  other:"Founded: 2020\nWhat we offer: ...\nWho it's for: ..." };
let WZ_TIMER=null;
function wzClose(){ $("#wizard").classList.add("hidden"); clearInterval(WZ_TIMER); }
async function openWizard(step){ if(READONLY) return; const st=step||wzGet().step||"ai"; wzSet({step:st}); $("#wizard").classList.remove("hidden"); await wzRender(st); }
function wzFrame(step,title,lead,body,{next="Next",canSkip=false,nextDisabled=false}={}){
  const i=WZ_STEPS.indexOf(step);
  $("#wz-card").innerHTML=`<div class="row" style="justify-content:space-between;margin-bottom:10px"><span class="status">Guided setup · step ${i+1} of ${WZ_STEPS.length}</span><button class="linkbtn" id="wz-later">Finish later</button></div>
    <ol class="wz-steps" aria-hidden="true">${WZ_STEPS.map((x,k)=>`<li class="${k<i?"done":k===i?"now":""}"></li>`).join("")}</ol>
    <h1 id="wz-title" style="font-size:24px;margin:0 0 6px">${title}</h1><p class="lead" style="margin-top:0">${lead}</p>${body}
    <div class="wz-foot"><div>${i>0?`<button class="btn ghost" id="wz-back">Back</button>`:""}</div><div class="row">${canSkip?`<button class="btn ghost" id="wz-skip">Skip this step</button>`:""}<button class="btn" id="wz-next" ${nextDisabled?"disabled":""}>${next}</button></div></div>
    <p class="status" id="wz-status" role="status" style="margin:10px 0 0"></p>`;
  $("#wz-later").onclick=()=>{ wzClose(); };
  const back=$("#wz-back"); if(back) back.onclick=()=>{ clearInterval(WZ_TIMER); const prev=WZ_STEPS[i-1]; wzSet({step:prev}); wzRender(prev); };
  const sk=$("#wz-skip"); if(sk) sk.onclick=()=>wzGo(WZ_STEPS[i+1]);
}
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("#wizard").classList.contains("hidden")) wzClose(); });   // Escape = finish later
const wzGo=step=>{ clearInterval(WZ_TIMER); wzSet({step}); wzRender(step); };
const wzBusy=(fn)=>{ const b=$("#wz-next"), st=$("#wz-status"); return busy(b,st,"Working…",fn); };
async function wzRender(step){
  const w=wzGet(), site=w.siteId?await api(`/api/sites/${w.siteId}`).catch(()=>null):null;
  if(step==="ai"){
    const cur=LLM.getSettings(), pick=w.provider||(LLM.isConfigured(cur)?cur.provider:"");
    const opts=[["claude","Claude","Paid · best writing · key from console.anthropic.com"],["openai","ChatGPT","Paid · key from platform.openai.com"],["gemini","Gemini","Paid · key from aistudio.google.com"],
      ["local","Built-in AI","Free · runs in Chrome on your computer · 2-6 GB download"],["ollama","Ollama","Free · runs on your computer · needs the Ollama app"],["mock","Demo mode","Try it with sample answers, no key"]];
    wzFrame("ai","Connect an AI","Choose which AI writes and checks your pages. You can change this any time in Settings.",
      `<div>${opts.map(([k,l,sub])=>`<button class="wz-opt" data-wzp="${k}" aria-pressed="${k===pick}"><b>${l}</b><br><span class="status">${sub}</span></button>`).join("")}</div><div id="wz-ai-form" style="margin-top:12px"></div>`,{next:"Test and continue",nextDisabled:!pick});
    const form=()=>{ const k=wzGet().provider||pick, f=$("#wz-ai-form");
      f.innerHTML=["claude","openai","gemini"].includes(k)?`<div class="field"><label for="wz-key">API key</label><input id="wz-key" type="password" autocomplete="off" value="${esc(LLM.getSettings().keys[k]||"")}" placeholder="Paste your API key"></div><p class="status">Your key stays in this browser and is sent only to ${esc(LLM.PROVIDERS[k].label)}.</p>`
        :k==="local"?`<p class="status">The model downloads once (Qwen3 4B, 3.4 GB) and then runs on your computer's graphics chip. Needs a recent Chrome or Edge.</p>`
        :k==="ollama"?`<div class="field"><label for="wz-ollama">Ollama address</label><input id="wz-ollama" value="${esc(LLM.getSettings().ollamaUrl||"http://localhost:11434")}"></div><p class="status">Install Ollama from ollama.com, run <code>ollama pull qwen3:8b</code>, and allow this site: <code>launchctl setenv OLLAMA_ORIGINS "${esc(location.origin)}"</code>, then restart Ollama.</p>`
        :k==="mock"?`<p class="status">Demo mode shows how everything works with sample answers. Switch to a real AI before writing pages you'll publish.</p>`:"";
      $("#wz-next").disabled=!k; };
    $("#wz-card").querySelectorAll("[data-wzp]").forEach(b=>b.onclick=()=>{ $("#wz-card").querySelectorAll("[data-wzp]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); wzSet({provider:b.dataset.wzp}); form(); });
    form();
    $("#wz-next").onclick=()=>wzBusy(async()=>{ const k=wzGet().provider||pick, st=LLM.getSettings(); st.provider=k;
      if(["claude","openai","gemini"].includes(k)){ const key=$("#wz-key").value.trim(); if(!key) throw new Error("Paste your API key."); st.keys[k]=key; }
      if(k==="ollama") st.ollamaUrl=$("#wz-ollama").value.trim()||"http://localhost:11434";
      LLM.saveSettings(st); updatePill();
      if(k==="local"){ $("#wz-status").textContent="Downloading and starting the model… this takes a few minutes the first time."; await LLM.loadLocalModel(LLM.getSettings().models.local||LLM.PROVIDERS.local.defaultModel,(t,f)=>{ $("#wz-status").textContent=`${Math.round((f||0)*100)}% · ${String(t).slice(0,80)}`; }); }
      if(k==="ollama"){ const models=await LLM.listModels("ollama",st.ollamaUrl); if(!models.length) throw new Error("Ollama is running but has no models. Run: ollama pull qwen3:8b"); const s2=LLM.getSettings(); s2.models.ollama=models.includes(s2.models.ollama)?s2.models.ollama:models[0]; LLM.saveSettings(s2); }
      if(k!=="mock"){ const r=await LLM.ask("test",'Reply with JSON only: {"ok":true}',{maxTokens:60}); if(!r||!r.ok) throw new Error("The AI answered, but not as expected. Try again."); }
      wzGo("site"); });
  }
  else if(step==="site"){
    wzFrame("site","Add your website","The tool reads your pages so every suggestion fits what you already have. Reading continues in the background while you go on.",
      `<div class="field"><label for="wz-url">Website address <span>(add a path like /es or /blog to read only that part)</span></label><input id="wz-url" placeholder="https://www.example.com" value="${esc(site?.url||"")}"></div>
       <div class="field"><label for="wz-name">Business or brand name</label><input id="wz-name" value="${esc(site?.name||"")}"></div>
       <div class="field"><label for="wz-offer">What the business offers <span>(one or two sentences)</span></label><textarea id="wz-offer" style="min-height:70px">${esc(site?.product||"")}</textarea></div>
       <div class="field"><label for="wz-aud">Who it's for <span>(optional)</span></label><input id="wz-aud" value="${esc(site?.audience||"")}"></div>`,{next:site?"Continue":"Start reading and continue"});
    $("#wz-next").onclick=()=>wzBusy(async()=>{ const url=$("#wz-url").value.trim(); if(!url) throw new Error("Enter the website address.");
      if(!site||site.url.replace(/\/$/,"")!==(/^https?:/.test(url)?url:"https://"+url).replace(/\/$/,"")){
        const s2=await api("/api/sites",{method:"POST",body:JSON.stringify({url,name:$("#wz-name").value.trim(),product:$("#wz-offer").value.trim(),audience:$("#wz-aud").value.trim(),max_pages:200})});
        wzSet({siteId:s2.id}); SITE_ID=s2.id; await loadSites(s2.id); }
      else await api(`/api/sites/${site.id}`,{method:"PATCH",body:JSON.stringify({name:$("#wz-name").value.trim(),product:$("#wz-offer").value.trim(),audience:$("#wz-aud").value.trim()})});
      wzGo("type"); });
  }
  else if(step==="type"){
    const ready=site&&site.status==="ready"&&site.page_count>0;
    wzFrame("type","What kind of website is it?",ready?"Detected from your pages. Change it if it's not right: it decides how pages are written.":"Reading your website… the type will be detected when it's done.",
      ready?`<div class="field"><label for="wz-type">Type of website</label><select id="wz-type">${Object.entries(BUSINESS_TYPES).map(([k,v])=>`<option value="${k}" ${k===site.business_type?"selected":""}>${esc(v.label)}${v.ymyl?" (needs expert review)":""}</option>`).join("")}</select></div>
        <p class="status" id="wz-type-note">${esc(BUSINESS_TYPES[site.business_type]?.guidance||"")}</p><p class="status">Read ${site.page_count} pages${site.summary?.urls_discovered?` of about ${fmtN(site.summary.urls_discovered)}`:""}.${site.notice?" "+esc(site.notice):""}</p>`
        :`<p class="status spin">${esc(site?.status||"Starting…")}</p>${site?.status==="error"?`<p class="err">${esc(site.error||"")}</p>`:""}`,{nextDisabled:!ready});
    if(!ready){
      // the reading stopped (for example the page was reloaded): start it again automatically
      if(site&&(site.status==="error"||(site.status==="ready"&&!site.page_count))){ await api(`/api/sites/${site.id}/recrawl`,{method:"POST"}).catch(()=>{}); const el=$("#wz-card .spin"); if(el) el.textContent="Reading was interrupted, so it started again…"; }
      WZ_TIMER=setInterval(async()=>{ const s2=await api(`/api/sites/${w.siteId}`).catch(()=>null); if(!s2) return;
        if(s2.status==="ready"&&s2.page_count){ clearInterval(WZ_TIMER); await loadSites(w.siteId); wzRender("type"); }
        else if(s2.status==="error"){ clearInterval(WZ_TIMER); wzRender("type"); }
        else { const el=$("#wz-card .spin"); if(el) el.textContent=s2.status; } },2000); return; }
    $("#wz-type").onchange=()=>{ $("#wz-type-note").textContent=BUSINESS_TYPES[$("#wz-type").value]?.guidance||""; };
    $("#wz-next").onclick=()=>wzBusy(async()=>{ await api(`/api/sites/${site.id}`,{method:"PATCH",body:JSON.stringify({business_type:$("#wz-type").value})}); wzGo("facts"); });
  }
  else if(step==="facts"){
    const existing=(await api(`/api/sites/${site.id}/kb`).catch(()=>({docs:[]}))).docs.find(d=>d.kind==="facts");
    wzFrame("facts","Add a few quick facts","Short, true facts about the business. The AI uses them on every page instead of placeholders, and checks claims against them. You can add documents and case studies later in Knowledge base.",
      `<div class="field"><label for="wz-facts">Quick facts <span>(one per line, “Label: value”)</span></label><textarea id="wz-facts" style="min-height:150px" placeholder="${esc(FACT_EXAMPLES[site.business_type]||FACT_EXAMPLES.other)}">${esc(existing?.text||"")}</textarea></div>`,{canSkip:true});
    $("#wz-next").onclick=()=>wzBusy(async()=>{ const t=$("#wz-facts").value.trim(); if(t) await api(`/api/sites/${site.id}/kb-facts`,{method:"POST",body:JSON.stringify({text:t})}); wzGo("keyword"); });
  }
  else if(step==="keyword"){
    wzFrame("keyword","Choose your first page","Searches your future customers make. Ones you don't have a page for yet are the best first pick.",`<div id="wz-ideas"><p class="status spin">Finding ideas for your website…</p></div>
      <div class="field" style="margin-top:12px"><label for="wz-kw">Or type your own keyword</label><input id="wz-kw" value="${esc(w.keyword||"")}"></div>`,{next:"Continue",nextDisabled:!w.keyword});
    const pickKw=(kw,intent)=>{ wzSet({keyword:kw,intent}); $("#wz-kw").value=kw; $("#wz-next").disabled=false; };
    $("#wz-kw").oninput=()=>{ wzSet({keyword:$("#wz-kw").value.trim(),intent:null}); $("#wz-next").disabled=!$("#wz-kw").value.trim();
      $("#wz-ideas").querySelectorAll("[data-wzk]").forEach(x=>x.setAttribute("aria-pressed","false")); };
    $("#wz-next").onclick=()=>{ if(!wzGet().keyword) return; wzGo("write"); };
    // a short topic makes a better seed than a whole sentence; the full description goes along as context
    const offer=String(site.product||"").trim(), seed=(offer.split(/[.;:!?—–]|,\s(?=and |for |with )/)[0]||site.name||site.url).split(/\s+/).slice(0,8).join(" ").replace(/[,.]+$/,"");
    try{ const r=await api(`/api/sites/${site.id}/keywords/ideas`,{method:"POST",body:JSON.stringify({seed,focus:offer})});
      const ideas=r.ideas.sort((a,b)=>(a.coverage?.status==="gap"?0:a.coverage?.status==="partial"?1:2)-(b.coverage?.status==="gap"?0:b.coverage?.status==="partial"?1:2)).slice(0,8);
      if(!$("#wz-ideas")) return;
      $("#wz-ideas").innerHTML=ideas.length?ideas.map(x=>`<button class="wz-opt" data-wzk="${esc(x.keyword)}" data-wzi="${esc(x.intent)}" aria-pressed="${x.keyword===w.keyword}"><b>${esc(x.keyword)}</b> <span class="status">· ${esc(INTENT_LABEL[x.intent]||x.intent)}</span><br>
        <span class="${x.coverage?.status==="covered"?"warn":"status"}">${x.coverage?.status==="covered"?"You already have a page for this":x.coverage?.status==="partial"?"Related page exists":"No page yet: a good first pick"}</span></button>`).join(""):`<p class="status">No ideas came back. Type a keyword below.</p>`;
      $("#wz-ideas").querySelectorAll("[data-wzk]").forEach(b=>b.onclick=()=>{ $("#wz-ideas").querySelectorAll("[data-wzk]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); pickKw(b.dataset.wzk,b.dataset.wzi); });
    }catch(e){ if($("#wz-ideas")) $("#wz-ideas").innerHTML=`<p class="status">${esc(e.message)} Type a keyword below instead.</p>`; }
  }
  else if(step==="write"){
    const authors=await api("/api/authors").catch(()=>[]), me=AUTH.state().user;
    const ymyl=BUSINESS_TYPES[site?.business_type]?.ymyl;
    wzFrame("write","Write your first page",`“${esc(w.keyword)}”. Google looks for real expertise, so name the author.${ymyl?" For this type of website, the author or a reviewer should be a qualified professional.":""}`,
      `<div class="field"><label for="wz-author">Author: name and role</label><input id="wz-author" value="${esc(authors[0]||(me?me.name:"")||"")}" placeholder="e.g. Priya Shah, Head of Marketing"></div>
       <div class="field"><label for="wz-notes">Anything the page should include <span>(optional: examples, opinions, results)</span></label><textarea id="wz-notes" style="min-height:70px"></textarea></div>
       <p class="status">Writing takes a few minutes; you'll see each step as it happens. Afterwards you can edit the page, fill in any placeholders and approve it.</p>`,{next:"Write my first page"});
    $("#wz-next").onclick=()=>{ const a=$("#wz-author").value.trim(); if(!a){ $("#wz-status").textContent="Add the author's name and role."; return; }
      const intent=w.intent||null; wzSet({done:Date.now(),step:"ai"}); wzClose();
      prefillWrite(w.keyword,intent); $("#g-author").value=a; $("#g-notes").value=$("#wz-notes").value;
      const it=$("#g-intent").value; const fmt=(RULES?.intent_formats||{})[it]||[]; if(fmt[0]&&$(`#g-type option[value="${fmt[0]}"]`)) $("#g-type").value=fmt[0];
      setTimeout(()=>$("#g-run").click(),300); };
  }
}

// ---------- accounts: sign-in screens, workspace switcher, roles ----------
function gate(html){ $("#gate-card").innerHTML=html; $("#gate").classList.remove("hidden"); const f=$("#gate-card input"); if(f) f.focus(); }
function gateForm(onSubmit){ const form=$("#gate-card form"), st=$("#gate-status");
  form.onsubmit=async e=>{ e.preventDefault(); const b=form.querySelector("button[type=submit]"); b.disabled=true; st.className="status spin"; st.textContent="Working…";
    try{ await onSubmit(Object.fromEntries(new FormData(form))); }catch(err){ st.className="status err"; st.textContent=err.message; b.disabled=false; } }; }
async function showGate(g){
  const brand=`<p class="status" style="margin:0 0 16px">Content Engine</p>`;
  if(g.gate==="login"){ gate(`${brand}<h1 id="gate-title">Sign in</h1><p class="status">Use the email and password for your account.</p>
      <form><div class="field"><label for="gl-e">Email</label><input id="gl-e" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="gl-p">Password</label><input id="gl-p" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn" type="submit">Sign in</button> <span id="gate-status" class="status" role="status"></span></form>
      <p class="status" style="margin-top:16px">No account? Ask an owner or admin of your workspace for an invitation link.</p>`);
    gateForm(f=>AUTH.login(f.email,f.password)); }
  else if(g.gate==="setup"){ gate(`${brand}<h1 id="gate-title">Set up accounts</h1><p class="status">Create the first owner account. You'll need the setup code from your Netlify settings (AUTH_SETUP_CODE).</p>
      <form><div class="field"><label for="gs-c">Setup code</label><input id="gs-c" name="code" type="password" required></div>
      <div class="field"><label for="gs-n">Your name</label><input id="gs-n" name="name" autocomplete="name" required></div>
      <div class="field"><label for="gs-e">Email</label><input id="gs-e" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="gs-p">Password <span>(at least 10 characters)</span></label><input id="gs-p" name="password" type="password" autocomplete="new-password" minlength="10" required></div>
      <div class="field"><label for="gs-w">First workspace name</label><input id="gs-w" name="workspace" placeholder="e.g. your company, or a client" required></div>
      <button class="btn" type="submit">Create owner account</button> <span id="gate-status" class="status" role="status"></span></form>`);
    gateForm(f=>AUTH.setup(f)); }
  else if(g.gate==="invite"){ let info; try{ info=await AUTH.inviteInfo(g.token); }catch(e){ gate(`${brand}<h1 id="gate-title">Invitation</h1><p class="err">${esc(e.message)}</p><button class="btn ghost" id="gate-home">Go to sign in</button>`); $("#gate-home").onclick=()=>{ history.replaceState(null,"",location.pathname); location.reload(); }; return; }
    gate(`${brand}<h1 id="gate-title">Join ${esc(info.workspace)}</h1><p class="status">You've been invited as <b>${esc(AUTH.ROLE_LABEL[info.role]||info.role)}</b> with ${esc(info.email)}.</p>
      <form>${info.has_account?`<div class="field"><label for="gi-p">Your password</label><input id="gi-p" name="password" type="password" autocomplete="current-password" required></div>`
        :`<div class="field"><label for="gi-n">Your name</label><input id="gi-n" name="name" autocomplete="name" required></div><div class="field"><label for="gi-p">Choose a password <span>(at least 10 characters)</span></label><input id="gi-p" name="password" type="password" autocomplete="new-password" minlength="10" required></div>`}
      <button class="btn" type="submit">${info.has_account?"Sign in and join":"Create account and join"}</button> <span id="gate-status" class="status" role="status"></span></form>`);
    gateForm(f=>AUTH.acceptInvite(g.token,f.name||"",f.password)); }
  else if(g.gate==="no-workspace"){ gate(`${brand}<h1 id="gate-title">No workspace yet</h1><p class="status">You're signed in, but you're not a member of any workspace. Ask an owner or admin to invite you.</p><button class="btn ghost" id="gate-out">Sign out</button>`); $("#gate-out").onclick=()=>AUTH.logout(); }
}
function applyAccount(){
  const st=AUTH.state(); if(!st.accounts||!st.workspace) return;
  const ws=st.workspace, role=ws.role; READONLY=!AUTH.canWrite(role);
  document.body.classList.toggle("readonly",READONLY); document.body.classList.toggle("role-client",role==="client");
  $("#ro-banner").classList.toggle("hidden",!READONLY); if(READONLY) $("#ro-banner").textContent=`You have view-only access to “${ws.name}” (${AUTH.ROLE_LABEL[role]}). You can look around and download reports, but not make changes.`;
  const sel=$("#ws-select"); sel.classList.remove("hidden"); sel.innerHTML=st.workspaces.map(w=>`<option value="${w.id}" ${w.id===ws.id?"selected":""}>${esc(w.name)}</option>`).join("");
  sel.onchange=()=>{ const w=st.workspaces.find(x=>x.id===sel.value); if(w) AUTH.openWorkspace(w); };
  const ub=$("#user-btn"); ub.classList.remove("hidden"); ub.textContent=`${st.user.name||st.user.email} · ${AUTH.ROLE_LABEL[role]}`;
  $("#sync-pill").classList.remove("hidden");
}
// the "Team workspace" panel in Settings, in account mode
async function renderAccountPanel(){
  const st=AUTH.state(); if(!st.accounts||!st.workspace) return false;
  const el=$("#team-panel"), ws=st.workspace, manage=AUTH.canManage(ws.role);
  let m={members:[],invites:[]}, act={activity:[]}; try{ m=await AUTH.members(ws.id); }catch{} try{ act=await AUTH.activity(ws.id); }catch{}
  const roleOpts=cur=>["owner","admin","editor","viewer","client"].filter(r=>ws.role==="owner"||r!=="owner").map(r=>`<option value="${r}" ${r===cur?"selected":""}>${AUTH.ROLE_LABEL[r]}</option>`).join("");
  el.innerHTML=`<h2>Workspace and team</h2>
   <p class="lead">You're in <b>${esc(ws.name)}</b> as <b>${AUTH.ROLE_LABEL[ws.role]}</b>. Everything here syncs automatically for its members. API keys stay in each person's browser.</p>
   ${manage?`<div class="row" style="margin-bottom:12px;flex-wrap:nowrap"><input id="ws-name" value="${esc(ws.name)}" aria-label="Workspace name" style="max-width:320px"><button class="btn ghost small" id="ws-rename">Rename</button><button class="btn ghost small" id="ws-new">New workspace</button></div>`:""}
   <h3 style="font-size:15px;margin:14px 0 4px">Members</h3>
   <div>${m.members.map(x=>`<div class="member-row"><span><b>${esc(x.name||x.email)}</b>${x.you?' <span class="pill">you</span>':""}<br><span class="status">${esc(x.email)}</span></span>
     ${manage&&!x.you?`<select data-mrole="${x.id}" aria-label="Role for ${esc(x.email)}">${roleOpts(x.role)}</select><button class="btn ghost small" data-mremove="${x.id}">Remove</button>`:`<span class="status">${AUTH.ROLE_LABEL[x.role]}</span><span></span>`}</div>`).join("")}</div>
   ${manage?`<h3 style="font-size:15px;margin:16px 0 4px">Invite someone</h3><div class="row" style="flex-wrap:nowrap"><input id="inv-email" type="email" placeholder="name@company.com" aria-label="Email to invite"><select id="inv-role" aria-label="Role" style="width:auto">${roleOpts("editor")}</select><button class="btn" id="inv-go">Create invitation</button></div><div id="inv-out" class="status" style="margin-top:8px"></div>
     ${m.invites.length?`<h3 style="font-size:15px;margin:16px 0 4px">Pending invitations</h3>${m.invites.map(i=>`<div class="member-row"><span>${esc(i.email)}<br><span class="status">${AUTH.ROLE_LABEL[i.role]} · expires ${esc(fmtDate(i.exp))}</span></span><button class="btn ghost small" data-icopy="${i.token}">Copy link</button><button class="btn ghost small" data-irevoke="${i.token}">Cancel</button></div>`).join("")}`:""}`:""}
   <details style="margin-top:16px"><summary><b>Activity</b> <span class="status">(who changed what)</span></summary><div class="tw" style="margin-top:8px"><table><tr><th>When</th><th>Who</th><th>What</th></tr>${act.activity.slice(0,60).map(a=>`<tr><td class="status">${esc(fmtDate(a.at))}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td></tr>`).join("")||"<tr><td colspan=3 class=status>Nothing yet.</td></tr>"}</table></div></details>
   <details style="margin-top:12px"><summary><b>Your account</b></summary><div style="margin-top:10px">
     <div class="row" style="flex-wrap:nowrap;max-width:520px"><input id="acc-name" value="${esc(st.user.name||"")}" aria-label="Your name"><button class="btn ghost small" id="acc-name-save">Save name</button></div>
     <div class="row" style="margin-top:10px;max-width:520px"><input id="acc-cur" type="password" placeholder="Current password" aria-label="Current password" autocomplete="current-password"><input id="acc-new" type="password" placeholder="New password (10+ characters)" aria-label="New password" autocomplete="new-password"><button class="btn ghost small" id="acc-pw">Change password</button></div>
     <div class="row" style="margin-top:10px"><button class="btn ghost small" id="acc-move">Bring this browser's earlier data into “${esc(ws.name)}”</button>${ws.role!=="owner"?`<button class="btn ghost small" id="acc-leave">Leave this workspace</button>`:""}<button class="btn ghost small" id="acc-out">Sign out</button></div>
     <span class="status" id="acc-msg" role="status"></span></div></details>`;
  const msg=t=>{ const e=$("#acc-msg")||$("#inv-out"); if(e) e.textContent=t; };
  const run=(b,fn)=>busy(b,$("#acc-msg"),"Working…",async()=>{ await fn(); });
  if(manage){
    $("#ws-rename").onclick=()=>run($("#ws-rename"),async()=>{ await AUTH.rename(ws.id,$("#ws-name").value.trim()); ws.name=$("#ws-name").value.trim(); localStorage.setItem("ce-ws",JSON.stringify(ws)); applyAccount(); msg("Renamed."); });
    $("#ws-new").onclick=()=>run($("#ws-new"),async()=>{ const name=prompt("Name of the new workspace (for example a client or brand):"); if(!name) return; const w=await AUTH.createWorkspace(name); AUTH.openWorkspace(w); });
    $("#inv-go").onclick=()=>busy($("#inv-go"),$("#inv-out"),"Creating…",async()=>{ const d=await AUTH.invite(ws.id,$("#inv-email").value.trim(),$("#inv-role").value);
      const link=`${location.origin}${location.pathname}#invite=${d.token}`; try{ await navigator.clipboard.writeText(link); }catch{}
      await renderAccountPanel(); $("#inv-out").innerHTML=`Invitation created and copied. Send this link to them (valid for 7 days, works once):<br><span class="url">${esc(link)}</span>`; });
    el.querySelectorAll("[data-mrole]").forEach(x=>x.onchange=async()=>{ try{ await AUTH.setRole(ws.id,x.dataset.mrole,x.value); msg("Role changed."); }catch(e){ msg(e.message); } renderAccountPanel(); });
    el.querySelectorAll("[data-mremove]").forEach(x=>x.onclick=async()=>{ if(!confirm("Remove this person from the workspace? They lose access immediately.")) return; try{ await AUTH.remove(ws.id,x.dataset.mremove); }catch(e){ msg(e.message); } renderAccountPanel(); });
    el.querySelectorAll("[data-icopy]").forEach(x=>x.onclick=async()=>{ const link=`${location.origin}${location.pathname}#invite=${x.dataset.icopy}`; try{ await navigator.clipboard.writeText(link); x.textContent="Copied"; }catch{ prompt("Copy this link:",link); } });
    el.querySelectorAll("[data-irevoke]").forEach(x=>x.onclick=async()=>{ await AUTH.revoke(ws.id,x.dataset.irevoke); renderAccountPanel(); });
  }
  $("#acc-name-save").onclick=()=>run($("#acc-name-save"),async()=>{ await AUTH.saveName($("#acc-name").value.trim()); st.user.name=$("#acc-name").value.trim(); applyAccount(); msg("Saved."); });
  $("#acc-pw").onclick=()=>run($("#acc-pw"),async()=>{ await AUTH.changePassword($("#acc-cur").value,$("#acc-new").value); msg("Password changed. Other devices have been signed out."); $("#acc-cur").value=$("#acc-new").value=""; });
  $("#acc-move").onclick=()=>run($("#acc-move"),async()=>{ if(READONLY) throw new Error("View-only roles can't add data."); const n=await store.countIn(store.DEFAULT_DB); if(!n) { msg("There's no earlier data in this browser."); return; }
    if(!confirm(`Copy ${n} item(s) from this browser's earlier data into “${ws.name}”? Your team will see them.`)) return; const c=await store.copyFrom(store.DEFAULT_DB); SYNC.syncNow().catch(()=>{}); await loadSites(); msg(`Copied ${c} item(s). They'll sync to your team in a moment.`); });
  const lv=$("#acc-leave"); if(lv) lv.onclick=()=>run(lv,async()=>{ if(!confirm(`Leave “${ws.name}”?`)) return; await AUTH.leave(ws.id); localStorage.removeItem("ce-ws"); location.reload(); });
  $("#acc-out").onclick=()=>AUTH.logout();
  return true;
}

(async()=>{
  // accounts first: when the site uses accounts, nothing loads until you're signed in and in a workspace
  const b=await AUTH.boot();
  if(b.reloading) return;
  if(b.gate){ await showGate(b); return; }
  applyAccount();
  SYNC.start(); renderSync();
  RULES=await api("/api/rules").catch(()=>null);
  updatePill();
  if(RULES){
    $("#g-intent").innerHTML=Object.entries(RULES.intents).map(([k,v])=>`<option value="${k}">${esc(v)} (${k})</option>`).join("");
    renderPageTypes();
  }
  await loadSites();
  const gret=await GSCC.handleReturn(async id=>(await api(`/api/sites/${id}`).catch(()=>({}))).url||"").catch(e=>({error:e.message}));
  if(gret&&gret.site){ SITE_ID=gret.site; await loadSites(gret.site); show("gsc"); toast(gret.conn.property?`Search Console connected (${gret.conn.property}). Importing your data…`:"Search Console connected. Choose the property for this website."); }
  else if(gret&&gret.error){ show("gsc"); toast(gret.error); }
  else { const aret=await GA4.handleReturn(async id=>(await api(`/api/sites/${id}`).catch(()=>({}))).url||"").catch(e=>({error:e.message}));
    if(aret&&aret.site){ SITE_ID=aret.site; await loadSites(aret.site); GS_TAB="analytics"; show("gsc"); /* just connected Analytics: show it */ toast(aret.conn.property?"Google Analytics connected. Getting your landing pages…":"Google Analytics connected. Choose the property."); if(aret.conn.property) GA4.refresh(aret.site).then(()=>renderGa4()).catch(e=>toast(e.message,"error")); }
    else if(aret&&aret.error){ GS_TAB="analytics"; show("gsc"); toast(aret.error,"error"); }
    else show("home"); }
  const wz=wzGet(), nSites=(await api("/api/sites").catch(()=>[])).length;
  const noWizard=new URLSearchParams(location.search).has("nowizard");   // for automated tests
  if(!noWizard&&!READONLY&&!wz.done&&!wz.dismissed&&(nSites===0||(wz.step&&wz.step!=="ai"&&wz.siteId))) openWizard();
})();

// sidebar groups fold and unfold (remembered); the item for the current screen always stays visible
document.querySelectorAll("nav .nav-group").forEach(h=>h.onclick=()=>{ let f=[]; try{ f=JSON.parse(localStorage.getItem("ce-nav-folded")||"[]"); }catch{}
  const name=h.dataset.group, fold=h.getAttribute("aria-expanded")==="true", cur=NAV_PARENT[CURRENT]||CURRENT;
  f=fold?[...new Set([...f,name])]:f.filter(x=>x!==name); try{ localStorage.setItem("ce-nav-folded",JSON.stringify(f)); }catch{}
  const g=navGroups().find(x=>x.head===h); h.setAttribute("aria-expanded",String(!fold)); g.items.forEach(b=>b.classList.toggle("folded",fold&&b.dataset.v!==cur)); });
applyNav();
// entry points for screens that live inside others
{ const go=(id,v)=>{ const b=document.getElementById(id); if(b) b.onclick=()=>show(v); }; go("go-keyword","keyword"); go("go-audit","audit"); go("go-audit2","audit");
  { const r=document.getElementById("go-ranks"); if(r) r.onclick=()=>{ GS_TAB="rankings"; show("gsc"); }; }
  document.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>show(b.dataset.goto)); }

document.querySelectorAll("#gs-tabs [data-gs]").forEach(b=>b.onclick=()=>gsTab(b.dataset.gs));

{ const mb=document.getElementById("nav-more"); if(mb) mb.onclick=()=>{ const on=mb.getAttribute("aria-expanded")!=="true"; try{ localStorage.setItem("ce-nav-more",on?"1":"0"); }catch{} applyMore(); if(!on&&MORE_TOOLS.includes(CURRENT)){ mb.setAttribute("aria-expanded","true"); document.querySelectorAll("nav .nav-sub").forEach(b=>b.classList.remove("more-closed")); } }; applyMore(); }

// ---------- Settings: four tabs, each showing whether it's set up ----------
let SET_TAB="ai";
function setTab(t){ SET_TAB=t; const sec=document.querySelector("section[data-view=settings]"); if(!sec) return;
  sec.querySelectorAll("#set-tabs [data-st]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.st===t)));
  sec.querySelectorAll("[data-stp]").forEach(el=>el.classList.toggle("hidden",el.dataset.stp!==t)); }
async function setStatus(){ const L=LLM.getSettings(), sec=document.querySelector("section[data-view=settings]"); if(!sec) return;
  const put=(k,html)=>{ const el=sec.querySelector(`[data-stc="${k}"]`); if(el) el.innerHTML=html; };
  const prov=(LLM.PROVIDERS&&LLM.PROVIDERS[L.provider]&&LLM.PROVIDERS[L.provider].label)||{mock:"Demo mode",builtin:"Built-in AI",ollama:"Ollama"}[L.provider]||L.provider||"";
  put("ai", prov?`<span class="status">${esc(prov)}</span>`:`<b class="warn">choose</b>`);
  const keys=[L.googleKey&&"Google",L.bingKey&&"Bing"].filter(Boolean); put("google", keys.length?`<span class="pass">✓</span> <span class="status">${keys.join(", ")}</span>`:`<span class="status">optional</span>`);
  const m=await api("/api/monitor-settings").catch(()=>({})); put("alerts", m.enabled?`<span class="pass">on</span>`:`<span class="status">off</span>`);
  const team=AUTH.state().accounts?"accounts":SYNC.syncSettings().enabled?"sync on":""; put("team", team?`<span class="pass">${team}</span>`:`<span class="status">this browser only</span>`); }
document.querySelectorAll("#set-tabs [data-st]").forEach(b=>b.onclick=()=>setTab(b.dataset.st));
setTab(SET_TAB);

// ---------- find any feature (Ctrl+K / ⌘K, or the search box at the top of the sidebar) ----------
const goScreen=(v,focus)=>()=>{ show(v); if(focus) setTimeout(()=>{ const el=document.querySelector(focus); if(el){ el.scrollIntoView({block:"center"}); el.focus(); } },250); };
const goScroll=(v,sel)=>()=>{ show(v); setTimeout(()=>{ const el=document.querySelector(sel); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); },450); };
const goTech=t=>()=>{ const g=TA_GROUP_OF[t]; if(CURRENT==="tech"&&document.querySelector("#ta-main")){ document.querySelector(`#ta-main [data-tm="${g}"]`)?.click(); document.querySelector(`#ta-tabs [data-tt="${t}"]`)?.click(); } else { TA_TAB=t; show("tech"); } };
const goPerf=t=>()=>{ GS_TAB=t; if(CURRENT==="gsc") gsTab(t); else show("gsc"); };
const goSet=t=>()=>{ SET_TAB=t; if(CURRENT==="settings") setTab(t); else show("settings"); };
const later=(sel,fn)=>setTimeout(()=>{ const el=document.querySelector(sel); if(el){ if(fn) fn(el); el.scrollIntoView({behavior:"smooth",block:"start"}); } },500);
const goKw=t=>()=>{ show("urlmap"); setTimeout(()=>document.querySelector(`#kw-tabs [data-kt="${t}"]`)?.click(),150); };
// [label, where it is, everyday words people might type, go]
const CMD=[
 ["Home","Overview","dashboard start summary for you",goScreen("home")],
 ["Ask AI","Overview","chat question assistant answer",goScreen("chat","#chat-text")],
 ["To-do list","Overview","tasks actions todo fix priorities",goScreen("actions")],
 ["Content ideas","Plan","strategy plan topics pages to write",goScreen("strategy")],
 ["Calendar","Plan","editorial board schedule deadlines due dates owners kanban",goScreen("calendar")],
 ["Briefs","Plan → Calendar","content brief writer freelancer outline",goScroll("calendar","#cal-briefs")],
 ["Download calendar (.ics)","Plan → Calendar","google calendar outlook ical export",goScreen("calendar","#cal-ics")],
 ["Keywords","Plan","my keywords list import export",goKw("list")],
 ["Find keyword ideas","Plan → Keywords","ideas research suggestions",goKw("ideas")],
 ["Topic clusters","Plan → Keywords","groups clustering hub",goKw("clusters")],
 ["Competing pages","Plan → Keywords","cannibalisation cannibalization overlap",goKw("compete")],
 ["Real questions","Plan → Keywords","stack exchange faq people ask",goKw("questions")],
 ["Topic facts","Plan → Keywords","wikipedia wikidata facts",goKw("wiki")],
 ["Check a keyword","Plan → Keywords","serp search intent ranking research",goScreen("keyword","#k-kw")],
 ["Write a page","Create","generate article blog post new page draft",goScreen("generate","#g-kw")],
 ["Brand style","Create → Write a page","tone voice style guide",()=>{ show("generate"); later("#st-save",el=>{ const d=el.closest("details"); if(d) d.open=true; }); }],
 ["My pages","Create","library drafts written pages approve publish",goScreen("library")],
 ["Review a draft","Create → My pages","audit check existing draft paste",goScreen("audit")],
 ["Site health","Measure","technical seo audit issues errors",goTech("issues")],
 ["Pages","Measure → Site health","all pages crawl list",goTech("pages")],
 ["Ignored issues","Measure → Site health","hidden dismissed",goTech("ignored")],
 ["Page speed","Measure → Site health","core web vitals lcp inp cls pagespeed fast slow performance",goTech("speed")],
 ["Is this page in Google?","Measure → Site health → Indexing","indexed index status url inspection coverage",goTech("index")],
 ["Sitemaps & robots.txt","Measure → Site health → Indexing","sitemap robots lastmod crawl blocked",goTech("sitemaps")],
 ["Internal links","Measure → Site health → Links","link map orphan pages internal linking",goTech("links")],
 ["External links","Measure → Site health → Links","broken outbound links",goTech("ext")],
 ["Duplicate content","Measure → Site health → Content","duplicates similar near duplicate",goTech("dupes")],
 ["Structured data","Measure → Site health → Content","schema json-ld rich results markup",goTech("schema")],
 ["Images","Measure → Site health → Content","image seo alt text size webp avif",goTech("images")],
 ["Performance","Measure","google search console traffic clicks overview",goPerf("overview")],
 ["Searches & pages","Measure → Performance","queries opportunities topics devices countries brand",goPerf("searches")],
 ["Rankings","Measure → Performance","rank tracking positions daily serp position",goPerf("rankings")],
 ["Content decay","Measure → Performance","declining pages losing traffic refresh",goPerf("decay")],
 ["Google Analytics","Measure → Performance","ga4 conversions key events sign ups revenue",goPerf("analytics")],
 ["Bing","Measure → Performance","bing webmaster copilot",goPerf("bing")],
 ["Import Search Console data","Measure → Performance","upload csv zip connect search console",goPerf("import")],
 ["Chart notes","Measure → Performance","annotations notes markers timeline",()=>{ goPerf("overview")(); later("[data-notes-box]",el=>{ const d=el.querySelector("details"); if(d) d.open=true; }); }],
 ["AI answers","Measure","chatgpt perplexity gemini ai visibility citations",goScreen("aivis")],
 ["AI-answer readiness","Measure → AI answers","ai crawlers gptbot robots readiness cited",goScroll("aivis","#air-panel")],
 ["llms.txt","Measure → AI answers","llms llmstxt ai file",goScroll("aivis","#air-panel")],
 ["Reports","Measure","client report share pdf",goScreen("reports")],
 ["Competitors","Measure","competitor tracking rivals new pages",goScreen("competitors")],
 ["Page history","Measure → More tools","wayback archive old versions history",goScreen("history")],
 ["Site migration","Measure → More tools","redirects move domain redesign 301",goScreen("migration")],
 ["Settings","Setup","settings preferences",goSet("ai")],
 ["AI provider","Setup → Settings","claude chatgpt openai gemini api key model ollama demo",goSet("ai")],
 ["Google & Bing keys","Setup → Settings","pagespeed api key bing key free tools",goSet("google")],
 ["Weekly monitoring","Setup → Settings → Alerts","weekly check email summary schedule",goSet("alerts")],
 ["Chat alerts","Setup → Settings → Alerts","slack teams google chat webhook notifications",()=>{ goSet("alerts")(); later("#chat-alerts"); }],
 ["Team workspace","Setup → Settings → Team & data","team sync share colleagues",goSet("team")],
 ["Export or import data","Setup → Settings → Team & data","backup download restore",goSet("team")],
 ["Websites","Setup","add website sites domains",goScreen("site")],
 ["Add a website","Setup → Websites","new site read website crawl",goScreen("site","#s-url")],
 ["Knowledge base","Setup","facts documents knowledge sources",goScreen("kb")],
 ["Rules","Setup","google rules guidelines seo thresholds",goScreen("rules")],
];
let CMD_SEL=0, CMD_RES=[], CMD_PREV=null;
const cmdNorm=t=>String(t).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"");
function cmdSearch(q){
  const qs=cmdNorm(q).split(/[\s→>]+/).filter(Boolean);
  if(!qs.length){ let rec=[]; try{ rec=JSON.parse(localStorage.getItem("ce-cmd-recent")||"[]"); }catch{} const r=rec.map(l=>CMD.find(c=>c[0]===l)).filter(Boolean); return (r.length?r:CMD.slice(0,8)).map(c=>({c,recent:r.length>0})); }
  return CMD.map((c,i)=>{ const label=cmdNorm(c[0]), all=cmdNorm(`${c[0]} ${c[1]} ${c[2]}`), words=all.split(/[^a-z0-9.]+/); let sc=0;
      for(const w of qs){ let s=0; if(label.startsWith(w)) s=100; else if(label.split(/[^a-z0-9.]+/).some(x=>x.startsWith(w))) s=80; else if(label.includes(w)) s=60; else if(words.some(x=>x.startsWith(w))) s=45; else if(all.includes(w)) s=25; if(!s) return null; sc+=s; }
      return {c,sc,i}; }).filter(Boolean).sort((a,b)=>b.sc-a.sc||a.i-b.i).slice(0,12);
}
function cmdRender(){ const ul=$("#cmd-list"); CMD_RES=cmdSearch($("#cmd-in").value); CMD_SEL=Math.min(CMD_SEL,Math.max(CMD_RES.length-1,0));
  ul.innerHTML=CMD_RES.length?CMD_RES.map((r,k)=>`<li role="option" id="cmd-o${k}" aria-selected="${k===CMD_SEL}" data-k="${k}"><span>${r.recent?`<span class="kind">Recent</span>`:""}${esc(r.c[0])}</span><span class="where">${esc(r.c[1])}</span></li>`).join(""):`<li class="cmd-empty" role="option" aria-disabled="true">Nothing found. Try another word, like “speed”, “brief” or “alt text”.</li>`;
  $("#cmd-in").setAttribute("aria-activedescendant",CMD_RES.length?`cmd-o${CMD_SEL}`:"");
  ul.querySelectorAll("[data-k]").forEach(li=>{ li.onmousemove=()=>{ if(CMD_SEL!==+li.dataset.k){ CMD_SEL=+li.dataset.k; cmdMark(); } }; li.onclick=()=>{ CMD_SEL=+li.dataset.k; cmdGo(); }; }); }
function cmdMark(){ $("#cmd-list").querySelectorAll("[data-k]").forEach(li=>li.setAttribute("aria-selected",String(+li.dataset.k===CMD_SEL))); $("#cmd-in").setAttribute("aria-activedescendant",`cmd-o${CMD_SEL}`); document.getElementById(`cmd-o${CMD_SEL}`)?.scrollIntoView({block:"nearest"}); }
function cmdOpen(){ CMD_PREV=document.activeElement; $("#cmd-back").classList.remove("hidden"); $("#cmd-in").value=""; CMD_SEL=0; cmdRender(); $("#cmd-in").focus(); }
function cmdClose(restore=true){ $("#cmd-back").classList.add("hidden"); if(restore&&CMD_PREV&&CMD_PREV.focus) CMD_PREV.focus(); }
function cmdGo(){ const r=CMD_RES[CMD_SEL]; if(!r) return; cmdClose(false);
  let rec=[]; try{ rec=JSON.parse(localStorage.getItem("ce-cmd-recent")||"[]"); }catch{} rec=[r.c[0],...rec.filter(x=>x!==r.c[0])].slice(0,5); try{ localStorage.setItem("ce-cmd-recent",JSON.stringify(rec)); }catch{}
  r.c[3](); }
$("#cmd-in").oninput=()=>{ CMD_SEL=0; cmdRender(); };
$("#cmd-in").onkeydown=e=>{ if(e.key==="ArrowDown"){ e.preventDefault(); if(CMD_RES.length){ CMD_SEL=(CMD_SEL+1)%CMD_RES.length; cmdMark(); } }
  else if(e.key==="ArrowUp"){ e.preventDefault(); if(CMD_RES.length){ CMD_SEL=(CMD_SEL-1+CMD_RES.length)%CMD_RES.length; cmdMark(); } }
  else if(e.key==="Enter"){ e.preventDefault(); cmdGo(); } else if(e.key==="Escape"){ e.preventDefault(); cmdClose(); } else if(e.key==="Tab"){ e.preventDefault(); } };
$("#cmd-back").onclick=e=>{ if(e.target.id==="cmd-back") cmdClose(); };
$("#cmd-open").onclick=cmdOpen;
document.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==="k"){ e.preventDefault(); if($("#cmd-back").classList.contains("hidden")) cmdOpen(); else cmdClose(); } });
if(/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent)) { const k=$("#cmd-kbd"); if(k) k.textContent="⌘K"; }
