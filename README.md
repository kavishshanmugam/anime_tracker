# Senpai — Anime Tracker

A local-first desktop app that tracks your anime watching, syncs airing schedules from AniList, and never loses track of sequels.

## Features

- **Library management** — Watching, Completed, Plan to Watch, On Hold, Dropped with scores, notes, and progress tracking
- **MAL / AniList import** — One-time migration from MyAnimeList XML export or AniList username
- **Airing calendar** — Week and month views showing upcoming episodes for your shows
- **Season watchdog** — Automatically detects sequels and spin-offs for shows you've watched
- **Recommendations** — For You + a Home row: learns from what you complete (no ratings needed; low scores and drops count against similar shows), combines AniList recommendations across your favourites with your genre/tag taste, explains each pick, and filters by genre, Sub/Dub, airing and hidden gems
- **Seasonal browser** — Browse what's airing each season
- **Stats** — Episodes watched, hours, genre breakdown, score distribution, watch heatmap
- **Up Next** — Home lists every show you're watching whose next episode is out; airing shows you've caught up on move to *Caught Up* (with a countdown) and pop back the moment the next episode airs
- **Sub / Dub** — pick per show from the episode list (applies to every episode); dubs are found under English titles and AniList alternate names, with a sub fallback when no dub exists
- **English dub tracking** — dub status (complete / in progress / sub only) from the community MAL-Dubs list, DUB badges, Sub/Dub and airing filters, and a notification when a show's dub finishes
- **Subtitles** — English subtitle tracks are switched on automatically; change or turn off from the player's ⚙ menu
- **Streaming-style UI** — Top navigation, rotating hero banner, horizontal shelves, episode thumbnails & titles (AniList), series pages with episode grids, player with Up Next list
- **In-app streaming** — Locked-down player with skip intro/outro (AniSkip), an on-video ⚙ menu for 0.5–3x speed and "Best available" quality that steps down only when it buffers, auto progress tracking and next-episode prompt
- **Self-healing sources** — Streaming sites are data-driven, health-checked, auto-failover between mirrors, and new domains are discovered automatically when one dies
- **Security gate** — Every streaming domain is vetted (malware DNS filters, domain age, redirects, parked/fake-site detection) before the player will load it
- **Command palette** — Ctrl+K to search and jump to any show
- **Data export/import** — Full JSON backup and restore

## Install

### Option A: Use the pre-built installer (recommended)

If someone has already built the installer for you:

1. Double-click **`Senpai Setup X.X.X.exe`**
2. Follow the prompts
3. Done — Senpai is in your Start Menu

No Node.js or anything else needed.

### Option B: Build the installer yourself

Requires **Node.js** v18+ ([nodejs.org](https://nodejs.org/), LTS recommended) and **Windows 10/11**.

1. Double-click **`INSTALL.bat`**
2. Wait for dependencies + build (~2-5 min on first run)
3. The installer opens automatically — click through to install
4. Done — delete the project folder if you want

The built installer (`release/Senpai Setup X.X.X.exe`) can be copied to any other PC and run without Node.js.

Senpai installs to `%LOCALAPPDATA%\Programs\Senpai\` and appears in the **Start Menu**.

## Uninstall

Uninstall from **Windows Settings > Apps > Senpai** like any other program.
This removes the app and all its data (database, backups, settings).

## Data

Your database is stored at `%APPDATA%\senpai\` and is automatically backed up on every launch (keeps last 5).
Export anytime from Settings as JSON.

## Importing from MyAnimeList

1. Go to [myanimelist.net](https://myanimelist.net) > Profile > Export (or [direct link](https://myanimelist.net/panel.php?go=export))
2. Download and extract the `.xml.gz` file
3. In Senpai, go to **Settings** > **Import from MyAnimeList** > select the `.xml` file
4. Done — Senpai fetches cover art and metadata from AniList in the background

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+K | Command palette / search |
| Alt+1-7 | Navigate sidebar sections |
| Escape | Go back |
| S | Skip intro/outro (player) |
| N / P | Next / previous episode (player) |
| [ / ] | Slower / faster playback (player) |
| F | Fullscreen (player) |

## Streaming Sources

Third-party streaming sites change domains constantly. Senpai treats them as data, not code.

**Source list (`electron/sources/providers.json`)** — each source defines its known domains, brand names,
search URL and scraping patterns. The app ships with this file built in and, every 6 hours, fetches the latest
copy from GitHub (`master` branch). When a site moves, edit that file and push — every install picks it up
without a rebuild. The URL can be changed in **Settings → Streaming Sources**.

**How a domain is chosen**
1. Domains are health-checked every 20 min; 3 failures in a row puts a domain in cooldown (5 min → 6 h back-off).
2. The healthiest vetted domain of the highest-priority source is tried first; on failure the next mirror, then the next source.
3. Show pages are cached per source as *paths* (`/category/one-piece`), so they keep working when the domain changes.
4. Both the romaji and English titles are searched; sub is preferred over dub.
5. If nothing matches automatically, the source's search page opens and the show is learned from your click.

**Domain discovery** (runs when a source has no healthy domain, daily, or via *Find new domains*):
redirects from old domains → the source's official domain-list pages (`hubs`) → the same brand on other TLDs
(`anitaku.to`, `anitaku.bz`, …). Every candidate goes through the security gate.

**Security gate** — a domain must pass before the player will load it:

| Check | Fails when |
|---|---|
| URL shape | not HTTPS, IP address, punycode look-alike, credentials in URL, `.zip`/`.mov` TLD |
| Site family | the domain's name isn't one of the source's brand names |
| DNS | doesn't resolve, or resolves to a private/loopback address (DNS rebinding) |
| Cloudflare 1.1.1.2 | flagged as malware/phishing |
| Quad9 | blocked by Quad9 threat intelligence |
| HTTPS probe | invalid TLS, off-site redirect (ad/malware redirect, hijacked domain), HTTP downgrade, parked/for-sale page, serves a file instead of a page |
| Fingerprint | search page doesn't look like the real site (clones, parked) |
| Google Safe Browsing | optional — add an API key in Settings |

Warnings (domain < 30 days old, bot challenge, unverifiable clone, risky TLD) put the domain on hold until you
click **Approve** in Settings. Unreachable domains (down, or blocked by your ISP/firewall) are retried hourly.
Tick *Require my approval for every discovered domain* to approve every new domain by hand.

**Player hardening** — the player runs in an isolated, sandboxed session: navigation off vetted domains,
popups, downloads and permission prompts (notifications, camera, location…) are blocked, known ad/malvertising
hosts are filtered, and plain-HTTP pages are refused. Links outside the player open in your normal browser.

**Built-in sources** — Gogoanime/Anitaku (currently all domains dead), 9anime (9anime.by), AnimeSuge (animesuge.ws, animesuge.lol) and 4anime (4anime.lol). These are unofficial mirrors of the original sites; untick any you don't want in Settings → Streaming Sources. Sites that put a bot check in front of everything are marked *browser-only*: Senpai never fetches them in the background — you pick the show once in the player and later episodes open directly.

**Adding a site you trust** — *Settings → Streaming Sources → Add a site you trust*: paste any link from the site.
Senpai runs the security gate first, then reads the homepage's search form / tries common search URLs, test-searches
a known title, detects gogo-style clones, and saves it as a source. In the player, *Source → Paste a link* does the
same for a specific episode page and plays it immediately.

**Manual source** — *Settings → Streaming Sources → Advanced: define a source manually*. "Gogo layout" works for
gogoanime clones; "Generic layout" finds the show by link titles and learns the episode URL pattern the first
time you pick an episode.

**Self-test** — `npm run test:sources` runs the security gate against live known-bad domains (Cloudflare and
Quad9 test domains) and exercises the engine against simulated mirrors. Add `-- --live` to run real discovery.

## Development

```
npm install
npm run dev
```
