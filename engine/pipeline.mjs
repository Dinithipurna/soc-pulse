// Pure merge + match step, separated from network I/O so it can be tested offline.
import { compileMonitors, matchPost } from './query.mjs';
import { classify } from './classify.mjs';

const DAY = 86400000;

// existing: previous mentions.json mentions[], pool: previous pool.json posts[], fresh: posts from this run
export function buildOutputs({ existing = [], pool = [], fresh = [], config, now = Date.now() }) {
  const ret = config.retention || {};
  const mentionsCut = now - (ret.mentionsDays || 30) * DAY;
  const poolCut = now - (ret.poolDays || 7) * DAY;
  const { monitors, errors } = compileMonitors(config);
  if (errors.length) throw new Error('Monitor query errors: ' + errors.map(e => `${e.id}: ${e.message}`).join('; '));

  const prevMention = new Map(existing.map(m => [m.id, m]));
  const all = new Map();
  for (const p of [...existing, ...pool, ...fresh]) {          // later sources win: fresh data replaces old
    const t = Date.parse(p.time);
    if (!p.id || isNaN(t) || t < mentionsCut || t > now + DAY) continue;
    all.set(p.id, { ...all.get(p.id), ...p });
  }

  const mentions = [], poolOut = [];
  const freshIds = new Set(fresh.map(p => p.id));
  let newMatches = 0;
  for (const p of all.values()) {
    const base = {
      id: p.id, srcKey: p.srcKey, src: p.src, time: p.time, url: p.url, title: p.title || '',
      text: String(p.text || '').slice(0, 1200), context: p.context || [], reach: p.reach || '',
      engagement: p.engagement || {}
    };
    if (Date.parse(p.time) >= poolCut) poolOut.push({ ...base, text: base.text.slice(0, 600) });
    const { monitors: ids, hits } = matchPost(monitors, base);
    if (!ids.length) continue;
    const cls = classify(base.text);
    const prev = prevMention.get(p.id);
    if (!prev) newMatches++;
    mentions.push({
      ...base, sev: cls.sev, wellbeing: cls.wellbeing, tag: cls.tag, monitors: ids, hits,
      firstSeen: prev?.firstSeen || new Date(now).toISOString()
    });
  }
  const byTime = (a, b) => Date.parse(b.time) - Date.parse(a.time);
  mentions.sort(byTime);
  poolOut.sort(byTime);
  return {
    mentions: mentions.slice(0, ret.maxMentions || 2000),
    pool: poolOut.slice(0, ret.maxPool || 1500),
    newMatches,
    freshMatched: mentions.filter(m => freshIds.has(m.id)).length
  };
}
