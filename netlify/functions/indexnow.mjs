// indexnow.mjs - tells IndexNow search engines (Bing, Yandex, Seznam, Naver and others; not Google) about new or changed pages.
// The IndexNow service doesn't accept requests from browsers, so this relays them. It also checks that the site's key file is live.
//   POST /api/indexnow {op:"verify", site_url, key, key_location?}
//   POST /api/indexnow {op:"submit", site_url, key, key_location?, urls:[...]}
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

const ENDPOINT = process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i];
async function isPublic(u) {
  if (process.env.INDEXNOW_ALLOW_LOCAL === "1") return true;   // local testing only; never set this on Netlify
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  return addrs.length > 0 && !addrs.some(a => PRIVATE.some(re => re.test(a)));
}
async function gate(req) {   // same rule as the other tools: signed in when accounts are on, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
const RESPONSES = {
  200: "Accepted: the search engines have been told about these pages.",
  202: "Received: the key is still being checked by the search engine. Submissions are accepted; the key check usually finishes within a day.",
  400: "The request was rejected as invalid (check the page addresses).",
  403: "The key wasn't accepted: the key file isn't on your site or its content doesn't match. Use Verify to check it.",
  422: "Some addresses don't belong to this website, or don't match the key's location.",
  429: "Too many submissions in a short time. Wait a while and submit again (only submit pages that actually changed).",
};

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const blocked = await gate(req); if (blocked) return blocked;
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || "");
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) return json(400, { error: "The IndexNow key must be 8-128 letters, numbers or dashes." });
  let site; try { site = new URL(String(b.site_url || "")); } catch { return json(400, { error: "Enter the website address." }); }
  if (!(await isPublic(site))) return json(400, { error: "Private network addresses are not allowed." });
  const keyLocation = b.key_location ? String(b.key_location) : `${site.origin}/${key}.txt`;
  let kl; try { kl = new URL(keyLocation); } catch { return json(400, { error: "The key file address isn't valid." }); }
  if (kl.host !== site.host) return json(400, { error: "The key file must be on the same website (same host)." });

  if (b.op === "verify") {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(kl.toString(), { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "ContentEngine/1.0 (IndexNow key check)" } });
      const text = (await r.text()).slice(0, 2000).trim();
      if (r.status !== 200) return json(200, { ok: false, url: kl.toString(), message: `The key file isn't there yet (${kl.toString()} returned ${r.status}).` });
      if (text !== key) return json(200, { ok: false, url: kl.toString(), message: text.startsWith("<") ? "That address returns a web page, not the key file. Upload the file itself so it contains only the key." : "The file is there but its content doesn't match the key exactly (it must contain only the key)." });
      return json(200, { ok: true, url: kl.toString(), message: "The key file is live and correct." });
    } catch (e) { return json(200, { ok: false, url: kl.toString(), message: e.name === "AbortError" ? "Your site took too long to answer." : "Couldn't reach your site." }); }
    finally { clearTimeout(t); }
  }
  if (b.op === "submit") {
    const urls = [...new Set((Array.isArray(b.urls) ? b.urls : []).map(String).map(u => u.trim()).filter(Boolean))].slice(0, 10000);
    const bad = urls.filter(u => { try { return new URL(u).host !== site.host; } catch { return true; } });
    if (!urls.length) return json(400, { error: "Add at least one page address." });
    if (bad.length) return json(400, { error: `${bad.length} address${bad.length > 1 ? "es don't" : " doesn't"} belong to ${site.host}: ${bad.slice(0, 3).join(", ")}` });
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(ENDPOINT, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host: site.host, key, keyLocation: kl.toString(), urlList: urls }) });
      return json(200, { status: r.status, accepted: r.status === 200 || r.status === 202, submitted: urls.length, message: RESPONSES[r.status] || `The search engine answered ${r.status}.` });
    } catch (e) { return json(504, { error: e.name === "AbortError" ? "The IndexNow service took too long to answer. Try again." : "Couldn't reach the IndexNow service." }); }
    finally { clearTimeout(t); }
  }
  return json(400, { error: "Unknown request" });
};

export const config = { path: "/api/indexnow" };
