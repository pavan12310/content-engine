// cms.mjs - sends approved pages to a website's CMS. WordPress first (REST API + application password).
// The browser sends the connection details with each request; nothing is stored here. Requests may only go to
// the WordPress REST paths below, on public addresses (no private networks), with a 15 s timeout.
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168)\./i];
async function publicUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error("That isn't a valid website address."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Use an http(s) address.");
  if (process.env.CMS_ALLOW_LOCAL === "1") return u;   // local testing only; never set this on Netlify
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("Private network addresses are not allowed.");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  if (!addrs.length) throw new Error(`Couldn't find ${host}. Check the address.`);
  if (addrs.some(a => PRIVATE.some(re => re.test(a)))) throw new Error("Private network addresses are not allowed.");
  return u;
}
async function gate(req) {   // same rule as the website reader: signed in, or the crawl token when one is set
  const { readToken, enabled: accountsOn } = await import("./_lib/auth.mjs");
  const session = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ce_session=([^;]+)/);
  if (accountsOn()) return session && readToken(session[1]) ? null : json(401, { error: "Please sign in." });
  const tok = process.env.CRAWL_TOKEN; if (!tok) return null;
  const got = req.headers.get("x-crawl-token") || "", a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : json(401, { error: "Add the crawl token in Settings." });
}
const WP_ERR = (status, d) => {
  const code = d?.code || "";
  if (status === 401 || code === "rest_not_logged_in" || code === "incorrect_password" || code === "invalid_username") return "WordPress didn't accept the username or application password. Create a new application password in WordPress (Users → Profile → Application Passwords) and try again.";
  if (status === 403 || /cannot_create|cannot_edit|forbidden/.test(code)) return "This WordPress user isn't allowed to create or edit these posts. Use an Editor or Administrator account.";
  if (status === 404 && /rest_no_route/.test(code)) return "The WordPress REST API isn't available at this address. Check the site address, or ask your host whether a security plugin blocks /wp-json.";
  if (status === 404) return "That post no longer exists in WordPress (it may have been deleted). Send it again as a new draft.";
  return `WordPress answered with an error (${status}${code ? `: ${code}` : ""}). ${String(d?.message || "").replace(/<[^>]+>/g, "").slice(0, 200)}`;
};

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const blocked = await gate(req); if (blocked) return blocked;
  const b = await req.json().catch(() => ({}));
  if (b.platform !== "wordpress") return json(400, { error: "Only WordPress is supported so far." });
  const user = String(b.username || "").trim(), pass = String(b.app_password || "").replace(/\s+/g, "");
  if (!user || !pass) return json(400, { error: "Enter the WordPress username and application password." });
  let base; try { base = await publicUrl(String(b.site_url || "").replace(/\/+$/, "")); } catch (e) { return json(400, { error: e.message }); }
  const root = base.toString().replace(/\/+$/, "") + "/wp-json/wp/v2";
  const type = b.post_type === "pages" ? "pages" : "posts";
  const call = async (path, method = "GET", body) => {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(root + path, { method, redirect: "follow", signal: ctrl.signal, headers: { authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"), accept: "application/json", "user-agent": "ContentEngine/1.0", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { }
      if (d === null && /<html/i.test(text)) return { status: r.status, d: { code: "not_json", message: "The site returned a web page instead of the API response (a security plugin or firewall may be blocking it)." } };
      return { status: r.status, d };
    } catch (e) { return { status: 0, d: { code: e.name === "AbortError" ? "timeout" : "unreachable", message: e.name === "AbortError" ? "WordPress didn't answer within 15 seconds." : "Couldn't reach the site." } }; }
    finally { clearTimeout(t); }
  };
  if (b.action === "test") {
    const me = await call("/users/me?context=edit");
    if (me.status !== 200) return json(400, { error: me.status ? WP_ERR(me.status, me.d) : me.d.message });
    const cats = await call("/categories?per_page=100&_fields=id,name");
    const caps = me.d?.capabilities || {};
    return json(200, { ok: true, user: { name: me.d?.name || user, roles: me.d?.roles || [] }, can_publish_posts: !!(caps.edit_posts || caps.publish_posts), can_edit_pages: !!caps.edit_pages,
      categories: Array.isArray(cats.d) ? cats.d.map(c => ({ id: c.id, name: String(c.name || "").replace(/&amp;/g, "&") })) : [] });
  }
  if (b.action === "save") {
    const p = b.post || {};
    const status = ["draft", "pending"].includes(p.status) ? p.status : "draft";   // never publish directly: a person presses Publish in WordPress
    const body = { title: String(p.title || "").slice(0, 300), content: String(p.content || ""), slug: String(p.slug || "").slice(0, 200), excerpt: String(p.excerpt || "").slice(0, 600), status };
    if (type === "posts" && Array.isArray(p.categories) && p.categories.length) body.categories = p.categories.map(Number).filter(Boolean).slice(0, 5);
    const id = Number(p.id) || 0;
    const r = await call(id ? `/${type}/${id}` : `/${type}`, "POST", body);
    if (![200, 201].includes(r.status)) return json(400, { error: r.status ? WP_ERR(r.status, r.d) : r.d.message });
    const site = base.toString().replace(/\/+$/, "");
    return json(200, { ok: true, id: r.d.id, status: r.d.status, link: r.d.link, edit_link: `${site}/wp-admin/post.php?post=${r.d.id}&action=edit`, updated: !!id });
  }
  return json(400, { error: "Unknown action" });
};

export const config = { path: "/api/cms" };
