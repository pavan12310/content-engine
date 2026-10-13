// Local preview: serves the static site and runs the real Netlify function at /api/fetch.
// Usage: node tests/dev-server.mjs [port]   (Netlify's own `netlify dev` works too)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetchPage from "../netlify/functions/fetch-page.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(repo, "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.argv[2] || 8888);
// same security headers as netlify.toml, so problems show up locally too
const toml = fs.readFileSync(path.join(repo, "netlify.toml"), "utf8");
const headers = Object.fromEntries([...toml.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)].filter(m => /^[A-Z]/.test(m[1])).map(m => [m[1], m[2]]));
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  if (u.pathname === "/api/fetch") {
    const r = await fetchPage(new Request(u, { method: req.method, headers: req.headers }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(root, decodeURIComponent(u.pathname)); if (u.pathname.endsWith("/")) f = path.join(f, "index.html");
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { ...headers, "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`Content Engine preview: http://localhost:${port}`));
