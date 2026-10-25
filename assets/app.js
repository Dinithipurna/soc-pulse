// SoC Pulse dashboard. Read-only: everything comes from files the hourly scanner commits.
import { parseQuery, evaluate, compileMonitors, highlightRanges } from '../engine/query.mjs';

const $ = id => document.getElementById(id);
const DAY = 86400000;
const PAGE = 50;

const state = {
  config: null, compiled: [], monitorErrors: [], monitorName: {},
  meta: null, mentions: [], pool: [], loadError: '',
  f: { monitor: 'all', source: 'all', sev: 'all', range: 7 },
  search: null,           // compiled search query {ast} or null
  shown: PAGE
};

// ---------------- helpers ----------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = m => Date.parse(m.time);
const fmtAbs = iso => new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
function fmtRel(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}
async function getJSON(path) {
  const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
function marked(text, terms) {
  const ranges = terms.length ? highlightRanges(text, terms) : [];
  let out = '', i = 0;
  for (const [a, b] of ranges) { out += esc(text.slice(i, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; i = b; }
  return out + esc(text.slice(i));
}
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
const sourceLabel = key => state.config?.sources?.[key]?.label || key;

// ---------------- loading ----------------
async function load() {
  try {
    state.config = await getJSON('config/monitors.json');
  } catch (e) {
    showBanner('Could not load config/monitors.json (' + esc(e.message) + '). If you opened index.html as a file, serve the folder instead: <code>python3 -m http.server</code>.');
    return;
  }
  const c = compileMonitors(state.config);
  state.compiled = c.monitors; state.monitorErrors = c.errors;
  state.monitorName = Object.fromEntries((state.config.monitors || []).map(m => [m.id, m.name]));
  try {
    const m = await getJSON('data/mentions.json');
    state.meta = m;
    state.mentions = m.schema === 2 ? (m.mentions || []) : [];
    if (m.schema !== 2) showBanner('The data file is from the old scanner. It will be replaced after the next scheduled scan.');
  } catch (e) { state.loadError = e.message; }
  try { state.pool = (await getJSON('data/pool.json')).posts || []; } catch { state.pool = []; }
  if (state.monitorErrors.length) {
    showBanner('Some monitors have query errors and are skipped: ' + state.monitorErrors.map(e => `<b>${esc(e.id)}</b> (${esc(e.message)})`).join('; '));
  }
  initControls();
  route();
}
function showBanner(html) { const b = $('banner'); b.innerHTML = html; b.hidden = false; }

// ---------------- filtering ----------------
function inScope(m, { ignoreMonitor = false, ignoreRange = false } = {}) {
  const f = state.f;
  if (!ignoreRange && t(m) < Date.now() - f.range * DAY) return false;
  if (!ignoreMonitor && f.monitor !== 'all' && !(m.monitors || []).includes(f.monitor)) return false;
  if (f.source !== 'all' && m.srcKey !== f.source) return false;
  if (f.sev === 'wellbeing' ? !m.wellbeing : f.sev !== 'all' && m.sev !== f.sev) return false;
  if (state.search && !evaluate(state.search.ast, { text: (m.title || '') + ' ' + m.text, context: m.context }).match) return false;
  return true;
}
function termsFor(m) {
  const set = new Set();
  const ids = state.f.monitor === 'all' ? Object.keys(m.hits || {}) : [state.f.monitor];
  for (const id of ids) for (const h of (m.hits || {})[id] || []) set.add(h);
  if (state.search) for (const h of evaluate(state.search.ast, { text: (m.title || '') + ' ' + m.text, context: m.context }).hits) set.add(h);
  return [...set];
}

// ---------------- mention card (shared with the tester) ----------------
function card(m, terms, { showMonitors = true } = {}) {
  const el = document.createElement('article');
  el.className = `mention sev-${m.sev || 'neutral'}${m.wellbeing ? ' well' : ''}`;
  const sevChip = m.wellbeing ? '<span class="chip well">WELLBEING</span>'
    : m.sev === 'attn' ? '<span class="chip attn">NEEDS ATTENTION</span>'
    : m.sev === 'good' ? '<span class="chip good">POSITIVE</span>'
    : m.sev ? '<span class="chip">NEUTRAL</span>' : '';
  const mons = showMonitors ? (m.monitors || []).map(id => `<span class="chip mon">${esc(state.monitorName[id] || id)}</span>`).join('') : '';
  // HWZ/HN text starts with the title; show the title on its own line and drop the duplicate
  let full = m.text || '';
  if (m.title && full.startsWith(m.title)) full = full.slice(m.title.length).replace(/^[.\s]+/, '');
  const LIMIT = 420;
  const long = full.length > LIMIT + 60;
  const sp = full.lastIndexOf(' ', LIMIT);
  const cut = long ? full.slice(0, sp > 200 ? sp : LIMIT) : full;
  el.innerHTML = `<div class="rail"></div><div>
    <div class="m-top"><span class="chip src">${esc(m.src)}</span>${sevChip}${mons}<span class="m-time" title="${esc(fmtAbs(m.time))}">${esc(fmtRel(m.time))}</span></div>
    ${m.title ? `<div class="m-title">${marked(m.title, terms)}</div>` : ''}
    <div class="m-text">${marked(cut, terms)}${long ? '… <button class="m-more">Show full post</button>' : ''}</div>
    <div class="m-meta"><span>${esc(m.reach)}</span>${m.tag ? `<span>${esc(m.tag)}</span>` : ''}<a href="${esc(m.url)}" target="_blank" rel="noopener">Open source ↗</a></div>
  </div>`;
  const more = el.querySelector('.m-more');
  if (more) more.addEventListener('click', () => { el.querySelector('.m-text').innerHTML = marked(full, terms); });
  return el;
}

// ---------------- monitor view ----------------
function renderMonitor() {
  const items = state.mentions.filter(m => inScope(m));
  $('kMent').textContent = items.length;
  const chans = new Set(items.map(m => m.srcKey)).size;
  $('kMentSub').textContent = `across ${chans} source${chans === 1 ? '' : 's'}`;
  $('kAttn').textContent = items.filter(m => m.sev === 'attn' && !m.wellbeing).length;
  $('kWell').textContent = items.filter(m => m.wellbeing).length;
  $('kGood').textContent = items.filter(m => m.sev === 'good').length;

  // monitor chips, counted under the other filters
  const base = state.mentions.filter(m => inScope(m, { ignoreMonitor: true }));
  const chips = [{ id: 'all', name: 'All monitors', n: base.length }]
    .concat(state.compiled.map(c => ({ id: c.id, name: c.name, high: c.priority === 'high', n: base.filter(m => (m.monitors || []).includes(c.id)).length })));
  $('monChips').innerHTML = chips.map(c =>
    `<button class="mchip${c.id === state.f.monitor ? ' on' : ''}${c.high ? ' high' : ''}" data-id="${esc(c.id)}" aria-pressed="${c.id === state.f.monitor}">${esc(c.name)}<span class="n">${c.n}</span></button>`).join('');

  const feed = $('feed'); feed.innerHTML = '';
  $('feedCount').textContent = items.length ? `${Math.min(items.length, state.shown)} of ${items.length}` : '';
  if (!items.length) {
    const why = !state.meta
      ? `No data yet${state.loadError ? ` (${esc(state.loadError)})` : ''}. The scanner runs hourly in GitHub Actions; the first run after this version is deployed fills this in.`
      : state.mentions.length
        ? 'Nothing matches these filters. Try a longer period or All monitors.'
        : `No posts have matched the monitors yet. The scanner holds ${state.pool.length} recent posts; the Query tester shows what they contain.`;
    feed.innerHTML = `<div class="feed-empty">${why}</div>`;
  }
  for (const m of items.slice(0, state.shown)) feed.appendChild(card(m, termsFor(m)));
  $('feedMore').hidden = items.length <= state.shown;

  renderTrend();
  renderSources();
  renderMonitorList(base);
}

const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shortDate = d => d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
function renderTrend() {
  const DAYS = 30;
  const items = state.mentions.filter(m => inScope(m, { ignoreRange: true }));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ key: dayKey(d), d, n: 0 }); }
  const idx = Object.fromEntries(days.map((x, i) => [x.key, i]));
  for (const m of items) { const k = dayKey(new Date(m.time)); if (k in idx) days[idx[k]].n++; }
  days.forEach((x, i) => {
    const prev = days.slice(Math.max(0, i - 7), i);
    const avg = prev.length ? prev.reduce((s, p) => s + p.n, 0) / prev.length : 0;
    x.spike = i >= 7 && x.n >= 3 && x.n > 2 * avg;
  });
  const W = 288, H = 120, padB = 18, padT = 14, max = Math.max(1, ...days.map(x => x.n));
  const bw = W / DAYS;
  const bars = days.map((x, i) => {
    const h = x.n ? Math.max(2, (H - padB - padT) * x.n / max) : 0;
    const label = `${shortDate(x.d)}: ${x.n} mention${x.n === 1 ? '' : 's'}${x.spike ? ' (spike)' : ''}`;
    return `<rect class="bar${x.spike ? ' spike' : ''}" x="${(i * bw + 1).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${esc(label)}</title></rect>`;
  }).join('');
  const total = days.reduce((s, x) => s + x.n, 0);
  const el = $('trend');
  el.className = 'trend';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mentions per day over the last 30 days: ${total} in total, peak ${max} in a day">
    <text class="axis" x="0" y="9">peak ${max}/day</text>
    <line class="base" x1="0" x2="${W}" y1="${H - padB + .5}" y2="${H - padB + .5}"/>${bars}
    <text class="axis" x="0" y="${H - 4}">${esc(shortDate(days[0].d))}</text>
    <text class="axis" x="${W}" y="${H - 4}" text-anchor="end">Today</text></svg>`;
}

function renderSources() {
  const el = $('sources'), meta = state.meta;
  if (!meta || meta.schema !== 2) { el.innerHTML = '<div class="src-line">Waiting for the first scan.</div>'; return; }
  el.innerHTML = (meta.sources || []).map(s => {
    const parts = [];
    if (s.status === 'ok') parts.push(`${s.fetched} fetched this run`, `${s.matched} matched in ${meta.retain_days} d`);
    if (s.status === 'disabled') parts.push('off');
    if (s.note) parts.push(s.note);
    return `<div class="src-line ${esc(s.status)}"><b>${esc(s.label)}</b><br><span class="st">${esc(parts.join(' · '))}</span></div>`;
  }).join('');
}

function renderMonitorList(base) {
  const errs = Object.fromEntries(state.monitorErrors.map(e => [e.id, e.message]));
  $('monitors').innerHTML = (state.config.monitors || []).map(m => {
    const n = base.filter(x => (x.monitors || []).includes(m.id)).length;
    return `<div class="mon-item${errs[m.id] ? ' err' : ''}">
      <div class="mh"><b>${esc(m.name)}</b><span class="n">${errs[m.id] ? 'error' : n}</span></div>
      <div class="md">${esc(errs[m.id] || m.description || '')}</div>
      <details><summary>Query</summary><pre>${esc(m.query)}</pre></details>
      <button class="test" data-id="${esc(m.id)}">Open in Query tester →</button>
    </div>`;
  }).join('');
}

// ---------------- query tester ----------------
function corpus() {
  const byId = new Map();
  for (const p of state.pool) byId.set(p.id, p);
  for (const m of state.mentions) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => t(b) - t(a));
}
function runTester() {
  const src = $('tqQuery').value, msg = $('tqMsg'), results = $('tqResults');
  const posts = corpus().filter(p => $('tqSource').value === 'all' || p.srcKey === $('tqSource').value);
  results.innerHTML = ''; $('tqBreak').innerHTML = '';
  if (!src.trim()) {
    msg.className = 'q-msg'; msg.textContent = '';
    $('tqCount').textContent = `${posts.length} stored posts`;
    results.innerHTML = `<div class="feed-empty">${posts.length
      ? `Type a query to search the ${posts.length} posts collected in the last ${state.config.retention?.poolDays || 7} days (plus older matched mentions).`
      : 'No stored posts yet. They appear after the first scan.'}</div>`;
    return;
  }
  let parsed;
  try { parsed = parseQuery(src, state.config.aliases || {}); }
  catch (e) {
    msg.className = 'q-msg err';
    msg.textContent = e.message + (e.pos != null ? ` (at character ${e.pos + 1})` : '');
    $('tqCount').textContent = '';
    return;
  }
  const hits = [];
  for (const p of posts) {
    const r = evaluate(parsed.ast, { text: (p.title || '') + ' ' + p.text, context: p.context });
    if (r.match) hits.push([p, r.hits]);
  }
  msg.className = parsed.warnings.length ? 'q-msg warn' : 'q-msg ok';
  msg.textContent = parsed.warnings.length ? parsed.warnings.map(w => w.msg).join(' ') : 'Query is valid.';
  $('tqCount').textContent = `${hits.length} of ${posts.length} posts`;
  const bySrc = {};
  for (const [p] of hits) bySrc[p.src] = (bySrc[p.src] || 0) + 1;
  $('tqBreak').innerHTML = Object.entries(bySrc).map(([s, n]) => `<span class="chip">${esc(s)} · ${n}</span>`).join('');
  if (!hits.length) results.innerHTML = '<div class="feed-empty">No stored posts match. The query may be too narrow, or nothing like it was posted recently.</div>';
  for (const [p, h] of hits.slice(0, 100)) results.appendChild(card(p, h));
  if (hits.length > 100) results.insertAdjacentHTML('beforeend', `<div class="feed-empty">Showing the newest 100 of ${hits.length}.</div>`);
}

// ---------------- CSV + report ----------------
function exportCsv() {
  const items = state.mentions.filter(m => inScope(m));
  const cols = ['time', 'source', 'monitors', 'sentiment', 'wellbeing', 'title', 'text', 'reach', 'url'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = items.map(m => [m.time, m.src, (m.monitors || []).map(id => state.monitorName[id] || id).join('; '),
    m.sev, m.wellbeing ? 'yes' : '', m.title, m.text, m.reach, m.url].map(q).join(','));
  const blob = new Blob(['﻿' + cols.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `soc-pulse-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildReport() {
  const items = state.mentions.filter(m => inScope(m));
  const snip = m => (m.title || m.text).replace(/\s+/g, ' ').slice(0, 150);
  const well = items.filter(m => m.wellbeing);
  const attn = items.filter(m => m.sev === 'attn' && !m.wellbeing);
  const good = items.filter(m => m.sev === 'good');
  const period = { 1: 'last 24 hours', 7: 'last 7 days', 30: 'last 30 days' }[state.f.range];
  const nSrc = new Set(items.map(m => m.srcKey)).size;
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let r = `SUMMARY\n${pl(items.length, 'mention')} in the ${period} across ${pl(nSrc, 'source')}: ${attn.length} needing attention, ${pl(well.length, 'wellbeing flag')}, ${good.length} positive, ${items.length - attn.length - well.length - good.length} neutral.\n\nBY MONITOR\n`;
  r += state.compiled.map(c => `• ${c.name}: ${items.filter(m => (m.monitors || []).includes(c.id)).length}`).join('\n');
  r += '\n\nWELLBEING (route to the wellbeing team; no public reply)\n';
  r += well.length ? well.slice(0, 5).map((m, i) => `${i + 1}. ${m.src}: ${snip(m)}\n   ${m.url}`).join('\n') : 'None flagged.';
  r += '\n\nNEEDS ATTENTION\n';
  r += attn.length ? attn.slice(0, 5).map((m, i) => `${i + 1}. ${m.src}: ${snip(m)}\n   ${m.url}`).join('\n') : 'None flagged.';
  r += '\n\nPOSITIVE HIGHLIGHTS\n';
  r += good.length ? good.slice(0, 5).map(m => `• ${m.src}: ${snip(m)}\n  ${m.url}`).join('\n') : 'None in this period.';
  const st = (state.meta?.sources || []).filter(s => s.status !== 'disabled').map(s => `${s.label} ${s.status === 'ok' ? 'ok' : 'failed'}`).join(', ');
  r += `\n\nSCANNER\nLast scan ${state.meta ? fmtAbs(state.meta.updated) : 'not yet run'}${st ? '. ' + st : ''}.\nSentiment is rule-based; check flagged items before acting on them.`;
  return r;
}
function openReport() {
  const f = state.f;
  const scope = [f.monitor !== 'all' ? state.monitorName[f.monitor] : 'All monitors',
    f.source !== 'all' ? sourceLabel(f.source) : 'all sources', $('fRange').selectedOptions[0].textContent.toLowerCase()];
  $('rDate').textContent = new Date().toLocaleDateString('en-SG', { dateStyle: 'full' });
  $('rScope').textContent = 'Scope: ' + scope.join(' · ') + (state.search ? ' · search: ' + $('fQuery').value : '') + '. Change the filters to change the report.';
  $('rBody').textContent = buildReport();
  $('overlay').classList.add('open');
  $('rClose').focus();
}

// ---------------- wiring ----------------
function initControls() {
  const cfgSrc = state.config.sources || {};
  const keys = [...new Set([...Object.keys(cfgSrc).filter(k => cfgSrc[k].enabled), ...state.mentions.map(m => m.srcKey)])];
  const opts = '<option value="all">All sources</option>' + keys.map(k => `<option value="${esc(k)}">${esc(sourceLabel(k))}</option>`).join('');
  $('fSource').innerHTML = opts;
  $('tqSource').innerHTML = opts;
  $('tqLoad').innerHTML = '<option value="">Blank query</option>' + (state.config.monitors || []).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  $('tqAliases').innerHTML = '<b>Aliases you can use</b>' + Object.entries(state.config.aliases || {}).map(([k, v]) => `<div><code>@${esc(k)}</code><pre>${esc(v)}</pre></div>`).join('');

  const refilter = () => { state.shown = PAGE; renderMonitor(); };
  $('monChips').addEventListener('click', e => { const b = e.target.closest('.mchip'); if (b) { state.f.monitor = b.dataset.id; refilter(); } });
  $('fSource').addEventListener('change', e => { state.f.source = e.target.value; refilter(); });
  $('fSev').addEventListener('change', e => { state.f.sev = e.target.value; refilter(); });
  $('fRange').addEventListener('change', e => { state.f.range = +e.target.value; refilter(); });
  $('fQuery').addEventListener('input', debounce(e => {
    const v = e.target.value.trim(), msg = $('fQueryMsg');
    if (!v) { state.search = null; msg.className = 'q-msg'; msg.textContent = ''; }
    else {
      try {
        const p = parseQuery(v, state.config.aliases || {});
        state.search = p;
        msg.className = p.warnings.length ? 'q-msg warn' : 'q-msg';
        msg.textContent = p.warnings.map(w => w.msg).join(' ');
      } catch (err) { msg.className = 'q-msg err'; msg.textContent = err.message; return; }
    }
    refilter();
  }, 200));
  $('btnMore').addEventListener('click', () => { state.shown += PAGE; renderMonitor(); });
  $('btnCsv').addEventListener('click', exportCsv);
  $('monitors').addEventListener('click', e => {
    const b = e.target.closest('.test'); if (!b) return;
    $('tqLoad').value = b.dataset.id;
    $('tqQuery').value = state.config.monitors.find(m => m.id === b.dataset.id).query;
    location.hash = 'tester';
  });

  $('tqLoad').addEventListener('change', e => {
    const m = state.config.monitors.find(x => x.id === e.target.value);
    $('tqQuery').value = m ? m.query : '';
    runTester();
  });
  $('tqSource').addEventListener('change', runTester);
  $('tqQuery').addEventListener('input', debounce(runTester, 200));
  $('tqCopy').addEventListener('click', () => {
    const entry = { id: 'new-monitor', name: 'New monitor', description: '', query: $('tqQuery').value.trim() };
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2) + ',').then(() => {
      $('tqCopy').textContent = 'Copied. Paste into config/monitors.json';
      setTimeout(() => { $('tqCopy').textContent = 'Copy as monitor entry'; }, 2500);
    });
  });

  $('btnReport').addEventListener('click', openReport);
  const closeReport = () => $('overlay').classList.remove('open');
  $('rClose').addEventListener('click', closeReport);
  $('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeReport(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReport(); });
  $('rCopy').addEventListener('click', () => {
    navigator.clipboard.writeText($('rBody').textContent).then(() => {
      $('rCopy').textContent = 'Copied ✓'; setTimeout(() => { $('rCopy').textContent = 'Copy to clipboard'; }, 1500);
    });
  });

  const age = $('scanAge');
  if (state.meta?.updated) {
    const hrs = (Date.now() - Date.parse(state.meta.updated)) / 3600000;
    age.textContent = 'Scanned ' + fmtRel(state.meta.updated) + (hrs > 3 ? ' · scanner may be stalled' : '');
    age.title = fmtAbs(state.meta.updated);
    age.classList.toggle('stale', hrs > 3);
  } else age.textContent = 'Not scanned yet';

  window.addEventListener('hashchange', route);
}

function route() {
  const tester = location.hash === '#tester';
  $('viewMonitor').hidden = tester;
  $('viewTester').hidden = !tester;
  $('navMonitor').classList.toggle('on', !tester);
  $('navTester').classList.toggle('on', tester);
  $('btnReport').hidden = tester;
  if (tester) runTester(); else renderMonitor();
}

load();
