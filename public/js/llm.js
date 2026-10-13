// llm.js - one interface for Claude, ChatGPT (OpenAI) and Gemini, called straight from the browser with the user's own key.
// Keys never touch our server. Each provider's web search tool is used for fact-checking and AI-answer checks.
import { rulesText } from "./rules.js";
import { mockResponse } from "./mock.js";

export const PROVIDERS = {
  claude: { label: "Claude (Anthropic)", keyHelp: "console.anthropic.com → API Keys", defaultModel: "claude-sonnet-5-5", keyPrefix: "sk-ant-" },
  openai: { label: "ChatGPT (OpenAI)", keyHelp: "platform.openai.com → API keys", defaultModel: "gpt-5.5", keyPrefix: "sk-" },
  gemini: { label: "Gemini (Google)", keyHelp: "aistudio.google.com → Get API key", defaultModel: "gemini-2.5-pro", keyPrefix: "" },
};
const SYSTEM = "You are a senior SEO content strategist and editor. You follow Google's official Search guidance exactly. " +
  "You never fabricate facts, statistics, quotes, customers or credentials; you insert clearly marked placeholders instead. " +
  "Your final answer is valid JSON only, no prose before or after, no code fences.\n\n" + rulesText();

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
export function isConfigured(s = getSettings()) { return s.provider === "mock" || !!(s.keys[s.provider] || "").trim(); }

class LLMError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function call(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch { throw new LLMError("Couldn't reach the AI provider. Check your internet connection.", 0); }
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const m = data?.error?.message || data?.error?.status || data?.message || text.slice(0, 300);
    const hint = r.status === 401 || r.status === 403 ? "The API key was rejected. Check it in Settings." :
      r.status === 429 ? "Rate limit or quota reached at the provider. Wait a minute, or check your plan and billing." :
      r.status === 404 ? "Model not found. Pick another model in Settings." : "";
    throw new LLMError(`${hint ? hint + " " : ""}(${r.status}) ${m}`, r.status);
  }
  return data;
}

// ---------- providers ----------
async function claude(s, prompt, { maxTokens, webSearch, maxSearches }) {
  const headers = { "content-type": "application/json", "x-api-key": s.keys.claude, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  const body = { model: activeModel(s), max_tokens: maxTokens, system: SYSTEM, messages: [{ role: "user", content: prompt }] };
  if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
  let d = await call("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  for (let i = 0; i < 4 && d.stop_reason === "pause_turn"; i++) {
    body.messages = [...body.messages, { role: "assistant", content: d.content }];
    d = await call("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  }
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}
async function openai(s, prompt, { maxTokens, webSearch }) {
  const body = { model: activeModel(s), instructions: SYSTEM, input: prompt, max_output_tokens: maxTokens };
  if (webSearch) body.tools = [{ type: "web_search" }];
  const d = await call("https://api.openai.com/v1/responses", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.keys.openai}` }, body: JSON.stringify(body) });
  if (typeof d.output_text === "string" && d.output_text) return d.output_text;
  return (d.output || []).filter(o => o.type === "message").flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
}
async function gemini(s, prompt, { maxTokens, webSearch }) {
  const model = activeModel(s).replace(/^models\//, "");
  const body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens } };
  if (webSearch) body.tools = [{ google_search: {} }];
  const d = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.keys.gemini)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const parts = d.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || "").join("");
  if (!text && d.candidates?.[0]?.finishReason) throw new LLMError(`Gemini stopped: ${d.candidates[0].finishReason}`, 0);
  return text;
}
const RUN = { claude, openai, gemini };

export function parseJson(text) {
  let t = (text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const end = t.lastIndexOf("}");
  for (let i = t.indexOf("{"); i !== -1 && i < end; i = t.indexOf("{", i + 1)) { try { return JSON.parse(t.slice(i, end + 1)); } catch { /* next */ } }
  throw new LLMError("The AI reply wasn't valid JSON.", 0);
}

// ask(task, prompt) -> parsed JSON. Falls back to no web search if the model/key doesn't support it.
// providers that can be used right now (have a key), plus demo mode when it's the active choice
export function availableProviders(s = getSettings()) {
  const out = Object.keys(PROVIDERS).filter(k => (s.keys[k] || "").trim());
  if (s.provider === "mock") out.unshift("mock");
  return out;
}
export async function ask(task, prompt, { maxTokens = 8000, webSearch = false, maxSearches = 8, provider = null } = {}) {
  const base = getSettings(), s = provider ? { ...base, provider } : base;   // provider override: ask a specific AI
  if (s.provider === "mock") return mockResponse(task, prompt);
  if (!isConfigured(s)) throw new LLMError(provider ? `No API key saved for ${PROVIDERS[provider]?.label || provider}.` : "Add your API key in Settings first.", 0);
  const fn = RUN[s.provider]; const useSearch = webSearch && s.webSearch;
  let text, noSearch = webSearch && !useSearch;
  try { text = await fn(s, prompt, { maxTokens, webSearch: useSearch, maxSearches }); }
  catch (e) {
    if (useSearch && e.status === 400 && /tool|search|grounding/i.test(e.message)) { text = await fn(s, prompt, { maxTokens, webSearch: false, maxSearches }); noSearch = true; }
    else throw e;
  }
  let out;
  try { out = parseJson(text); }
  catch {
    const fixed = await fn(s, "Convert this into the requested JSON only, nothing else:\n\n" + text.slice(-60000), { maxTokens, webSearch: false, maxSearches });
    out = parseJson(fixed);
  }
  if (noSearch && out && typeof out === "object") out._no_search = true;   // callers can tell the answer didn't use live search
  return out;
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
  if (provider === "gemini") {
    const d = await call(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {});
    return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name) && !/(embedding|image|tts|audio|live)/.test(m.name))
      .map(m => m.name.replace(/^models\//, "")).sort().reverse();
  }
  return [];
}
