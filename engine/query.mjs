// SoC Pulse Boolean query engine. Zero dependencies; runs in Node (scanner) and the browser (dashboard).
//
// Syntax (a subset of Meltwater's):
//   word            whole-word match, case-insensitive          module
//   "a phrase"      words in order; punctuation between ignored  "School of Computing, NUS"
//   comput*         wildcard: any word starting with "comput"
//   case:AI         case-sensitive (combine with * : case:CS*)
//   context:nus     true when the post comes from an NUS-only community (r/nus, NUSWhispers, HWZ NUS board)
//   @name           expands to a named query from the config's "aliases"
//   AND  OR  NOT    operators, CAPITALS only; ( ) for grouping. Adjacent terms are ANDed.
// Precedence: NOT binds tightest, then AND, then OR.

const WORD = '[\\p{L}\\p{N}]';
const SEP = '[^\\p{L}\\p{N}]+';

export class QueryError extends Error {
  constructor(message, pos) { super(message); this.pos = pos; }
}

// ---------- tokenizer ----------
function tokenize(src) {
  const toks = [], warnings = [];
  let i = 0;
  const s = src.replace(/[“”„‟″]/g, '"'); // curly quotes -> straight
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { toks.push({ t: c, pos: i }); i++; continue; }
    if (c === '"' || (s.startsWith('case:"', i))) {
      const caseSens = c !== '"';
      const start = i;
      i += caseSens ? 6 : 1;
      const end = s.indexOf('"', i);
      if (end < 0) throw new QueryError('Unclosed quote', start);
      const text = s.slice(i, end).trim();
      i = end + 1;
      if (!text) { warnings.push({ msg: 'Empty phrase ignored', pos: start }); continue; }
      toks.push({ t: 'TERM', pos: start, term: makeTerm(text, caseSens, true) });
      continue;
    }
    // bare word (stops at whitespace, parens, quotes)
    let j = i;
    while (j < s.length && !/[\s()"]/.test(s[j])) j++;
    const w = s.slice(i, j);
    const pos = i;
    i = j;
    if (w === 'AND' || w === 'OR' || w === 'NOT') { toks.push({ t: w, pos }); continue; }
    if (/^(and|or|not|And|Or|Not)$/.test(w)) {
      warnings.push({ msg: `"${w}" is treated as a word to search for. Did you mean ${w.toUpperCase()}?`, pos });
    }
    if (w.startsWith('@')) { toks.push({ t: 'ALIAS', pos, name: w.slice(1) }); continue; }
    if (w.toLowerCase().startsWith('context:')) {
      toks.push({ t: 'TERM', pos, term: { kind: 'context', value: w.slice(8).toLowerCase(), raw: w } });
      continue;
    }
    if (w.startsWith('case:')) {
      const body = w.slice(5);
      if (!body) throw new QueryError('case: needs a word after it', pos);
      toks.push({ t: 'TERM', pos, term: makeTerm(body, true, false) });
      continue;
    }
    toks.push({ t: 'TERM', pos, term: makeTerm(w, false, false) });
  }
  return { toks, warnings };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function makeTerm(text, caseSensitive, quoted) {
  // split into words; keep a trailing * as wildcard on the last word
  const words = text.split(new RegExp(SEP, 'u')).filter(Boolean);
  const wildcard = /\*$/.test(text);
  if (!words.length) return { kind: 'never', raw: text };
  const parts = words.map(escapeRe);
  let body = parts.join(SEP);
  if (wildcard) body += WORD + '*';
  const re = new RegExp(`(?<!${WORD})${body}(?!${WORD})`, caseSensitive ? 'gu' : 'giu');
  const raw = (caseSensitive ? 'case:' : '') + (quoted ? `"${text}"` : text);
  return { kind: 'text', re, raw, caseSensitive, phrase: words.length > 1 };
}

// ---------- parser ----------
// AST: {op:'OR'|'AND', kids:[..]} | {op:'NOT', kid} | {op:'TERM', term}
export function parseQuery(src, aliases = {}, _seen = new Set()) {
  if (typeof src !== 'string' || !src.trim()) throw new QueryError('Query is empty', 0);
  const { toks, warnings } = tokenize(src);
  let k = 0;
  const peek = () => toks[k];
  const startsUnary = tk => tk && (tk.t === 'TERM' || tk.t === '(' || tk.t === 'NOT' || tk.t === 'ALIAS');

  function parseOr() {
    const kids = [parseAnd()];
    while (peek() && peek().t === 'OR') { k++; kids.push(parseAnd()); }
    return kids.length === 1 ? kids[0] : { op: 'OR', kids };
  }
  function parseAnd() {
    const kids = [parseUnary()];
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'AND') { k++; kids.push(parseUnary()); continue; }
      if (startsUnary(tk)) { kids.push(parseUnary()); continue; } // implicit AND
      break;
    }
    return kids.length === 1 ? kids[0] : { op: 'AND', kids };
  }
  function parseUnary() {
    const tk = peek();
    if (!tk) throw new QueryError('Query ends too early: a term is missing', src.length);
    if (tk.t === 'NOT') { k++; return { op: 'NOT', kid: parseUnary() }; }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new QueryError('Query ends too early: a term is missing', src.length);
    if (tk.t === '(') {
      k++;
      const e = parseOr();
      if (!peek() || peek().t !== ')') throw new QueryError('Missing closing parenthesis', tk.pos);
      k++;
      return e;
    }
    if (tk.t === 'TERM') { k++; return { op: 'TERM', term: tk.term }; }
    if (tk.t === 'ALIAS') {
      k++;
      const def = aliases[tk.name];
      if (def === undefined) throw new QueryError(`Unknown alias @${tk.name}`, tk.pos);
      if (_seen.has(tk.name)) throw new QueryError(`Alias @${tk.name} refers to itself`, tk.pos);
      const sub = parseQuery(def, aliases, new Set([..._seen, tk.name]));
      warnings.push(...sub.warnings.map(w => ({ ...w, msg: `in @${tk.name}: ${w.msg}` })));
      return sub.ast;
    }
    if (tk.t === ')') throw new QueryError('Unexpected closing parenthesis', tk.pos);
    throw new QueryError(`${tk.t} needs a term on both sides`, tk.pos);
  }

  const ast = parseOr();
  if (k < toks.length) {
    const tk = toks[k];
    throw new QueryError(tk.t === ')' ? 'Unexpected closing parenthesis' : `Unexpected ${tk.t}`, tk.pos);
  }
  return { ast, warnings };
}

// ---------- evaluation ----------
// post: {text: string, context?: string[]}
// returns {match: boolean, hits: string[]}  (hits = positive terms that matched, for highlighting)
export function evaluate(ast, post) {
  const hits = new Set();
  const ctx = new Set((post.context || []).map(c => c.toLowerCase()));
  const text = post.text || '';
  const cache = new Map();
  const termTrue = term => {
    if (cache.has(term)) return cache.get(term);
    let v = false;
    if (term.kind === 'context') v = ctx.has(term.value);
    else if (term.kind === 'text') { term.re.lastIndex = 0; v = term.re.test(text); }
    cache.set(term, v);
    return v;
  };
  // collect = whether matched terms here count as hits (false under NOT)
  function ev(n, collect) {
    switch (n.op) {
      case 'TERM': {
        const v = termTrue(n.term);
        if (v && collect && n.term.kind === 'text') hits.add(n.term);
        return v;
      }
      case 'NOT': return !ev(n.kid, false);
      case 'AND': {
        // evaluate all kids only if the AND as a whole is true, so hits reflect real matches
        if (!n.kids.every(c => ev(c, false))) return false;
        if (collect) n.kids.forEach(c => ev(c, true));
        return true;
      }
      case 'OR': {
        let any = false;
        for (const c of n.kids) if (ev(c, collect)) any = true;
        return any;
      }
    }
    return false;
  }
  const match = ev(ast, true);
  return { match, hits: match ? [...hits].map(t => t.raw) : [], hitTerms: match ? [...hits] : [] };
}

// Compile every monitor once. Returns {monitors:[{id,name,ast}], errors:[{id,message}]}
export function compileMonitors(config) {
  const aliases = config.aliases || {};
  const monitors = [], errors = [];
  for (const m of config.monitors || []) {
    try {
      const { ast, warnings } = parseQuery(m.query, aliases);
      monitors.push({ ...m, ast, warnings });
    } catch (e) {
      errors.push({ id: m.id, message: e.message, pos: e.pos });
    }
  }
  return { monitors, errors };
}

// Run all monitors against one post: {monitors:[ids], hits:{id:[terms]}}
export function matchPost(compiled, post) {
  const ids = [], hits = {};
  for (const m of compiled) {
    if (m.sources && !m.sources.includes('all') && !m.sources.includes(post.srcKey)) continue;
    const r = evaluate(m.ast, post);
    if (r.match) { ids.push(m.id); hits[m.id] = r.hits; }
  }
  return { monitors: ids, hits };
}

// Ranges [start,end) in text where any of the given raw terms match, merged. For highlighting.
export function highlightRanges(text, rawTerms) {
  const ranges = [];
  for (const raw of rawTerms) {
    let term;
    try { term = parseQuery(raw).ast.term; } catch { continue; }
    if (!term || term.kind !== 'text') continue;
    term.re.lastIndex = 0;
    let m;
    while ((m = term.re.exec(text))) {
      ranges.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) term.re.lastIndex++;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([...r]);
  }
  return out;
}
