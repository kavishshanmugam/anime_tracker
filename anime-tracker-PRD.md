# Product Requirements Document — Anime Tracker (Desktop)

**Working title:** *Senpai* (placeholder)
**Type:** Local-first desktop app + browser companion. Single user, single computer.
**Status:** Draft v5 — final, build-ready
**Last updated:** July 17, 2026

---

## 0. Decisions locked in

- **Off MAL for good** — read once to migrate full history, then never again. The local DB is the sole source of truth.
- **Single computer.** No accounts, no server, no cross-device sync.
- **You watch on streaming sites in a browser** (possibly Edge + Chrome) → headline tracking is a **browser companion** installed per-browser, all feeding the one app.
- **Legal boundary:** detection and "where to watch" target **licensed** platforms only. No recognizing, scraping, embedding, or proxying unlicensed sites. In-app playback is limited to files you own.
- **Phone/social capture is parked** (see Appendix A) — the reliable version depends on screenshots or caption text, and the "share a raw reel link and auto-identify" flow isn't dependable. Not part of the v1 build.
- **Priorities:** 1) auto-progress, 2) never lose track of a franchise across seasons, 3) smart "what to watch next" (incl. mood), 4) calendar + alerts, 5) stats. **Feel/polish is a first-class requirement throughout, not a Phase-3 afterthought.**

---

## 1. Summary

A fast, genuinely nice-to-use desktop app that owns your anime life and does the remembering for you. Migrate your MyAnimeList history once; after that the app tracks progress automatically as you watch, recommends from your taste and your mood, and — crucially — watches the franchise graph so a sequel arriving a year later lands on your calendar with a reminder of exactly where you left off. It should look good, feel instant, and stay out of the way: dark by default, cover-art-forward, skeleton-loaded, optimistic, and quiet.

---

## 2. Goals and non-goals

### Goals
- Migrate complete MAL history once; be the single source of truth.
- Auto-update progress hands-free (browser live tracking + daily confirmable history scan).
- Never lose your place across seasons: proactively track upcoming sequels/spin-offs, remember where you left off, surface them on the calendar.
- Bulk actions: mark a whole series completed / up-to-episode-N in one move; multi-select edits.
- Recommend from watch history (with reasons) and by **mood**; learn from "not interested".
- Calendar with **week and month** views, delay-aware, including upcoming-season dates.
- Stats + year-in-review. Export/back up your own data.
- **A polished, dark, aesthetic UI that feels effortless and fast** (see §6).

### Non-goals
- No ongoing MAL dependency/sync.
- No integration with unlicensed/piracy sites.
- No cloud storage, accounts, or cross-device sync.
- No social features, no manga/other media in v1, no separate mobile/web app.
- No phone/social capture in v1 (parked — Appendix A).

---

## 3. Target user

One person: you. One computer. A power user migrating off MAL who watches mostly on licensed streaming sites and wants tracking automatic, franchises remembered, and the whole thing pleasant to open every day.

---

## 4. Architecture at a glance

Three local parts:
1. **Desktop app** (Tauri) — library, recommendations, mood mode, calendar, season watchdog, stats, detail pages, and the local SQLite DB (source of truth).
2. **Browser extension** — installed in each browser you watch in; live-tracks licensed sites and runs the daily history scan; talks to the app over a localhost WebSocket.
3. **AniList API** (+ Jikan fallback) — metadata, airing schedules, **relations** (season watchdog), recommendation graph, licensed streaming links. No account.

The app works fully offline from cache; the others are refreshers.

---

## 5. Feature requirements

### 5.1 Auto-tracking via browser companion — PRIORITY 1 (Phase 1)
- **Live tracking:** the extension recognizes licensed streaming sites, extracts title + episode, and reports to the app, which marks an episode watched past a ~70–80% threshold and advances status automatically. Per-browser install; all instances feed one app, which de-duplicates.
- **Daily history backfill (confirmable):** a daily alarm in the extension scans history *since last scan* (small, fast; runs whenever the browser is open, independent of the app), stages detections in extension storage, and syncs to the app's `pending_review` table on connect.
- **Review** is a batched, grouped prompt on next app open: per-show editable range + Accept / Adjust / Dismiss + "approve all". A visited URL ≠ watched, so nothing commits silently; dismissals are remembered; suggestions only move progress forward.

### 5.2 Season & sequel watchdog — PRIORITY 2 (Phase 1 core, Phase 2 polish)
The fix for MAL's biggest gap.
- For every franchise you've **watched, are watching, or rated highly**, periodically walk AniList **relations** (SEQUEL / SIDE_STORY / SPIN_OFF / ALTERNATIVE / PARENT) for entries with status `NOT_YET_RELEASED` or `RELEASING`.
- When a related entry has (or gains) a **start date / airing schedule**, add it to the calendar automatically and surface it in a **"Coming for you"** area.
- Each card shows a **franchise timeline with a "you are here" marker**: what you watched, when you finished, what's next — e.g. "Finished S1 (24/24) Mar 2024 · S2 ep 1 airs Apr 6 · you're caught up." Includes add-to-plan, add-to-calendar (auto for scheduled), and a "need a recap?" hint for long gaps.
- **Notifications:** sequel announced → scheduled → starts this week. Mute-per-franchise to avoid noise.
- **Watch-order guidance** for tangled franchises (recaps/movies/OVAs interleaved; chronological vs airing order), flagging skippable compilation entries.
- **"Where you left off" memory** everywhere: continue-watching and detail views show last-watched episode + date.

### 5.3 What to watch next + mood — PRIORITY 3 (Phase 1 base, Phase 2 mood)
- **Continue Watching** home hero; **completion nudges** ("1 episode left"); **stale detection** ("untouched 3 months — resume or drop?").
- **Mood recommender:** a "What should I watch?" input — pick a vibe (chill / mind-bending / hype / short & funny / make me cry / comfort rewatch) or (optionally) type it. Maps mood → AniList tags/genres (+ implied filters like short = low episode count, "to binge" = finished airing), ranks by your taste profile, returns a few picks with reasons. Toggle scopes it to **your plan-to-watch backlog** or **the whole catalog**. Tag-rule-based locally; optional LLM layer for free-text moods (open question §12).
- **Queue** from in-progress + plan-to-watch weighted by taste/recency; **"surprise me"** single pick.

### 5.4 Calendar — PRIORITY 4 (Phase 1 week, Phase 2 month + alerts)
- **Week and month views** (toggle) + agenda ("today / this week"), local time.
- Shows next episodes for currently-watching shows **and** upcoming-season dates from the watchdog.
- **Delay-aware:** reflects broadcast slips/breaks with a "delayed / on break" state and "episodes behind" counts.
- Desktop **notifications** for new episodes, plan-to-watch shows starting, and watchdog events.

### 5.5 Recommendations + "not interested" (Phase 1 base, Phase 2 refine)
- AniList recommendation-graph aggregation across your rated shows ("Because you liked X"); Phase 2 adds a content-based taste profile (genre/tag/studio/staff affinities).
- **"Not interested"** on any rec removes it, remembers it (never resurfaces), and down-weights its genres/tags/franchise as a negative signal.

### 5.6 Library + bulk actions (Phase 1)
- Statuses (Watching / Completed / Plan / On Hold / Dropped), score (10-pt / 100-pt / 5-star), progress, dates, notes, custom tags, **rewatch tracking**.
- **Bulk / instant complete:** "Mark whole series completed" (progress→finale, status→completed, finish date→today) and "watched up to episode N" picker for partial binges.
- **Multi-select mode:** apply status/score to many titles at once.
- Sort, filter, search.

### 5.7 MAL migration (one-time, Phase 1)
Import full history via MAL XML export (or optional MAL-API read; or AniList/Kitsu exports). Parse → **preview** (counts by status, flag unmatched) → confirm. MAL never contacted again.

### 5.8 Where-to-watch links (Phase 1)
From a detail page, open the **licensed** platform streaming the title (AniList `externalLinks`), best-effort to the right episode, else series page. Honest labeling; no fabricated links.

### 5.9 Stats + year-in-review (Phase 2→3)
Hours, episodes, genre/tag/studio breakdowns, score distribution, seasonal history; a Wrapped-style annual recap.

### 5.10 Data backup/export (Phase 1)
One-click JSON export + re-import + automatic local DB backups. Non-negotiable since MAL is no longer a fallback copy.

### 5.11 First-launch onboarding (Phase 1)
A short wizard: run MAL migration (with preview); auto-detect installed browsers and one-click-add the extension to each with a live connection status. (Browsers block silent extension installs, so extension-add is one guided click per browser.)

### 5.12 In-app playback of your own files (optional, Phase 3)
Point at local folders; parse filenames with Anitomy; built-in player; playback updates progress. Secondary to browser tracking.

---

## 6. UI / UX & visual design

The brief: **dark theme, aesthetic, skeleton loading, and details that make it feel easy and good.** This section is a first-class requirement.

### 6.1 Design principles
- **Instant over everything.** Open to cached content with no spinner. Every user action responds immediately (optimistic), then persists in the background.
- **The cover art is the design.** The UI shell stays quiet and neutral so vivid posters carry the color and energy. Poster grids are the hero.
- **Quiet by default, expressive on demand.** Minimal chrome, generous space, one considered accent. Spend boldness in one place (the signature, §6.4), keep everything else disciplined.
- **Every state is designed** — loading, empty, and error states are part of the product, not gaps.
- **It explains itself.** Recommendations, nudges, and auto-detections always say why, and are always correctable.

### 6.2 Dark theme + a distinctive direction
Dark is the default (a light mode can come later). Avoid the AI-default "near-black + one acid-green accent" look. The chosen direction: a **restrained neutral-dark shell with a per-show dynamic accent extracted from each title's cover art** — most surfaces are calm neutral dark, and a show's detail page subtly tints its accents (buttons, progress bar, highlights) with a color sampled from its poster. This is grounded in the subject (anime posters are saturated and distinct) and gives every show a slightly different feel without theming work. A neutral default accent is used where no art context applies.

**Starter token set** (refine at build; derive everything from tokens):
- Surfaces (layered for depth): `--bg-0 #0F1113` (app base), `--bg-1 #16191C` (cards), `--bg-2 #1D2125` (raised/hover), hairline border `--border #262B30`.
- Text: `--text-1 #ECEEF0` (primary), `--text-2 #A2ACB4` (secondary), `--text-3 #6B767E` (muted).
- Default accent: `--accent #7E7BF2` (calm iris) — overridden per-show by a poster-derived color at runtime.
- Status: watching `#7E7BF2`, completed `#4FD1A1`, planned neutral, delayed/warning `#E0A46B`, dropped/muted.
- Radius `10–14px`, soft elevation shadows, hairline borders over heavy shadows.

### 6.3 Typography
Type carries personality; avoid the default Inter-everywhere look.
- **Display** (titles, hero, section heads): a characterful grotesque or editorial face used with restraint — e.g. *Clash Display*, *General Sans*, or *Hanken Grotesk*.
- **Body/UI:** a clean, highly legible sans — e.g. *Geist* or *Satoshi* (a small step away from default Inter).
- **Data/utility** (episode counts, timestamps, stats): a monospace — e.g. *Geist Mono* — so numbers feel tactile and align.
- Set a real type scale with intentional weights; two weights per family is plenty.

### 6.4 Signature element
The one memorable thing: the **cover-art-forward "Continue Watching" hero + the "Coming for you" franchise timeline**, both using the per-show poster-derived accent. The franchise timeline with its "you are here" marker is the emotional core (it's the feature that fixes the MAL pain) and should be the most crafted component in the app.

### 6.5 Loading & skeleton states
- **Skeletons, never spinners**, for any genuinely-loading region. Each skeleton is **shape-matched** to its final layout (poster tiles, detail blocks, calendar cells, stat bars) with a subtle shimmer.
- Because data is cached locally, skeletons appear mainly on **first run** and during **background network refreshes** — steady-state opens are instant.
- **Progressive reveal:** render each region as its data arrives rather than blocking the whole screen; cached shell first, fresh data streams in.
- A quiet "updating…" affordance (not a blocking overlay) when a background refresh is running.

### 6.6 Feedback, optimistic updates & undo
- **Optimistic writes:** +1 progress, status/score changes, and bulk actions apply to the UI instantly and sync after; on failure, revert with a clear toast.
- **Toasts with undo** for meaningful actions ("Marked episode 9 watched · Undo"). Auto-tracking surfaces a non-intrusive "Just tracked Frieren ep 9 · Undo".
- **Confirmations only for destructive/bulk** actions, never for routine ones.
- Copy is active-voice and consistent (a "Mark completed" control produces a "Marked completed" toast); sentence case throughout.

### 6.7 Empty, error & edge states
- Empty states are **invitations to act**, not blank voids: "Nothing airing this week." / "Your backlog's empty — add something from Discover." with a clear next action.
- Errors state **what happened and how to fix it**, in the interface's voice, never a vague apology: "Couldn't reach AniList — showing your last saved data. Retry."
- Honest edge cases: "No licensed platform found for your region" instead of a dead button.

### 6.8 Navigation & information architecture
- Persistent **left sidebar**: Home (Continue Watching) · Coming for you · Library · Calendar · For you · Stats.
- **Top bar**: search + a notifications bell (watchdog/airing/review counts).
- Detail opens as a route/overlay with a clear back affordance. Keep nav minimal and stable.

### 6.9 Motion & micro-interactions
- Motion is **deliberate and quick** (≈150–250ms): view crossfades, a gentle hover-lift on poster cards, smooth progress-bar fills, a satisfying check animation on "mark watched."
- One orchestrated moment beats scattered effects — e.g. the "Coming for you" card revealing the timeline. Avoid decorative animation that reads as AI-generated filler.
- **Respect `prefers-reduced-motion`** (swap motion for instant/fade).

### 6.10 Keyboard & command palette
- **Command palette** (Cmd/Ctrl-K): jump to any show, run actions (mark watched, add to plan, open calendar).
- `/` focuses search; quick keys for +1 progress and status on a focused card.
- Full keyboard navigation as a floor, not a feature.

### 6.11 Accessibility & responsiveness (quality floor)
- WCAG AA contrast for text even on dark surfaces; visible keyboard focus rings; alt text on covers; scalable type.
- Fluid poster grid that reflows by window width; sensible minimum window size; no layout breakage on resize.

### 6.12 Copy voice
Plain, active, sentence case, no filler. Name things by what the user controls ("Where to watch", not "External links provider"). Failure and emptiness give direction, not mood. An action keeps the same verb through its whole flow.

---

## 7. Data sources

| Source | Role | Auth |
|---|---|---|
| MAL XML export (+ AniList/Kitsu exports) | One-time migration | None (files) |
| AniList GraphQL | Metadata, airing schedules, **relations (watchdog)**, recommendation graph, licensed streaming links | None for public reads |
| Jikan (v4) | Read-only metadata fallback | None |
| Browser extension (yours) | Live tracking + daily history scan | Local |

ID mapping via a maintained MAL↔AniList crosswalk (JSON), manual override for gaps. Cache locally; respect rate limits; verify API terms at build.

---

## 8. Data model (local, SQLite) — selected

- **anime** — ids (`mal_id`, `anilist_id`), titles, `cover_url`, `cover_accent` (poster-derived color), `episodes_total`, `status`, season/year, studio, `genres`, `tags`, `relations`, `updated_at`.
- **library_entry** — `anime_id`, `my_status`, `my_score`, `score_scale`, `progress`, `rewatch_count`, `started_at`, `finished_at`, `last_watched_at`, `notes`, `custom_tags`, `source`, `updated_at`.
- **airing_schedule** — `anime_id`, `episode`, `airing_at`, `state` (scheduled/delayed/break).
- **franchise_watch** — `root_anime_id`, `related_anime_id`, `relation_type`, `release_status`, `start_date`, `surfaced_at`, `state` (watching/muted/dismissed).
- **not_interested** — `anime_id`, `reason`, `created_at`.
- **pending_review** — `anime_id`, `detected_range`, `source_url_host`, `state`, `detected_at`.
- **watch_event** — `anime_id`, `episode`, `source` (browser/manual/file/bulk/history), `watched_at`.
- **app_state** — crosswalk version, `last_history_scan_at`, `last_watchdog_scan_at`, refresh/backup times.

---

## 9. Tech stack

- **Desktop:** Tauri (Rust core + web frontend). Frontend: React or Svelte + Tailwind, with a small **design-token layer** (§6.2) driving all color/space/type; per-show accent applied at runtime from `cover_accent` (extract with a small color-thief-style pass on the poster). Storage: SQLite.
- **Browser extension:** one WebExtension codebase installed per-browser (Chrome/Edge/Firefox); localhost WebSocket to the app (scales to N browsers, localhost-bound + token). Permissions: `history`, `alarms`. Live tracking + daily history-scan alarm + offline staging.
- **Networking:** GraphQL to AniList; tokens (only for optional MAL-API import) stay in the Rust layer.
- When building UI, follow a token-first approach and a distinctive, non-templated visual direction (see §6); refine the starter palette/type rather than shipping defaults.

---

## 10. Non-functional requirements

- **Performance:** cold start < ~2s; instant scroll/filter on 1,000+ titles; local edits reflect < 100ms; background jobs (recs, watchdog, history scan) never block the UI.
- **Perceived performance:** cached shell renders immediately; skeletons only for genuinely-loading regions; background refresh is non-blocking.
- **Offline:** full library + last-known schedule + cached recs without a connection.
- **Privacy:** all data local; no telemetry unless you add it.
- **Durability:** JSON export/import + automatic local backups.
- **Resilience:** every external call cached and degrades gracefully; a failure never blocks the app.
- **Quality floor:** keyboard-navigable, visible focus, reduced-motion respected, AA contrast.

---

## 11. Roadmap

**Phase 0 — Setup:** Tauri scaffold, SQLite schema, **design-token layer + app shell** (sidebar: Continue Watching / Coming for you / Library / Calendar / For you / Stats), skeleton + toast primitives, backup plumbing.

**Phase 1 — MVP:** MAL migration; browser extension + **live tracking** + **daily history scan**; **season & sequel watchdog** (core); **Continue Watching + bulk complete**; **week calendar**; basic **recommendations**; where-to-watch; onboarding; export. Dark theme, skeletons, optimistic updates, empty/error states all in from the start (they're cheap when built first, expensive when retrofitted).

**Phase 2 — Smarter:** more-site tracking; **month calendar + alerts + delay handling**; **mood recommender**; **"not interested" learning**; content-based recs; watch-order guides; multi-select bulk edit; **stats + year-in-review**; rewatch/scale/tags; command palette; motion polish.

**Phase 3 — Extras:** optional local-file player (Anitomy); recommendation tuning; light theme/theming; (revisit Appendix A capture if desired).

Ship Phase 1 first: migration + tracking + the season watchdog is the core value, and building the dark/skeleton/optimistic UX from day one is what makes it feel good rather than bolted-on.

---

## 12. Open questions
1. **Shell:** Tauri (recommended) or Electron?
2. **Streaming site(s)** you watch on most — first recognizer target.
3. **Browser(s)** — e.g. Edge + Chrome (same extension in each).
4. **Mood recommender:** tag-rule-based only, or add an optional LLM layer for free-text moods?
5. **Frontend framework:** React (bigger ecosystem) or Svelte (lightest) under Tauri?

---

## 13. Risks & mitigations
- **App is the only copy of your history** → JSON export + auto backups from day one.
- **Watchdog noise** (every OVA pinging you) → only surface entries with a real release status/date; mute-per-franchise; group under "Coming for you" instead of spamming notifications.
- **Streaming sites change page structure** → isolated per-site recognizers, easy to fix; degrade to manual.
- **API terms/limits change** → cache-first, backoff, offline-usable, verify at build.
- **ID mapping gaps** → maintained crosswalk + manual override.
- **UX rot from retrofitting polish late** → build dark theme, skeletons, optimistic updates, and empty/error states in Phase 1, not later.
- **Scope creep** → hold the non-goals line; capture stays parked (Appendix A).

---

## Appendix A — Parked: phone / social capture

Explored and deliberately deferred. The intent was to fire a show at the app from your phone when a reel/TikTok catches your eye. Findings:
- A shared reel/TikTok delivers a **link, not the video**; the link contains no anime name.
- Reliable identification needs either a **screenshot** (share the image → trace.moe scene search → title + episode) or the **caption/on-screen text** (fetch link metadata → resolve title). Both work; the screenshot path is the most dependable.
- The "share a **raw link** and auto-identify the anime" flow is **not dependable** — it requires downloading the video off TikTok/Instagram (against their terms, and constantly broken by platform changes), and even then heavily-edited reels resist matching.
- An **Instagram/TikTok bot account** to DM shares to isn't viable: Instagram's Messaging API needs a Business/Creator account + Meta app + App Review and is built for business messaging; TikTok's SDK only shares *into* TikTok with no inbound path; unofficial password-login bots violate ToS and risk bans. The workable equivalent is the phone's **OS share sheet → a Telegram bot (via BotFather, hosted locally) or an iOS Shortcut**.

If revisited (Phase 3), the honest design is: **caption/metadata parsing as the reliable primary, screenshot→trace.moe as the strong secondary, raw-link video analysis as a best-effort bonus only.** A small self-hosted relay (e.g. Raspberry Pi 5 reachable over Tailscale) can hold the queue for the app to pull.

---

*Legal note: detection and "where to watch" target licensed platforms only; no unlicensed-site integration. In-app playback is limited to files you own. MAL is read once, for migration. Keeping these true keeps the project on the right side of the law and the source APIs' terms.*
