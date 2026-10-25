// Rule-based sentiment + wellbeing routing (ported from the PoC).
// sev: 'attn' (needs attention) | 'good' (positive) | 'neutral'
// wellbeing: true when the post may signal distress -> route to the wellbeing team, never auto-reply.

const WELLBEING = /\b(depress\w*|anxi\w*|suicid\w*|self[- ]?harm|burn[ -]?out|burnt out|overwhelm\w*|mental health|hopeless|lonely|breaking down|panic attack\w*)\b/i;
const NEGATIVE = /\b(complain\w*|fail\w*|worst|angry|disappoint\w*|frustrat\w*|scam\w*|broken|can'?t get|cannot get|no job|jobless|reject\w*|retrench\w*|unfair|rant|struggl\w*|regret\w*|stress\w*|toxic|waste|breach\w*|leak\w*|misconduct|plagiaris\w*|harass\w*|discriminat\w*)\b/i;
const POSITIVE = /\b(congrat\w*|award\w*|win|won|winner|proud|launch\w*|welcome|love|amazing|best|excit\w*|achiev\w*|grateful|thank\w*|top \d+|breakthrough|scholarship\w*|recommend\w*)\b/i;

export function classify(text) {
  const t = String(text || '');
  if (WELLBEING.test(t)) return { sev: 'attn', wellbeing: true, tag: 'Possible wellbeing signal · route to wellbeing team, no automated reply' };
  if (NEGATIVE.test(t)) return { sev: 'attn', wellbeing: false, tag: 'Negative sentiment · review and monitor' };
  if (POSITIVE.test(t)) return { sev: 'good', wellbeing: false, tag: 'Positive mention · consider amplifying' };
  return { sev: 'neutral', wellbeing: false, tag: 'Community chatter · monitor' };
}
