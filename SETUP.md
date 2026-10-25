# SoC Pulse server-side pipeline — setup

The repo contains a GitHub Action (`.github/workflows/scan.yml`) that runs
`scan.mjs` **hourly on GitHub's servers**, scanning public sources and
committing the results to `data/mentions.json`. The dashboard reads that file
on every scan, so all mentions found by the server appear for every team
member — shared history, no browser limitations.

## What works with zero setup

NUSWhispers, Hacker News and HardwareZone (RSS) are scanned server-side
immediately. Nothing to configure. To trigger the first run manually:

1. Go to the repo's **Actions** tab
2. Select **SoC Pulse scan** in the left sidebar
3. Click **Run workflow** → **Run workflow**

After ~1 minute it commits `data/mentions.json`, GitHub Pages redeploys
(~90 seconds), and the next dashboard scan will show a "Server feed" line.

> If the Actions tab shows a prompt asking you to enable workflows, click
> enable — GitHub sometimes requires one-time confirmation for workflows
> added to a repo.

## Enabling Reddit (currently not possible for new apps)

> Reddit now requires approval for every new API client, stops accepting
> new access requests on 31 October 2026, and closes remaining public API
> access in March 2027. The steps below only apply if SoC already has an
> approved Reddit app. After adding the secrets, set
> `"enabled": true` for `reddit` in `config/monitors.json`.

### Old setup steps

Reddit blocks all anonymous and proxy access, but its official API has a
generous free tier. You need a Reddit account.

1. Log in to Reddit, then open **https://www.reddit.com/prefs/apps**
2. Click **create app** (bottom). Fill in:
   - **name**: `soc-pulse-scanner`
   - **type**: select **script**
   - **redirect uri**: `http://localhost` (required but unused)
3. Click **create app**. Note two values:
   - the **client ID** — the short string under the app name, beneath
     "personal use script"
   - the **secret** — labelled `secret`
4. In this GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**. Create these secrets (paste the values you noted):
   - `REDDIT_CLIENT_ID`
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_USER_AGENT` (optional) — e.g. `soc-pulse by u/YOUR_USERNAME`
5. Run the workflow again from the Actions tab. The run log should show
   `Reddit · r/nus: N new` instead of `FAILED - no credentials`.

Secrets are encrypted by GitHub and are **not** visible in the public repo
or to the dashboard — only the Action can read them. Never put these values
in `index.html` or any committed file.

## Enabling Bluesky (3 minutes, free; needs an account)

After adding the secrets, set `"enabled": true` for `bluesky` in `config/monitors.json`.

Bluesky's public search API rejects requests from server IPs, so the scanner
signs in with an **app password** instead. App passwords are separate from
your real password, read-only for our purposes, and can be revoked any time.

1. Log in to Bluesky, then open **Settings → Privacy and security →
   App passwords** and click **Add App Password**. Name it `soc-pulse` and
   copy the generated password (it is shown once).
2. In this GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**. Create:
   - `BSKY_HANDLE` — your handle, e.g. `yourname.bsky.social`
   - `BSKY_APP_PASSWORD` — the app password from step 1
3. Run the workflow again. The run log should show `Bluesky: N new` instead
   of `FAILED - no credentials`.

## Notes

- `data/mentions.json` keeps matched posts for 30 days; `data/pool.json` keeps
  every fetched post for 7 days so the Query tester can try new queries.
  Limits are in the `retention` block of `config/monitors.json`.
- Editing `config/monitors.json` and pushing triggers a scan, which re-tags
  everything stored. A query with a syntax error fails the tests and the
  scan does not run, so a typo never silently empties the feed.
- New sources: add `connectors/<name>.mjs` exporting `scan(cfg, {since})`
  that returns `{posts}`, then register it in `scan.mjs` and the config.
