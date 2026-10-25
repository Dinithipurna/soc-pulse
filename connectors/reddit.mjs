// Reddit r/nus via the official Data API. Disabled by default: new API access requires Reddit's approval.
import { fetchJSON } from './http.mjs';
import { clean } from '../engine/text.mjs';

export async function scan(cfg, { since }) {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error('no credentials (see SETUP.md)');
  const ua = process.env.REDDIT_USER_AGENT || 'soc-pulse-scanner/2.0 (NUS SoC comms monitoring)';
  const tok = await fetchJSON('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ua },
    body: 'grant_type=client_credentials'
  });
  const posts = [];
  for (const sub of cfg.subreddits || ['nus']) {
    const j = await fetchJSON(`https://oauth.reddit.com/r/${sub}/new?limit=100`, { headers: { 'Authorization': 'Bearer ' + tok.access_token, 'User-Agent': ua } });
    for (const k of j.data?.children || []) {
      const p = k.data || {};
      const when = new Date((p.created_utc || 0) * 1000);
      if (when.getTime() < since) continue;
      posts.push({
        id: 'r' + p.id, srcKey: 'reddit', src: `Reddit · r/${sub}`, time: when.toISOString(),
        url: 'https://www.reddit.com' + p.permalink, title: clean(p.title),
        text: clean((p.title || '') + '. ' + (p.selftext || '')), context: sub.toLowerCase() === 'nus' ? ['nus'] : [],
        engagement: { likes: p.ups || 0, comments: p.num_comments || 0 },
        reach: `${p.ups || 0} upvotes · ${p.num_comments || 0} comments`
      });
    }
  }
  return { posts };
}
