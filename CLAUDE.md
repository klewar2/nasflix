# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nasflix: a personal Netflix-style catalog + streaming app for movies/series stored on a Synology NAS. Metadata comes from TMDB (`language=fr-FR`) and lives in PostgreSQL, so the catalog stays browsable when the NAS is off. Multi-tenant: data is scoped by **CineClub** (a club owns media, members, NAS config, secrets). Deployed on Railway.

UI text, code comments, and commit messages are in **French** (conventional-commit style, e.g. `feat(tv): …`, `fix(deletion): …`).

## Commands

```bash
docker compose up -d       # PostgreSQL 16 + Redis 7 (required for the API)
pnpm dev                   # all apps in parallel (api :4000, web :5173, tv :5174)
pnpm build                 # turbo build
pnpm type-check            # tsc --noEmit in every workspace — the main verification step
pnpm lint                  # eslint (api + web only)
pnpm db:generate           # prisma generate
pnpm db:migrate            # prisma migrate dev (run from repo root)
```

Scope to one workspace with pnpm filters: `pnpm --filter @nasflix/api dev` (also `@nasflix/web`, `@nasflix/tv`, `@nasflix/shared`).

Tests exist only in the API (Vitest, currently just `src/common/media-parser.test.ts`):

```bash
pnpm --filter @nasflix/api test                          # vitest run
pnpm --filter @nasflix/api exec vitest run src/common/media-parser.test.ts   # single file
```

TV app for LG webOS: `pnpm --filter @nasflix/tv build:ipk` builds and packages an .ipk via `ares-package` (requires webOS CLI; `scripts/package-webos.mjs` generates icons + appinfo.json).

API env: `cp apps/api/.env.example apps/api/.env` (DATABASE_URL, JWT secrets, TMDB_API_KEY, CORS_ORIGIN, REDIS_HOST/REDIS_URL, PORT). Most runtime configuration (NAS URL, Radarr/Sonarr, SSH seedbox, WoL, Gmail, Anthropic key…) is **per-CineClub in the database**, edited through the backoffice Settings page — not env vars.

## Monorepo layout

pnpm workspaces + Turborepo.

- `apps/api` — NestJS 11 + Prisma 6. All routes prefixed `/api` (global prefix in `main.ts`). BigInt is monkey-patched to serialize as string in JSON.
- `apps/web` — React 19 + Vite SPA (React Router v7 in `src/router.tsx`, TanStack Query 5, ShadCN/ui, Tailwind v4). Public catalog pages + `/admin/*` backoffice.
- `apps/tv` — React app for LG webOS TVs (remote-control navigation, hls.js player). Talks to the same API via `src/lib/api.ts`; `VITE_API_URL` points at the deployed API.
- `packages/shared` — TypeScript types shared by all apps (`@nasflix/shared`), consumed directly from source (no build step).
- `scripts/nas` — shell scripts installed in Synology DSM Task Scheduler: `sync-on-boot.sh` (boot webhook) and `watch-downloads.sh` (5-min file diff → webhook).

## Backend architecture (apps/api/src)

NestJS modules, one directory each: `auth`, `users`, `cineclubs`, `media`, `metadata` (TMDB client), `nas` (streaming, File Station/VideoStation, Wake-on-LAN, Freebox), `sync` (NAS scan + reconciliation), `jobs` (download/deletion pipeline), `recommendations` (AI recos via Anthropic SDK), `mail` (Gmail via nodemailer), `health`, `common` (Prisma module, filename parser).

**Auth**: JWT access + refresh (Passport). The JWT payload carries `sub` (user id) and `cineClubId` — most endpoints resolve tenant scope from the token. Guards/decorators in `auth/guards`: `@Public()` skips auth, `@Roles()` + RolesGuard checks CineClub membership role (ADMIN/VIEWER), SuperAdminGuard checks `User.isSuperAdmin` (cross-club administration, user management).

**Async work**: two BullMQ queues on Redis — `metadata-sync` (`sync/sync.processor.ts`) and `nasflix-jobs` (`jobs/jobs.processor.ts`). Three Socket.IO gateways (`sync`, `jobs`, `nas`) push realtime progress/NAS-status to the frontends. `@nestjs/schedule` drives cron work (jobs cleanup, recommendation refresh, WoL boot detection).

**Sync pipeline**: NAS webhook (`POST /api/sync/webhook`) or manual trigger → File Station recursive scan → `parse-torrent-title` + custom parser extract title/year/S­xxEyy/quality/HDR/Atmos → TMDB search with scoring → upsert Media (keyed on `[cineClubId, nasPath]`). Series episodes are deduplicated into one Media with Seasons/Episodes. The webhook authenticates via per-CineClub `webhookSecret` (header `X-Sync-Secret`), which also identifies the tenant; env `SYNC_WEBHOOK_SECRET` is legacy.

**Streaming** (`nas/nas.service.ts`): preferred path is Synology VideoStation HLS — the browser talks to the NAS directly (media found by `nasPath`, fallback by title). If VideoStation is unavailable, falls back to an FFmpeg proxy through the API (`ffmpeg-static`). Subtitles are extracted from the media file and cached as VTT in `SubtitleCache`. Also here: Wake-on-LAN magic packets (admin-only; wake state persisted on CineClub) and Freebox integration.

**Jobs pipeline** (`jobs/`): tracks media lifecycle across external systems — Radarr/Sonarr grabs → seedbox download → rsync over SSH from seedbox to NAS (`ssh2`; CineClub stores seedbox and NAS SSH credentials) → deletion cascades (seedbox with grace period, Jellyfin, Radarr/Sonarr, NAS). Job rows in Postgres drive state (`JobKind`/`JobStatus`); BullMQ executes.

**Recommendations** (`recommendations/`): scheduled batches generated with the Anthropic SDK from the club's catalog + member feedback (LIKE/DISLIKE/SEEN, denormalized to survive batch rotation), enriched via TMDB.

## Database (apps/api/prisma/schema.prisma)

Core chain: `User` —< `CineClubMember` >— `CineClub` —< `Media` —< `Season` —< `Episode`. `Media.nasPath` unique per club; `syncStatus` (PENDING/SYNCING/SYNCED/FAILED/NOT_FOUND) tracks TMDB matching; `nasDeletedAt` soft-deletes when a file disappears from the NAS. `sourceType` distinguishes NAS vs SEEDBOX items. Genre/Person are global TMDB-keyed tables joined through MediaGenre/MediaPerson.

After editing the schema: `pnpm db:migrate` (dev) — production uses `db:migrate:prod` (`prisma migrate deploy`) and the API build runs `prisma generate`.

## Frontend notes

- `apps/web/src/lib/api-client.ts` is the single fetch wrapper (JWT injection, refresh handling); server state goes through TanStack Query; realtime via `use-sync-socket.ts` / `use-jobs-socket.ts`.
- Netflix dark theme: primary `#e50914`, background `#09090b`.
- `apps/tv` has no router library — page state is managed in `App.tsx`; keep webOS constraints in mind (old Chromium, key-based navigation, native subtitle rendering when possible).
