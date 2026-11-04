# Senpai — Anime Tracker

A local-first desktop app that tracks your anime watching, syncs airing schedules from AniList, and never loses track of sequels.

## Features

- **Library management** — Watching, Completed, Plan to Watch, On Hold, Dropped with scores, notes, and progress tracking
- **MAL / AniList import** — One-time migration from MyAnimeList XML export or AniList username
- **Airing calendar** — Week and month views showing upcoming episodes for your shows
- **Season watchdog** — Automatically detects sequels and spin-offs for shows you've watched
- **Recommendations** — AniList-powered suggestions based on your library
- **Seasonal browser** — Browse what's airing each season
- **Stats** — Episodes watched, hours, genre breakdown, score distribution, watch heatmap
- **In-app streaming** — Watch episodes directly via embedded webview with skip times (AniSkip)
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

## Development

```
npm install
npm run dev
```
