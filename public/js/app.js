import { api as localApi, download } from "./api.js";
import * as LLM from "./llm.js";
import * as store from "./store.js";
import { check as liveCheck } from "./validators.js";
import { GOOGLE_UPDATES } from "./rules.js";
import { htmlToMarkdown } from "./md.js";

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const list=a=>Array.isArray(a)&&a.length?`<ul class="c">${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"";
let RULES=null, SITE_ID=null, pollTimer=null, CURRENT="home";


async function api(path,opts={}){ return localApi(path,opts); }
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
async function loadHome(){
  const out=$("#home-out");
  if(!SITE_ID){
    out.innerHTML=`<div class="panel welcome"><h2>Welcome to Content Engine</h2><p class="lead">Plan, write and measure content that follows Google's rules and earns mentions in AI answers. Start by connecting an AI provider and adding your website: the engine reads your pages, so every suggestion fits what you already have.</p>
      <ol class="steps" style="max-width:560px;margin:14px 0 18px"><li><span class="n">1</span><span class="t">Connect Claude, ChatGPT or Gemini (or try Demo mode)</span></li><li><span class="n">2</span><span class="t">Add your website</span></li><li><span class="n">3</span><span class="t">See site health, then check keywords and write your first page</span></li></ol>
      <div class="row">${LLM.isConfigured()?"":'<button class="btn" data-go="settings">Connect AI</button>'}<button class="btn ${LLM.isConfigured()?"":"ghost"}" data-go="site">Add your website</button></div></div>`;
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
  if(!LLM.isConfigured()) alerts.push(["warn","<b>Connect an AI provider</b> to write pages, check keywords and run AI answer checks.","settings","Connect AI"]);
  if(crawledAgo!=null&&crawledAgo>30) alerts.push(["warn",`Your website was last read <b>${crawledAgo} days ago</b>. Read it again so checks and suggestions reflect your current pages.`,"site","Read again"]);
  if(overdue.length) alerts.push(["bad",`<b>${overdue.length} to-do${overdue.length>1?"s are":" is"} overdue.</b>`,"actions","Open to-do list"]);
  if(g&&g.range){ const age=daysAgo(Date.parse(g.range.to+"T00:00:00Z")); if(age>45) alerts.push(["warn",`Your Google data ends <b>${age} days ago</b>. Upload a fresh Search Console export.`,"gsc","Upload"]); }
  else if(!g) alerts.push(["info","Upload your Google Search Console data to see clicks, trends and quick wins.","gsc","Upload"]);
  if(vs.checks&&lastAi&&daysAgo(lastAi)>30) alerts.push(["warn",`Your AI answer checks are <b>${daysAgo(lastAi)} days old</b>. Run them again to track the trend.`,"aivis","Run checks"]);
  const today=new Date().toISOString().slice(0,10), recentUpd=GOOGLE_UPDATES.filter(u=>u.start<=today&&daysAgo(Date.parse(u.end+"T00:00:00Z"))<=21);
  for(const u of recentUpd) alerts.push(["info",`<b>${esc(u.name)}</b> ${u.end>=today?"is rolling out":`finished ${daysAgo(Date.parse(u.end+"T00:00:00Z"))} days ago`}. Wait a week after it finishes, then compare your clicks before and after in Google search.`,"gsc","See impact"]);
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
     ${card("Google clicks",g&&(g.daily||[]).length>1?`Per day · ${esc(gs.imports[0].label)} · shaded bands are Google updates`:"Upload Search Console data to see the trend",g&&(g.daily||[]).length>1?lineChart(g.daily.map(x=>({date:x.date,value:x.clicks})),{updates:g.impact||[]}):g?emptyBox("No daily data","Upload the full Search Console zip to see clicks per day.","gsc","Upload"):emptyBox("No Google data yet","See clicks, trends and quick wins.","gsc","Upload data"))}
     ${card("AI answers","Share of answers that mention you, per run",vs.trend&&vs.trend.length?columns(vs.trend.map(t=>({label:(t.date||"").slice(5),value:t.mention_rate})),{fmt:v=>v+"%",color:"var(--c2)"})+(vs.share_of_voice&&vs.share_of_voice.length?`<p class="status">Named most: ${esc(vs.share_of_voice.filter(e=>!e.ours).slice(0,3).map(e=>e.name).join(", "))}</p>`:""):emptyBox("No checks yet","See whether ChatGPT, Gemini or Claude recommend you.","aivis","Run a check"))}
   </div>
   <div class="grid2">
     ${card("Site health","Issues by severity",ta?hbars(["error","high","medium","low"].map(k=>({label:{error:"Errors",high:"High",medium:"Medium",low:"Low"}[k],value:ta.counts[k]||0,color:{error:"var(--c4)",high:"var(--c4)",medium:"var(--c3)",low:"var(--c5)"}[k]})))+(ta.history&&ta.history.length>1?`<p class="status">Health over your last reads: ${ta.history.slice(-5).map(h=>h.health).join(" → ")}</p>`:""):emptyBox("Not checked yet","","tech","Check site health"))}
     ${card("Best keyword opportunities","Search demand, business value and ease (0–100)",K.length?hbars(K.slice(0,7).map(k=>({label:k.keyword,value:k.opportunity})),{max:100}):emptyBox("No keywords yet","Check a keyword or import a list.","urlmap","Add keywords"))}
   </div>
   ${intents.length?card("Your pages by what searchers want","Search intent of the pages read from your site",donut(intents,{sub:"pages",label:"pages by search intent"})):""}
   ${otherSites.length?`<div class="panel"><h2>All your websites</h2><div class="tw" style="margin-top:10px"><table><tr><th>Website</th><th>Pages read</th><th>Last read</th><th></th></tr>${(allSites||[]).map(x=>`<tr><td><b>${esc(x.name||x.url)}</b><br><span class="url">${esc(x.url)}</span></td><td>${x.page_count}</td><td>${esc(x.crawled_at||x.status)}</td><td>${x.id===SITE_ID?'<span class="pill pass">Showing</span>':`<button class="btn ghost small" data-site-switch="${x.id}">Open</button>`}</td></tr>`).join("")}</table></div></div>`:""}`;
  bindGo(out);
  out.querySelectorAll("[data-hdoit]").forEach(b=>b.onclick=()=>goAction(acts.find(a=>a.id===+b.dataset.hdoit)));
  out.querySelectorAll("[data-site-switch]").forEach(b=>b.onclick=()=>{ $("#site-select").value=b.dataset.siteSwitch; $("#site-select").onchange({target:$("#site-select")}); });
}
function updateBadge(n){const b=$("#nav-badge");if(!b)return;b.textContent=n;b.classList.toggle("hidden",!n);}

// nav
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>show(b.dataset.v));
function show(v){document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",String(b.dataset.v===v)));
  document.querySelectorAll("[data-view]").forEach(s=>s.classList.toggle("hidden",s.dataset.view!==v));
  window.scrollTo(0,0); CURRENT=v;
  if(v==="home")loadHome().catch(()=>{});
  if(v==="settings")renderSettings();
  if(SITE_ID&&v==="keyword")loadRecent().catch(()=>{});
  if(SITE_ID&&v==="strategy")loadStrategy().catch(()=>{});
  if(SITE_ID&&v==="audit"){loadReviews().catch(()=>{});loadAuthors().catch(()=>{});}
  if(SITE_ID&&v==="generate"){loadStyle().catch(()=>{});loadAuthors().catch(()=>{});kwInfo().catch(()=>{});}
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
  const s=await api("/api/sites",{method:"POST",body:JSON.stringify({url,name:$("#s-name").value,product:$("#s-product").value,audience:$("#s-aud").value,max_pages:+$("#s-max").value||200})});
  SITE_ID=s.id; await loadSites(s.id);
});
async function loadSite(){
  if(!SITE_ID){$("#site-overview").classList.add("hidden");return}
  const s=await api(`/api/sites/${SITE_ID}`);window._siteUrl=s.url;
  $("#site-state").textContent=s.status==="ready"?`Read ${s.crawled_at||""}`:s.status==="error"?`Error: ${s.error}`:s.status;
  clearTimeout(pollTimer);
  if(String(s.status).startsWith("crawling")||s.status==="new"){pollTimer=setTimeout(loadSite,3000)}
  else if(s.status==="ready"){ $("#site-select").querySelector(`option[value="${SITE_ID}"]`).textContent=`${s.name||s.url} (${s.page_count} pages)`; }
  const sm=s.summary||{}; const ov=$("#site-overview"); ov.classList.remove("hidden");
  const st=(v,l)=>`<div class="stat"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`;
  ov.innerHTML=`<h2>${esc(s.name||s.url)}</h2><p class="status ${String(s.status).startsWith("crawling")||s.status==="new"?"spin":""}">${esc(s.url)} · ${s.status==="ready"?"pages read":esc(s.status)}</p>
   <div class="stats">${st(sm.urls_discovered??"–","URLs on the site")}${st(s.page_count,"pages read")}${st(sm.median_word_count??"–","median words")}
   ${st((sm.languages||[]).length||"–","languages")}${st((sm.thin_pages_under_300_words||[]).length,"thin pages")}${st(sm.pages_with_author_signal!=null?sm.pages_with_author_signal+"/"+s.page_count:"–","show an author")}</div>
   <div class="grid2"><div class="block"><h3>Pages by what searchers want</h3>${donut(Object.entries(s.intent_counts||{}).sort((a,b)=>b[1]-a[1]).map(([k,v],i)=>({label:INTENT_LABEL[k]||k,value:v,color:PAL[i%PAL.length]})),{sub:"pages"})||"<p class='status'>Not read yet.</p>"}</div>
   <div class="block"><h3>Largest sections of the site</h3>${hbars((sm.sections||[]).slice(0,8).map(x=>({label:x[0],value:x[1]})))||"<p class='status'>Not read yet.</p>"}</div></div>
   ${(sm.repeated_title_patterns||[]).length?`<div class="block"><h3>Repeated title patterns</h3>${list(sm.repeated_title_patterns.map(x=>`"${x[0]}…" × ${x[1]}`))}</div>`:""}
   <div class="row"><button class="btn ghost" id="recrawl">Read again</button><button class="btn ghost" id="site-del">Remove this website</button></div>`;
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
   ${(d.pages_to_improve||[]).length?`<div class="panel"><h2>Existing pages to improve</h2><p class="lead">Often faster than writing new pages.</p><div class="tw"><table><tr><th>Page</th><th>Why</th><th>What to add</th><th></th></tr>${d.pages_to_improve.map(r=>`<tr><td class="url">${esc(r.url)}</td><td>${esc(r.why)}</td><td>${esc(r.what_to_add)}</td><td>${r.keyword?`<button class="btn ghost small" data-icheck="${esc(r.keyword)}">Get update plan</button>`:""}</td></tr>`).join("")}</table></div></div>`:""}`;
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
  return `<p class="status">From a web search by your AI provider: a close guide to what ranks, not an exact Google ranking.</p>
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
   ${opts.length?`<div class="tw"><table><tr><th>Search</th><th>Searcher wants</th><th>How it differs</th><th></th></tr>${opts.map(o=>`<tr><td><b>${esc(o.keyword)}</b><br><span class="status">${esc(o.title_idea||"")}</span></td><td>${esc(INTENT_LABEL[o.intent]||o.intent||"")}</td><td>${esc(o.angle||"")}</td><td><button class="btn ghost small" data-angle='${esc(JSON.stringify({k:o.keyword,i:o.intent,t:o.page_type}))}'>Write</button></td></tr>`).join("")}</table></div>`:emptyBox("No other angles suggested","")}
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
const STYLE_FIELDS=[["tone","st-tone"],["reading_level","st-level"],["person","st-person"],["spelling","st-spell"],["avoid","st-avoid"],["cta","st-cta"],["notes","st-notes"]];
async function loadStyle(){ if(!SITE_ID) return; const s=await api(`/api/sites/${SITE_ID}/style`).catch(()=>({}));
  STYLE_FIELDS.forEach(([k,id])=>$("#"+id).value=s[k]||""); const n=STYLE_FIELDS.filter(([k])=>s[k]).length;
  $("#g-style-sum").textContent=n?`· ${n} rule${n>1?"s":""} set${s.tone?`: ${s.tone}`:""}`:"· not set yet (optional)"; }
$("#st-save").onclick=()=>{ if(!needSite($("#st-status")))return; busy($("#st-save"),$("#st-status"),"Saving…",async()=>{
  const s={}; STYLE_FIELDS.forEach(([k,id])=>{const v=$("#"+id).value.trim(); if(v) s[k]=v;}); await api(`/api/sites/${SITE_ID}/style`,{method:"POST",body:JSON.stringify(s)}); await loadStyle(); $("#st-status").textContent="Saved for this website."; }); };
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
function setSteps(n){ document.querySelectorAll("#g-steps li").forEach(li=>{const k=+li.dataset.step;li.className=k<n?"done":k===n?"now":"";}); }
$("#g-run").onclick=()=>{if(!needSite($("#g-status"),true))return;busy($("#g-run"),$("#g-status"),"Starting… this takes 2–6 minutes. Keep this tab open.",async()=>{
  const body={keyword:$("#g-kw").value.trim(),intent:$("#g-intent").value,page_type:$("#g-type").value,audience:$("#g-aud").value,notes:$("#g-notes").value,author:$("#g-author").value.trim(),override_duplicate:$("#g-override").checked,verify_claims:$("#g-verify").checked};
  if(!body.keyword) throw new Error("Enter a keyword.");
  setSteps(0); $("#g-steps").classList.remove("hidden");
  try{
    const d=await api(`/api/sites/${SITE_ID}/generate`,{method:"POST",body:JSON.stringify(body),onProgress:m=>{$("#g-status").dataset.progress="1";$("#g-status").textContent=m+" Keep this tab open.";const n=(m.match(/\((\d)\/5\)/)||[])[1];if(n)setSteps(+n);}});
    setSteps(6);
    const item=await api(`/api/contents/${d.id}`); renderItem(item,$("#g-out")); loadAuthors();
  } finally { setTimeout(()=>$("#g-steps").classList.add("hidden"),1200); }
});};
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
   ${(r.rounds||[]).length?`<p class="status">Audit and repair rounds: ${r.rounds.map(x=>`round ${x.round}: ${esc(GATE[x.status]||x.status)} (satisfaction ${x.scores.search_satisfaction}, quality ${x.scores.content_quality})`).join(" → ")}</p>`:""}
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
   ${item?approvePanel(item):""}
  </div>`;
  el.querySelectorAll(".tabs2 button").forEach(b=>b.onclick=()=>{el.querySelectorAll(".tabs2 button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));el.querySelectorAll("[data-p]").forEach(p=>p.classList.toggle("hidden",p.dataset.p!==b.dataset.t));});
  const ex=el.querySelector("[data-export]"); if(ex) ex.onclick=()=>api(`/api/contents/${ex.dataset.export}/export.md`);
  const cs=el.querySelector("[data-copy-status]"), done=m=>{cs.textContent=m;setTimeout(()=>cs.textContent="",3000);};
  el.querySelector("[data-copy]").onclick=async()=>{try{await navigator.clipboard.writeText((c.html||"")+`\n<script type="application/ld+json">${JSON.stringify(c.schema_jsonld)}<\/script>`);done("Copied HTML with schema.");}catch{done("Your browser blocked copying.");}};
  el.querySelector("[data-copy-rich]").onclick=async()=>{try{const html=sanitize(c.html||"");
    await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([c.body_markdown||""],{type:"text/plain"})})]);done("Copied. Paste into Google Docs or Word: headings and links are kept.");}catch{done("Your browser blocked rich copying. Use the HTML file instead.");}};
  const exh=el.querySelector("[data-export-html]"); if(exh) exh.onclick=()=>api(`/api/contents/${exh.dataset.exportHtml}/export.html`);
  if(item){ bindEdit(item,el); bindApprove(item,el); }
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
   <details class="block"><summary><b>Version history (${vers.length})</b></summary><div class="tw" style="margin-top:8px"><table><tr><th>Version</th><th>When</th><th>What changed</th><th></th></tr>
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
  if(item.status==="approved") return `<div class="approve-box"><b class="pass">Approved by ${esc(item.approved.by)} on ${esc(fmtDate(item.approved.at))}.</b> <span class="status">Editing the page again sends it back to review.</span></div>`;
  const ph=(item.report.validation||{}).placeholders||0;
  return `<div class="approve-box"><h3 style="font-size:15px;margin-bottom:6px">Approve for publishing</h3>
   <p class="status" style="margin-top:0">${ph?`<span class="warn">${ph} placeholder${ph>1?"s":""} still to fill (Edit tab).</span> `:""}A person must check the page before it goes live.</p>
   <label class="check"><input type="checkbox" data-conf> Every placeholder is replaced with real proof (screenshots, data with sources, real quotes)</label>
   <label class="check" style="margin-top:6px"><input type="checkbox" data-conf> Facts, numbers and product details are correct</label>
   <label class="check" style="margin-top:6px"><input type="checkbox" data-conf> The named author has read and stands behind the page</label>
   <div class="row" style="margin-top:12px;flex-wrap:nowrap;max-width:560px"><input data-reviewer aria-label="Your name" placeholder="Your name" value="${esc((item.author||"").split(",")[0])}"><button class="btn" data-approve>Approve</button></div>
   <span class="status" data-astatus role="status"></span></div>`;
}
function bindApprove(item,el){ const b=el.querySelector("[data-approve]"); if(!b) return; const st=el.querySelector("[data-astatus]");
  b.onclick=()=>busy(b,st,"Checking…",async()=>{ if(DIRTY) throw new Error("Save your edits first.");
    const it=await api(`/api/sites/${SITE_ID}/contents/${item.id}/approve`,{method:"POST",body:JSON.stringify({reviewer:el.querySelector("[data-reviewer]").value,confirmations:[...el.querySelectorAll("[data-conf]:checked")].map(()=>1)})});
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
    if(L.url){ TA_TAB="pages"; renderAudit(); openPage(L.url); }
    else if(L.check){ TA_TAB="issues"; renderAudit(); const d=$(`#ta-out details[data-check="${L.check}"]`); if(d){ d.open=true; d.scrollIntoView({behavior:"smooth",block:"start"}); } } return; }
  if(L.view==="keyword") return openCheck(L.keyword);
  if(L.view==="generate") return prefillWrite(L.keyword,L.intent);
  if(L.view==="gsc"){ GSC_TAB=L.tab||"quick"; show("gsc"); const el=await waitFor(()=>$("#gsc-tabs")); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); return; }
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
     <div class="tabs2" role="group" id="ta-tabs"><button data-tt="issues">Issues (${d.issues.length})</button><button data-tt="pages">Pages (${d.page_rows.length})</button><button data-tt="ignored">Ignored (${(d.ignored||[]).length})</button></div>
     <div data-tp="issues">${d.issues.length?d.issues.map(issueBlock).join(""):emptyBox("No issues found","Every checked page passed. Read more pages to check the rest of the site.")}</div>
     <div data-tp="pages"><div class="row" style="margin-bottom:10px"><input id="ta-q" placeholder="Search pages" style="flex:1;min-width:180px"></div><div id="ta-pages"></div><div id="ta-page"></div></div>
     <div data-tp="ignored">${(d.ignored||[]).length?`<p class="status">Ignored issues don't count towards your score or to-do list.</p><div class="tw"><table><tr><th>Issue</th><th>Page</th><th>Reason</th><th></th></tr>${d.ignored.map(x=>`<tr><td>${esc((CHECK_LABELS[x.check]||x.check))}</td><td class="url">${esc(x.url)}</td><td>${esc(x.reason||"")}</td><td><button class="btn ghost small" data-unig='${esc(JSON.stringify({check:x.check,url:x.url}))}'>Restore</button></td></tr>`).join("")}</table></div>`:emptyBox("Nothing ignored","Use Ignore on an issue that's intentional, like a login page that's hidden from Google on purpose.")}</div>
   </div>`;
  const out=$("#ta-out");
  const tab=t=>{TA_TAB=t;out.querySelectorAll("[data-tt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.tt===t)));out.querySelectorAll("[data-tp]").forEach(p=>p.classList.toggle("hidden",p.dataset.tp!==t));};
  out.querySelectorAll("[data-tt]").forEach(b=>b.onclick=()=>tab(b.dataset.tt)); tab(TA_TAB);
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
   <div class="tw"><table><tr><th>Page</th><th>Detail</th>${TA.has_traffic?"<th>Google clicks</th>":""}<th></th></tr>${i.pages.slice(0,100).map(x=>`<tr><td><button class="linkbtn" data-open-page="${esc(x.url)}" title="${esc(x.url)}">${esc(shortUrl(x.url))}</button></td><td>${esc(x.detail)}</td>${TA.has_traffic?`<td>${x.clicks==null?"–":fmtN(x.clicks)}</td>`:""}<td style="white-space:nowrap"><input data-igr placeholder="Reason (optional)" class="inline-edit" style="width:150px"> <button class="btn ghost small" data-ig='${esc(JSON.stringify({check:i.check,url:x.url}))}'>Ignore</button></td></tr>`).join("")}</table></div>${i.count>100?`<p class="status">Showing 100 of ${i.count}. Export the CSV for the full list.</p>`:""}</details>`;
}
function renderPages(){
  const q=($("#ta-q")?.value||"").toLowerCase(), rows=TA.page_rows.filter(r=>!q||r.url.toLowerCase().includes(q));
  $("#ta-pages").innerHTML=rows.length?`<div class="tw"><table><tr><th>Page</th>${TA.has_traffic?"<th>Google clicks</th>":""}<th>Problems</th><th></th></tr>${rows.slice(0,200).map(r=>`<tr><td title="${esc(r.url)}">${esc(shortUrl(r.url))}</td>${TA.has_traffic?`<td>${r.clicks==null?"–":fmtN(r.clicks)}</td>`:""}
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
    ${p?`<div class="row" style="margin-top:12px"><button class="btn" data-fixes>Suggest fixes with AI</button><span class="status" data-fstatus></span></div><div data-fout></div>`:""}</div>`;
  const box=$("#ta-page"); box.querySelector("[data-close-page]").onclick=()=>{TA_PAGE=null;box.innerHTML="";};
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
function lineChart(points,{updates=[],label="clicks per day",color="var(--c1)"}={}){
  if(points.length<2) return "";
  const W=760,H=220,L=44,Rp=10,T=18,B=28, max=Math.max(...points.map(p=>p.value),1), n=points.length;
  const x=i=>L+(W-L-Rp)*i/(n-1), y=v=>T+(H-T-B)*(1-v/max), idx=d=>points.findIndex(p=>p.date>=d);
  const path=points.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const bands=updates.map(u=>{ let a=idx(u.start), b=idx(u.end); if(a<0) return ""; if(b<0) b=n-1; if(points[b].date>u.end&&b>a) b--;
    const col=u.type==="core"?"var(--c2)":"var(--c4)";
    return `<rect x="${x(a)}" y="${T}" width="${Math.max(3,x(b)-x(a))}" height="${H-T-B}" fill="${col}" opacity=".13"><title>${esc(u.name)} (${u.start} to ${u.end})</title></rect><line x1="${x(a)}" x2="${x(a)}" y1="${T-6}" y2="${H-B}" stroke="${col}" stroke-dasharray="3 3"/>`; }).join("");
  const ticks=[0,.25,.5,.75,1].map(f=>Math.round((n-1)*f)), yt=[0,.5,1].map(f=>Math.round(max*f));
  return `<div class="line-chart chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${yt.map(v=>`<line x1="${L}" x2="${W-Rp}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text class="ax" x="${L-6}" y="${y(v)+4}" text-anchor="end">${fmtN(v)}</text>`).join("")}
    ${bands}
    <path d="${path} L${x(n-1)},${H-B} L${x(0)},${H-B} Z" fill="${color}" opacity=".08"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
    ${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="6" fill="transparent"><title>${esc(p.date)}: ${fmtN(p.value)} ${esc(label.split(" ")[0])}</title></circle>`).join("")}
    ${ticks.map(i=>`<text class="ax" x="${x(i)}" y="${H-8}" text-anchor="middle">${esc(new Date(points[i].date+"T00:00:00Z").toLocaleDateString(undefined,{day:"numeric",month:"short",timeZone:"UTC"}))}</text>`).join("")}
  </svg></div>`;
}
const deltaHtml=(v,{suffix="%",invert=false,abs=false}={})=>{ if(v==null) return ""; const good=invert?v<0:v>0, flat=v===0;
  return `<span class="delta ${flat?"flat":good?"up":"down"}">${v>0?"▲":v<0?"▼":"■"} ${abs?Math.abs(v):Math.abs(v)}${suffix}</span>`; };
let GSC=null, GSC_TAB="quick";
async function loadGsc(){
  const d=await api(`/api/sites/${SITE_ID}/gsc`); GSC=d;
  $("#gsc-imports").innerHTML=d.imports.length?`<p class="status">Uploaded: ${d.imports.map(i=>`<span class="pill">${esc(i.label)}</span> <button class="btn ghost small" data-gdel="${i.id}" aria-label="Delete ${esc(i.label)}">Remove</button>`).join(" ")}</p>`:"";
  $("#gsc-imports").querySelectorAll("[data-gdel]").forEach(x=>x.onclick=async()=>{await api(`/api/sites/${SITE_ID}/gsc/${x.dataset.gdel}`,{method:"DELETE"});loadGsc();});
  if(!d.analysis){$("#gsc-out").innerHTML="";$("#gsc-how").open=true;return}
  $("#gsc-how").open=false;
  const a=d.analysis, t=a.totals||a.totals, c=a.change, imps=d.imports;
  const kpi=(n,l,dl)=>`<div class="panel kpi"><div><div class="num">${n}</div><div class="lbl">${l} ${dl||""}</div></div></div>`;
  const section=(title,sub,body)=>`<div class="panel"><h2>${esc(title)}</h2><p class="lead">${esc(sub)}</p>${body}</div>`;
  const impactRows=(a.impact||[]).map(u=>`<tr><td><span class="dot" style="background:${u.type==="core"?"var(--c2)":"var(--c4)"}"></span>${esc(u.name)}</td><td>${esc(u.start)} → ${esc(u.end)}</td><td>${u.before==null?"–":fmtN(u.before)} → ${u.after==null?"–":fmtN(u.after)}</td>
     <td>${u.change==null?`<span class="status">Not enough data ${u.days_after<7?"after":"before"} the update</span>`:u.change<=-20?`<span class="pill fail">${u.change}% · possibly affected</span>`:u.change>=20?`<span class="pill pass">+${u.change}%</span>`:`<span class="pill">${u.change>0?"+":""}${u.change}% · no clear effect</span>`}</td></tr>`).join("");
  const br=a.brand;
  $("#gsc-out").innerHTML=`
   <p class="status" style="margin:-6px 0 12px">${a.range?`Showing <b>${esc(imps[0].label)}</b>`:`Showing <b>${esc(imps[0].label)}</b>`}${imps[1]?` compared with <b>${esc(imps[1].label)}</b>${c&&c.basis!=="date"?" (compared using the searches list, because one period has no daily data)":""}`:". Upload an earlier period to compare."}</p>
   <div class="grid4">${kpi(fmtN(t.clicks),"Clicks",c?deltaHtml(c.clicks):"")}${kpi(fmtN(t.impressions),"Times shown in Google",c?deltaHtml(c.impressions):"")}${kpi(t.ctr+"%","Click rate",c?deltaHtml(c.ctr,{suffix:" pts"}):"")}${kpi(t.position??"–","Average position",c&&c.position!=null?deltaHtml(c.position,{suffix:"",invert:true})+'<span class="status"> (lower is better)</span>':"")}</div>
   ${(a.daily||[]).length>1?`<div class="panel"><h2>Clicks per day</h2><p class="lead">Shaded bands are confirmed Google updates. Hover over a band for its name and dates.</p>
     ${lineChart(a.daily.map(x=>({date:x.date,value:x.clicks})),{updates:a.impact||[]})}
     <div class="upd-legend"><span><i style="background:var(--c2);opacity:.5"></i>Core update</span><span><i style="background:var(--c4);opacity:.5"></i>Spam update</span></div>
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
       ${a.low_ctr.length?`<div class="tw"><table><tr><th>Search or page</th><th>Shown</th><th>Click rate</th><th>Your usual</th><th>Position</th><th>Clicks missed</th><th></th></tr>${a.low_ctr.slice(0,20).map((r,k)=>`<tr><td>${esc(r.query||shortUrl(r.page))}</td><td>${fmtN(r.impressions)}</td><td>${r.ctr}%</td><td>${r.benchmark_ctr}%</td><td>${r.position}</td><td>~${fmtN(r.missed_clicks)}</td><td>${r.query?`<button class="btn ghost small" data-snip="${k}">Suggest better titles</button>`:""}</td></tr><tr class="hidden" data-snip-row="${k}"><td colspan="7"></td></tr>`).join("")}</table></div>`:emptyBox("Nothing here","Your click rates look normal for your positions.")}</div>
     <div data-gp="near"><p class="status">These searches rank in positions 8–20. A stronger page could bring them onto page 1, where almost all clicks happen.</p>
       ${a.striking_distance.length?`<div class="tw"><table><tr><th>Search</th><th>Shown</th><th>Position</th><th>Clicks</th><th></th></tr>${a.striking_distance.slice(0,25).map(r=>`<tr><td>${esc(r.query)}</td><td>${fmtN(r.impressions)}</td><td>${r.position}</td><td>${fmtN(r.clicks)}</td><td><button class="btn ghost small" data-gcheck="${esc(r.query)}">Check keyword</button></td></tr>`).join("")}</table></div><div style="margin-top:10px"><button class="btn ghost small" id="gsc-tokw">Add all to my keywords</button></div>`:emptyBox("Nothing here","")}</div>
     <div data-gp="losing"><p class="status">Pages that lost 20% or more of their clicks, and searches that lost 10 or more, compared with the earlier period. Check whether the page still fully answers the search, and whether something technical changed.</p>
       ${a.compared||imps[1]?`${a.declining_pages.length?`<div class="tw"><table><tr><th>Page</th><th>Clicks before → now</th><th>Change</th><th>Position</th><th></th></tr>${a.declining_pages.map(r=>`<tr><td title="${esc(r.page)}">${esc(shortUrl(r.page))}</td><td>${fmtN(r.clicks_before)} → ${fmtN(r.clicks_now)}</td><td class="fail">${r.change_pct}%</td><td>${r.position_before} → ${r.position_now}</td><td><button class="btn ghost small" data-ghealth="${esc(r.page)}">Open in Site health</button></td></tr>`).join("")}</table></div>`:`<p class="status">No single page lost 20% or more of its clicks.${c&&c.clicks<=-10?` Your total clicks fell ${Math.abs(c.clicks)}%, so the drop is spread across many pages. Look at the daily chart and the Google update table above, and at searches losing clicks below.`:""}</p>`}
         ${(a.falling||[]).length?`<h3 style="font-size:15px;margin:14px 0 6px">Searches losing clicks</h3><div class="tw"><table><tr><th>Search</th><th>Clicks before → now</th><th></th></tr>${a.falling.map(x=>`<tr><td>${esc(x.query)}</td><td>${fmtN(x.before)} → ${fmtN(x.now)}</td><td><button class="btn ghost small" data-gcheck="${esc(x.query)}">Check keyword</button></td></tr>`).join("")}</table></div>`:""}`:emptyBox("Upload an earlier period","Then you'll see which pages and searches are losing clicks.")}</div>
     <div data-gp="compete"><p class="status">Several of your pages show up for the same search, so Google splits attention between them. Pick one main page.</p>
       ${a.has_query_page?(a.cannibalisation.length?gscTable(a.cannibalisation.slice(0,20),[["Search","query"],["Shown",r=>fmtN(r.impressions)],["Pages",r=>r.pages.map(p=>shortUrl(p.page)).join(" | ")]]):"<p class='status'>None found.</p>"):emptyBox("Needs a search + page export","The standard zip lists searches and pages separately. Export searches by page from the Search Console API, Looker Studio or BigQuery to see this.")}</div>
     <div data-gp="noclick"><p class="status">Pages that appear in Google but nobody clicks. Check the title and description, and whether the page matches the searches it shows for.</p>
       ${a.pages_with_impressions_no_clicks.length?`<div class="tw"><table><tr><th>Page</th><th>Shown</th><th>Position</th><th></th></tr>${a.pages_with_impressions_no_clicks.map(r=>`<tr><td title="${esc(r.page)}">${esc(shortUrl(r.page))}</td><td>${fmtN(r.impressions)}</td><td>${r.position}</td><td><button class="btn ghost small" data-ghealth="${esc(r.page)}">Open in Site health</button></td></tr>`).join("")}</table></div>`:emptyBox("Nothing here","")}</div>
   </div>
   ${(a.topics||[]).length?section("Topics","Your non-brand searches grouped into topics. Each topic should have one strong page.",`<div class="tw"><table><tr><th>Topic</th><th>Searches</th><th>Clicks</th><th>Shown</th><th>Click rate</th><th>Position</th><th>Your page</th><th></th></tr>${a.topics.map(tp=>`<tr><td><b>${esc(tp.topic)}</b><br><span class="status">${esc(tp.searches.slice(1,4).join(", "))}${tp.searches.length>4?"…":""}</span></td><td>${tp.searches.length}</td><td>${fmtN(tp.clicks)}</td><td>${fmtN(tp.impressions)}</td><td>${tp.ctr}%</td><td>${tp.position}</td><td>${tp.coverage?covPill(tp.coverage):"–"}</td><td><button class="btn ghost small" data-gcheck="${esc(tp.topic)}">Check</button></td></tr>`).join("")}</table></div>`):""}`;
  const out=$("#gsc-out");
  const tab=t=>{GSC_TAB=t;out.querySelectorAll("[data-gt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.gt===t)));out.querySelectorAll("[data-gp]").forEach(p=>p.classList.toggle("hidden",p.dataset.gp!==t));};
  out.querySelectorAll("[data-gt]").forEach(b=>b.onclick=()=>tab(b.dataset.gt)); tab(GSC_TAB);
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
  $("#gsc-file").value=""; $("#gsc-label").value=""; await loadGsc(); $("#gsc-status").textContent=`Uploaded ${r.rows} rows.`; window.scrollTo(0,0);
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
     <div class="tw"><table><tr><th>Question</th>${engs.map(e=>`<th>${esc(ENGINE_LABEL[e]||e)}</th>`).join("")}<th>History</th><th></th></tr>
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
  $("#av-ideas").innerHTML=ideas.length?`<div class="block"><h3>Suggested questions</h3><div class="tw"><table><tr><th></th><th>Question</th><th>Type</th><th>Why</th></tr>${ideas.map((x,k)=>`<tr><td><input type="checkbox" data-idea="${k}" ${x.tracked?"disabled":"checked"} aria-label="Select question"></td><td>${esc(x.question)}${x.tracked?' <span class="status">(already tracked)</span>':""}</td><td>${esc(x.type||"")}</td><td class="status">${esc(x.why||"")}</td></tr>`).join("")}</table></div>
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
function renderKw(){
  const q=$("#kw-q").value.trim().toLowerCase(), fc=$("#kw-f-cov").value, fi=$("#kw-f-intent").value, fa=$("#kw-f-action").value, so=$("#kw-sort").value;
  let rows=KW.filter(k=>(!q||k.keyword.includes(q))&&(!fc||(k.coverage||{}).status===fc)&&(!fi||k.intent===fi)&&(!fa||k.action===fa));
  rows.sort(so==="volume"?(a,b)=>((b.volume||b.gsc_impressions||0)-(a.volume||a.gsc_impressions||0)):so==="keyword"?(a,b)=>a.keyword.localeCompare(b.keyword):so==="recent"?(a,b)=>(b.updated_at||0)-(a.updated_at||0):(a,b)=>b.opportunity-a.opportunity);
  const acts=["review",...Object.keys((RULES||{}).url_actions||{})];
  if(!KW.length){$("#kw-out").innerHTML=emptyBox("No keywords yet","Add keywords above, import a file, or use Find ideas.");$("#kw-bulk").classList.add("hidden");return;}
  const shown=rows.slice(0,300);
  $("#kw-out").innerHTML=`<p class="status">${rows.length} of ${KW.length} keywords${rows.length>300?" (showing the first 300)":""}. Coverage is checked against the pages read from your site, instantly and without AI.</p>
   <div class="tw"><table><thead><tr><th><input type="checkbox" id="kw-all" aria-label="Select all shown"></th><th>Keyword</th><th>Your page</th><th title="0–100: search demand, business value and ease">Score</th><th>Volume</th><th>Difficulty</th><th title="How valuable this keyword is to your business, 1–5">Value</th><th>Intent</th><th>Action</th></tr></thead><tbody>
   ${shown.map(k=>`<tr data-kw="${esc(k.keyword)}"><td><input type="checkbox" data-sel ${KW_SEL.has(k.keyword)?"checked":""} aria-label="Select ${esc(k.keyword)}"></td>
     <td class="kw-cell"><b>${esc(k.keyword)}</b><div class="row-links"><button class="linkbtn" data-kcheck>Check</button>${(k.coverage||{}).status!=="covered"?`<button class="linkbtn" data-kwrite>Write a page</button>`:""}</div>${(k.source&&!["added","manual"].includes(k.source))||k.gsc_impressions!=null?`<br><span class="status">${esc(["added","manual"].includes(k.source)?"":k.source||"")}${k.gsc_impressions!=null?`${k.source&&!["added","manual"].includes(k.source)?" · ":""}${fmtN(k.gsc_impressions)} impressions, pos ${k.gsc_position}`:""}</span>`:""}</td>
     <td class="cov-cell">${covPill(k.coverage)}${k.coverage&&k.coverage.url?`<a class="url trunc" href="${esc(k.coverage.url)}" target="_blank" rel="noopener" title="${esc(k.coverage.url)}">${esc(k.coverage.url.replace(/^https?:\/\/(www\.)?[^/]+/,"")||"/")}</a>`:""}</td>
     <td><b>${k.opportunity}</b></td>
     <td><input class="inline-edit num-in" type="number" data-f="volume" value="${k.volume??""}" placeholder="–" aria-label="Volume"></td>
     <td><input class="inline-edit num-in" type="number" data-f="difficulty" value="${k.difficulty??""}" min="0" max="100" placeholder="–" aria-label="Difficulty"></td>
     <td><input class="inline-edit num-in sm" type="number" data-f="business_value" value="${k.business_value??3}" min="1" max="5" aria-label="Business value"></td>
     <td class="nowrap">${esc(INTENT_LABEL[k.intent]||k.intent||"")}${k.intent_guessed?'<br><span class="status">guessed</span>':""}</td>
     <td><select class="inline-edit" data-f="action" aria-label="Action">${acts.map(a=>`<option ${a===k.action?"selected":""}>${a}</option>`).join("")}</select></td>
</tr>`).join("")}</tbody></table></div>`;
  $("#kw-out").querySelectorAll("tr[data-kw]").forEach(tr=>{
    const kw=tr.dataset.kw, k=KW.find(x=>x.keyword===kw);
    tr.querySelector("[data-sel]").onchange=e=>{e.target.checked?KW_SEL.add(kw):KW_SEL.delete(kw);updBulk();};
    tr.querySelectorAll("[data-f]").forEach(inp=>inp.onchange=async()=>{const f=inp.dataset.f;let v=inp.value;if(["volume","business_value"].includes(f))v=v===""?null:parseInt(v);if(f==="difficulty")v=v===""?null:parseFloat(v);
      try{await api(`/api/sites/${SITE_ID}/keywords`,{method:"PATCH",body:JSON.stringify({keyword:kw,[f]:v})});await loadKw();}catch(e){$("#kw-status").textContent=e.message;}});
    tr.querySelector("[data-kcheck]").onclick=()=>{openCheck(kw);};
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
   <div class="tw"><table><thead><tr><th></th><th>Keyword idea</th><th>Type</th><th>Intent</th><th>Your page</th><th>Why it fits</th></tr></thead><tbody>
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
  const rows=await api(`/api/sites/${SITE_ID}/contents`);
  $("#lib-out").innerHTML=rows.length?`<div class="tw"><table><tr><th>Page</th><th>Keyword</th><th>Searcher wants</th><th>Status</th><th></th></tr>${rows.map(r=>`<tr><td><b>${esc(r.title||r.keyword)}</b><br><span class="status">${esc(fmtDate(r.updated_at||r.created_at))}${r.author?` · ${esc(r.author)}`:""}</span></td><td>${esc(r.keyword)}</td><td>${esc(INTENT_LABEL[r.intent]||r.intent)}</td><td>${statusPill(r)}</td><td><button class="btn ghost" data-open="${r.id}">Open</button></td></tr>`).join("")}</table></div><div id="lib-view"></div>`:"<p>Nothing generated yet.</p>";
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


// ---------- AI & data settings ----------
const PROV=[["claude","Claude","Anthropic"],["openai","ChatGPT","OpenAI"],["gemini","Gemini","Google"],["mock","Demo mode","No key needed: sample answers"]];
let SET_PROV=LLM.getSettings().provider;
function updatePill(){
  const st=LLM.getSettings(), b=$("#ai-pill"); if(!b) return;
  if(!LLM.isConfigured(st)){ b.textContent="Connect AI"; b.classList.remove("ghost"); return; }
  b.classList.add("ghost");
  b.textContent= st.provider==="mock" ? "AI: Demo mode" : `AI: ${PROV.find(p=>p[0]===st.provider)[1]} · ${LLM.activeModel(st)}`;
}
function renderSettings(){
  const st=LLM.getSettings();
  $("#prov-cards").innerHTML=PROV.map(([k,l,sub])=>`<button class="panel prov" type="button" data-prov="${k}" aria-pressed="${k===SET_PROV}"><b>${l}</b><span class="status">${sub}</span>${k!=="mock"&&(st.keys[k]||"")?'<span class="pill pass">key saved</span>':""}</button>`).join("");
  $("#prov-cards").querySelectorAll("[data-prov]").forEach(b=>b.onclick=()=>{SET_PROV=b.dataset.prov;renderSettings();});
  const isMock=SET_PROV==="mock", info=LLM.PROVIDERS[SET_PROV];
  $("#set-key").disabled=isMock; $("#set-load").disabled=isMock; $("#set-model").disabled=isMock;
  $("#set-key").value=isMock?"":(st.keys[SET_PROV]||"");
  $("#set-keyhelp").textContent=isMock?"(not needed in demo mode)":`(get one at ${info.keyHelp})`;
  const list=(st.modelLists||{})[SET_PROV]||[], cur=st.models[SET_PROV]||(info?info.defaultModel:"");
  const opts=[...new Set([cur,...list].filter(Boolean))];
  $("#set-model").innerHTML=isMock?'<option>demo</option>':opts.map(m=>`<option ${m===cur?"selected":""}>${esc(m)}</option>`).join("");
  $("#set-web").checked=st.webSearch!==false; $("#set-remember").checked=st.remember!==false; $("#set-token").value=st.crawlToken||"";
  $("#set-status").textContent=""; $("#set-status").classList.remove("err");
}
function collectSettings(){
  const st=LLM.getSettings(); st.provider=SET_PROV;
  if(SET_PROV!=="mock"){ st.keys[SET_PROV]=$("#set-key").value.trim(); if($("#set-model").value) st.models[SET_PROV]=$("#set-model").value; }
  st.webSearch=$("#set-web").checked; st.remember=$("#set-remember").checked; return st;
}
$("#set-show").onclick=()=>{const k=$("#set-key");k.type=k.type==="password"?"text":"password";$("#set-show").textContent=k.type==="password"?"Show":"Hide";};
$("#set-save").onclick=()=>{ LLM.saveSettings(collectSettings()); updatePill(); renderSettings(); $("#set-status").textContent="Saved."; };
$("#set-load").onclick=()=>busy($("#set-load"),$("#set-status"),"Loading models…",async()=>{
  const key=$("#set-key").value.trim(); if(!key) throw new Error("Paste your API key first.");
  const models=await LLM.listModels(SET_PROV,key); if(!models.length) throw new Error("No usable models found for this key.");
  const st=collectSettings(); st.modelLists=st.modelLists||{}; st.modelLists[SET_PROV]=models;
  if(!models.includes(st.models[SET_PROV])) st.models[SET_PROV]=models.find(m=>m===LLM.PROVIDERS[SET_PROV].defaultModel)||models[0];
  LLM.saveSettings(st); renderSettings(); updatePill(); $("#set-status").textContent=`Found ${models.length} models. Choose one, then Save.`;
});
$("#set-test").onclick=()=>busy($("#set-test"),$("#set-status"),"Testing…",async()=>{
  const st=collectSettings(); LLM.saveSettings(st); updatePill();
  if(st.provider==="mock"){ $("#set-status").textContent="Demo mode is ready. Answers are samples, not real AI output."; return; }
  if(!st.keys[st.provider]) throw new Error("Paste your API key first.");
  const r=await LLM.ask("test",'Reply with JSON only: {"ok":true}',{maxTokens:50});
  $("#set-status").textContent= r&&r.ok ? `Connected to ${PROV.find(p=>p[0]===st.provider)[1]} (${LLM.activeModel(st)}).` : "Connected, but the reply was unexpected.";
});
$("#set-token-save").onclick=()=>{const st=LLM.getSettings();st.crawlToken=$("#set-token").value.trim();LLM.saveSettings(st);$("#set-token-save").textContent="Saved";setTimeout(()=>$("#set-token-save").textContent="Save",1500);};
$("#data-export").onclick=async()=>{ download(`content-engine-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(await store.exportAll()), "application/json"); $("#data-status").textContent="Backup downloaded. It doesn't include your API key."; };
$("#data-import").onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
  try{ await store.importAll(JSON.parse(await f.text())); $("#data-status").textContent="Restored. Reloading…"; setTimeout(()=>location.reload(),600);}catch(err){ $("#data-status").textContent=err.message; $("#data-status").classList.add("err"); } };
let clearArm=false;
$("#data-clear").onclick=async()=>{ if(!clearArm){ clearArm=true; $("#data-clear").textContent="Click again to delete everything"; setTimeout(()=>{clearArm=false;$("#data-clear").textContent="Delete all data";},4000); return; }
  await store.clearAll(); location.reload(); };
document.querySelectorAll("[data-go-settings]").forEach(b=>b.onclick=()=>show("settings"));

(async()=>{
  RULES=await api("/api/rules").catch(()=>null);
  updatePill();
  if(RULES){
    $("#g-intent").innerHTML=Object.entries(RULES.intents).map(([k,v])=>`<option value="${k}">${esc(v)} (${k})</option>`).join("");
    $("#g-type").innerHTML=RULES.page_types.map(t=>`<option>${t}</option>`).join("");
  }
  await loadSites();
  show("home");
})();
