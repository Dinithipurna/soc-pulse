// Bluesky search. Disabled by default: the public API rejects GitHub's IPs, so it needs an app password.
import { fetchJSON } from './http.mjs';
import { clean } from '../engine/text.mjs';

export async function scan(cfg, { since }) {
  const handle = process.env.BSKY_HANDLE, pw = process.env.BSKY_APP_PASSWORD;
  if (!handle || !pw) throw new Error('no credentials (see SETUP.md)');
  const sess = await fetchJSON('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: handle, password: pw })
  });
  const posts = [];
  for (const q of cfg.queries || ['NUS computing']) {
    const j = await fetchJSON('https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=' + encodeURIComponent(q) + '&limit=50',
      { headers: { 'Authorization': 'Bearer ' + sess.accessJwt } });
    for (const p of j.posts || []) {
      const rkey = (p.uri || '').split('/').pop();
      const when = new Date(p.record?.createdAt);
      if (isNaN(when) || when.getTime() < since) continue;
      posts.push({
        id: 'b' + rkey, srcKey: 'bluesky', src: cfg.label || 'Bluesky', time: when.toISOString(),
        url: 'https://bsky.app/profile/' + (p.author?.handle || '') + '/post/' + rkey, title: '',
        text: clean(p.record?.text), context: [],
        engagement: { likes: p.likeCount || 0, reposts: p.repostCount || 0 },
        reach: `${p.likeCount || 0} likes · ${p.repostCount || 0} reposts`
      });
    }
  }
  return { posts };
}
