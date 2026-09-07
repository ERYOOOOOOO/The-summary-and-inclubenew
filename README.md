# KMITL CS News Board

A plain, one-page news board that collects KMITL news — with a filter for the
computer-science / IT ones — from **official sources**, shows **the date of every
story**, and links back to the original post.

- No colours, no images in the list, no framework. Black text, white paper.
- Works in Thai and English (button at the top right).
- Filter by source, search, sort by date, or show computer-science stories only.
- Every filter is stored in the URL, so a view can be copied and shared.

## Short answer to "is this possible?"

| Source | Possible? | How |
| --- | --- | --- |
| KMITL official website (`kmitl.ac.th`) | **Yes, working now** | The news pages are plain HTML; the article page carries a `schema:dateCreated` value, which is where the date comes from. |
| Faculty of IT official website (`it.kmitl.ac.th`) | **Yes, working now** | Same idea; the date comes from the `publishedAt` value on the post page. |
| Official Facebook pages | **Only with a token** | Facebook blocks scraping of `facebook.com` and their terms forbid it. The supported route is the Graph API with a **Page access token**, which normally only a page admin can issue. The code is ready for it — see below. Until you have one, add posts by hand. |

So: the website half is fully automatic. The Facebook half needs either a token
from whoever runs the page, or hand-entered posts.

## Run it

Node 18 or newer. No packages to install.

```bash
node scripts/aggregate.mjs   # collect the news  -> data/news.json
node scripts/serve.mjs       # open http://localhost:8080
```

Or with npm: `npm run update`, then `npm start`.

Opening `index.html` directly from the file system will **not** work — browsers
block `fetch()` on `file://` URLs, so the page could not read `data/news.json`.
That is what the small server is for.

Useful flags:

```bash
node scripts/aggregate.mjs --only it-event,kmitl-news   # refresh some sources
node scripts/aggregate.mjs --no-detail                  # skip the date lookup (faster)
```

## Publish it

`data/news.json` is committed, so the site is just static files.
On GitHub: **Settings → Pages → Deploy from a branch → `main` / root**.

`.github/workflows/update-news.yml` re-runs the collector every day at 08:00
Bangkok time and commits `data/news.json` when something changed.

## Facebook

Public Facebook pages cannot be read without permission. Two honest options:

**1. Graph API (automatic).** If you can get a Page access token for the page:

```bash
export FACEBOOK_PAGE_TOKEN='...'
node scripts/aggregate.mjs
```

In GitHub Actions, add it as a repository secret named `FACEBOOK_PAGE_TOKEN`.
Without the token those sources are reported as `skipped` in the footer of the
page — nothing is invented.

**2. By hand.** Put posts in `data/manual.json`:

```json
[
  {
    "title": "IT KMITL open house 2026",
    "url": "https://www.facebook.com/itkmitl/posts/…",
    "source": "Faculty of IT (KMITL) Official Facebook Page",
    "kind": "facebook",
    "date": "2026-09-01T09:00:00Z",
    "summary": "Optional short description."
  }
]
```

Only `title` and `url` are required.

## Adding or changing a source

Everything lives in `sources.json` — no code changes needed.

| Type | What it does |
| --- | --- |
| `html` | Fetches a listing page, pulls each card out with the `item` regex, then reads the link/title/category out of that card. If `detailDate` is set it opens each article once to read the publish date. |
| `rss` | Reads an RSS or Atom feed. |
| `facebook` | Facebook Graph API, needs the token above. |
| `manual` | Reads `data/manual.json`. |

A minimal `html` source:

```json
{
  "id": "my-source",
  "name": "Some KMITL department",
  "kind": "website",
  "type": "html",
  "enabled": true,
  "listUrl": "https://example.kmitl.ac.th/news",
  "origin": "https://example.kmitl.ac.th",
  "limit": 20,
  "item": "<article[\\s\\S]*?</article>",
  "link": "<a href=\"([^\"]+)\"",
  "title": "<h2[^>]*>([^<]+)</h2>",
  "detailDate": ["\"datePublished\"\\s*:\\s*\"([^\"]+)\""]
}
```

Remember these are JSON strings holding JavaScript regexes, so every `\` has to
be written `\\`.

Dates that fail to parse, or that land outside a sensible year range, are stored
as `null` and shown on the page as "no date given" rather than as a wrong date.

### The "computer science only" filter

`csKeywords` in `sources.json` is the word list. Any story whose title, summary,
category or source name contains one of those words is tagged `cs: true`. Nothing
is thrown away — the tag only drives the checkbox on the page, so widening or
narrowing the list is safe.

## Layout

```
index.html              the page
assets/styles.css       all of the styling
assets/app.js           filtering, search, Thai/English, date formatting
sources.json            which sites are read, and how
data/news.json          the collected news (generated, committed)
data/manual.json        hand-added posts
scripts/aggregate.mjs   the collector
scripts/serve.mjs       small static server for local use
```

## Please note

This board stores only a title, a date, a short summary and a **link**. It does
not copy full articles or photos, and it links every story back to the source it
came from. Keep `limit` modest and the schedule to about once a day so the
university's servers are not hit harder than a normal reader would hit them.
