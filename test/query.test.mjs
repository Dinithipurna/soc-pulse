import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, evaluate, compileMonitors, matchPost, highlightRanges, QueryError } from '../engine/query.mjs';
import { readFileSync } from 'node:fs';

const q = (src, text, context = [], aliases = {}) => evaluate(parseQuery(src, aliases).ast, { text, context }).match;

test('single words match whole words, case-insensitively', () => {
  assert.equal(q('soc', 'NUS SoC is great'), true);
  assert.equal(q('soc', 'the social club'), false); // the old substring bug
  assert.equal(q('computing', 'Computing!'), true);
});

test('phrases ignore punctuation and spacing between words', () => {
  assert.equal(q('"School of Computing, NUS"', 'the School of Computing NUS team'), true);
  assert.equal(q('"NUS SoC"', 'NUS-SoC students'), true);
  assert.equal(q('"NUS SoC"', 'SoC NUS'), false);
});

test('curly quotes from Slack/Word are accepted', () => {
  assert.equal(q('“NUS Computing”', 'nus computing open house'), true);
});

test('AND / OR / NOT and precedence', () => {
  assert.equal(q('a OR b AND c', 'a'), true);          // a OR (b AND c)
  assert.equal(q('(a OR b) AND c', 'a'), false);
  assert.equal(q('a NOT b', 'a b'), false);             // implicit AND with NOT b
  assert.equal(q('a AND NOT b', 'a'), true);
  assert.equal(q('NUS computing', 'computing at NUS'), true); // adjacent = AND
});

test('case: makes acronyms case-sensitive', () => {
  assert.equal(q('case:AI', 'AI lab opens'), true);
  assert.equal(q('case:AI', 'said Ai Ling'), false);
  assert.equal(q('AI', 'said Ai Ling'), true);           // without case: it matches
  assert.equal(q('case:CS', 'cs is hard'), false);
});

test('wildcards', () => {
  assert.equal(q('comput*', 'computational biology'), true);
  assert.equal(q('case:CS*', 'CS1101S is fun'), true);
  assert.equal(q('leak*', 'exam leaked'), true);
  assert.equal(q('leak*', 'bleak'), false);
});

test('context:nus is true only for NUS-only sources', () => {
  assert.equal(q('context:nus AND SoC', 'SoC workload is insane', ['nus']), true);
  assert.equal(q('context:nus AND SoC', 'SoC workload is insane', []), false);
});

test('aliases expand and cycles are refused', () => {
  const al = { soc: '"NUS SoC" OR "NUS Computing"', loop: '@loop' };
  assert.equal(q('@soc AND stress', 'NUS Computing stress', [], al), true);
  assert.throws(() => parseQuery('@loop', al), QueryError);
  assert.throws(() => parseQuery('@missing', al), /Unknown alias/);
});

test('syntax errors carry a message', () => {
  assert.throws(() => parseQuery('(a OR b'), /closing parenthesis/);
  assert.throws(() => parseQuery('a OR'), /ends too early/);
  assert.throws(() => parseQuery('"open quote'), /Unclosed quote/);
  assert.throws(() => parseQuery('a )'), /closing parenthesis/);
});

test('lowercase operators produce a warning, not silent misbehaviour', () => {
  const { warnings } = parseQuery('"computer science" or "computer engineering"');
  assert.match(warnings[0].msg, /Did you mean OR/);
});

test('hits list only positive terms that matched', () => {
  const r = evaluate(parseQuery('(NUS OR NTU) AND stress NOT exam').ast, { text: 'NUS stress' });
  assert.deepEqual(r.hits.sort(), ['NUS', 'stress']);
});

test('highlight ranges merge overlaps', () => {
  assert.deepEqual(highlightRanges('NUS Computing rocks', ['"NUS Computing"', 'computing']), [[0, 13]]);
});

// ---- the shipped monitors: every query compiles and behaves on realistic posts ----
const config = JSON.parse(readFileSync(new URL('../config/monitors.json', import.meta.url)));
const { monitors, errors } = compileMonitors(config);

test('all configured monitors compile without errors', () => {
  assert.deepEqual(errors, []);
  for (const m of monitors) assert.deepEqual(m.warnings, [], `warnings in ${m.id}`);
});

const tags = (text, srcKey = 'hackernews', context = []) => matchPost(monitors, { text, srcKey, context }).monitors;

test('SoC mentions monitor', () => {
  assert.ok(tags('Congrats to NUS School of Computing on the award').includes('soc-mentions'));
  assert.ok(tags('SoC open house this weekend', 'nuswhispers', ['nus']).includes('soc-mentions'));
  assert.ok(!tags('SoC open house this weekend').includes('soc-mentions')); // no NUS context
});

test('programmes monitor ignores Counter-Strike and bare AI news', () => {
  assert.ok(tags('Is NUS computer science worth it?').includes('programmes'));
  assert.ok(!tags('NUS team wins CS tournament in Counter-Strike').includes('programmes'));
  assert.ok(!tags('NUS Medicine launches AI tool for doctors').includes('programmes'));
});

test('issues monitor needs a risk word, not just a classroom word', () => {
  assert.ok(tags('NUS Computing data breach reported').includes('issues'));
  assert.ok(!tags('NUS Computing lecture recordings are up').includes('issues'));
  assert.ok(tags('NUS Computing lecture recordings are up').includes('teaching'));
});

test('student experience monitor does not fire on generic AI posts', () => {
  assert.ok(!tags('AI internships are hard to get these days').includes('experience'));
  assert.ok(tags('CS workload this sem is crazy', 'nuswhispers', ['nus']).includes('experience'));
});
