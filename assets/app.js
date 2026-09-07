// Reads data/news.json (written by scripts/aggregate.mjs) and renders the board.
// Filters live in the URL hash, so any view can be copied and shared.

const TEXT = {
  en: {
    skip: 'Skip to the news list',
    title: 'KMITL CS News Board',
    subtitle: 'News about KMITL computer science, gathered from official sources.',
    searchLabel: 'Search',
    searchPh: 'Search news…  (press /)',
    sortLabel: 'Sort',
    sortNew: 'Newest first',
    sortOld: 'Oldest first',
    whereLabel: 'Where the news comes from',
    kindAll: 'All sources',
    kindWeb: 'Official website',
    kindFb: 'Official Facebook',
    kindManual: 'Added by hand',
    sourceLabel: 'Source',
    sourceAll: 'Every source',
    csOnly: 'Computer science only',
    empty: 'Nothing matches those filters.',
    sourcesHead: 'Where this comes from',
    note: 'This board only links to the original posts. Open the link to read the full story on the official site.',
    updated: (d) => `Last checked ${d}`,
    counted: (n, total) => `Showing ${n} of ${total} stories`,
    noDate: 'no date given',
    loading: 'Loading…',
    failed: 'Could not load data/news.json. Run: node scripts/aggregate.mjs',
    ok: (n) => `${n} item(s)`,
    skipped: 'skipped',
    error: 'error',
    today: 'today',
    yesterday: 'yesterday',
    daysAgo: (n) => `${n} days ago`,
  },
  th: {
    skip: 'ข้ามไปที่รายการข่าว',
    title: 'กระดานข่าว คอมพิวเตอร์ สจล.',
    subtitle: 'รวมข่าวด้านคอมพิวเตอร์ของ สจล. จากแหล่งข่าวทางการ',
    searchLabel: 'ค้นหา',
    searchPh: 'ค้นหาข่าว…  (กด /)',
    sortLabel: 'เรียงลำดับ',
    sortNew: 'ใหม่สุดก่อน',
    sortOld: 'เก่าสุดก่อน',
    whereLabel: 'ข่าวมาจากที่ใด',
    kindAll: 'ทุกแหล่ง',
    kindWeb: 'เว็บไซต์ทางการ',
    kindFb: 'เฟซบุ๊กทางการ',
    kindManual: 'เพิ่มเอง',
    sourceLabel: 'แหล่งข่าว',
    sourceAll: 'ทุกแหล่งข่าว',
    csOnly: 'เฉพาะข่าวคอมพิวเตอร์',
    empty: 'ไม่พบข่าวตามเงื่อนไขนี้',
    sourcesHead: 'แหล่งที่มาของข้อมูล',
    note: 'กระดานนี้เป็นเพียงลิงก์ไปยังโพสต์ต้นทาง กดลิงก์เพื่ออ่านฉบับเต็มที่เว็บไซต์ทางการ',
    updated: (d) => `ตรวจล่าสุด ${d}`,
    counted: (n, total) => `แสดง ${n} จาก ${total} ข่าว`,
    noDate: 'ไม่ระบุวันที่',
    loading: 'กำลังโหลด…',
    failed: 'โหลด data/news.json ไม่สำเร็จ ให้รันคำสั่ง: node scripts/aggregate.mjs',
    ok: (n) => `${n} รายการ`,
    skipped: 'ข้าม',
    error: 'ผิดพลาด',
    today: 'วันนี้',
    yesterday: 'เมื่อวานนี้',
    daysAgo: (n) => `${n} วันก่อน`,
  },
};

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                     'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const el = {
  list: document.getElementById('list'),
  count: document.getElementById('count'),
  empty: document.getElementById('empty'),
  updated: document.getElementById('updated'),
  srclist: document.getElementById('srclist'),
  q: document.getElementById('q'),
  sort: document.getElementById('sort'),
  source: document.getElementById('source'),
  cs: document.getElementById('cs'),
  kinds: document.getElementById('kinds'),
  lang: document.getElementById('lang'),
};

const state = {
  lang: localStorage.getItem('lang') === 'th' ? 'th' : 'en',
  q: '',
  kind: 'all',
  source: 'all',
  cs: false,
  sort: 'new',
};

let data = { items: [], sources: [], generatedAt: null };

/* ------------------------------------------------------------------ boot */

readHash();
applyLanguage();
el.count.textContent = t('loading');

fetch('data/news.json', { cache: 'no-store' })
  .then((res) => {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  })
  .then((payload) => {
    data = payload;
    buildSourceOptions();
    applyLanguage();
    render();
  })
  .catch(() => {
    el.count.textContent = t('failed');
  });

/* --------------------------------------------------------------- wiring */

el.q.addEventListener('input', () => {
  state.q = el.q.value.trim();
  render();
});

el.sort.addEventListener('change', () => {
  state.sort = el.sort.value;
  render();
});

el.source.addEventListener('change', () => {
  state.source = el.source.value;
  render();
});

el.cs.addEventListener('change', () => {
  state.cs = el.cs.checked;
  render();
});

el.kinds.addEventListener('click', (event) => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  state.kind = button.dataset.kind;
  markKinds();
  render();
});

el.lang.addEventListener('click', () => {
  state.lang = state.lang === 'en' ? 'th' : 'en';
  localStorage.setItem('lang', state.lang);
  applyLanguage();
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== el.q) {
    event.preventDefault();
    el.q.focus();
    el.q.select();
  }
});

window.addEventListener('hashchange', () => {
  readHash();
  syncControls();
  render();
});

/* ------------------------------------------------------------- rendering */

function render() {
  const items = filter(data.items || []);

  el.list.replaceChildren(...items.map(row));
  el.empty.hidden = items.length > 0;
  el.count.textContent = t('counted')(items.length, (data.items || []).length);

  el.updated.textContent = data.generatedAt
    ? t('updated')(formatDateTime(data.generatedAt))
    : '';

  renderSourceReport();
  writeHash();
}

function filter(items) {
  const needle = state.q.toLowerCase();

  const kept = items.filter((item) => {
    if (state.kind !== 'all' && item.kind !== state.kind) return false;
    if (state.source !== 'all' && item.sourceId !== state.source) return false;
    if (state.cs && !item.cs) return false;
    if (!needle) return true;
    const hay = [item.title, item.summary, item.category, item.source, item.sourceTh]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });

  const direction = state.sort === 'old' ? -1 : 1;
  return kept.sort((a, b) => {
    if (!a.date && !b.date) return a.title.localeCompare(b.title);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return direction * b.date.localeCompare(a.date);
  });
}

function row(item) {
  const li = document.createElement('li');
  li.className = 'item';

  const when = document.createElement('div');
  when.className = 'when';
  if (item.date) {
    const day = document.createElement('b');
    day.textContent = formatDate(item.date);
    const rel = document.createElement('span');
    rel.textContent = relative(item.date);
    when.append(day, rel);
  } else {
    const day = document.createElement('b');
    day.textContent = '—';
    const rel = document.createElement('span');
    rel.textContent = t('noDate');
    when.append(day, rel);
  }

  const body = document.createElement('div');

  const title = document.createElement('h3');
  title.className = 'title';
  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.title;
  title.append(link);

  const detail = document.createElement('p');
  detail.className = 'detail';
  detail.append(text(state.lang === 'th' ? (item.sourceTh || item.source) : item.source));
  if (item.category) {
    detail.append(dot(), tag(item.category, false));
  }
  if (item.cs) {
    detail.append(dot(), tag(state.lang === 'th' ? 'คอมพิวเตอร์' : 'computer science', true));
  }

  body.append(title, detail);

  if (item.summary) {
    const sum = document.createElement('p');
    sum.className = 'sum';
    sum.textContent = item.summary;
    body.append(sum);
  }

  li.append(when, body);
  return li;
}

function renderSourceReport() {
  el.srclist.replaceChildren(
    ...(data.sources || []).map((source) => {
      const li = document.createElement('li');
      const config = findConfig(source.id);
      const name = document.createElement('span');

      if (config?.homepage) {
        const a = document.createElement('a');
        a.href = config.homepage;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = source.name;
        name.append(a);
      } else {
        name.textContent = source.name;
      }

      const status = document.createElement('span');
      status.className = 'state';
      status.textContent =
        source.status === 'ok' ? t('ok')(source.count)
        : source.status === 'skipped' ? `${t('skipped')} — ${source.message || ''}`
        : `${t('error')} — ${source.message || ''}`;

      li.append(name, status);
      return li;
    }),
  );
}

// The report has no homepage field; recover it from an item of that source.
function findConfig(sourceId) {
  const item = (data.items || []).find((entry) => entry.sourceId === sourceId);
  if (!item) return null;
  try {
    return { homepage: new URL(item.url).origin };
  } catch {
    return null;
  }
}

function buildSourceOptions() {
  const seen = new Map();
  for (const item of data.items || []) {
    if (!seen.has(item.sourceId)) {
      seen.set(item.sourceId, { en: item.source, th: item.sourceTh || item.source });
    }
  }
  el.source.replaceChildren(
    option('all', t('sourceAll')),
    ...[...seen.entries()].map(([id, names]) => option(id, names[state.lang])),
  );
  el.source.value = seen.has(state.source) ? state.source : 'all';
  state.source = el.source.value;
}

function option(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

/* ------------------------------------------------------------- language */

function t(key) {
  return TEXT[state.lang][key];
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  el.lang.textContent = state.lang === 'en' ? 'ไทย' : 'EN';

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-ph]')) {
    node.placeholder = t(node.dataset.i18nPh);
  }
  for (const node of document.querySelectorAll('[data-i18n-al]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAl));
  }
  document.title = t('title');

  if (data.items?.length) buildSourceOptions();
  syncControls();
}

function syncControls() {
  el.q.value = state.q;
  el.sort.value = state.sort;
  el.cs.checked = state.cs;
  if ([...el.source.options].some((o) => o.value === state.source)) {
    el.source.value = state.source;
  }
  markKinds();
}

function markKinds() {
  for (const button of el.kinds.querySelectorAll('[data-kind]')) {
    button.classList.toggle('is-on', button.dataset.kind === state.kind);
    button.setAttribute('aria-pressed', String(button.dataset.kind === state.kind));
  }
}

/* ------------------------------------------------------------ url state */

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.q = params.get('q') || '';
  state.kind = params.get('kind') || 'all';
  state.source = params.get('source') || 'all';
  state.cs = params.get('cs') === '1';
  state.sort = params.get('sort') === 'old' ? 'old' : 'new';
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.kind !== 'all') params.set('kind', state.kind);
  if (state.source !== 'all') params.set('source', state.source);
  if (state.cs) params.set('cs', '1');
  if (state.sort !== 'new') params.set('sort', state.sort);

  const hash = params.toString();
  const next = `${location.pathname}${location.search}${hash ? '#' + hash : ''}`;
  history.replaceState(null, '', next);
}

/* ----------------------------------------------------------------- dates */

function formatDate(iso) {
  const d = new Date(iso);
  if (state.lang === 'th') {
    return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
  }
  return `${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mm}`;
}

function relative(iso) {
  // Count whole calendar days, not 24-hour blocks, so two stories published on
  // the same day never read as "3 days ago" and "4 days ago".
  const days = Math.round((midnight(new Date()) - midnight(new Date(iso))) / 86400000);
  if (days <= 0) return t('today');
  if (days === 1) return t('yesterday');
  return t('daysAgo')(days);
}

function midnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/* ----------------------------------------------------------------- small */

function text(value) {
  return document.createTextNode(value);
}

function dot() {
  const span = document.createElement('span');
  span.className = 'dot';
  span.textContent = '·';
  return span;
}

function tag(label, isCs) {
  const span = document.createElement('span');
  span.className = isCs ? 'tag is-cs' : 'tag';
  span.textContent = label;
  return span;
}
