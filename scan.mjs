// SoC Pulse scanner. Runs hourly in GitHub Actions (Node 20+); also runnable locally: node scan.mjs
// 1. each enabled connector fetches recent public posts
// 2. engine/pipeline matches them against config/monitors.json and classifies sentiment
// 3. writes data/mentions.json (matched posts, 30 days) and data/pool.json (all fetched posts, 7 days,
//    used by the dashboard's query tester)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildOutputs } from './engine/pipeline.mjs';

const CONNECTORS = {
  nuswhispers: () => import('./connectors/nuswhispers.mjs'),
  hackernews: () => import('./connectors/hackernews.mjs'),
  hardwarezone: () => import('./connectors/hardwarezone.mjs'),
  reddit: () => import('./connectors/reddit.mjs'),
  bluesky: () => import('./connectors/bluesky.mjs')
};

const readJSON = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };

const config = readJSON('config/monitors.json', null);
if (!config) { console.error('config/monitors.json missing or invalid'); process.exit(1); }

const now = Date.now();
const since = now - (config.retention?.poolDays || 7) * 86400000;
const existing = readJSON('data/mentions.json', {}).mentions || [];
const pool = readJSON('data/pool.json', {}).posts || [];

const fresh = [], sources = [];
for (const [key, cfg] of Object.entries(config.sources || {})) {
  const entry = { key, label: cfg.label || key };
  if (!cfg.enabled) { sources.push({ ...entry, status: 'disabled', note: cfg.note || '' }); continue; }
  if (!CONNECTORS[key]) { sources.push({ ...entry, status: 'error', note: 'no connector for this source' }); continue; }
  try {
    const { scan } = await CONNECTORS[key]();
    const t0 = Date.now();
    const r = await scan(cfg, { since });
    fresh.push(...r.posts);
    sources.push({ ...entry, status: 'ok', fetched: r.posts.length, note: r.note || '', ms: Date.now() - t0 });
  } catch (e) {
    sources.push({ ...entry, status: 'error', note: e.message });
  }
}

const out = buildOutputs({ existing, pool, fresh, config, now });

// per-source matched counts for the status panel
for (const s of sources) s.matched = out.mentions.filter(m => m.srcKey === s.key).length;

mkdirSync('data', { recursive: true });
const updated = new Date(now).toISOString();
writeFileSync('data/mentions.json', JSON.stringify({
  schema: 2, updated, retain_days: config.retention?.mentionsDays || 30,
  newMatches: out.newMatches, sources, mentions: out.mentions
}, null, 1));
writeFileSync('data/pool.json', JSON.stringify({
  schema: 2, updated, retain_days: config.retention?.poolDays || 7, posts: out.pool
}));

console.log(`SoC Pulse scan ${updated}`);
for (const s of sources) console.log(`  ${s.label}: ${s.status}${s.fetched != null ? ` · ${s.fetched} fetched` : ''}${s.matched != null ? ` · ${s.matched} matched (30 d)` : ''}${s.note ? ` · ${s.note}` : ''}`);
console.log(`  mentions: ${out.mentions.length} (${out.newMatches} new) · pool: ${out.pool.length}`);
