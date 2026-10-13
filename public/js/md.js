// md.js - convert HTML (pasted from Google Docs/Word, uploaded files, live pages) into clean Markdown.
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "BLOCKQUOTE", "FIGURE", "LI", "UL", "OL", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "HR", "BR"]);
const clean = t => t.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ");
function inline(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += clean(n.textContent); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName, inner = inline(n);
    if (tag === "BR") out += "\n";
    else if (tag === "A") { const href = n.getAttribute("href") || ""; out += /^https?:/i.test(href) && inner.trim() ? `[${inner.trim()}](${href})` : inner; }
    else if (tag === "IMG") { const src = n.getAttribute("src") || ""; if (/^https?:/i.test(src)) out += `![${(n.getAttribute("alt") || "").trim()}](${src})`; }
    else if (tag === "STRONG" || tag === "B" || (n.style && Number(n.style.fontWeight) >= 600)) out += inner.trim() ? `**${inner.trim()}** ` : "";
    else if (tag === "EM" || tag === "I") out += inner.trim() ? `*${inner.trim()}* ` : "";
    else if (tag === "CODE") out += "`" + n.textContent + "`";
    else if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "BUTTON", "FORM", "INPUT", "SELECT", "TEXTAREA", "IFRAME"].includes(tag)) continue;
    else out += inner;
  }
  return out.replace(/\*\* \*\*/g, " ").replace(/ {2,}/g, " ").replace(/ ([.,;:!?])/g, "$1");
}
function block(node, out, depth = 0) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { const t = clean(n.textContent).trim(); if (t) out.push(t); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "NAV", "FORM", "BUTTON", "IFRAME", "TEMPLATE"].includes(tag)) continue;
    const m = tag.match(/^H([1-6])$/);
    if (m) { const t = inline(n).trim(); if (t) out.push("#".repeat(Math.min(+m[1], 4)) + " " + t.replace(/\*\*/g, "")); continue; }
    if (tag === "P") { const t = inline(n).trim(); if (t) out.push(t); continue; }
    if (tag === "UL" || tag === "OL") {
      let k = 1; const items = [];
      for (const li of n.children) if (li.tagName === "LI") {
        const sub = [...li.children].filter(c => c.tagName === "UL" || c.tagName === "OL");
        const clone = li.cloneNode(true); clone.querySelectorAll("ul,ol").forEach(x => x.remove());
        items.push("  ".repeat(depth) + (tag === "OL" ? `${k++}. ` : "- ") + inline(clone).trim());
        for (const s of sub) { const inner = []; block({ childNodes: [s] }, inner, depth + 1); items.push(...inner); }
      }
      if (items.length) out.push(items.join("\n")); continue;
    }
    if (tag === "TABLE") {
      const rows = [...n.querySelectorAll("tr")].map(tr => [...tr.children].map(td => inline(td).trim().replace(/\|/g, "/")));
      if (rows.length) { const w = Math.max(...rows.map(r => r.length)); const pad = r => [...r, ...Array(w - r.length).fill("")];
        out.push([`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(w).fill("---").join(" | ")} |`, ...rows.slice(1).map(r => `| ${pad(r).join(" | ")} |`)].join("\n")); }
      continue;
    }
    if (tag === "BLOCKQUOTE") { const t = inline(n).trim(); if (t) out.push("> " + t); continue; }
    if (tag === "PRE") { out.push("```\n" + n.textContent.trim() + "\n```"); continue; }
    if (tag === "HR") { out.push("---"); continue; }
    if (tag === "IMG") { const t = inline({ childNodes: [n] }); if (t) out.push(t); continue; }
    // containers: recurse if they hold blocks, otherwise treat as a paragraph (Google Docs wraps text in spans/divs)
    if ([...n.children].some(c => BLOCK.has(c.tagName))) block(n, out, depth);
    else { const t = inline(n).trim(); if (t) out.push(t); }
  }
  return out;
}
export function htmlToMarkdown(input) {
  const root = typeof input === "string" ? new DOMParser().parseFromString(input, "text/html").body : input;
  // Google Docs wraps everything in <b id="docs-internal-guid..."> with font-weight normal: unwrap it
  root.querySelectorAll('b[id^="docs-internal-guid"]').forEach(b => { b.replaceWith(...b.childNodes); });
  return block(root, []).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
