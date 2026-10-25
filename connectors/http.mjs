export const UA = 'SoC-Pulse/2.0 (media monitoring prototype for NUS School of Computing; +https://github.com/surangan/soc-pulse)';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchText(url, opts = {}, ms = 15000) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(to); }
}

export async function fetchJSON(url, opts = {}, ms = 15000) {
  return JSON.parse(await fetchText(url, opts, ms));
}
