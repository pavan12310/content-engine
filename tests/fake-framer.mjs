// fake-framer.mjs - local tests only (FRAMER_API_MODULE): behaves like the framer-api package for a project with a "Blog"
// collection you manage and a plugin-managed "Changelog". State is written to /tmp/fake-framer-state.json after each change.
import fs from "node:fs";
const S = globalThis.__fakeFramer ||= { items: [{ id: "human_1", slug: "existing-post", draft: false, fieldData: { f_title: { type: "string", value: "A post written in Framer" } } }], n: 0, published: 0, deployed: 0 };
const save = () => fs.writeFileSync("/tmp/fake-framer-state.json", JSON.stringify(S, null, 1)); save();
const blogFields = [{ id: "f_title", name: "Title", type: "string" }, { id: "f_body", name: "Content", type: "formattedText" }, { id: "f_desc", name: "Excerpt", type: "string" },
  { id: "f_date", name: "Date", type: "date" }, { id: "f_author", name: "Author", type: "string" }, { id: "f_img", name: "Cover", type: "image" }, { id: "f_seot", name: "SEO Title", type: "string" }, { id: "f_seod", name: "Meta Description", type: "string" }, { id: "f_div", name: "—", type: "divider" }];
const collection = (id, name, managedBy, fields) => ({ id, name, managedBy,
  getFields: async () => fields, getItems: async () => (id === "c_blog" ? S.items : []).map(x => ({ ...x })),
  addItems: async items => { if (managedBy !== "user") throw new Error("Collection is managed by a plugin (read-only)");
    for (const it of items) { if (!it.slug) throw new Error("slug required");
      for (const [k, v] of Object.entries(it.fieldData || {})) { const f = fields.find(x => x.id === k); if (!f) throw new Error(`Unknown field ${k}`); if (f.type !== v.type) throw new Error(`Field ${k} expects ${f.type}, got ${v.type}`); }
      const i = it.id ? S.items.findIndex(x => x.id === it.id) : -1;
      if (i >= 0) S.items[i] = { ...S.items[i], ...it, fieldData: { ...S.items[i].fieldData, ...it.fieldData } };
      else { if (S.items.some(x => x.slug === it.slug)) throw new Error("Slug already exists"); S.items.push({ ...it, id: `item_${++S.n}` }); } }
    save(); } });
export async function connect(url, key) {
  if (key !== "good-framer-key") throw new Error("Unauthorized: invalid API key");
  if (!/Trupeer--/.test(url)) throw new Error("Project not found");
  return { getCollections: async () => [collection("c_blog", "Blog", "user", blogFields), collection("c_log", "Changelog", "anotherPlugin", [{ id: "x", name: "Title", type: "string" }])],
    publish: async () => { S.published++; save(); return { deployment: { id: `dep_${S.published}` }, hostnames: [{ hostname: "trupeer-preview.framer.app", isPrimary: false, isPublished: false }] }; },
    deploy: async () => { S.deployed++; save(); return [{ hostname: "www.trupeer.ai", isPrimary: true, isPublished: true }]; },
    disconnect: async () => {} };
}
