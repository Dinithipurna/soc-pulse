// HardwareZone Forums (XenForo) via each board's public RSS feed.
// RSS lists new threads with their opening post; replies inside threads are not included.
import { fetchText, sleep } from './http.mjs';
import { htmlToText, decodeEntities, clean } from '../engine/text.mjs';

const BASE = 'https://forums.hardwarezone.com.sg';

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') : '';
};

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    items.push({
      title: clean(decodeEntities(tag(it, 'title'))),
      link: clean(tag(it, 'link')),
      pubDate: clean(tag(it, 'pubDate')),
      board: clean(decodeEntities(tag(it, 'category'))),
      body: htmlToText(tag(it, 'content:encoded') || tag(it, 'description')),
      comments: parseInt(tag(it, 'slash:comments'), 10) || 0
    });
  }
  return items;
}

export async function scan(cfg, { since }) {
  const posts = [], failed = [];
  for (const f of cfg.forums || []) {
    try {
      const xml = await fetchText(`${BASE}/forums/${f.slug}.${f.id}/index.rss`);
      for (const it of parseRss(xml)) {
        const when = new Date(it.pubDate);
        if (isNaN(when) || when.getTime() < since) continue;
        const tid = (it.link.match(/\.(\d+)\/?$/) || it.link.match(/threads\/(\d+)/) || [])[1];
        if (!tid) continue;
        posts.push({
          id: 'hwz' + tid, srcKey: 'hardwarezone', src: cfg.label || 'HardwareZone',
          time: when.toISOString(), url: it.link,
          title: it.title, text: clean(it.title + '. ' + it.body.slice(0, 2000)),
          context: f.nusOnly ? ['nus'] : [],
          engagement: { comments: it.comments },
          reach: `${it.board || f.name} · ${it.comments} replies`
        });
      }
    } catch (e) { failed.push(`${f.name} (${e.message})`); }
    await sleep(1500); // be polite: one board every 1.5 s
  }
  if (failed.length === (cfg.forums || []).length && failed.length) throw new Error('all boards failed: ' + failed.join(', '));
  return { posts, note: failed.length ? 'failed: ' + failed.join(', ') : '' };
}
