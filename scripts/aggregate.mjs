#!/usr/bin/env node
// Collects KMITL news from the official website(s) and the official Facebook
// pages, and writes everything into data/news.json for the site to read.
//
//   node scripts/aggregate.mjs            refresh everything
//   node scripts/aggregate.mjs --only it-event,kmitl-news
//   node scripts/aggregate.mjs --no-detail   skip the per-article date lookup
//
// No npm packages needed. Node 18+ (uses the built-in fetch).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'news.json');
const UA = 'kmitl-cs-news-board/1.0 (student project; aggregates public university news)';

const args = process.argv.slice(2);
const only = flagValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const skipDetail = args.includes('--no-detail');

function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, 'sources.json'), 'utf8'));
  const previous = await readPrevious();
  const knownDates = new Map(previous.map((it) => [it.url, it.date]));

  const report = [];
  const items = [];

  for (const source of config.sources) {
    if (source.enabled === false) continue;
    if (only && !only.includes(source.id)) continue;

    const started = Date.now();
    try {
      const collected = await collect(source, knownDates);
      items.push(...collected);
      report.push({
        id: source.id,
        name: source.name,
        kind: source.kind,
        status: 'ok',
        count: collected.length,
        ms: Date.now() - started,
      });
      log(`ok    ${source.id.padEnd(14)} ${collected.length} item(s)`);
    } catch (err) {
      const note = err?.skipped ? 'skipped' : 'error';
      report.push({
        id: source.id,
        name: source.name,
        kind: source.kind,
        status: note,
        count: 0,
        message: String(err.message || err),
      });
      log(`${note.padEnd(5)} ${source.id.padEnd(14)} ${err.message}`);
    }
  }

  const merged = dedupe(items)
    .map((item) => ({ ...item, cs: looksLikeCS(item, config.csKeywords || []) }))
    .sort(byNewest);

  const payload = {
    generatedAt: new Date().toISOString(),
    itemCount: merged.length,
    sources: report,
    items: merged,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const dated = merged.filter((i) => i.date).length;
  log('');
  log(`wrote ${path.relative(ROOT, OUT)} — ${merged.length} item(s), ${dated} with a date`);
  log(`computer-science related: ${merged.filter((i) => i.cs).length}`);
}

async function readPrevious() {
  if (!existsSync(OUT)) return [];
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf8'));
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function collect(source, knownDates) {
  switch (source.type) {
    case 'html':
      return fromHtml(source, knownDates);
    case 'rss':
      return fromRss(source);
    case 'facebook':
      return fromFacebook(source);
    case 'manual':
      return fromManual(source);
    default:
      throw new Error(`unknown source type "${source.type}"`);
  }
}

/* ------------------------------------------------------------------ fetch */

async function get(url, { headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'th,en;q=0.8', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/* ------------------------------------------------------- HTML page adapter */

async function fromHtml(source, knownDates) {
  const html = await get(source.listUrl);
  const blocks = matchAll(html, source.item, 'gs');
  const seen = new Set();
  const items = [];

  for (const block of blocks) {
    const href = firstGroup(block, source.link);
    const title = clean(firstGroup(block, source.title));
    if (!href || !title) continue;

    const url = absolute(href, source.origin || source.listUrl);
    if (seen.has(url)) continue;
    seen.add(url);

    items.push({
      id: hash(url),
      title,
      url,
      sourceId: source.id,
      source: source.name,
      sourceTh: source.nameTh || source.name,
      kind: source.kind,
      category: clean(firstGroup(block, source.category)) || null,
      image: source.image ? absolute(firstGroup(block, source.image), source.origin) : null,
      summary: clean(firstGroup(block, source.summary)) || null,
      date: toIso(firstGroup(block, source.date)),
    });

    if (items.length >= (source.limit || 20)) break;
  }

  if (!skipDetail && source.detailDate?.length) {
    await fillDates(items, source, knownDates);
  }
  return items;
}

// Cards usually do not carry the publish date, so open each article once and
// read it from the page. Dates already known from the last run are reused.
async function fillDates(items, source, knownDates) {
  const pending = items.filter((item) => {
    const cached = knownDates.get(item.url);
    if (cached) {
      item.date = cached;
      return false;
    }
    return !item.date;
  });

  const queue = [...pending];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const page = await get(item.url);
        for (const pattern of source.detailDate) {
          const iso = toIso(firstGroup(page, pattern));
          if (iso) {
            item.date = iso;
            break;
          }
        }
      } catch {
        // A single unreachable article should not fail the whole source.
      }
    }
  });
  await Promise.all(workers);
}

/* --------------------------------------------------------------- RSS/Atom */

async function fromRss(source) {
  const xml = await get(source.listUrl);
  const entries = matchAll(xml, '<(?:item|entry)\\b[\\s\\S]*?</(?:item|entry)>', 'gs');
  const items = [];

  for (const entry of entries) {
    const title = clean(tagText(entry, 'title'));
    const url =
      clean(tagText(entry, 'link')) ||
      firstGroup(entry, '<link[^>]*href="([^"]+)"');
    if (!title || !url) continue;

    items.push({
      id: hash(url),
      title,
      url,
      sourceId: source.id,
      source: source.name,
      sourceTh: source.nameTh || source.name,
      kind: source.kind,
      category: clean(tagText(entry, 'category')) || null,
      image: null,
      summary: truncate(plain(tagText(entry, 'description') || tagText(entry, 'summary'))),
      date: toIso(tagText(entry, 'pubDate') || tagText(entry, 'published') || tagText(entry, 'updated')),
    });

    if (items.length >= (source.limit || 20)) break;
  }
  return items;
}

/* --------------------------------------------------------------- Facebook */

// Facebook only allows this through the Graph API with a Page access token.
// Scraping facebook.com directly is blocked and against their terms, so when
// there is no token the source is skipped instead of faked.
async function fromFacebook(source) {
  const token = process.env[source.tokenEnv || 'FACEBOOK_PAGE_TOKEN'];
  if (!token) {
    throw Object.assign(
      new Error(
        `no ${source.tokenEnv || 'FACEBOOK_PAGE_TOKEN'} set — see README "Facebook". ` +
          `Posts can still be added by hand in data/manual.json.`,
      ),
      { skipped: true },
    );
  }

  const version = process.env.FACEBOOK_API_VERSION || 'v21.0';
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(source.pageId)}/posts` +
    `?fields=id,message,created_time,permalink_url,full_picture` +
    `&limit=${source.limit || 15}&access_token=${encodeURIComponent(token)}`;

  const body = JSON.parse(await get(url));
  if (body.error) throw new Error(`Graph API: ${body.error.message}`);

  return (body.data || []).map((post) => {
    const message = clean(post.message || '');
    return {
      id: hash(post.permalink_url || post.id),
      title: truncate(message, 120) || 'Facebook post',
      url: post.permalink_url || `https://www.facebook.com/${post.id}`,
      sourceId: source.id,
      source: source.name,
      sourceTh: source.nameTh || source.name,
      kind: 'facebook',
      category: null,
      image: post.full_picture || null,
      summary: truncate(message),
      date: toIso(post.created_time),
    };
  });
}

/* ----------------------------------------------------------------- manual */

async function fromManual(source) {
  const file = path.join(ROOT, source.file || 'data/manual.json');
  if (!existsSync(file)) return [];
  const entries = JSON.parse(await readFile(file, 'utf8'));

  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: hash(entry.url || entry.title),
    title: clean(entry.title),
    url: entry.url,
    sourceId: source.id,
    source: entry.source || source.name,
    sourceTh: entry.sourceTh || entry.source || source.nameTh,
    kind: entry.kind || 'manual',
    category: entry.category || null,
    image: entry.image || null,
    summary: entry.summary || null,
    date: toIso(entry.date),
  })).filter((entry) => entry.title && entry.url);
}

/* ------------------------------------------------------------------ utils */

function matchAll(text, pattern, flags) {
  if (!pattern) return [];
  return [...text.matchAll(new RegExp(pattern, flags))].map((m) => m[0]);
}

function firstGroup(text, pattern) {
  if (!pattern) return null;
  const m = text.match(new RegExp(pattern, 's'));
  return m ? m[1] : null;
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : null;
}

function stripTags(value) {
  return value ? value.replace(/<[^>]*>/g, ' ') : value;
}

// RSS descriptions carry HTML that is itself entity-encoded, so the entities
// have to be decoded before the tags can be stripped, then tidied again.
function plain(value) {
  return clean(stripTags(clean(value)));
}

function clean(value) {
  if (!value) return null;
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code) => {
    if (named[code]) return named[code];
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    }
    return whole;
  });
}

function truncate(value, max = 220) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

function absolute(href, origin) {
  if (!href) return null;
  try {
    return new URL(decodeEntities(href), origin).toString();
  } catch {
    return null;
  }
}

function toIso(value) {
  if (!value) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  // Guard against obviously wrong dates from a bad regex match.
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 2) return null;
  return parsed.toISOString();
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function dedupe(items) {
  const byUrl = new Map();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    // Keep the copy that actually knows its date.
    if (!existing || (!existing.date && item.date)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

function byNewest(a, b) {
  if (a.date && b.date) return b.date.localeCompare(a.date);
  if (a.date) return -1;
  if (b.date) return 1;
  return a.title.localeCompare(b.title);
}

function looksLikeCS(item, keywords) {
  const haystack = ` ${[item.title, item.summary, item.category, item.source].filter(Boolean).join(' ')} `.toLowerCase();
  return keywords.some((word) => haystack.includes(word.toLowerCase()));
}

function log(message) {
  process.stdout.write(message + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
