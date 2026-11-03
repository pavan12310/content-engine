// monitor-api.mjs - the web address for weekly monitoring (/api/monitor). Netlify never gives scheduled functions a web address, so the
// hourly job (monitor.mjs) can't answer the app directly. This function does: GET ?op=status says whether email is set up; POST runs the
// check now for the requesting team or workspace and the chosen websites, optionally emailing the results.
import { enabled as accountsOn, currentUser, roleIn, CAN, json, sameText } from "./_lib/auth.mjs";
import { runOnce } from "./monitor.mjs";

async function scope(req) {
  if (accountsOn() && (req.headers.get("cookie") || "").includes("ce_session=")) {
    const me = await currentUser(req); if (me.error) return { error: me.error };
    const { ws, role } = await roleIn(me.store, me.user, req.headers.get("x-workspace") || "");
    if (!ws || !role) return { error: json(403, { error: "You're not a member of this workspace." }) };
    return { prefix: `w:${ws.id}:`, write: CAN.write(role) };
  }
  const pass = process.env.TEAM_PASSWORD;
  if (!pass) return { error: json(501, { error: "Running the check on the server needs team sync or accounts. In Netlify, add TEAM_PASSWORD (or AUTH_SECRET for accounts)." }) };
  if (!sameText(req.headers.get("x-team-key") || "", pass)) return { error: json(401, { error: "Wrong team password." }) };
  return { prefix: "", write: true };
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("op") !== "status") return json(400, { error: "Unknown request." });
    const email = !!(process.env.RESEND_API_KEY && process.env.MONITOR_FROM);
    return json(200, { email, from: email ? process.env.MONITOR_FROM : "", schedule: "hourly", accounts: accountsOn(), team: !!process.env.TEAM_PASSWORD });
  }
  if (req.method !== "POST") return json(405, { error: "Use GET or POST." });
  const sc = await scope(req); if (sc.error) return sc.error;
  if (!sc.write) return json(403, { error: "Your role can't run checks. Ask an owner, admin or editor." });
  const b = await req.json().catch(() => ({}));
  const siteIds = Array.isArray(b.site_ids) ? b.site_ids.map(Number).filter(Boolean).slice(0, 50) : null;
  // web requests get about 10 seconds on Netlify: websites that don't fit are left for the hourly job
  // the addresses currently in the box, even if not saved yet (checked, at most 20)
  const emails = Array.isArray(b.emails) ? b.emails.map(e => String(e).trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)).slice(0, 20) : null;
  const [r] = await runOnce({ force: true, onlyPrefix: sc.prefix, siteIds, sendMail: !!b.email, emails, budgetMs: 8500 });
  if (!r) return json(200, { checked: 0, deferred: 0, mail: { skipped: "no websites to check" } });
  return json(200, { checked: r.checked.length, names: r.checked, deferred: r.deferred, levels: r.levels, mail: r.email });
};
export const config = { path: "/api/monitor" };
