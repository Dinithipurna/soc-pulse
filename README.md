# SoC Pulse

Media-monitoring dashboard prototype for NUS School of Computing.

An hourly GitHub Action collects public posts, matches them against **Boolean monitors**, and commits
the results. The dashboard (GitHub Pages) reads those files: everyone sees the same feed.

## Sources

| Source | How | Needs an account? |
| --- | --- | --- |
| NUSWhispers | Public JSON API | No |
| Hacker News | Algolia search API (stories + comments) | No |
| HardwareZone | Public RSS feed of selected boards (new threads only, not replies) | No |
| Reddit | Official API | Yes; disabled (see SETUP.md) |
| Bluesky | Search API | Yes; disabled (see SETUP.md) |

## Monitors

Monitors live in `config/monitors.json`. Each is a named Boolean query:

```
"NUS Computing" OR "NUS School of Computing" OR (context:nus AND SoC)
```

| Syntax | Meaning |
| --- | --- |
| `word` | Whole word, any case (`soc` no longer matches "social") |
| `"a phrase"` | Words in order; punctuation between them ignored |
| `comput*` | Any word starting with "comput" |
| `case:AI` | Case-sensitive, for acronyms (`case:CS*` works too) |
| `context:nus` | Post comes from an NUS-only community (NUSWhispers, HWZ NUS board) |
| `@soc` | Expands to a shared definition in `aliases` |
| `AND` `OR` `NOT` `( )` | Capitals only. Adjacent terms are ANDed. NOT > AND > OR |

To change a monitor: try it in the dashboard's **Query tester**, then edit `config/monitors.json`
and push. The push triggers a scan, and the tests block any query with a syntax error.

## Layout

```
engine/query.mjs      Boolean parser + evaluator (shared by scanner and dashboard)
engine/pipeline.mjs   merge, de-duplicate, match, classify
engine/classify.mjs   rule-based sentiment and wellbeing flag
connectors/*.mjs      one file per source
scan.mjs              runs the connectors and writes data/
data/mentions.json    matched posts, 30 days
data/pool.json        all fetched posts, 7 days (for the Query tester)
index.html, assets/   dashboard
test/                 node --test test/*.test.mjs
```

## Run locally

```
node --test test/*.test.mjs   # engine + monitor tests
node scan.mjs                 # one scan, writes data/
python3 -m http.server 8080   # then open http://localhost:8080
```

## Known limits

- Sentiment is keyword-based; treat flags as a prompt to read the post, not a verdict.
- HardwareZone RSS shows new threads, not replies inside long-running threads.
- The site is public on GitHub Pages, so collected post text is visible to anyone with the URL.
