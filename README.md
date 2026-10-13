# Content Engine

Plan, write and measure SEO content that follows Google's rules and earns citations in AI answers.
It runs on Netlify; each person pastes their own **Claude, ChatGPT or Gemini** API key.

## How it works

- **The app runs in your browser.** All the logic (rules, checks, scoring, writing pipeline) is plain JavaScript.
  Nothing needs a server except reading other websites.
- **Your API key stays in your browser.** The browser sends requests straight to Anthropic, OpenAI or Google.
  The key never touches Netlify or any server of ours, and usage is billed to the key owner's account.
- **One small Netlify Function (`/api/fetch`) reads websites** for the crawler, because browsers can't fetch other sites directly.
  It only reads public pages, blocks internal network addresses, and caps size and time.
- **Data is saved in each person's browser** (IndexedDB). Use *AI & data → Download backup* to move it or share it with a colleague.

Netlify doesn't run Python and limits server functions to short runs, which is why the earlier Python version was rebuilt this way.
Writing a page takes minutes, and that is fine in the browser.

---

## Deploy: GitHub → Netlify (about 10 minutes, no coding)

### Step 1: Put the code on GitHub
1. Sign in at **github.com**, click **+ → New repository**, name it `content-engine`, choose **Private**, and click **Create repository**.
2. On the new repository page, click **uploading an existing file**.
3. Unzip `content-engine-netlify.zip` on your computer. Open the `content-engine-netlify` folder, select **everything inside it**
   (`public`, `netlify`, `tests`, `netlify.toml`, `package.json`, `README.md`, `.gitignore`), and drag it into the browser.
4. Click **Commit changes**.

> Check that `netlify.toml` sits at the top level of the repository, not inside another folder.

### Step 2: Connect GitHub to Netlify
1. Sign in at **app.netlify.com** (you can sign in with GitHub).
2. Click **Add new site → Import an existing project → GitHub** and allow Netlify access to the `content-engine` repository.
3. Netlify reads the settings from `netlify.toml`. Leave **Build command** empty; **Publish directory** should show `public`.
4. Click **Deploy**. After a minute you get a link like `https://your-site-name.netlify.app`.
5. Optional: under **Domain management**, rename the site or add your own domain (e.g. `seo.yourcompany.com`).

From now on, every change committed to GitHub redeploys automatically.

### Step 3 (recommended): Stop strangers using your crawler
The app itself is safe to leave public: each visitor has to use their own API key and sees only their own browser's data.
The only shared resource is the website reader. To limit it to your team:
1. In Netlify, open **Site configuration → Environment variables → Add a variable**.
2. Key `CRAWL_TOKEN`, value: any long random password. Save, then **Deploys → Trigger deploy**.
3. Share the token with your team. Each person enters it once under **AI & data → Crawl token**.

---

## Get an API key (pick one or more)

| Provider | Where to get a key | Notes |
|---|---|---|
| **Claude** (Anthropic) | console.anthropic.com → API Keys | Web search must be enabled for your organisation in the Claude Console for fact-checking. |
| **ChatGPT** (OpenAI) | platform.openai.com → API keys | Uses the Responses API with OpenAI's web search tool. |
| **Gemini** (Google) | aistudio.google.com → Get API key | Uses Google Search grounding. |

In the app, open **AI & data**, choose a provider, paste the key, click **Load models**, pick a model, then **Save** and **Test connection**.
**Demo mode** needs no key and uses sample answers, which is useful for trying the app or training colleagues.

If a model doesn't support web search, the app automatically continues without it. Fact-checks are then less thorough, and the app tells you.

---

## Using it

1. **AI & data:** connect a provider.
2. **Websites:** add your site and click **Read my website** (start with 200 pages).
3. **Home:** your dashboard. Alerts (overdue to-dos, old data, recent Google updates), what changed since your last visit,
   clickable headline numbers, "Do these first" with **Do it** buttons, the content pipeline (keyword gaps → drafts → ready → approved),
   daily Google clicks with updates marked, AI answer trend, and an overview of all your websites.
4. **Site health:** 27 checks (errors, broken links, redirects, mobile setup, titles, headings, descriptions, thin pages,
   insecure files, social tags, structured data…). Each issue explains why it matters and how to fix it.
   Open any page to see all its problems and get AI-suggested titles, descriptions and H1s.
   Ignore intentional cases, export a CSV for developers, and click **Read website again** after fixing to see what got fixed.
   With Search Console data uploaded, issues on pages that get the most Google clicks come first.
5. **Google search:** upload your Search Console export (Performance → Export → Download CSV), then an earlier period too.
   You get headline changes, a daily clicks chart with confirmed Google updates marked (and their before/after impact),
   devices, countries, brand vs topic searches, rising and falling searches, topics, and opportunity lists with fixes:
   AI-suggested titles for searches that get few clicks, keyword checks for searches close to page 1, and links into Site health.
   Google update dates live in `public/js/rules.js` (`GOOGLE_UPDATES`). Add new ones from status.search.google.com.
6. **Keywords:** keep every keyword you care about in one place.
   - **My keywords:** paste or import keywords. Each one shows straight away whether you already have a page for it
     (has a page / partly covered / no page yet), with search, filters, sorting and bulk actions.
   - **Find ideas:** enter a topic and the AI suggests searches your buyers make that fit what you sell, each checked against your pages.
     These are suggestions without search volumes, so confirm demand in Ahrefs, Semrush, Keyword Planner or Search Console.
   - **Topic clusters:** keywords that one page should target together. Write one strong page per cluster, not one page per keyword.
   - **Competing pages:** pages on your site that target the same topic and intent.
   **Check a keyword** gives the full AI analysis for one keyword before writing.
7. **Content ideas:** page ideas grouped into topic clusters (a pillar page plus supporting pages), each backed by evidence from
   your keywords, Google search data and AI-answer gaps, and checked against pages you already have. Add ideas to the
   **Content plan** (by month, with a writer and status). Statuses update themselves as pages are written and approved.
   The **Site review** tab covers strengths, risks under Google's rules, and existing pages worth improving.
8. **Write a page:** a named author is required. Set your **writing style** once per website (tone, spelling,
   words to avoid, preferred call to action). Writing takes 2–6 minutes; **keep the tab open**.
   Then, in the **Edit** tab:
   - fill every highlighted placeholder with real proof (live SEO checks update as you type)
   - rewrite any weak section with AI, without regenerating the whole page
   - undo with **Version history** at any time
   - when ready, tick the three confirmations and **Approve**. A page can't be approved while placeholders or failing checks remain.
   Export as a Markdown or HTML file, copy HTML for your CMS, or copy formatted text straight into Google Docs or Word.
   **Review a draft** checks pages written elsewhere (a writer, an agency, a Google Doc, or a live page on any site) with the same
   rules and scores. Paste from Google Docs or Word (headings, lists and links are kept), upload a file, or load a URL.
   Problems are highlighted in the text, and **Open in editor** moves the draft into My pages to fix, rewrite and approve.
9. **AI answers:** track 5–25 questions your buyers ask AI (or let AI suggest them), then **Run all questions** across every
   assistant you have a key for (Claude, ChatGPT, Gemini) in one go. See mention rate and trend, share of voice against competitors,
   the sources AI relies on (sites to get listed or reviewed on), how each assistant describes you, and a **Why not us?**
   analysis with concrete actions. Log checks from Perplexity, Copilot or Google's AI Overviews by hand.
   Run monthly: answers vary, so trends matter more than one run.
10. **To-do list:** builds itself from every part of the tool. Start with **Start here** (quick wins: big impact, little effort).
   **Do it** jumps straight to the fix. View by priority, by page or by source; assign an owner, due date and notes;
   export a CSV for Jira, Asana or a sheet. Items resolve themselves when the problem disappears after a refresh.

## Google's rules are built in

`public/js/rules.js` holds every rule: core principles, spam patterns, high-risk page types, search intents,
SEO thresholds, page structures by intent, the release gate and guardrails. Each rule is applied three ways:
- **In every AI request:** the rules are sent as the system instructions for Claude, ChatGPT and Gemini alike.
- **Deterministic checks:** `validators.js` checks titles, meta descriptions, one H1, H2s, the direct answer, real internal links,
  FAQs, unnatural repetition, filler phrases and unsourced statistics.
- **Guardrails and the release gate:** duplicate same-intent pages are blocked, a named author is required, output is capped
  at 10 pages per site per day, there are 6 separate scores with minimums, and false claims block release.
  Nothing is ever marked "publish"; a person reviews every page.

Edit the thresholds in `rules.js`, commit to GitHub, and Netlify redeploys.

---

## Preview on your own computer (optional)

With Node.js 18 or newer installed:

```
npm run preview
```

Then open http://localhost:8888. This serves the app and runs the real `/api/fetch` function locally.
The Netlify CLI works too: `npx netlify dev`.

## Costs and limits

- **AI usage** is billed by your provider. One page makes roughly 5–9 AI requests plus up to 8 web searches.
  Turn off fact-checking for a page to save cost.
- **Netlify:** reading 200 pages uses about 200 function calls. Check your Netlify plan's function allowance.
- **Data** lives in one browser. Clearing browser data deletes it, so download a backup regularly.
- **Website reading:** the reader sees the HTML a server sends. Pages that load their text with JavaScript show few words, and those are flagged.

## Files

```
netlify.toml                      Netlify settings and security headers
netlify/functions/fetch-page.mjs  website reader (/api/fetch)
public/index.html                 the interface
public/js/
  app.js          interface logic
  api.js          local request router (the same endpoints the Python version had)
  rules.js        Google's rules, SEO thresholds, guardrails  <- edit here
  llm.js          Claude / ChatGPT / Gemini connector + settings
  prompts.js      AI prompts
  services.js     workflows: keyword check, writing pipeline, release gate, to-do list
  validators.js   deterministic page checks
  text.js         search intent + duplicate-keyword detection
  crawler.js      website reader (sitemaps, robots.txt, fair sampling)
  techaudit.js    site health checks
  gsc.js          Search Console import + analysis
  kwio.js         keyword import (Ahrefs, Semrush, Keyword Planner) / CSV export
  store.js        browser storage + backup/restore
  mock.js         demo mode answers
public/vendor/    marked (Markdown) and JSZip (zip files), bundled so nothing loads from other sites
tests/dev-server.mjs  local preview server
```
