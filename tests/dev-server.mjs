// Local preview: serves the static site and runs the real Netlify function at /api/fetch.
// Usage: node tests/dev-server.mjs [port]   (Netlify's own `netlify dev` works too)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetchPage from "../netlify/functions/fetch-page.mjs";
// local stand-in for Netlify Blobs (team sync), using Netlify's own local Blobs server
import { BlobsServer } from "@netlify/blobs/server";
const blobsDir = process.env.BLOBS_DIR || "/tmp/content-engine-blobs";
fs.mkdirSync(blobsDir, { recursive: true });
const blobs = new BlobsServer({ directory: blobsDir, token: "dev" });
const { port: bport } = await blobs.start();
const burl = `http://localhost:${bport}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ apiURL: burl, edgeURL: burl, uncachedEdgeURL: burl, siteID: "dev-site", token: "dev" })).toString("base64");
process.env.TEAM_PASSWORD = process.env.TEAM_PASSWORD || "dev-team";   // local preview only
const sync = (await import("../netlify/functions/sync.mjs")).default;
const search = (await import("../netlify/functions/search.mjs")).default;
const auth = (await import("../netlify/functions/auth.mjs")).default;
const reports = (await import("../netlify/functions/reports.mjs")).default;
const cms = (await import("../netlify/functions/cms.mjs")).default;
const gscfn = (await import("../netlify/functions/gsc.mjs")).default;
const monitorFn = await import("../netlify/functions/monitor.mjs");   // the hourly job; /__tick runs it once (local preview only)
const indexnow = (await import("../netlify/functions/indexnow.mjs")).default;
const bingfn = (await import("../netlify/functions/bing.mjs")).default;
const waybackfn = (await import("../netlify/functions/wayback.mjs")).default;
const redirectsfn = (await import("../netlify/functions/redirects.mjs")).default;
const notifyfn = (await import("../netlify/functions/notify.mjs")).default;
const FN = { "/api/notify": notifyfn, "/api/redirects": redirectsfn, "/api/wayback": waybackfn, "/api/bing": bingfn, "/api/indexnow": indexnow, "/api/sync": sync, "/api/search": search, "/api/auth": auth, "/api/report": reports, "/api/cms": cms, "/api/gsc": gscfn, "/api/gsc/callback": gscfn };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(repo, "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.argv[2] || 8888);
// same security headers as netlify.toml, so problems show up locally too
const toml = fs.readFileSync(path.join(repo, "netlify.toml"), "utf8");
const headers = Object.fromEntries([...toml.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)].filter(m => /^[A-Z]/.test(m[1])).map(m => [m[1], m[2]]));
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  if (u.pathname === "/__tick") { const r = await monitorFn.runOnce({ force: u.searchParams.has("force") }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(r)); return; }
  const fnHere = FN[u.pathname] || (u.pathname.startsWith("/r/") ? reports : null);
  if (fnHere && u.pathname !== "/api/sync" && u.pathname !== "/api/search") {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await fnHere(new Request(u, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); if (r.status === 302 && !h.location && r.headers.get("location")) h.location = r.headers.get("location"); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (u.pathname === "/api/search") {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await search(new Request(u, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (u.pathname === "/api/sync") {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await sync(new Request(u, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (u.pathname === "/api/fetch") {
    const r = await fetchPage(new Request(u, { method: req.method, headers: req.headers }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(root, decodeURIComponent(u.pathname)); if (u.pathname.endsWith("/")) f = path.join(f, "index.html");
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { ...headers, "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`Content Engine preview: http://localhost:${port}`));
