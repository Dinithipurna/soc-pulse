// NUSWhispers public JSON API. Every confession is NUS-specific, so posts carry context:nus.
import { fetchJSON, sleep } from './http.mjs';
import { clean } from '../engine/text.mjs';

const BASE = 'https://www.nuswhispers.com/api/confessions';

export async function scan(cfg, { since }) {
  const byId = new Map();
  let failures = 0;
  const add = c => {
    const ts = c.created_at || c.status_updated_at;
    if (!ts || c.status && c.status !== 'Approved' && c.status !== 'Featured') return;
    const when = new Date(String(ts).replace(' ', 'T') + '+08:00'); // API times are SGT
    if (isNaN(when) || when.getTime() < since) return;
    const text = clean(c.content);
    if (!text) return;
    byId.set(c.confession_id, {
      id: 'w' + c.confession_id, srcKey: 'nuswhispers', src: cfg.label || 'NUSWhispers',
      time: when.toISOString(), url: 'https://www.nuswhispers.com/confession/' + c.confession_id,
      title: '', text, context: ['nus'],
      engagement: { views: c.views || 0, likes: c.fb_like_count || 0, comments: c.fb_comment_count || 0 },
      reach: `Confession #${c.confession_id} · ${c.views || 0} views` + (c.fb_like_count ? ` · ${c.fb_like_count} likes` : '')
    });
  };
  const recent = await fetchJSON(`${BASE}/recent?count=${cfg.recentCount || 100}`);
  for (const c of recent.data?.confessions || []) add(c);
  for (const kw of cfg.search || []) {
    await sleep(500);
    try {
      const j = await fetchJSON(`${BASE}/search/${encodeURIComponent(kw)}?count=25`);
      for (const c of j.data?.confessions || []) add(c);
    } catch { failures++; }
  }
  return { posts: [...byId.values()], note: failures ? `${failures} keyword search(es) failed` : '' };
}
