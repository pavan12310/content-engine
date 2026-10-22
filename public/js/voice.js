// voice.js - voiceover preview with the browser's built-in voices (Web Speech API: free, no service), and a spoken-length estimate.
const WPM = { en: 150, es: 160, pt: 155, fr: 155, de: 140, it: 155, nl: 150, hi: 140, ko: 140, ar: 130, ru: 140 };   // words a minute at normal speed
const CPS = { ja: 6.5, zh: 4.5 };   // characters a second for languages written without spaces
// how long a text takes to say, in seconds, at a speed (1 = normal)
export function estimateSeconds(text, lang = "en", rate = 1) {
  const t = String(text || "").trim(); if (!t) return 0;
  const l = String(lang || "en").slice(0, 2).toLowerCase();
  const base = CPS[l] ? (t.replace(/\s/g, "").length / CPS[l]) : (t.split(/\s+/).length / (WPM[l] || 150) * 60);
  const pauses = (t.match(/[.!?。！？]/g) || []).length * 0.25;   // a short pause after each sentence
  return Math.round(((base + pauses) / Math.max(rate, 0.5)) * 10) / 10;
}
// planned vs spoken time per scene; flags scenes that run more than 20% (and 2 s) over
export function timing(scenes, lang, rate = 1) {
  const rows = scenes.map((s, i) => { const est = estimateSeconds(s.voiceover, lang, rate), plan = Number(s.seconds) || 0;
    return { i, plan, est, over: plan > 0 && est > plan * 1.2 && est - plan >= 2 }; });
  const total = rows.reduce((t, r) => t + r.est, 0), planned = rows.reduce((t, r) => t + r.plan, 0);
  return { rows, total: Math.round(total), planned, long: total > 95, short: total < 25 };
}
export const supported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
// voices for a language first, then the rest (they load asynchronously in some browsers)
export function voices(lang = "en") {
  return new Promise(res => {
    if (!supported()) return res([]);
    const pick = () => { const all = speechSynthesis.getVoices() || [], l = String(lang).slice(0, 2).toLowerCase();
      return [...all.filter(v => v.lang && v.lang.toLowerCase().startsWith(l)), ...all.filter(v => !(v.lang || "").toLowerCase().startsWith(l))]; };
    const now = pick(); if (now.length) return res(now);
    let done = false; const finish = () => { if (done) return; done = true; res(pick()); };
    speechSynthesis.addEventListener?.("voiceschanged", finish, { once: true }); setTimeout(finish, 1500);
  });
}
// speak scenes one after another; onScene(i) when a scene starts, onSceneEnd(i, seconds) with the measured time, onDone() at the end
export function play(scenes, { voice = null, rate = 1, lang = "en", from = 0, only = false, onScene = () => {}, onSceneEnd = () => {}, onDone = () => {}, onWord = () => {} } = {}) {
  if (!supported()) { onDone(); return { stop() {} }; }
  speechSynthesis.cancel(); let stopped = false, i = from;
  const next = () => {
    if (stopped || i >= scenes.length || (only && i > from)) { onDone(); return; }
    const idx = i, u = new SpeechSynthesisUtterance(String(scenes[idx].voiceover || "")); let t0 = 0;
    if (voice) u.voice = voice; u.lang = voice?.lang || lang; u.rate = rate;
    let gotBoundary = false, est = null;
    const words = String(scenes[idx].voiceover || "").split(/\s+/).filter(Boolean), starts = []; { let p = 0; const t = String(scenes[idx].voiceover || ""); for (const w of words) { p = t.indexOf(w, p); starts.push(p); p += w.length; } }
    u.onboundary = e => { if (e.name && e.name !== "word") return; gotBoundary = true; if (est) { clearInterval(est); est = null; } let k = 0; while (k + 1 < starts.length && starts[k + 1] <= e.charIndex) k++; onWord(idx, k); };
    u.onstart = () => { t0 = performance.now(); onScene(idx); onWord(idx, 0);
      // some voices never report word positions: estimate them from the speaking speed instead
      const perWord = estimateSeconds(scenes[idx].voiceover, lang, rate) * 1000 / Math.max(words.length, 1);
      setTimeout(() => { if (!gotBoundary && !stopped) est = setInterval(() => { const k = Math.min(words.length - 1, Math.floor((performance.now() - t0) / perWord)); onWord(idx, k); }, 120); }, 700); };
    u.onend = () => { if (est) clearInterval(est); onSceneEnd(idx, t0 ? Math.round((performance.now() - t0) / 100) / 10 : null); i++; next(); };
    u.onerror = () => { i++; next(); };
    speechSynthesis.speak(u);
  };
  next();
  return { stop() { stopped = true; speechSynthesis.cancel(); onDone(); } };
}

// ---- subtitles (SRT) ----
const ts = sec => { const ms = Math.max(0, Math.round(sec * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`; };
// captions of at most two lines of 42 characters, split at sentence ends, then commas, then spaces
export function captions(text, max = 84) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" "), out = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); if (/[.!?]$/.test(w) && cur.length > max * 0.5) { out.push(cur); cur = ""; } }
  if (cur) out.push(cur);
  const wrap = c => { if (c.length <= 42) return c; const mid = c.lastIndexOf(" ", 42); return mid > 0 ? c.slice(0, mid) + "\n" + c.slice(mid + 1) : c; };
  return out.map(wrap);
}
// durations: seconds per scene (measured or estimated); each caption gets time in proportion to its length
export function srt(scenes, durations) {
  let t = 0, n = 0; const blocks = [];
  scenes.forEach((s, i) => { const d = Math.max(0.5, durations[i] || 0), caps = captions(s.voiceover), total = caps.reduce((a, c) => a + c.length, 0) || 1; let start = t;
    for (const c of caps) { const len = d * c.length / total; blocks.push(`${++n}\n${ts(start)} --> ${ts(start + len)}\n${c}`); start += len; }
    t += d; });
  return blocks.join("\n\n") + "\n";
}
// ---- remembered choices (per language) ----
export const remember = (lang, v) => { try { localStorage.setItem(`ce-voice:${String(lang).slice(0, 2)}`, JSON.stringify(v)); } catch { } };
export const recall = lang => { try { return JSON.parse(localStorage.getItem(`ce-voice:${String(lang).slice(0, 2)}`) || "null"); } catch { return null; } };
