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
- **Data is saved in each person's browser** (IndexedDB). Use *Settings → Download backup* to move it or share it with a colleague.

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
3. Share the token with your team. Each person enters it once under **Settings → Crawl token**.

---

## Get an API key (pick one or more)

| Provider | Where to get a key | Notes |
|---|---|---|
| **Claude** (Anthropic) | console.anthropic.com → API Keys | Web search must be enabled for your organisation in the Claude Console for fact-checking. |
| **ChatGPT** (OpenAI) | platform.openai.com → API keys | Uses the Responses API with OpenAI's web search tool. |
| **Gemini** (Google) | aistudio.google.com → Get API key | Uses Google Search grounding. |

In the app, open **Settings**, choose a provider, paste the key, click **Load models**, pick a model, then **Save** and **Test connection**.

### Free options (no API key)

| Option | What it is | Good for | Limits |
|---|---|---|---|
| **Built-in AI** | An open-source model (Qwen3, Llama, Gemma) that downloads once (2–6 GB) and runs inside Chrome or Edge on your computer's graphics chip | Trying the tool for free, private drafts, keyword checks, ideas | Needs a recent Chrome/Edge and a working graphics chip (any Apple-silicon Mac is fine). Slower and simpler writing than GPT or Claude |
| **Ollama** | The free Ollama app (ollama.com) running open-source models on your computer | Free drafts with better quality than Built-in AI (bigger models such as `qwen3:8b` or `qwen3:14b`) | One-time setup: install, `ollama pull qwen3:8b`, then allow your site: `launchctl setenv OLLAMA_ORIGINS "https://your-site.netlify.app"` and restart Ollama |

**Section-by-section writing (automatic for the free options):** the page is planned, then the title and intro, each section and the FAQ
are written in separate small steps. Each section is checked the moment it's written (too short, filler, invented statistics) and retried once
if needed; repair rounds rewrite only the sections with problems and stop when a round brings no improvement. Progress is saved after every
section, so an interruption resumes mid-page. Paid models can use it too: Writing style → How to write pages → Section by section.
The screen is kept awake while the AI works. If Ollama's model crashes (usually out of memory), the tool waits and retries, then explains.

**Hybrid mode (free writing, paid review):** Settings → Hybrid mode. Your free AI writes the intro, sections and FAQ; a paid model
(Claude, ChatGPT or Gemini) plans the page (optional), reviews quality, fixes only the flagged sections, and fact-checks with its own web search.
Paid reviews re-read the whole page, so hybrid mode limits them to 2 rounds and skips a re-review when nothing changed. Each page's report
shows its estimated saving against writing everything with the paid model (typically 30–60%; more for long pages). A smaller paid model for
review saves more. Keyword research and Review a draft also use the paid model when hybrid mode is on.

**Web search for the free options (optional, free):** Built-in AI and Ollama can't search by themselves, so the tool can search for them.
Get a free key from **Tavily** (app.tavily.com: 1,000 searches a month, no card) and paste it in **Settings → Web search for the free AI options**.
Then the keyword check researches what currently ranks, and fact-checks list the page's claims, search for each one, and judge it against the
real results (a source the AI invents is rejected). Results are cached for a day. Brave Search keys also work. For a team-wide key, set
`TAVILY_API_KEY` (or `BRAVE_API_KEY` for a Brave Search key) in Netlify; it's only used by people with the team password or crawl token. AI-answer checks still need Claude, ChatGPT or Gemini,
because they measure what real assistants say.

If a model doesn't support web search, the app automatically continues without it. Fact-checks are then less thorough, and the app tells you.

---

## Guided setup

New users see a six-step **guided setup** (also on Home): connect an AI (with a connection test), add the website (reading continues in the
background), confirm the type of website, add quick facts (examples tailored to the type), choose a first keyword from suggestions (pages you
don't have yet first), then write the first page. It remembers where you stopped, restarts an interrupted website reading, and isn't shown to
view-only roles.

## Using it

1. **Settings:** connect a provider.
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
npm install      # first time only
npm run preview
```

Then open http://localhost:8888. This serves the app and runs the real `/api/fetch` function locally.
The Netlify CLI works too: `npx netlify dev`.

## Page speed (free)

**Site health → Speed** tests your homepage and the pages Google sends the most visitors to with Google's free PageSpeed Insights API:
real-visitor Core Web Vitals from Chrome users over the last 28 days (loading LCP, responsiveness INP, visual stability CLS, rated with Google's
official thresholds), a whole-site verdict, a lab speed score with each page's previous score, and the biggest fixes with the time they save.
**Quick check (real visitors)** gets the Core Web Vitals for up to 50 pages in seconds from Google's Chrome UX Report API (enable it for your
key); **Full test (with fixes)** runs the slower lab test three pages at a time and reuses pages fully tested in the last 24 hours unless you tick
"test again". **Fixes that help most pages** groups the same fix across pages with the total time it saves, and each page shows its score trend.
Slow important pages become to-dos. Tests run from your browser (each takes 10-30 seconds at Google). For Google's full free allowance (about
25,000 tests a day), add a free Google API key under **Settings → Free Google tools** (instructions there; no billing needed).

## Is this page in Google? (free)

**Site health → In Google** uses Search Console's URL Inspection (free, up to 2,000 checks a day per property, through the same Search Console
connection) on your homepage and the pages Google sends the most visitors to. For each page it shows whether it's in Google's index, when Google
last read it, whether Google chose a different main (canonical) page than yours, and rich-result issues, with every Google status explained in
plain words and a fix ("Crawled, currently not indexed" = Google read it but didn't think it was worth indexing). Pages left out on purpose
(noindex, redirects, alternates) are listed separately. Important pages that aren't in Google, and canonical mismatches, become to-dos. Pages checked in the last 3 days are skipped (tick "include" to recheck them); earlier problems,
new or changed pages and pages losing traffic are checked first. Each page keeps a short history, so the tab shows changes ("Dropped out of
Google", "Now in Google") and drop-outs become urgent to-dos. **Check in Google** in Site health's page details checks one page. The weekly
Netlify check also inspects up to 5 due important pages and reports drop-outs in the weekly summary, email and chat alerts.

## Instant indexing with IndexNow (free)

**Websites → Instant indexing (IndexNow)** tells Bing, Yandex, Seznam, Naver and other participating search engines about new or changed pages
straight away (Bing's index also feeds ChatGPT search and Copilot). Google doesn't use IndexNow. Create a key, upload the key file to your site's
root (WordPress: your host's file manager or Microsoft's IndexNow plugin; Shopify and Webflow don't allow root files), click **Verify**, then
submit pages in a batch ("pages changed in the last 7 days") or with **Notify search engines** on a live page. Every submission and the search
engine's answer is logged. Requests go through `netlify/functions/indexnow.mjs`, which only accepts addresses on the website's own domain.


Pages are added to **Waiting to be sent** automatically when an approved page gets a live address, a live page is approved again after
changes, or a published WordPress post is updated (drafts aren't sent). **Submit all** sends them in one request; with **Notify automatically**
they're sent as soon as they're added. A page sent in the last 24 hours isn't sent again unless its content changed.
## Bing data (free)

Add a free Bing Webmaster API key under **Settings → Google & Bing** (Bing Webmaster Tools → Settings → API access; add your site
there first, or import it from Google Search Console). The **Google search** screen then shows a Bing section: clicks and appearances for the last
28 days against the 28 before, a daily chart, top searches and pages, searches where Bing sends visitors but Google doesn't, pages Bing couldn't
read, and today's URL submission allowance. Bing also powers ChatGPT search and Copilot. Data refreshes once a day when you open the screen;
Bing crawl errors become to-dos, and Ask AI can answer Bing questions. Each refresh adds Bing's daily numbers to a stored history (up to 2 years), shown as clicks by month. **Bing vs Google,
per page** compares each page's share of clicks on each engine and lists pages much stronger on one than the other. Daily refreshes use 3 requests;
crawl data and the submission allowance refresh every 3 days (the Refresh button gets everything). A 25%+ drop in Bing clicks becomes a to-do. Requests go through `netlify/functions/bing.mjs` (read-only reports only).

## Page history (free)

**Page history** (under Measure) uses the Internet Archive's free Wayback Machine for any page, yours or a competitor's: how many distinct
versions were archived and when, a comparison of two versions (title, description, H1, word count, sections added and removed, and sentences
added and removed), and the text of any version, which you can copy, add to the knowledge base or open in Review a draft (useful for recovering
deleted pages). Site health's page details have a **See history** button. Versions already read are cached in your browser (not synced; the latest 60), so reopening them is instant. For pages
flagged by Content decay, **Compare before and after the traffic drop** compares the versions either side of when clicks began to fall (Content
decay's **See history** opens straight into this). **Title and heading changes over time** reads up to 12 versions spread across the history and
highlights when the title, H1, length or sections changed. Requests go through `netlify/functions/wayback.mjs`, which only
contacts web.archive.org.

## Real questions (free)

**Keywords → Real questions** searches Stack Exchange's Q&A sites (Stack Overflow, Super User, Web Applications, Software Recommendations and
more; the right ones are ticked for your type of website) with the free Stack Exchange API, straight from the browser (about 300 searches a day
per network, no key). Each question shows its views, votes, whether it was answered well, and whether your site already answers it; unanswered
popular questions come first. Save questions to the website's question bank (shared with the team), start a page from one, or use
**Add saved questions as FAQ ideas** in Write a page. Best for software, technical and how-to topics. Searches are cached in your browser for 24 hours (repeats use none of the daily allowance), and Stack Exchange's "back off"
signal is respected. **Group similar questions** (on by default) joins questions about the same thing into one topic with combined views. Pages
you've written in the tool count too: a question answered by one of their headings or FAQs shows "In a page you wrote".

## Topic facts (free)

**Keywords → Topic facts** looks a topic up on Wikipedia (in your site's language, straight from the browser): the article's summary, its
subtopics (sections) marked by whether your site covers them, and key Wikidata facts (founded, founder, headquarters, industry, website,
developer, release dates…) with source links. Add the facts to the knowledge base or the subtopics to Write a page notes. On written pages,
**Check names and dates against Wikidata** finds the organisations and products a page mentions (places and people are skipped) and flags
sentences whose founding year or headquarters differ from Wikidata, as things to check rather than definite errors. Lookups are cached for 7 days in your browser, and the page check is batched (names resolved as titles together, a search only
for unclear names, and all facts in one request: typically about 5 requests instead of 4 per name). Newly written pages are checked automatically
(at most 8 seconds, not in Demo mode), and any conflicts appear in the page's warnings.

## Internal link map (free)

**Site health → Links** maps how your pages link to each other, from the pages read: orphan pages (nothing links to them), pages 4 or more clicks
from the homepage, average clicks from home, most and least linked pages, and an interactive map (size = links in, colour = site section,
red outline = orphan; click a page for its details). **Suggested links** say which related page should link to a page that needs it, with what
words and in which sentence, with a Copy button. When only part of the site was read, unlinked pages are labelled "no links from the pages read"
(they may be linked from pages not read) and orphan to-dos are only created once at least 80% of the site has been read. Reading the website
again records links inside the content separately from menu links, for better suggestions. The map is worked out once and reused until pages are read again or new Google data arrives (**Recalculate** forces it).
Suggestions are grouped by the page to edit, prefer source pages that already get Google traffic, and use at most 3 per page and never the same
sentence twice. **Copy as a list** gives ready-to-send instructions; **Make it a to-do** keeps them on the to-do list until the links exist. After
reading the site again, the tab shows how many earlier suggestions were added.

## Content decay (free)

**Performance → Content decay** finds pages losing Google clicks. With the Search Console connection it reads each page's clicks for the last
6 full months (one request per month) and flags pages down 30% or more from their peak that are still falling; with zip imports only it compares
the two latest periods. Each page shows a sparkline, peak → latest clicks, when the fall began, and the likely cause from the data: rankings fell
(position dropped), fewer people search (appearances down, position steady), searchers click other results (click rate down, position steady),
a Google update that ran as the drop began, or an out-of-date page (old year in the title, old date). **Which searches were lost?** lists the
searches the page lost; **Refresh this page** opens Check a keyword for the top lost search (then "Get an update plan"); **See history** shows
what changed on the page. Declining pages become to-dos. Completed months are kept (in your browser, and separately by the weekly job), so after the first check only new months are
fetched. Pages that have fallen two months in a row but aren't yet 30% down are shown as **Early warning**. The weekly Netlify check works out
content decay too and reports newly declining pages in the weekly summary, email and chat alerts.

## Competitor tracking (free)

**Competitors** (under Measure) tracks up to 10 competitor websites per website through their public sitemaps (robots.txt, sitemap indexes,
up to 10,000 pages each): new pages (with titles), updated pages and removed pages since the previous check. Each new page is labelled
against your keywords and pages: your keyword with no page yet, your keyword where you have a page, a topic you cover, or a new topic.
New competitor pages on your keywords where you have no page become to-dos. **Check now** works in the browser; the weekly Netlify check
also checks up to two due competitors per website when there's time, and adds a line to the weekly summary and email. Logic shared by both:
`public/js/competitors-core.mjs`. Compressed (.gz) sitemaps are skipped. Sitemap files whose last-changed date (in the sitemap index) hasn't changed aren't downloaded again; their pages come from the
stored snapshot. Each competitor shows what it has been publishing about in the last 30 and 90 days (topics matching your keywords highlighted),
and **New pages from all competitors** lists the last 30 days across all of them, pages on your keywords with no page of yours first.

## Site migration planner (free)

**Site migration** (under Measure) protects Google traffic when page addresses change. 1) Load the current pages: your sitemap (up to 10,000)
plus every page with Google traffic and the pages read. 2) Add the new addresses: paste, upload a list, or read the new site's sitemap.
3) Review the matches (no AI): same address, same page name, similar words, parent section, or no good match; pages that need a look
(especially those with Google traffic) come first, and every target can be edited or marked Gone (410). 4) Export the redirects for Netlify
(`_redirects`), Apache, Nginx, the WordPress Redirection plugin, or CSV. 5) After launch, **Check the redirects**: every old address is
followed hop by hop (`netlify/functions/redirects.mjs`) to catch wrong targets, chains, temporary 302s, loops, missing redirects and dead ends.
Problems become to-dos.


Matching uses an index of address words, so large sites (10,000 old × 10,000 new pages) match in about a second, falling back to a full
comparison only for pages whose shortlist found nothing good. **Improve matches using page titles** reads the titles of the likeliest new pages
for unmatched pages with Google traffic (up to 100) and matches renamed pages by title. After the first redirect check, **Check again** re-tests
only redirects with problems, rows edited since, and rows never checked. A progress summary shows planned, working, broken and unchecked redirects.
## Structured data checker (free)

**Site health → Structured data** reads your homepage and top pages (up to 50) and checks their JSON-LD against Google's published rich
result requirements: Article, Product, Review, FAQ, HowTo, Organization, LocalBusiness (and its subtypes), BreadcrumbList, VideoObject, Event,
Recipe, SoftwareApplication and JobPosting. Errors (missing required fields, invalid dates, relative URLs, prices with currency symbols,
lowercase currency codes, ratings out of range, invalid JSON) block rich results; recommendations are optional fields. Each type shows how many
pages qualify; FAQ and HowTo carry Google's current restrictions. Each error type becomes one to-do listing the affected pages. Microdata and RDFa
are detected but not checked in detail. Google's Rich Results Test has no API, so double-check important pages there. Pages checked in the last 24 hours are reused unless you tick the option; a fingerprint of each page's markup shows which pages
changed and which errors were fixed since the previous check. **Get fixed JSON-LD** gives a corrected, ready-to-paste version for pages with
errors (prices, currency codes, relative addresses, dates, durations, breadcrumb positions, and unfilled template placeholders such as
{{SEO Description}}), and lists what needs your input instead of guessing. The structured data generated for your written pages is checked with
the same rules, and errors appear in the page's warnings.

## Duplicate content finder (free)

**Site health → Duplicates** compares the text of every page read, with no AI, using compact fingerprints the reader stores for each page
(MinHash over 5-word sequences: 64 numbers per page, plus paragraph fingerprints). It finds groups of near-duplicate pages, with how alike they
are and a suggestion: merge and redirect (or set one main page with a canonical tag), rewrite each page with its own details, keep an ad landing
page out of Google with noindex, or nothing (already handled by canonical tags). It also lists paragraphs repeated on several pages (menus and
footers on nearly every page are ignored) and titles and descriptions used more than once. Other-language versions aren't counted as duplicates.
Near-duplicate groups and duplicate titles become to-dos. Pages read before this feature are compared on their first ~400 words; read the website
again for full-text comparisons.


Template text is discounted: paragraphs on most pages of a section (or 40% of the site) are treated as template, and similarity is adjusted to the
content that isn't template, so pages that only share a template aren't flagged. **Compare side by side** reads two pages live and lists the
sentences they share and what is unique to each.
## External links (free)

**Site health → External links** checks the links from your pages to other websites (recorded when pages are read; up to 30 per page, marking
whether each is in the content or in menus and footers). Each link is followed hop by hop (through the redirect checker) and judged: broken
(404, 410, site gone), now leading to a different website (a domain may have changed hands: possible spam), page removed (a deep link that now
redirects to the homepage), moved permanently (update the link), server error, or couldn't check (sites that block automated checks aren't
counted as broken). http → https and "www" changes count as working. Each problem lists the pages containing the link; broken links and domain
changes become to-dos. Up to 500 links per check. Links that worked in the last 7 days are reused (tick "check everything" to force a full check); problems and new links are
always checked. After the website is read again, links never seen before are checked automatically in the background. Several broken links to the
same website are grouped (it may have reorganised), and checks are spread so no website gets more than 2 requests at a time.

## Chat alerts: Slack, Microsoft Teams, Google Chat (free)

**Settings → Alerts → Chat alerts** sends messages to your team's chat through incoming webhooks: the weekly check summary,
urgent problems (when the weekly check or "Run the check now" finds them), and pages ready for review. Choose per channel which messages it gets,
and use **Send test message** to check it. Webhook addresses are secrets, so they're stored encrypted (AES-256-GCM, keyed from AUTH_SECRET or
TEAM_PASSWORD) by `netlify/functions/notify.mjs`; the browser only sees a shortened version. Only https addresses from Slack, Teams (Workflows)
and Google Chat are accepted, each webhook gets at most 30 messages an hour, and only owners and admins can add or change channels. Needs team
sync or accounts. If you change AUTH_SECRET or TEAM_PASSWORD, add the webhooks again. Urgent alerts within 10 minutes of the last one are combined into one message, the same alert isn't repeated within 24 hours,
and each channel can have **quiet hours** (in your time zone) when urgent alerts are held. Netlify functions can't wait, so held alerts go out
combined with the next hourly scheduled run; the weekly summary is never held.

## Google Analytics 4 (free)

**Performance → Google Analytics** connects GA4 with the same Google setup as Search Console (read-only; the permission is stored encrypted).
In your Google Cloud project, also enable the **Google Analytics Data API** and **Google Analytics Admin API**, and add the
`https://www.googleapis.com/auth/analytics.readonly` scope to the OAuth consent screen; nothing else changes. The tool picks the property matching
the website, then shows landing pages with sessions, engaged sessions, key events (conversions), conversion rate and revenue, for organic search
or all traffic, over 28, 90 or 180 days, with Google clicks alongside. **Promote these** lists pages that convert well but get few visitors;
**Improve these** lists pages with many visitors but few conversions (these also become to-dos). Older properties that still call key events
"conversions" are handled automatically. Ask AI can answer questions about conversions, sign-ups, sales and revenue. Every figure is compared with the period before (one request with two date ranges), with the pages whose conversions fell or
rose most. Choose which key event counts (for example only "purchase" or "sign_up"). **Visitors from AI assistants** shows sessions and
conversions from ChatGPT, Perplexity, Gemini, Copilot, Claude and similar. Data refreshes once a day when you open the screen; the weekly check
refreshes it for the team and reports a 25%+ fall in conversions from Google search. Live pages in My pages show their own visits and conversions.

## Refresh drafts (tracked changes)

**Create a refresh draft** (Content decay, or Site health's page details) reads the live page and writes an updated version that changes only
what needs changing: outdated years and facts (from your knowledge base, or marked [CHECK]), sections answering the searches the page lost, a
clearer title and description. With Search Console connected, the lost searches are fetched automatically. The draft opens in My pages as
**tracked changes**: each change (a paragraph, or a section with its heading) highlighted word by word, to **Accept**, **Reject** or **Edit**;
title and description changes too. A before/after box shows word counts and how many lost searches each version covers. **Apply my decisions**
saves the result and checks it like any edit; the original stays in Version history and the live page isn't touched. **Refresh the top 3**
creates drafts for the pages losing the most clicks.

## Editorial calendar

**Calendar** (under Plan) shows the content plan as a board: Idea → Brief → Writing → Review → Approved → Published, with owners and due dates,
shared with your team. Every page you write gets a card automatically and moves as it's reviewed, approved and published (live). Add cards
from Keywords (**Add to calendar**), content ideas, or **Add card**; drag Idea, Brief and Writing cards between those columns or use their menu;
**Write this page** opens Write a page with the keyword. Edit the owner and due date on the card. Filter by owner, **Mine** or **Overdue only**,
switch to the **Month** view, or **Download calendar (.ics)** for Google Calendar, Outlook or Apple Calendar. Overdue cards become a to-do and
appear in the weekly summary. The calendar extends the content plan (no duplicate lists).

## Content briefs

**Brief** (on calendar cards and keywords) writes a brief for a writer from what the tool knows: what currently ranks (if the keyword was
checked), Wikipedia subtopics, real questions from your question bank, related searches from Search Console, your knowledge base and your
related pages. It covers title ideas, who is searching, the angle, an outline with notes, questions to answer, facts and sources, what to
include and avoid, internal links and the call to action, plus the writer and due date from the calendar card. Briefs are shared with your team
(Calendar → Briefs); **Edit**, **Copy**, **Download (.md)**, or **Share link for the writer** (read-only, no account, 60 days, not indexed by search
engines). **Write a page from this brief** puts it in the notes; the page then shows how much of the brief it covers and what's missing.

## Rank tracking (free)

**Performance → Rankings** shows each keyword's average Google position day by day for 90 days, from your Search Console connection (one request
for all tracked keywords, refreshed daily): position over 7 days, change over 7 and 28 days, a 90-day sparkline, clicks, and the ranking page.
Pages that take turns ranking for the same keyword are flagged ("pages compete"). Click a keyword for its chart, with each day's ranking page
coloured. Optionally also track your 50 most-shown Google searches. A weekly chart shows how many keywords are in the top 3, 4-10, 11-20 and beyond;
**Download CSV** exports the table. The weekly Netlify check reports keywords with real traffic that fell 3 or more places over 28 days. Zip exports
don't contain daily data per search, so this needs the Search Console connection.

## Chart annotations

Notes mark what happened when on the Home and Google search click charts, the ranking charts and the Bing chart (dotted lines; hover for
details). Add your own under the Google search chart (or click the chart on a day), shared with your team. Pages published or refreshed in the
tool, competitor publishing bursts (5+ new pages) and site migration checks are added automatically; Google updates stay as shaded bands. Each
note shows Google clicks in the 14 days after compared with the 14 days before, you can choose which kinds of marker to show, and Ask AI uses the
timeline when asked why traffic changed.

## AI-answer readiness

**AI answers → Ready to be cited by AI?** reads robots.txt and shows, for each AI crawler, whether it may read the site, separating answer
and search bots (OpenAI's OAI-SearchBot and ChatGPT-User, Claude-SearchBot, PerplexityBot, Bingbot for Copilot, Googlebot; blocking these keeps
you out of AI answers, and becomes an urgent to-do) from training bots (GPTBot, ClaudeBot, Google-Extended, CCBot and others; blocking these is a
business choice and doesn't stop citations). It generates an **llms.txt** (llmstxt.org) from your site's details and top pages, and if you
already have one, lists top pages missing from it and links in it that are broken (checked, not guessed). Your top pages get a readiness
score: a direct answer near the top, question-style headings, facts and figures, a visible recent date, an author, structured data, and depth.
**Suggest fixes** writes a direct-answer opening, question headings and facts to state, from the page's own text. Pages with traffic and a low
score become to-dos; the score is tracked over time. The website reader now records published and updated dates.

## Image SEO

**Site health → Images** checks every image the reader recorded (up to 25 per page): missing or poor alt text, large files (over 300 KB; over
1 MB is urgent), old formats where WebP or AVIF would be smaller, missing width and height, the first image lazy-loaded, and images that don't
load. Sizes come from headers; when a server sends no size, the checker counts bytes up to 3 MB (images only). Slow servers are reported as
"couldn't check", never as broken, and get one retry. Images with smaller versions (srcset) are marked as such, since most visitors download
less. **Write alt text** suggests alt text from the file name and surrounding text (the image itself isn't sent; check each one), with a CSV
download. Results from the last 7 days are reused; an estimated saving is shown; page details list that page's image problems; and pages you
write get a warning for images without alt text. Broken and over-1-MB images become to-dos.

## Sitemaps and robots.txt

**Site health → Sitemaps & robots.txt** reads your sitemaps (from robots.txt or the usual locations) and checks: whether robots.txt lists
them, the 50,000-address limit, last-changed dates (missing, in the future, all the same, or older than the page's own update), important pages
missing from the sitemaps (Google clicks or several internal links), entries that shouldn't be there (noindex, canonical elsewhere, redirects,
errors; up to 100 addresses checked), and robots.txt rules that block Google from important pages or from CSS and JavaScript. With Search Console
connected it also shows the sitemaps Google has: when it last read them, errors and warnings, and submissions that no longer exist. **Download
fixes for your developer** gives a CSV of what to add, replace or remove. Problems become to-dos.

## Comments, suggestions and approval steps

In **My pages**, every paragraph has **Comment** and **Suggest**. Comments have replies and can be resolved; a suggestion shows the proposed
wording word by word and can be accepted (the paragraph changes, a version is saved and the page is checked again) or rejected. Comments stay
attached to their paragraph, and are kept under "On text that has since changed" if it's edited. Each comment and reply is its own record, so
teammates commenting at the same time never overwrite each other. Write **@Name** to mention someone: it appears under **For you** on their Home
and in chat alerts set to "Reviews & mentions". **Approval steps** (per website, e.g. `Expert (Priya), Legal (Rahul), Marketing`) are signed off
in order; a name in brackets puts the page on that person's Home when it reaches their step; a page can only be approved when every step is
signed off, and editing the page clears earlier sign-offs. Optionally, all comments must be resolved before approval. My pages shows each page's
open comments.

## Screen layout notes

The Google search screen has tabs: Overview (key numbers and the clicks chart), Searches & pages (devices, countries, brand vs topic,
rising and falling searches, opportunities, topics), Content decay, Analytics, Bing, and Import & connect. A status line at the top shows which
data sources are set up; it opens on Import & connect until there's data, then on Overview. Site health has six main tabs (Problems, Pages,
Speed, Indexing, Links, Content) with sub-tabs and problem counts. Sidebar groups fold (remembered); Check a keyword is on Keywords and Review a
draft is in My pages. Settings has four tabs (AI, Google & Bing, Alerts, Team & data), each showing whether it's set up. Weekly monitoring has one
panel (Settings → Alerts): on/off, emails, the day, which websites, and "only email when something needs attention"; the weekly Netlify check
honours the day (running at the next opportunity if a week was missed) and only checks the chosen websites. Press **Ctrl+K** (⌘K on Mac) or use the search box at the top of the sidebar to jump to any screen, tab or main action by typing
everyday words (for example "llms", "lcp", "alt text", "slack" or "brief"); arrow keys and Enter choose, Esc closes, and recent places show
when the box is empty.

## Testing-only settings (never set these on a live site)

The code also reads switches used only by the local test server. They point the app at stand-in services, or let it reach private network
addresses. **Leave all of them unset in Netlify**: without them the app uses the real services and refuses private addresses, which keeps it safe.

- Let the server reach private addresses: `FETCH_ALLOW_LOCAL`, `CMS_ALLOW_LOCAL`, `INDEXNOW_ALLOW_LOCAL`, `MONITOR_ALLOW_LOCAL`
- Stand-in services: `GSC_API_BASE`, `GSC_INSPECT_BASE`, `GA_DATA_BASE`, `GA_ADMIN_BASE`, `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_REVOKE_URL`,
  `GOOGLE_STATUS_FEED`, `BING_API_BASE`, `WAYBACK_BASE`, `INDEXNOW_ENDPOINT`, `RESEND_BASE`, `TAVILY_BASE`, `BRAVE_BASE`
- Chat alert testing: `NOTIFY_TEST_SINK`, `NOTIFY_COMBINE_MS`

## Weekly monitoring

Once a week (on the day you choose), even with no browser open, each website gets a quick check and you get an email:
key pages (the homepage, top pages by Google clicks, and pages read from the site; up to 25) are checked for errors, a new noindex, title or
canonical changes and new redirects; Google clicks for the last 7 days are compared with the week before (needs the Search Console connection),
with the pages losing the most; new Google ranking updates are listed; and pages waiting for approval and overdue to-dos are counted.
Results also appear on Home and in **Settings → Alerts**, where **Run a check now** checks instantly.

Setup:
1. Turn on **team sync** or **accounts** (the check works on the data your browsers share with the server).
2. Email: create a free account at **resend.com**, add and verify your sending domain, create an API key, then in Netlify add
   `RESEND_API_KEY` and `MONITOR_FROM` (for example `Content Engine <alerts@yourdomain.com>`). Redeploy.
3. In **Settings → Alerts**: recipients, the day, which websites, then **Turn on** and **Save**.
Links in emails, reports and chat alerts use the app's address, which Netlify provides automatically as `URL`; set `APP_URL` only if you use a different address (for example a custom domain added later).

How it runs: Netlify runs `netlify/functions/monitor.mjs` every hour; each run checks only websites that are due (the chosen day, not yet checked
that week), a few at a time, because scheduled functions have a 30-second limit. Only pages on the website's own domain are checked, so a
mismatched Search Console property can't cause false alarms. Tick "Only email when something needs attention" for quiet weeks.

## Search Console connection

Connect each website to Google Search Console once; the data then refreshes itself (daily, when you open Google search) and includes
search + page combinations, so the **competing pages** view works. Access is read-only. One-time setup (about 15 minutes):

1. Go to **console.cloud.google.com** → create a project (for example "Content Engine").
2. **APIs & Services → Library** → search **Google Search Console API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - **User type: Internal** if everyone uses a Google Workspace account in your organisation (recommended: no review, connections don't expire).
   - Otherwise **External**. While the app is in **Testing**, add each person's Google address under **Test users**. Note: Google ends
     test-mode connections after **7 days**, so people reconnect weekly. To avoid that, publish the app (Google reviews apps that read
     Search Console data, which can take several weeks).
   - Add the scope `https://www.googleapis.com/auth/webmasters.readonly`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → **Web application**.
   - **Authorised redirect URI:** `https://YOUR-SITE.netlify.app/api/gsc/callback` (use your real address; add your custom domain too if you have one).
5. Copy the **Client ID** and **Client secret** into Netlify → Environment variables as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Redeploy.
6. In Content Engine: **Performance → Connect with Google**, sign in with an account that can see the website in Search Console.

The tool picks the matching property automatically (you can change it), imports the last 90 days and the 90 days before for comparison.
Google's long-lived permission is encrypted on the server (AES-256-GCM, key derived from your client secret) and only the encrypted form is kept
in the browser; nothing is stored on the server. **Disconnect** revokes the permission. If you change the client secret, people reconnect once.

## Publishing to WordPress

Approved pages can be sent to WordPress **as drafts** (or pending review): someone always presses Publish in WordPress.
1. In WordPress: **Users → Profile → Application Passwords**, create one named "Content Engine" (an Editor or Administrator account).
2. In Content Engine: **Websites → Publishing**, enter the WordPress address, username and application password, choose posts or pages and an optional
   category, then **Test and save**.
3. Open an approved page in **My pages** and click **Send to WordPress as a draft**. Sending again updates the same post (if it was deleted in WordPress,
   a new draft is created).
The title, URL slug, content (the H1 is removed because WordPress shows the title), excerpt from the meta description, FAQ and optional structured data
are sent. Connection details stay in your browser only. Requests go through the site's `/api/cms` function, which never stores them and refuses
private network addresses.

## Ask AI

**Ask AI** (under Overview) is a chat about the selected website. For each question the tool adds only the relevant data: the website basics and
brand style, matching pages, knowledge base passages, and, depending on the question, Google search data, site health, the to-do list, pages
written in the tool and AI-answer results. Answers cite numbered sources, which are listed underneath, and say plainly when the tool doesn't have
the data. The last 10 messages are remembered. Answers can be copied or used to start a page. Conversations are personal: they stay in your
browser and aren't shared through team sync. View-only roles can use it too.

## Repurposing

Open an approved page in **My pages → Repurpose for other channels** to create a LinkedIn post, an X (Twitter) thread, a newsletter section,
a short video script (scenes with voiceover, on-screen text and what to show) and social snippets. Everything is written from the page's own facts
in its language and your brand style, with the page's address as the link. Any number that doesn't appear in the page is flagged, and channel
limits are checked (280 characters per X post, counting links as 23). Copy each piece, redo one format, or download them all.

**Voiceover preview:** the video script card plays the script with the browser's built-in voices (free; Chrome, Edge and Safari include
them), scene by scene or all at once, with a preview frame showing each scene's on-screen text and what to show. Voices for the page's language
come first, and the speed is adjustable. A timing check estimates how long each voiceover takes to say (by language and speed) against its planned
seconds, flags scenes that run long and checks the total against 60-90 seconds; measured times replace the estimates after playing. The words of the current scene are highlighted as they're spoken (estimated from the speed when a voice doesn't report word
positions). **Download subtitles (SRT)** exports the voiceover as timed captions (two lines of up to 42 characters), using measured scene lengths
when the script has been played. The chosen voice and speed are remembered per language.

## Reports

**Reports** (under Measure) builds a report for a period (last 30 days, this or last month, last 90 days, or custom dates) from the website's
own data: site health, Google search (clicks, views, position, daily chart, top searches, Google updates), AI answers (mention rate, share of voice,
cited sites), content written and approved, work done and next steps, and keywords. The summary is written automatically from the numbers, or by
the AI, and is editable. Add your branding (name, colour, logo) once. Then **Print or save as PDF**, **Download file** (one self-contained HTML file
with no external links or scripts), or **Create share link** (needs accounts or team sync): links are read-only, served with a sandboxed security
policy so no scripts can run, hidden from search engines, valid 90 days, and can be removed at any time.

## Knowledge base (per website)

**Knowledge base** in the menu holds the business's own material: quick facts ("Free trial: 14 days"), product or service details, case studies,
FAQs, data, brand voice and policies. Paste (Google Docs/Word formatting kept), upload text/Markdown/HTML/CSV files, or import a web page.
Documents are split into passages and ranked with BM25; the page plan gets the best passages for the topic and each section gets the best for its
heading, within a word budget (smaller for free models). Pages list the documents they used. Fact-checks confirm claims about the business from the
knowledge base, and flag claims whose numbers contradict it ("your knowledge base says $19"). **Test what the AI will find** shows the passages for
any topic. The knowledge base syncs with your team like everything else.

## Works for any kind of website

Set **Type of website** when adding a site (or let the tool detect it): software, online store, local business, publisher, agency,
education, health, finance or legal. It steers every page the AI writes: specifications and returns for shops, real locations and no doorway
pages for local businesses, original reporting for publishers. **Health, finance and legal** sites are "Your Money or Your Life" topics: their
pages are always fact-checked and flagged for review by a named, qualified professional.
Entering an address with a path (for example `example.com/es` or `example.com/blog`) reads only that language or section.
Sites that block automated reading (rate limits, bot protection) are reported as blocked, not as broken pages, and the reader slows down.


**Page types for every industry:** besides articles, guides and comparisons, Write a page offers product pages and category pages (online stores),
service pages and location pages (local businesses and services), news articles and first-hand reviews. Each has its own required structure and checks:
product pages need a specifications table and never show ratings unless they come from real reviews; category pages get a short, helpful intro;
reviews must explain how the product was tested; news articles cite sources. **Location pages** need at least three real local details (address,
opening hours, local team, nearby projects) and must use them; a location page that repeats more than half of another location page is blocked as a
doorway page. The menu suggests the page types that fit the website and the search intent. Structured data follows the page type (Product, NewsArticle…),
and prices and ratings are never added automatically.

**Other languages:** the checks work in any language. Japanese and Chinese are measured by characters (about two per word) and split
into two-character pieces for topic matching, as search engines do. Filler phrases are checked in English, Spanish, Portuguese, French, German,
Italian, Dutch, Japanese, Chinese and Hindi; generic headings ("Conclusión", "Fazit", "まとめ") and search intent ("cómo", "mejores", "precio",
"おすすめ", "料金", "kostenlos"…) are recognised in those languages too. The language of each page is detected automatically.

**Language versions:** open any page in **My pages → Language versions → Create a version in another language**. Choose the language and
market, click **Find the local keyword** (what locals actually search for, often not a literal translation), then **Create this version**.
The page is adapted, not translated word for word: local keyword, examples, units, dates and register, with every fact, price, link and
placeholder kept (unknown local details become [LOCALIZE: …] notes). The checks run in that language, and approval requires naming a fluent
reviewer, because mass-translated pages are treated as scaled content by Google. Versions are linked: add each version's page address to get
ready-made **hreflang** tags (including x-default) for all of them. One version per language and market; versions count towards the daily limit.
## Accessibility and phones

Every screen passes the axe-core accessibility checks in light and dark mode (text contrast meets WCAG AA, every control has a name).
Keyboard users get a "Skip to content" link, visible focus, focus moved to each screen's heading, and Escape to close the guided setup.
All screens fit a phone without sideways scrolling; wide tables scroll inside their own box. Large lists stay fast (tested with 3,000 keywords,
2,000 pages and 1,500 to-dos: every screen under a second); the keyword table shows 300 rows at a time with **Show more**.

## Accounts and workspaces (optional, recommended for teams and agencies)

Each person signs in with their own email and password, and data is separated into **workspaces** (for example one per client or brand).
1. In Netlify → Environment variables, add `AUTH_SECRET` (a long random text, at least 16 characters) and `AUTH_SETUP_CODE` (a code you choose). Redeploy.
2. Open the site: you'll see **Set up accounts**. Enter the setup code and create the first owner account and workspace.
3. In **Settings → Workspace and team**, invite people by email with a role, then send them the link (valid 7 days, works once).

| Role | Can do |
|---|---|
| Owner | Everything, including managing owners |
| Admin | Invite and manage members (not owners), create workspaces, edit everything |
| Editor | Create and edit content |
| Viewer | See everything, change nothing |
| Client | See results, change nothing; AI settings and costs hidden |

Roles are enforced on the server. Every change is listed in the workspace's **Activity** log. Passwords are stored only as scrypt hashes; sessions use
secure, HttpOnly cookies; 8 wrong passwords lock an account for 15 minutes; changing your password signs out your other devices. With accounts on,
website reading and the team's search key only work for signed-in people. Use **Bring this browser's earlier data** to move data you had before accounts.
Without `AUTH_SECRET`, the site works as before (single browser, or the shared team password below).

## Team workspace (optional)

Share websites, keywords, pages, plans and to-dos with your team, with an automatic cloud backup.
1. In Netlify: **Site configuration → Environment variables → Add a variable**: `TEAM_PASSWORD` = a long password. Then **Deploys → Trigger deploy**.
2. Each person: **Settings → Team & data**, enter the password and their name, click **Turn on team sync**.

Data is stored in **Netlify Blobs** (part of your Netlify site, via the `netlify/functions/sync.mjs` function). Changes sync every 2 minutes
and a few seconds after an edit. Lists merge item by item, so two people adding keywords at once both keep their additions, and hand edits
(owner, due date, notes, status) always beat automatic rebuilds. When two people edit the same item at the same moment, the latest save wins.
API keys and personal settings are never synced. Netlify installs the one dependency (`@netlify/blobs`) automatically when it deploys.

## Reliability

- **AI requests** retry automatically when a provider is busy or rate-limiting (429, 5xx, "overloaded"), following its Retry-After hint.
  They don't retry when your account is out of credit. Requests time out instead of hanging (4 minutes; 8 for full pages).
  A reply cut off by the length limit is retried once with more room. A **Stop** bar appears whenever the AI is working.
- **Usage** (requests, tokens, web searches, failures) is counted per provider per month under Settings.
- **Website reading** retries failed pages, slows down automatically when a site rate-limits it, caps very large sitemaps
  (80 files / 60,000 URLs), and can be stopped while keeping the pages already read. If a tab is closed mid-read, the site
  isn't left stuck: the previous read stays in use and a notice explains what happened.
- **Storage** asks the browser to keep data permanently, shows how much space is used, gives a clear message if storage
  is full, and keeps two open tabs in sync.
- **Page reading** picks the part of each page that really holds the text (empty `<main>` placeholders are skipped), and reads text from a
  page's embedded data when it only appears after JavaScript runs. Site health flags those pages, since many AI crawlers don't run JavaScript.
- **Google updates** come live from Google's Search Status Dashboard (refreshed every 12 hours), with a built-in list as a fallback.
- **Speed:** results are cached until the underlying data changes, so Home opens in about 0.1 s for a 1,000-page site.

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
