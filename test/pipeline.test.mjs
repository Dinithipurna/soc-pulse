import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRss } from '../connectors/hardwarezone.mjs';
import { buildOutputs } from '../engine/pipeline.mjs';
import { htmlToText } from '../engine/text.mjs';

const config = JSON.parse(readFileSync(new URL('../config/monitors.json', import.meta.url)));

// Shape copied from the live HardwareZone (XenForo) feed
const RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"><channel><title>NUS</title>
<item><title>Is NUS Computing still worth it in 2026?</title><pubDate>Sat, 24 Oct 2026 03:10:00 +0000</pubDate><link>https://forums.hardwarezone.com.sg/threads/is-nus-computing-still-worth-it.7230001/</link><guid isPermaLink="false">7230001</guid><author>invalid@example.com (someone)</author><category domain="https://forums.hardwarezone.com.sg/forums/nus.305/"><![CDATA[NUS]]></category><dc:creator>someone</dc:creator><content:encoded><![CDATA[<div class="bbWrapper"><blockquote class="bbCodeBlock">quoted SoC text</blockquote>Thinking of the CS course &amp; worried about the workload.<br />Any seniors?</div>]]></content:encoded><slash:comments>12</slash:comments></item>
<item><title>Best chicken rice</title><pubDate>Sat, 24 Oct 2026 02:00:00 +0000</pubDate><link>https://forums.hardwarezone.com.sg/threads/best-chicken-rice.7230002/</link><category domain="x">EDMW</category><content:encoded><![CDATA[<div>Maxwell or Tian Tian?</div>]]></content:encoded><slash:comments>3</slash:comments></item>
</channel></rss>`;

test('parseRss reads XenForo items, decodes entities, drops quoted replies', () => {
  const items = parseRss(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Is NUS Computing still worth it in 2026?');
  assert.equal(items[0].board, 'NUS');
  assert.equal(items[0].comments, 12);
  assert.match(items[0].body, /CS course & worried about the workload\. Any seniors\?/);
  assert.doesNotMatch(items[0].body, /quoted SoC text/);
});

test('htmlToText handles numeric entities', () => {
  assert.equal(htmlToText('it&#39;s &#x27;fine&#x27; &lt;3'), "it's 'fine' <3");
});

const NOW = Date.parse('2026-10-25T12:00:00Z');
const post = (id, text, extra = {}) => ({ id, srcKey: 'hardwarezone', src: 'HardwareZone', time: '2026-10-24T03:00:00Z', url: 'u', text, context: [], ...extra });

test('pipeline keeps matched posts as mentions, everything recent in the pool', () => {
  const out = buildOutputs({
    config, now: NOW,
    fresh: [
      post('hwz1', 'Is NUS Computing still worth it? CS workload is crazy', { context: ['nus'] }),
      post('hwz2', 'Best chicken rice in Maxwell')
    ]
  });
  assert.equal(out.pool.length, 2);
  assert.equal(out.mentions.length, 1);
  const m = out.mentions[0];
  assert.equal(m.id, 'hwz1');
  assert.ok(m.monitors.includes('soc-mentions'));
  assert.ok(m.monitors.includes('experience'));
  assert.ok(m.hits['soc-mentions'].includes('"NUS Computing"'));
  assert.equal(out.newMatches, 1);
});

test('pipeline preserves firstSeen and drops posts past retention', () => {
  const first = buildOutputs({ config, now: NOW, fresh: [post('hwz1', 'NUS School of Computing open house')] });
  const later = NOW + 3600000;
  const second = buildOutputs({ config, now: later, existing: first.mentions, pool: first.pool, fresh: [] });
  assert.equal(second.mentions[0].firstSeen, first.mentions[0].firstSeen);
  assert.equal(second.newMatches, 0);
  const muchLater = NOW + 40 * 86400000;
  const third = buildOutputs({ config, now: muchLater, existing: second.mentions, pool: second.pool, fresh: [] });
  assert.equal(third.mentions.length, 0);
});

test('editing a monitor re-tags stored posts on the next run', () => {
  const first = buildOutputs({ config, now: NOW, fresh: [post('hwz9', 'NUS Computing hackathon this weekend')] });
  assert.equal(first.mentions.length, 1);
  const narrowed = { ...config, monitors: [{ id: 'issues-only', name: 'x', query: '@soc AND breach' }] };
  const second = buildOutputs({ config: narrowed, now: NOW, existing: first.mentions, pool: first.pool });
  assert.equal(second.mentions.length, 0);
  assert.equal(second.pool.length, 1); // still available to the query tester
});

test('a broken monitor query stops the run instead of silently matching nothing', () => {
  const bad = { ...config, monitors: [{ id: 'bad', name: 'bad', query: '("NUS SoC" OR' }] };
  assert.throws(() => buildOutputs({ config: bad, now: NOW }), /Monitor query errors/);
});
