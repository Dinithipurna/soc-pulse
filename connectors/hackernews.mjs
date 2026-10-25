// Hacker News via the public Algolia search API (stories and comments).
import { fetchJSON, sleep } from './http.mjs';
import { htmlToText, clean } from '../engine/text.mjs';

export async function scan(cfg, { since }) {
  const byId = new Map();
  const sinceSec = Math.floor(since / 1000);
  for (const query of cfg.queries || []) {
    const url = 'https://hn.algolia.com/api/v1/search_by_date?query=' + encodeURIComponent(query) +
      '&tags=(story,comment)&hitsPerPage=50&numericFilters=created_at_i>' + sinceSec;
    const j = await fetchJSON(url);
    for (const h of j.hits || []) {
      const isComment = (h._tags || []).includes('comment');
      const title = clean(isComment ? h.story_title : h.title);
      const body = htmlToText(isComment ? h.comment_text : h.story_text);
      const text = clean((isComment ? '' : title + '. ') + body);
      if (!text) continue;
      const item = 'https://news.ycombinator.com/item?id=' + h.objectID;
      byId.set(h.objectID, {
        id: 'hn' + h.objectID, srcKey: 'hackernews', src: cfg.label || 'Hacker News',
        time: new Date(h.created_at).toISOString(), url: isComment ? item : (h.url || item),
        title: isComment ? 'Comment on: ' + title : title, text, context: [],
        engagement: { points: h.points || 0, comments: h.num_comments || 0 },
        reach: isComment ? 'Comment' : `${h.points || 0} points · ${h.num_comments || 0} comments`
      });
    }
    await sleep(300);
  }
  return { posts: [...byId.values()] };
}
