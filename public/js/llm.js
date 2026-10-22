// llm.js - one interface for Claude, ChatGPT (OpenAI) and Gemini, called straight from the browser with the user's own key.
// Keys never touch our server. Each provider's web search tool is used for fact-checking and AI-answer checks.
import { rulesText } from "./rules.js";
import { mockResponse } from "./mock.js";

export const PROVIDERS = {
  claude: { label: "Claude (Anthropic)", keyHelp: "console.anthropic.com → API Keys", defaultModel: "claude-sonnet-5-5", keyPrefix: "sk-ant-" },
  openai: { label: "ChatGPT (OpenAI)", keyHelp: "platform.openai.com → API keys", defaultModel: "gpt-5.5", keyPrefix: "sk-" },
  gemini: { label: "Gemini (Google)", keyHelp: "aistudio.google.com → Get API key", defaultModel: "gemini-2.5-pro", keyPrefix: "" },
  local: { label: "Built-in AI (free, in your browser)", keyless: true, defaultModel: "Qwen3-4B-q4f16_1-MLC" },
  ollama: { label: "Ollama (free, on your computer)", keyless: true, defaultModel: "qwen3:8b", defaultUrl: "http://localhost:11434" },
};
const SYSTEM = "You are a senior SEO content strategist and editor. You follow Google's official Search guidance exactly. " +
  "You never fabricate facts, statistics, quotes, customers or credentials; you insert clearly marked placeholders instead. " +
  "Your final answer is valid JSON only, no prose before or after, no code fences.\n\n" + rulesText();
// for plain-text writing (section-by-section): same rules, but the answer is Markdown, not JSON
const SYSTEM_TEXT = "You are a senior content writer and editor. You follow Google's official Search guidance exactly. " +
  "You never fabricate facts, statistics, quotes, customers or credentials; you insert clearly marked placeholders instead. " +
  "Write clear, specific, practical prose in Markdown exactly as instructed. Output only the requested text: no preamble, no notes, no code fences.\n\n" + rulesText();

// ---------- settings (keys stay in this browser) ----------
const SKEY = "ce-settings";
export function getSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SKEY) || sessionStorage.getItem(SKEY) || "{}"); } catch { s = {}; }
  return { provider: "claude", keys: {}, models: {}, webSearch: true, remember: true, crawlToken: "", ...s };
}
export function saveSettings(s) {
  try {
    localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY);
    (s.remember ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(s));
  } catch { /* storage blocked */ }
}
export function activeModel(s = getSettings()) { return s.models[s.provider] || PROVIDERS[s.provider]?.defaultModel; }
export function isConfigured(s = getSettings()) { return s.provider === "mock" || !!PROVIDERS[s.provider]?.keyless || !!(s.keys[s.provider] || "").trim(); }
export const canSearch = (s = getSettings()) => ["claude", "openai", "gemini"].includes(s.provider);

class LLMError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
// remember Content-Security-Policy blocks so we can explain them
let lastCspBlock = null;
if (typeof document !== "undefined") document.addEventListener("securitypolicyviolation", e => { lastCspBlock = { uri: e.blockedURI, at: Date.now() }; });

// ---------- cancel, activity and usage ----------
let CANCEL = new AbortController(), INFLIGHT = 0;
export function cancelAll() { CANCEL.abort(); CANCEL = new AbortController(); }
const activity = d => { INFLIGHT = Math.max(0, INFLIGHT + d); if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai-activity", { detail: { active: INFLIGHT } })); };
const UKEY = "ce-usage";
// per-job meter: generation turns it on to measure how much work each model did (hybrid mode reports this)
let METER = null;
export function startMeter() { METER = {}; return METER; }
export function meterPeek() { return METER ? JSON.parse(JSON.stringify(METER)) : {}; }
export function stopMeter() { const m = METER; METER = null; return m || {}; }
function meter(provider, u) { if (!METER || !u) return; const m = METER[provider] || (METER[provider] = { calls: 0, input: 0, output: 0 }); m.calls++; m.input += u.input || 0; m.output += u.output || 0; }
export function recordUsage(provider, u) {
  try {
    const all = JSON.parse(localStorage.getItem(UKEY) || "{}"), m = new Date().toISOString().slice(0, 7);
    const e = ((all[m] = all[m] || {})[provider] = all[m][provider] || { requests: 0, input: 0, output: 0, searches: 0, errors: 0 });
    e.requests++; e.input += u.input || 0; e.output += u.output || 0; e.searches += u.searches || 0; if (u.error) e.errors++;
    localStorage.setItem(UKEY, JSON.stringify(all));
  } catch { /* storage blocked */ }
}
export function getUsage() { try { return JSON.parse(localStorage.getItem(UKEY) || "{}"); } catch { return {}; } }

const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal && signal.addEventListener("abort", () => { clearTimeout(t); rej(new LLMError("Stopped.", "cancelled")); }, { once: true }); });
const RETRY = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
// one HTTP call with timeout, cancel, and retries with backoff for busy / overloaded providers
async function call(url, opts, { timeoutMs = 240000, retries = 3 } = {}) {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController(), cancel = CANCEL.signal; let timedOut = false;
    const onCancel = () => ctrl.abort(); cancel.addEventListener("abort", onCancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    let r;
    try { r = await fetch(url, { ...opts, signal: ctrl.signal }); }
    catch {
      clearTimeout(timer); cancel.removeEventListener("abort", onCancel);
      if (cancel.aborted) throw new LLMError("Stopped.", "cancelled");
      if (timedOut) throw new LLMError(`The AI didn't reply within ${timeoutMs >= 60000 ? Math.round(timeoutMs / 60000) + " minutes" : Math.round(timeoutMs / 1000) + " seconds"}. Try again, or choose a faster model in Settings.`, "timeout");
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new LLMError("You appear to be offline. Check your internet connection and try again.", 0);
      if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) throw new LLMError(`Couldn't reach Ollama at ${host}. Make sure the Ollama app is running, and that it allows this website (see the Ollama setup steps in Settings).`, 0);
      if (lastCspBlock && Date.now() - lastCspBlock.at < 3000 && String(lastCspBlock.uri).includes(host))
        throw new LLMError(`This site's security settings blocked ${host}. Check the Content-Security-Policy in netlify.toml includes https://${host}.`, 0);
      throw new LLMError(`Your browser blocked the request to ${host} before it was sent. This is usually an ad blocker or privacy extension (uBlock Origin, AdGuard, Ghostery, Brave Shields), or a company network/VPN. Try an incognito window, or allow ${host} in your blocker.`, 0);
    }
    let text;
    try { text = await r.text(); } catch { text = ""; }
    clearTimeout(timer); cancel.removeEventListener("abort", onCancel);
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (r.ok) return data;
    const m = data?.error?.message || data?.error?.status || data?.message || text.slice(0, 300);
    const quota = /insufficient_quota|exceeded your current quota|billing|credit balance/i.test(text);   // retrying won't help
    if (RETRY.has(r.status) && !quota && attempt < retries) {
      const ra = Number(r.headers.get("retry-after")), wait = ra > 0 ? Math.min(ra * 1000, 60000) : Math.min(2000 * 2 ** attempt, 20000) + Math.random() * 800;
      await sleep(wait, CANCEL.signal); continue;
    }
    const hint = r.status === 401 || r.status === 403 ? "The API key was rejected. Check it in Settings." :
      quota ? "Your provider account is out of credit or over its quota. Check billing with your AI provider." :
      r.status === 429 ? "The provider is rate-limiting your key. Wait a minute, or check your plan's limits." :
      r.status === 529 || r.status === 503 ? "The provider is overloaded right now. Try again in a few minutes." :
      r.status === 404 ? "Model not found. Click Load models in Settings and pick another." : "";
    throw new LLMError(`${hint ? hint + " " : ""}(${r.status}) ${m}`, r.status);
  }
}

// ---------- providers: each returns { text, truncated, usage } ----------
async function claude(s, prompt, { maxTokens, webSearch, maxSearches, timeoutMs }) {
  const headers = { "content-type": "application/json", "x-api-key": s.keys.claude, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  const body = { model: activeModel(s), max_tokens: maxTokens, system: arguments[2].system || SYSTEM, messages: [{ role: "user", content: prompt }] };
  if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
  const u = { input: 0, output: 0, searches: 0 }, add = d => { u.input += d.usage?.input_tokens || 0; u.output += d.usage?.output_tokens || 0; u.searches += d.usage?.server_tool_use?.web_search_requests || 0; };
  let d = await call("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs }); add(d);
  for (let i = 0; i < 4 && d.stop_reason === "pause_turn"; i++) {
    body.messages = [...body.messages, { role: "assistant", content: d.content }];
    d = await call("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs }); add(d);
  }
  return { text: (d.content || []).filter(b => b.type === "text").map(b => b.text).join(""), truncated: d.stop_reason === "max_tokens", usage: u };
}
async function openai(s, prompt, { maxTokens, webSearch, timeoutMs }) {
  const body = { model: activeModel(s), instructions: arguments[2].system || SYSTEM, input: prompt, max_output_tokens: maxTokens };
  if (webSearch) body.tools = [{ type: "web_search" }];
  const d = await call("https://api.openai.com/v1/responses", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.keys.openai}` }, body: JSON.stringify(body) }, { timeoutMs });
  const text = typeof d.output_text === "string" && d.output_text ? d.output_text
    : (d.output || []).filter(o => o.type === "message").flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
  return { text, truncated: d.status === "incomplete" && /max_output_tokens/.test(d.incomplete_details?.reason || ""),
    usage: { input: d.usage?.input_tokens || 0, output: d.usage?.output_tokens || 0, searches: (d.output || []).filter(o => o.type === "web_search_call").length } };
}
async function gemini(s, prompt, { maxTokens, webSearch, timeoutMs }) {
  const model = activeModel(s).replace(/^models\//, "");
  const body = { systemInstruction: { parts: [{ text: arguments[2].system || SYSTEM }] }, contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens } };
  if (webSearch) body.tools = [{ google_search: {} }];
  const d = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.keys.gemini)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { timeoutMs });
  const c = d.candidates?.[0], text = (c?.content?.parts || []).map(p => p.text || "").join("");
  if (!text && c?.finishReason && c.finishReason !== "MAX_TOKENS") throw new LLMError(c.finishReason === "SAFETY" ? "Gemini declined to answer (safety filter). Try rewording, or another provider." : `Gemini stopped: ${c.finishReason}`, 0);
  if (!c && d.promptFeedback?.blockReason) throw new LLMError(`Gemini blocked the request: ${d.promptFeedback.blockReason}`, 0);
  return { text, truncated: c?.finishReason === "MAX_TOKENS",
    usage: { input: d.usageMetadata?.promptTokenCount || 0, output: d.usageMetadata?.candidatesTokenCount || 0, searches: c?.groundingMetadata?.webSearchQueries?.length || 0 } };
}
const RUN = { claude, openai, gemini };

// Small models sometimes copy the template's option list ("informational|how_to|commercial") instead of choosing.
// Resolve any such value to its first option, everywhere in the reply.
export function cleanChoices(v) {
  if (typeof v === "string") return /^[a-z0-9_-]+(\s*\|\s*[a-z0-9_-]+)+$/i.test(v.trim()) ? v.split("|")[0].trim() : v;
  if (Array.isArray(v)) return v.map(cleanChoices);
  if (v && typeof v === "object") { for (const k of Object.keys(v)) v[k] = cleanChoices(v[k]); return v; }
  return v;
}
export function parseJson(text) {
  let t = (text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const end = t.lastIndexOf("}");
  for (let i = t.indexOf("{"); i !== -1 && i < end; i = t.indexOf("{", i + 1)) { try { return JSON.parse(t.slice(i, end + 1)); } catch { /* next */ } }
  throw new LLMError("The AI reply wasn't valid JSON.", 0);
}

// providers that can be used right now (have a key), plus demo mode when it's the active choice
export function availableProviders(s = getSettings()) {
  const out = Object.keys(PROVIDERS).filter(k => !PROVIDERS[k].keyless && (s.keys[k] || "").trim());   // AI-answer checks: real assistants only
  if (s.provider === "mock") out.unshift("mock");
  return out;
}
// ask(task, prompt) -> parsed JSON. Retries busy providers, recovers from cut-off replies, falls back to no web search
// if the model can't search, and records usage.
export async function ask(task, prompt, { maxTokens = 8000, webSearch = false, maxSearches = 8, provider = null, timeoutMs = null } = {}) {
  const base = getSettings(), s = provider ? { ...base, provider } : base;   // provider override: ask a specific AI
  if (s.provider === "mock") { activity(1); meter("mock", { input: Math.round(prompt.length / 4), output: 400 }); try { return await mockResponse(task, prompt); } finally { activity(-1); } }
  if (!isConfigured(s)) throw new LLMError(provider ? `No API key saved for ${PROVIDERS[provider]?.label || provider}.` : "Add your API key in Settings first.", 0);
  const free = !!PROVIDERS[s.provider]?.keyless, fn = RUN[s.provider], useSearch = webSearch && s.webSearch && !free;
  const tmo = timeoutMs || (free ? 1200000 : maxTokens >= 12000 ? 480000 : 240000);   // models on your own computer are slower
  const run = async (p, opt) => { try { const r = await fn(s, p, opt); recordUsage(s.provider, r.usage); meter(s.provider, r.usage); return r; } catch (e) { if (e.status !== "cancelled") recordUsage(s.provider, { error: true }); throw e; } };
  activity(1);
  try {
    let res, noSearch = webSearch && !useSearch;   // free options can't search the web: callers see _no_search
    try { res = await run(prompt, { maxTokens, webSearch: useSearch, maxSearches, timeoutMs: tmo }); }
    catch (e) {
      if (useSearch && e.status === 400 && /tool|search|grounding/i.test(e.message)) { res = await run(prompt, { maxTokens, webSearch: false, maxSearches, timeoutMs: tmo }); noSearch = true; }
      else throw e;
    }
    let out;
    try { out = parseJson(res.text); }
    catch {
      if (res.truncated) {   // reply was cut off by the length limit: try once more with room to finish
        const more = Math.min(Math.round(maxTokens * 2), 32000);
        res = await run(prompt + "\n\nKeep the answer compact so it fits: shorter text fields, same JSON structure.", { maxTokens: more, webSearch: useSearch && !noSearch, maxSearches, timeoutMs: tmo });
        try { out = parseJson(res.text); } catch { out = null; }
      }
      if (!out) {
        const fixed = await run("Convert this into the requested JSON only, nothing else:\n\n" + res.text.slice(-60000), { maxTokens, webSearch: false, maxSearches, timeoutMs: tmo });
        out = parseJson(fixed.text);
      }
    }
    out = cleanChoices(out);
    if (noSearch && out && typeof out === "object") out._no_search = true;   // callers can tell the answer didn't use live search
    return out;
  } finally { activity(-1); }
}

// list models available to this key (so the dropdown never goes stale)
export async function listModels(provider, key) {
  if (provider === "claude") {
    const d = await call("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
    return (d.data || []).map(m => m.id);
  }
  if (provider === "openai") {
    const d = await call("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
    return (d.data || []).map(m => m.id).filter(id => /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search-preview|instruct)/.test(id)).sort().reverse();
  }
  if (provider === "ollama") {
    const base = String(key || PROVIDERS.ollama.defaultUrl).replace(/\/+$/, "");
    const d = await call(`${base}/api/tags`, {}, { timeoutMs: 8000, retries: 0 }).catch(e => { throw new LLMError(`Couldn't reach Ollama at ${base}. Is the Ollama app running? See the setup steps below. (${e.message})`, 0); });
    return (d.models || []).map(m => m.name);
  }
  if (provider === "local") return LOCAL_MODELS.map(m => m.id);
  if (provider === "gemini") {
    const d = await call(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {});
    return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name) && !/(embedding|image|tts|audio|live)/.test(m.name))
      .map(m => m.name.replace(/^models\//, "")).sort().reverse();
  }
  return [];
}

// ---------- free options: built-in AI (WebLLM, runs in the browser) and Ollama (runs on your computer) ----------
export const LOCAL_MODELS = [
  { id: "Qwen3-4B-q4f16_1-MLC", name: "Qwen3 4B", gb: 3.4, note: "Recommended: good writing for its size" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 3B", gb: 2.2, note: "Faster and smaller, simpler writing" },
  { id: "Qwen3-8B-q4f16_1-MLC", name: "Qwen3 8B", gb: 5.6, note: "Best quality; needs 16 GB of memory" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", name: "Gemma 2 2B", gb: 1.9, note: "Smallest; for older computers" },
];
export const LOCAL_CONTEXT = 12288;   // tokens the built-in model can read + write at once (raised from the 4,096 default)
// WebGPU must actually give us a graphics adapter: some browsers expose the API but have no usable GPU
let GPU_CHECK = null;
export function webgpuSupported() {
  if (!GPU_CHECK) GPU_CHECK = (async () => {
    if (typeof navigator === "undefined" || !navigator.gpu) return { ok: false, why: "This browser doesn't support WebGPU." };
    try { const a = await navigator.gpu.requestAdapter(); if (!a) return { ok: false, why: "WebGPU is available but no usable graphics chip was found (it may be turned off or not supported)." };
      return { ok: true, fallback: !!a.isFallbackAdapter }; } catch (e) { return { ok: false, why: "WebGPU failed to start: " + e.message }; }
  })();
  return GPU_CHECK;
}
let LOCAL = { engine: null, model: null, loading: null };
export function localStatus() { return { loaded: LOCAL.model, loading: !!LOCAL.loading }; }
// download (first time) and start a built-in model; progress(text, fraction) is called while it loads
export async function loadLocalModel(model, progress = () => {}) {
  if (LOCAL.engine && LOCAL.model === model) return LOCAL.engine;
  const gpu = await webgpuSupported();
  if (!gpu.ok) throw new LLMError(`This browser can't run the built-in AI: ${gpu.why} Use a recent Chrome or Edge on a computer, or choose Ollama or an API provider.`, "no_webgpu");
  if (LOCAL.loading) return LOCAL.loading;
  LOCAL.loading = (async () => {
    const webllm = await import("../vendor/web-llm/index.js");
    if (LOCAL.engine) { try { await LOCAL.engine.unload(); } catch { } LOCAL.engine = null; }
    const engine = await webllm.CreateMLCEngine(model, { initProgressCallback: r => progress(r.text || "", r.progress ?? 0) },
      { context_window_size: LOCAL_CONTEXT });
    LOCAL.engine = engine; LOCAL.model = model; return engine;
  })();
  try { return await LOCAL.loading; } finally { LOCAL.loading = null; }
}
export async function localModelCached(model) {
  try { const webllm = await import("../vendor/web-llm/index.js"); return await webllm.hasModelInCache(model); } catch { return false; }
}
// small models can't read our full prompts: keep the most useful parts
const estTokens = t => Math.ceil(t.length / 3.6);
export function compactPrompt(prompt, maxChars) {
  if (prompt.length <= maxChars) return prompt;
  const lines = prompt.split("\n"); let pageLines = 0;
  let out = lines.filter(l => !/^- https?:\/\//.test(l) || ++pageLines <= 20);   // existing-page lists: keep the 20 most relevant
  let t = out.join("\n");
  if (t.length > maxChars) t = t.replace(/("""\n)([\s\S]*?)(\n""")/g, (m, a, body, c) => a + body.slice(0, Math.max(2000, maxChars - (t.length - body.length) - 200)) + c);
  if (t.length > maxChars) t = t.slice(0, Math.floor(maxChars * 0.6)) + "\n…\n" + t.slice(t.length - Math.floor(maxChars * 0.4));
  return t;
}
async function localRun(s, prompt, { maxTokens, timeoutMs, system = null, text: plain = false }) {
  const model = s.models.local || PROVIDERS.local.defaultModel;
  const engine = await loadLocalModel(model, (txt, f) => window.dispatchEvent(new CustomEvent("local-ai-progress", { detail: { text: txt, progress: f } })));
  const sys = system || SYSTEM, budget = LOCAL_CONTEXT - Math.min(maxTokens, 4500) - estTokens(sys) - 150;
  const p = compactPrompt(prompt, Math.max(4000, budget * 3.6)), max = Math.max(512, Math.min(maxTokens, LOCAL_CONTEXT - estTokens(sys + p) - 100));
  const qwen3 = /qwen3/i.test(model);
  let timer, onCancel;
  const stop = new Promise((_, rej) => {
    timer = setTimeout(() => { engine.interruptGenerate(); rej(new LLMError(`The built-in AI didn't finish within ${Math.round(timeoutMs / 60000)} minutes. Try a smaller model or a shorter task.`, "timeout")); }, timeoutMs);
    onCancel = () => { engine.interruptGenerate(); rej(new LLMError("Stopped.", "cancelled")); }; CANCEL.signal.addEventListener("abort", onCancel, { once: true });
  });
  try {
    const r = await Promise.race([stop, engine.chat.completions.create({ messages: [{ role: "system", content: sys }, { role: "user", content: p + (qwen3 ? "\n/no_think" : "") }],
      max_tokens: max, temperature: plain ? 0.7 : 0.6, ...(plain ? {} : { response_format: { type: "json_object" } }) })]);
    const text = String(r.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text, truncated: r.choices?.[0]?.finish_reason === "length", usage: { input: r.usage?.prompt_tokens || 0, output: r.usage?.completion_tokens || 0, searches: 0 } };
  } finally { clearTimeout(timer); CANCEL.signal.removeEventListener("abort", onCancel); }
}
async function ollamaRun(s, prompt, { maxTokens, timeoutMs, system = null, text: plain = false }) {
  prompt = compactPrompt(prompt, 26000);   // local models read faster and stay focused with shorter prompts
  const base = (s.ollamaUrl || PROVIDERS.ollama.defaultUrl).replace(/\/+$/, ""), model = s.models.ollama || PROVIDERS.ollama.defaultModel;
  // Ollama's model runner can crash (usually out of memory) or still be loading: wait and retry before giving up
  let d, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { d = await ollamaChat(base, model, prompt, { maxTokens, timeoutMs, system, plain }); break; }
    catch (e) {
      lastErr = e; const crashed = /unexpected EOF|model runner|llama runner|exited|terminated|out of memory|unable to allocate/i.test(e.message);
      if (e.status === "cancelled" || e.status === "timeout" || !(crashed || e.status === 500 || e.status === 503) || attempt === 2) {
        if (crashed) throw new LLMError(`Ollama stopped while running the model, which usually means your computer ran out of memory. Close other apps, or choose a smaller model (for example qwen3:4b), then try again. (${e.message.slice(0, 120)})`, e.status);
        throw e;
      }
      await sleep(attempt ? 15000 : 5000, CANCEL.signal);
    }
  }
  return { text: String(d.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(), truncated: d.done_reason === "length",
    usage: { input: d.prompt_eval_count || 0, output: d.eval_count || 0, searches: 0 } };
}
async function ollamaChat(base, model, prompt, { maxTokens, timeoutMs, system, plain }) {
  return call(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, ...(plain ? {} : { format: "json" }), think: false, messages: [{ role: "system", content: system || SYSTEM }, { role: "user", content: prompt }],
      options: { num_ctx: 16384, num_predict: maxTokens, temperature: plain ? 0.7 : 0.6 } }) }, { timeoutMs, retries: 0 });
}
RUN.local = localRun; RUN.ollama = ollamaRun;

// askText(task, prompt) -> Markdown string. Used for section-by-section writing: small models write better prose
// as plain text than inside JSON. Same retries, timeouts, usage tracking and Stop button as ask().
export function cleanText(t) {
  return String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*```(?:markdown|md)?\s*\n/i, "").replace(/\n```\s*$/, "").trim();
}
export async function askText(task, prompt, { maxTokens = 2000, provider = null, timeoutMs = null } = {}) {
  const base = getSettings(), s = provider ? { ...base, provider } : base;
  if (s.provider === "mock") { activity(1); meter("mock", { input: Math.round(prompt.length / 4), output: 400 }); try { return { text: cleanText(await mockResponse(task, prompt)), truncated: false }; } finally { activity(-1); } }
  if (!isConfigured(s)) throw new LLMError("Add your API key in Settings first.", 0);
  const fn = RUN[s.provider], free = !!PROVIDERS[s.provider]?.keyless, tmo = timeoutMs || (free ? 900000 : 240000);
  activity(1);
  try {
    let r;
    try { r = await fn(s, prompt, { maxTokens, webSearch: false, maxSearches: 0, timeoutMs: tmo, system: SYSTEM_TEXT, text: true }); recordUsage(s.provider, r.usage); meter(s.provider, r.usage); }
    catch (e) { if (e.status !== "cancelled") recordUsage(s.provider, { error: true }); throw e; }
    return { text: cleanText(r.text), truncated: !!r.truncated };
  } finally { activity(-1); }
}
export const isFreeProvider = (s = getSettings()) => !!PROVIDERS[s.provider]?.keyless;

// ---------- hybrid mode: a free model writes, a paid model plans (optional), reviews, repairs and fact-checks ----------
export const PAID = ["claude", "openai", "gemini"];
export function hybridSettings() { return { enabled: false, reviewer: "", plan: true, ...(getSettings().hybrid || {}) }; }
export function saveHybrid(patch) { const s = getSettings(); s.hybrid = { ...hybridSettings(), ...patch }; saveSettings(s); }
// the paid model to use for review, or null when hybrid mode is off / not usable (writer must be free, reviewer needs a key)
export function hybridReviewer(s = getSettings()) {
  const h = { enabled: false, reviewer: "", ...(s.hybrid || {}) };
  if (!h.enabled || !PROVIDERS[s.provider]?.keyless || !PAID.includes(h.reviewer) || !(s.keys[h.reviewer] || "").trim()) return null;
  return h.reviewer;
}
