# NCAA D1 Scraper — Agent Build Prompt

You are building **NCAAD1Scraper**, a standalone Node.js/TypeScript CLI scraper that collects **all NCAA Division I men's basketball players**, **every season available on usbasket.com**, and their **per-season stats**, then ingests them into **Hoop Central** — the same way the existing league scrapers do.

**Target site:** https://www.usbasket.com/NCAA1/basketball-Players.aspx

**Target repo:** `/Users/leoadams/Documents/NCAAD1Scraper` (currently empty except this file — build the full project here)

**The user has a paid usbasket.com subscription.** You must support authenticated access to subscriber-only content. Ask the user for login credentials or a browser session if you need them (see Questions section).

---

## Your mission (success criteria)

1. Discover **every NCAA D1 player** usbasket has across **all historical seasons** (the site lists seasons back to at least 2007-2008).
2. For each player, scrape **every season row** with per-game stats.
3. POST each season to Hoop Central via the ingest API (one row per player-team-season).
4. Match the **architecture, CLI, logging, checkpointing, and rate-limiting patterns** of the sibling scrapers — especially `GLeagueScraper5.0` and `USportsScraper5.0`.
5. Include **field goal percentage** and **three-point percentage** in addition to the standard stats the other scrapers already collect.
6. Support `--dry-run`, `--player-slug`, `--backfill --resume`, `--health`, `--limit`, and offline fixture-based tests.
7. Handle **bot blocking / WAF / captcha** on usbasket.com (this is a different site than Basketball Reference — study `USportsScraper5.0` for the Playwright approach).

---

## Before you write code — ask these questions

Stop and ask the user anything you cannot resolve from the repos below. At minimum, confirm:

1. **usbasket login** — username/password, or should you use a Playwright persistent profile where the user logs in manually once?
2. **League slug** — Hoop Central already seeds `ncaa` ("NCAA Division I"). Use `league.slug: "ncaa"` unless the user wants a different slug like `ncaa-d1`.
3. **`source` string** — propose `usbasket-ncaa-d1` (or `usbasket-ncaa`) and confirm. Must be unique and stable across runs.
4. **FG% field naming** — on the index page, usbasket labels columns `FGP` and `3FGP`. The user calls these "field goal percentage" (2FGP) and "three point percentage" (3FGP). Confirm whether `FGP` on usbasket is overall FG% or specifically 2PT FG% before mapping to DB columns.
5. **Cross-league linking** — should NCAA players be linked to existing NBA/BallDontLie identities (like G League does), or ingest standalone for now?
6. **Deployment target** — production Hoop Central only, or also local dev (`http://localhost:3001`)?

---

## Sibling repos you MUST study (read these first)

| Repo | Path | What to copy |
|------|------|--------------|
| **G League scraper (primary template)** | `/Users/leoadams/Documents/GLeagueScraper5.0` | Overall architecture: CLI, types, transform, ingestClient, checkpoint, slug cache, team cache, runner loop, logging prefixes |
| **U Sports scraper (anti-bot template)** | `/Users/leoadams/Documents/USportsScraper5.0` | Playwright browser fetch, AWS WAF/captcha handling, session bootstrap, discovery via multiple index sort/filter combos, fixture-based offline tests |
| **Hoop Central (database + API)** | `/Users/leoadams/Documents/HoopCentral-5.0-` | Ingest API contract, DB schema, validation, what fields exist today |
| **BIO scraper** | `/Users/leoadams/Documents/BIO-Scraper-5.0` | Bio pass-through pattern (do NOT overwrite bio fields scraped elsewhere) |
| **WNBA scraper** | `/Users/leoadams/Documents/WNBAScraper5.0` | Another working ingest example |

**Do not modify GLeagueScraper5.0.** Build everything in `NCAAD1Scraper`. You MAY need to modify Hoop Central if adding new stat columns — see below.

---

## Hoop Central — how data flows (no local DB in scraper)

The scraper has **no local database**. It POSTs JSON to Hoop Central, which owns PostgreSQL.

### Production API base URL

```
https://hoopcentral-50-production.up.railway.app
```

Local dev alternative: `http://localhost:3001`

### Endpoints you will use

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check (`--health`) |
| `POST` | `/api/ingest/player-season` | **Primary** — upsert player + league + team + season + stint + stats |
| `POST` | `/api/ingest/player-bio` | Optional — link player to another source identity |
| `GET` | `/api/ingest/completion-status?source=<source>` | Load existing players for fuzzy linking |
| `GET` | `/api/players/:playerId` | Fetch profile for bio pass-through after linking |

Full API docs: `/Users/leoadams/Documents/HoopCentral-5.0-/docs/INGESTION_API.md`

Identity rules: `/Users/leoadams/Documents/HoopCentral-5.0-/docs/INGESTION.md`

### Authentication

If `INGEST_API_KEY` is set on the server, every ingest request needs:

```
x-ingest-api-key: <INGEST_API_KEY>
```

**Copy credentials from the working G League scraper env file:**

```
/Users/leoadams/Documents/GLeagueScraper5.0/.env
```

Create `NCAAD1Scraper/.env` from `.env.example` and copy these values:

- `HOOP_CENTRAL_API_URL` — production Railway URL above
- `INGEST_API_KEY` — copy from GLeagueScraper `.env` (required for production ingest)
- `SCRAPE_REQUEST_DELAY_MS` — start conservative (see anti-bot section)
- `SCRAPE_INDEX_DELAY_MS` — start conservative

**Never commit `.env` or paste secrets into git.**

---

## Database schema (Hoop Central PostgreSQL)

Schema lives in `/Users/leoadams/Documents/HoopCentral-5.0-/server/src/db/schema/`.

### Core tables

**`player_identities`** — links external IDs to canonical players

| Column | Notes |
|--------|-------|
| `source` | Your scraper's source string (e.g. `usbasket-ncaa-d1`) |
| `external_id` | usbasket's stable player ID/slug |
| `player_id` | FK to `players.id` |

Unique: `(source, external_id)`

**`players`** — canonical player profile

Fields you may pass on ingest: `displayName`, `birthDate`, `position`, `heightCm`, `weightKg`, `hometown`, `headshotUrl`

**`leagues`** — use existing seed: `slug: "ncaa"`, `name: "NCAA Division I"`

**`teams`** — `slug`, `name`, `abbreviation`, `league_id`

**`seasons`** — `season_label` (e.g. `"2024-25"`) per league

**`player_stints`** — player + team + league + season association

**`player_season_stats`** — the actual stats (file: `player-season-stats.ts`)

### Current stats columns (what exists TODAY)

```typescript
// HoopCentral-5.0-/server/src/db/schema/player-season-stats.ts
gamesPlayed: integer
pointsPerGame: numeric(5,1)
reboundsPerGame: numeric(5,1)
assistsPerGame: numeric(5,1)
stealsPerGame: numeric(5,1)   // optional on ingest
blocksPerGame: numeric(5,1)   // optional on ingest
```

**FG% and 3FG% do NOT exist in the DB yet.**

The UI already has placeholder fields (`fieldGoalPct: "—"` in `player.service.ts`) but they are hardcoded dashes — not wired to real data.

### Adding FG% and 3FG% (required new work)

The user wants:
- **Field goal percentage** — usbasket column `FGP` (user calls it 2FGP)
- **Three-point percentage** — usbasket column `3FGP`

**If Hoop Central can accept them without breaking existing scrapers, add them.** Suggested approach:

1. Add nullable columns to `player_season_stats`:
   - `field_goal_pct` → ingest as `stats.fieldGoalPct` (numeric, e.g. precision 5 scale 1, stored as percentage like `45.2` not `0.452` — match how usbasket displays it)
   - `three_point_pct` → ingest as `stats.threePointPct`
2. Update `parseIngestPlayerSeasonBody()` and `upsertSeasonStats()` in `/Users/leoadams/Documents/HoopCentral-5.0-/server/src/services/ingest.service.ts`
3. Update `toStatRow()` in `/Users/leoadams/Documents/HoopCentral-5.0-/server/src/services/player.service.ts` to return real values
4. Update client types in `/Users/leoadams/Documents/HoopCentral-5.0-/client/src/lib/api.ts`
5. Run DB migration (Drizzle) — follow existing migration patterns in Hoop Central
6. Update `docs/INGESTION_API.md`

**Critical rule:** New stat fields must be **optional** on ingest so G League, WNBA, U Sports, and BIO scrapers keep working unchanged. If the API rejects unknown fields, do NOT send them until Hoop Central is updated.

**If you cannot safely add DB columns in this session**, scrape and log FG%/3FG% in dry-run output and note them as pending — but try to add them; the user explicitly wants them.

---

## Ingest payload shape (copy this contract)

Each season row POSTs one payload like:

```json
{
  "source": "usbasket-ncaa-d1",
  "externalId": "<usbasket-player-id>",
  "player": {
    "displayName": "Zion Williamson",
    "birthDate": null,
    "position": "F",
    "heightCm": null,
    "weightKg": null,
    "hometown": null,
    "headshotUrl": null
  },
  "league": {
    "slug": "ncaa",
    "name": "NCAA Division I"
  },
  "team": {
    "slug": "duke-blue-devils",
    "name": "Duke Blue Devils",
    "abbreviation": "DUKE"
  },
  "season": {
    "label": "2018-19"
  },
  "stats": {
    "gamesPlayed": 33,
    "pointsPerGame": 22.6,
    "reboundsPerGame": 8.9,
    "assistsPerGame": 2.1,
    "stealsPerGame": 1.0,
    "blocksPerGame": 1.8,
    "fieldGoalPct": 68.0,
    "threePointPct": 33.3
  }
}
```

### Naming conventions (match existing scrapers)

| Concept | Convention |
|---------|------------|
| `source` | Stable string per data provider, e.g. `"usbasket-ncaa-d1"` |
| `externalId` | usbasket's native player ID from URL or page (lowercase, stable across seasons) |
| `league.slug` | `"ncaa"` (already seeded in Hoop Central) |
| `team.slug` | `nameToSlug(teamName)` — lowercase, non-alphanumeric → `-` |
| `season.label` | `"YYYY-YY"` format (e.g. `"2024-25"`) — normalize usbasket's format |
| Stats rounding | Per-game stats to 1 decimal (`round1()`) — copy from `src/utils/season.ts` |
| Percentages | Store as displayed on usbasket (likely `45.2` not `0.452`) — verify on a real page |

### Idempotency

Re-sending the same payload updates stats; does not duplicate rows. Unique key: `(player_id, team_id, season_id, league_id)`.

---

## usbasket.com — what you are scraping

### Entry point

```
https://www.usbasket.com/NCAA1/basketball-Players.aspx
```

### What the index page offers (inspect live HTML yourself)

- **Season selector** — seasons from `2025-2026` back to `2007-2008` (and possibly more)
- **Letter filter** — A–Z plus "All"
- **Position filter** — G, F, C
- **View** — "Regular" stats
- **Stat columns on index** — includes: PPG, RPG, APG, SPG, BPG, TO, **FGP**, **3FGP**, FT
- **Warning** — site prohibits redistribution; this is a private ingest pipeline for Hoop Central (user has paid subscription)

### Discovery strategy (learn from USportsScraper)

The index likely shows only **top N players per sort column** (U Sports shows ~125 per column). Do NOT assume one page gives you everyone.

**You must union multiple discovery passes:**
- Every season (2007-08 through current)
- Every letter A–Z (and "All")
- Every relevant sort/stat column (PPG, RPG, APG, GP, FGP, 3FGP, etc.)
- Team roster pages if usbasket exposes them per season
- Player profile pages linked from index rows

Cache discovered player IDs in `ncaa-player-slugs.cache.json` (version 1, same pattern as G League).

### Per-player page

Each player profile should have a **career/season stats table** with one row per season. Parse:
- Season label
- Team name / abbreviation
- Games played
- PPG, RPG, APG, SPG, BPG (match existing scrapers)
- **FGP** → `fieldGoalPct`
- **3FGP** → `threePointPct`
- Skip total/summary rows, zero-game rows, invalid seasons (same discipline as G League parser)

**Inspect the actual DOM with browser tools before writing selectors.** usbasket is ASP.NET WebForms — expect `__VIEWSTATE`, postbacks, query params. Do not guess selectors; save HTML fixtures for offline tests.

### Subscriber authentication

The user has a **paid subscription**. Subscriber content may require:
- Login form (username/password)
- Session cookies after login
- Member-only pages unlocked after auth

**Recommended approach (copy USportsScraper Playwright pattern):**
1. `playwright` with persistent browser profile (`playwright/ncaa-profile/`)
2. `npm run session:bootstrap` — user logs in manually once, cookies persist
3. All live fetches go through Playwright browser context (not raw Node `fetch`)
4. Save session to `ncaa-session.json` / `ncaa-cookies.txt`
5. Support env vars: `USBASKET_COOKIE`, `USBASKET_SESSION_FILE`, `USBASKET_USERNAME`, `USBASKET_PASSWORD` (ask user which they prefer)

Test whether raw `fetch()` works for subscriber pages — it probably does NOT if WAF is involved (Eurobasket/usbasket family sites often use bot protection).

---

## Anti-bot / rate limiting (different site than BRef)

Basketball Reference (G League) uses plain `fetch` with conservative delays.

**usbasket.com is more like U Sports** — expect WAF, captcha, or session binding.

### Copy these patterns from `USportsScraper5.0`:

| Pattern | Implementation |
|---------|----------------|
| Playwright persistent profile | `src/scrape/browserContext.ts`, `browserFetch.ts` |
| Session bootstrap CLI | `src/bootstrapSession.ts` → `npm run session:bootstrap` |
| Blocked HTML detection | Check for empty body, missing `<title>`, captcha containers |
| Request pacing | Base delay + jitter (0–2500ms random) |
| Penalty delay | +4000ms cumulative on block, decays 500ms per success, max 20s |
| 429/503 retry | Up to 8 retries, parse `Retry-After`, exponential backoff |
| Checkpoint resume | Stop on hard block; user waits 1–2 hours, reruns `--resume` |
| Caches | Slug cache, team cache — avoid redundant fetches |
| Transparent User-Agent | `Mozilla/5.0 (compatible; HoopCentralNCAAScraper/1.0; +https://github.com/hoopcentral)` for fetch; real Chrome UA for browser mode |

### Suggested starting delays (tune after testing)

```
SCRAPE_REQUEST_DELAY_MS=15000   # between player pages
SCRAPE_INDEX_DELAY_MS=20000     # between index/list pages
```

U Sports uses 20s/25s because AWS WAF is aggressive. Start conservative; the user can lower delays if usbasket tolerates it.

### CLI flags for browser mode (mirror USports)

| Flag | Description |
|------|-------------|
| `--use-browser` | Fetch via Playwright (default for live scrapes if WAF detected) |
| `--use-fetch` | Force Node fetch (for testing — likely blocked) |
| `--use-fixtures` | Offline HTML fixtures — no network |
| `--browser-headless` | Headless only after recent captcha solve in profile |

---

## Project structure to build

Mirror G League + U Sports hybrid:

```
NCAAD1Scraper/
├── src/
│   ├── index.ts                 # CLI entry
│   ├── config.ts                # dotenv, delays
│   ├── usbasketClient.ts        # fetch + site-specific anti-block + discovery URLs
│   ├── ingestClient.ts          # Hoop Central REST client (copy from GLeagueScraper)
│   ├── transform.ts             # records → ingest payloads
│   ├── types.ts                 # source constant, stat shapes, options
│   ├── bootstrapSession.ts      # Playwright login warm-up
│   ├── scrape/
│   │   ├── runner.ts            # orchestration loop
│   │   ├── playerSeason.ts      # cheerio parsing of season tables
│   │   ├── discovery.ts         # index crawl: seasons × letters × sorts
│   │   ├── checkpoint.ts        # resume + log
│   │   ├── slugCache.ts
│   │   ├── teamCache.ts
│   │   ├── browserContext.ts    # Playwright profile
│   │   ├── browserFetch.ts
│   │   ├── session.ts           # cookie loading
│   │   └── fixtures.ts          # offline test HTML paths
│   ├── utils/
│   │   ├── rateLimiter.ts
│   │   ├── teams.ts             # nameToSlug
│   │   └── season.ts            # round1()
│   └── test/
│       ├── parsing.test.ts      # offline cheerio tests
│       └── discovery.test.ts
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

### Dependencies

```json
{
  "cheerio": "^1.0.0",
  "dotenv": "^16.4.7",
  "playwright": "^1.x"
}
```

Node ≥20, TypeScript ESM (`"type": "module"`), `node:test` for unit tests.

### npm scripts (match siblings)

```json
{
  "dev": "tsx src/index.ts",
  "build": "tsc",
  "test:build": "npm run build && npm test",
  "scrape": "node dist/index.js",
  "scrape:dry-run": "node dist/index.js --dry-run",
  "scrape:backfill": "node dist/index.js --backfill",
  "session:bootstrap": "tsx src/bootstrapSession.ts"
}
```

---

## CLI interface (match G League exactly)

```
npm run scrape -- [options]

Options:
  --backfill             Discover all players and ingest
  --dry-run              Parse and log payloads; do not POST
  --resume               Skip slugs in checkpoint (default with --backfill)
  --fresh                Ignore checkpoint and reprocess all
  --limit <n>            Cap players processed
  --player-slug <slug>   Single player test
  --delay <ms>           Override request delay
  --health               Hoop Central health check
  --use-fixtures         Offline HTML fixtures
  --use-browser          Playwright fetch (default for live)
  --use-fetch            Force Node fetch
  --browser-headless     Headless browser
  --help
```

### Recommended dev workflow

```bash
# 1. Setup
cp .env.example .env
# Copy HOOP_CENTRAL_API_URL and INGEST_API_KEY from GLeagueScraper5.0/.env
npm install
npx playwright install chromium
npm run build

# 2. Health check
npm run scrape -- --health

# 3. Bootstrap usbasket login (user logs in manually)
npm run session:bootstrap

# 4. Save HTML fixture from one real player page, then:
npm run scrape:dry-run -- --use-fixtures --player-slug <test-slug>

# 5. Single live player
npm run scrape:dry-run -- --use-browser --player-slug <test-slug>
npm run scrape -- --use-browser --player-slug <test-slug>

# 6. Verify on Hoop Central web UI

# 7. Backfill
npm run scrape:backfill -- --use-browser --resume
```

---

## Logging conventions (use these prefixes)

```
[usbasket]   HTTP / WAF / rate limit messages
[index]      Discovery crawl progress (season, letter, sort)
[player]     Per-player processing
[season]     Successful season ingest
[season-fail] Failed season ingest
[skip]       Player with no stat rows
[dry-run]    Would-have-posted payloads
[error]      Fatal per-player errors
[link]       Cross-source identity linking (if implemented)
```

Also write a line-per-player log file: `scrape-ncaa-backfill.log`

Checkpoint file: `scrape-ncaa-backfill.checkpoint.json`

```json
{
  "version": 1,
  "completedSlugs": ["player-id-1", "player-id-2"],
  "allSlugs": ["..."],
  "updatedAt": "2026-06-17T..."
}
```

---

## Stats mapping reference

### Standard stats (same as G League / U Sports)

| usbasket (expected) | Ingest field | Type |
|---------------------|--------------|------|
| GP / Games | `gamesPlayed` | number (required) |
| PPG | `pointsPerGame` | number (required) |
| RPG | `reboundsPerGame` | number (required) |
| APG | `assistsPerGame` | number (required) |
| SPG | `stealsPerGame` | number (optional) |
| BPG | `blocksPerGame` | number (optional) |

### New stats (user request)

| usbasket column | User name | Proposed ingest field | Notes |
|-----------------|-----------|----------------------|-------|
| `FGP` | field goal % / 2FGP | `fieldGoalPct` | Confirm meaning on player page — is it 2PT only or overall FG%? |
| `3FGP` | three-point % | `threePointPct` | Percentage as shown on site |

Round per-game stats to 1 decimal. Percentages: match site display (likely 1 decimal, e.g. `45.2`).

---

## Identity linking (optional but good to have)

G League links to BallDontLie via `POST /api/ingest/player-bio` with `linkTo`:

```json
{
  "source": "basketball-reference-gleague",
  "externalId": "curryse01d",
  "player": { "displayName": "Seth Curry" },
  "linkTo": { "source": "balldontlie", "externalId": "<bdl-id>" }
}
```

For NCAA, many players later appear in NBA data. **Optional phase 2:**
- Load `GET /api/ingest/completion-status?source=balldontlie`
- Fuzzy match by normalized name + birthDate
- If matched: minimal bio POST + bio pass-through (do NOT overwrite BIO-Scraper fields)

**For v1, standalone ingest is fine** — ask the user if they want linking now.

If linking: copy `src/scrape/linking.ts` and `src/utils/profile.ts` from GLeagueScraper.

---

## Bio handling rule (do not break BIO-Scraper)

If you link to an existing Hoop Central player:
1. POST minimal `player-bio` with just `displayName` + `linkTo`
2. `GET /api/players/:id` to fetch existing profile
3. Pass through existing bio fields on season POSTs (`birthDate`, `position`, `heightCm`, etc.)
4. **Never send empty/null bio fields that would wipe data scraped by BIO-Scraper**

---

## Testing requirements

1. **Offline parsing tests** — save real usbasket HTML fixtures under `src/test/fixtures/`, test cheerio parsers with `node:test` (no live HTTP in CI/tests)
2. **Discovery tests** — verify URL builders and slug extraction from fixture HTML
3. **Dry-run** — log full JSON payloads before any live ingest
4. **Single player live test** — confirm one player appears correctly on Hoop Central with all seasons + FG%/3FG%
5. **Do not run full backfill in tests** — use `--limit 3` for smoke tests

---

## Files to copy almost verbatim from GLeagueScraper5.0

- `src/ingestClient.ts` — change nothing except maybe log prefix
- `src/utils/rateLimiter.ts`
- `src/utils/teams.ts`
- `src/utils/season.ts`
- `src/scrape/checkpoint.ts` — rename defaults to `scrape-ncaa-*`
- `src/scrape/slugCache.ts`
- `package.json` structure / `tsconfig.json`

Adapt heavily from USportsScraper5.0:
- `src/scrape/browserContext.ts`
- `src/scrape/browserFetch.ts`
- `src/scrape/session.ts`
- `src/bootstrapSession.ts`
- `src/scrape/discovery.ts` (rewrite URLs for usbasket NCAA1)

---

## What NOT to do

- Do not insert directly into Hoop Central's database — always use ingest API
- Do not use one discovery page and assume full coverage
- Do not hammer the site — conservative pacing, checkpoint resume
- Do not commit `.env`, session files, cookie files, or `playwright/` profiles
- Do not break existing scrapers when adding FG% columns — make new fields optional
- Do not guess usbasket DOM selectors — inspect real pages and save fixtures first
- Do not skip `--dry-run` before first live ingest

---

## Verify success

After single-player ingest, check Hoop Central:

```
https://hoopcentral-50-production.up.railway.app/players/<playerId>
```

Confirm:
- Player exists with correct `displayName`
- League shows "NCAA Division I"
- All seasons from usbasket appear with correct teams
- Stats match usbasket (PPG, RPG, APG, SPG, BPG)
- FG% and 3FG% display correctly (after DB/API update)
- Re-running ingest is idempotent (no duplicates)

---

## Summary checklist

- [ ] Read GLeagueScraper5.0, USportsScraper5.0, HoopCentral ingest docs
- [ ] Ask user the questions above (login, source string, linking, FG% meaning)
- [ ] Inspect usbasket HTML structure live; save fixtures
- [ ] Scaffold NCAAD1Scraper project
- [ ] Implement Playwright session + discovery + parsing
- [ ] Add FG%/3FG% to Hoop Central DB + API if needed (optional fields)
- [ ] Offline tests pass (`npm run test:build`)
- [ ] Dry-run single player looks correct
- [ ] Live single player ingest verified on Hoop Central
- [ ] Backfill with checkpoint/resume works
- [ ] README with setup, WAF notes, test players, env vars

Good luck. When in doubt, copy the pattern from the sibling scraper that solved the same problem — G League for ingest architecture, U Sports for bot blocking on a non-BRef site.
