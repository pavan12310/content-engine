// images.js - image SEO: every image the reader recorded, checked for alt text, size, dimensions, format and loading.
// Sizes come from a headers-only check (nothing is downloaded).
const extOf = u => { try { return (new URL(u).pathname.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || ""; } catch { return ""; } };
const stem = u => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "").toLowerCase(); } catch { return ""; } };
// alt text that says nothing: a filename, "image", "photo 3", "IMG_2041", or very short
export const poorAlt = (alt, src) => { const a = String(alt || "").trim().toLowerCase(); if (!a) return false;
  return a.length < 4 || /\.(jpe?g|png|webp|gif|svg|avif)$/.test(a) || /^(image|img|photo|picture|pic|screenshot|graphic|banner|logo|icon)[\s_-]*\d*$/.test(a) || /^(img|dsc|screen ?shot)[_\s-]?\d+/.test(a) || a === stem(src) || a.replace(/[-_]/g, " ") === stem(src).replace(/[-_]/g, " "); };
export function collect(pages) {
  const m = new Map();
  for (const p of pages) for (const [src, alt, dims, lazy, main, pos, ctx, srcset] of p.imgs_d || []) {
    if (/\.svg(\?|$)/i.test(src) && !main) continue;   // decorative icons
    const o = m.get(src) || { src, pages: [], alts: new Set(), missing_alt: 0, no_dims: 0, lazy_first: [], main: false, context: ctx || "", page_title: p.title || "" };
    o.pages.push(p.url); if (srcset) o.srcset = true; if (alt == null) o.missing_alt++; else o.alts.add(alt); if (!dims) o.no_dims++; if (main) o.main = true;
    if (lazy && main && pos === 0) o.lazy_first.push(p.url); m.set(src, o);
  }
  return [...m.values()].map(o => ({ ...o, alts: [...o.alts], ext: extOf(o.src) }));
}
// problems for one image (after the size check)
export function judge(im, check = {}) {
  const out = [], kb = check.bytes ? Math.round(check.bytes / 1024) : null, type = check.type || "", status = check.final_status ?? null;
  // a slow answer isn't a broken image: timeouts are "couldn't check", not broken
  if (status != null && status >= 400) out.push({ kind: "broken", level: "fail", text: `doesn't load (${status})` });
  else if (status === 0 && check.error && check.error !== "timed out") out.push({ kind: "broken", level: "fail", text: `doesn't load (${check.error})` });
  else if (status === 0 || check.skipped) out.push({ kind: "unchecked", level: "info", text: "couldn't be checked (the server was slow); try again" });
  if (im.missing_alt && im.main) out.push({ kind: "alt_missing", level: "fail", text: `no alt text on ${im.missing_alt} page${im.missing_alt > 1 ? "s" : ""}` });
  else if (im.alts.some(a => poorAlt(a, im.src))) out.push({ kind: "alt_poor", level: "warn", text: `alt text says nothing useful (“${im.alts.find(a => poorAlt(a, im.src))}”)` });
  // with srcset (or <picture>), browsers usually download a smaller version: the original's size overstates what visitors get
  const ss = im.srcset ? " original; the page also offers smaller versions (srcset), so most visitors download less" : "";
  if (kb != null && kb > 1024) out.push({ kind: "big", level: im.srcset ? "warn" : "fail", text: `${check.at_least ? "at least " : ""}${(kb / 1024).toFixed(1)} MB${ss}` });
  else if (kb != null && kb > 300) out.push({ kind: "big", level: im.srcset ? "info" : "warn", text: `${kb} KB${ss}` });
  const isOld = ["jpg", "jpeg", "png", "gif", "bmp"].includes(im.ext) || /image\/(jpeg|png|gif|bmp)/.test(type);
  if (isOld && kb != null && kb > 100) out.push({ kind: "format", level: "warn", text: `${(type.split("/")[1] || im.ext).toUpperCase()}: WebP or AVIF would usually be 25-50% smaller` });
  if (im.no_dims && im.main) out.push({ kind: "dims", level: "warn", text: "no width and height, so the page shifts while it loads" });
  if (im.lazy_first.length) out.push({ kind: "lazy_first", level: "warn", text: "the first image in the content is lazy-loaded, which delays it; load it normally" });
  return out;
}
