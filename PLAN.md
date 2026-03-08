# NAS Catalog - Netflix-Like Web App

## Vue d'ensemble

Application web personnelle pour cataloguer les films et séries stockés sur un NAS Synology, avec un design inspiré de Netflix. L'app fonctionne même quand le NAS est éteint (métadonnées stockées côté cloud).

---

## Hébergement (Railway ~$5/mois)

| Composant | Service | Détails |
|-----------|---------|---------|
| Frontend (React SPA) | Railway | Vite + React Router, servi via nginx |
| Backend (NestJS) | Railway | API REST, 2 services dans le même monorepo |
| Base de données | Railway PostgreSQL | Plugin intégré |
| API métadonnées | TMDB (gratuit) | `language=fr-FR`, attribution obligatoire |

Railway supporte les monorepos : chaque service pointe vers un `Root Directory` différent (`apps/web` et `apps/api`).

---

## Architecture

### Monorepo (pnpm workspaces + Turborepo)

```
netflix-like/
├── apps/
│   ├── web/                    # React SPA (Vite + React Router)
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── HomePage.tsx
│   │   │   │   ├── FilmsPage.tsx
│   │   │   │   ├── SeriesPage.tsx
│   │   │   │   ├── MediaDetailPage.tsx
│   │   │   │   ├── SearchPage.tsx
│   │   │   │   └── backoffice/
│   │   │   │       ├── LoginPage.tsx
│   │   │   │       ├── DashboardPage.tsx
│   │   │   │       ├── MediaListPage.tsx
│   │   │   │       ├── MediaEditPage.tsx
│   │   │   │       ├── SyncPage.tsx
│   │   │   │       └── SettingsPage.tsx
│   │   │   ├── components/
│   │   │   │   ├── ui/             # ShadCN/ui
│   │   │   │   ├── media/          # MediaCard, MediaCarousel
│   │   │   │   ├── layout/         # Navbar, Sidebar, Footer
│   │   │   │   └── backoffice/     # Tables, forms admin
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   └── auth.ts
│   │   │   ├── hooks/
│   │   │   ├── router.tsx
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── Dockerfile              # nginx pour servir le build
│   │   └── nginx.conf
│   │
│   └── api/                    # NestJS Backend
│       ├── src/
│       │   ├── auth/           # JWT (credentials via env vars)
│       │   ├── media/          # CRUD, recherche, filtres
│       │   ├── nas/            # Client Synology File Station API
│       │   ├── metadata/       # Client TMDB
│       │   ├── sync/           # Orchestration NAS → TMDB → DB
│       │   ├── health/         # Health check
│       │   └── common/         # Filtres, intercepteurs
│       ├── prisma/
│       │   └── schema.prisma
│       └── Dockerfile
│
├── packages/
│   └── shared/                 # Types TS partagés
│
├── scripts/nas/                # Scripts pour Synology DSM
├── docker-compose.yml          # PostgreSQL local (dev)
├── .nvmrc
├── turbo.json
├── pnpm-workspace.yaml
└── .gitignore
```

### Stack technique

| Couche | Technologie |
|--------|------------|
| Frontend | Vite, React 19, React Router v7, TypeScript |
| UI | ShadCN/ui, TailwindCSS v4, embla-carousel-react |
| Data fetching | TanStack Query (React Query) |
| Backend | NestJS 11, TypeScript |
| ORM | Prisma |
| Base de données | PostgreSQL 16 |
| Auth backoffice | JWT (access + refresh), credentials en env vars |
| API métadonnées | TMDB API v3 |
| Parsing fichiers | parse-torrent-title |
| Monorepo | pnpm workspaces + Turborepo |

---

## Base de données (Prisma)

### Tables

- **Media** : id, type (MOVIE/SERIES via TMDB), titleVf, titleOriginal, nasPath, nasFilename, nasSize, tmdbId, overview, posterUrl, backdropUrl, trailerUrl, releaseYear, runtime, voteAverage, syncStatus (PENDING/SYNCING/SYNCED/FAILED/NOT_FOUND), lastSyncedAt
- **Genre** + **MediaGenre** : genres TMDB en français (many-to-many)
- **Person** + **MediaPerson** : acteurs, réalisateurs (rôle, personnage, ordre)
- **Season** + **Episode** : pour les séries, chaque épisode a son nasPath
- **NasConfig** : url, username, passwordEnc, sharedFolders[], isActive, lastSyncAt
- **ApiConfig** : provider (tmdb), apiKey, baseUrl, isActive
- **SyncLog** : type, status, totalItems, processedItems, errors

### Pas de table AdminUser
Les credentials admin sont en variables d'environnement : `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (bcrypt).

---

## API Endpoints

### Publics (webapp)
```
GET  /media                    # Liste avec filtres (type, genre, année, page)
GET  /media/:id                # Détail complet (genres, cast, saisons)
GET  /media/search?q=          # Recherche par titre VF
GET  /media/recent             # Dernièrement ajouté (par date de sync)
GET  /media/unsynchronized     # Non synchronisés
GET  /health                   # Statut API + NAS
POST /sync/webhook             # Webhook NAS (protégé par secret partagé)
```

### Protégés (backoffice, JWT)
```
POST   /auth/login             # Login admin → JWT
POST   /auth/refresh           # Refresh token
GET    /nas/status              # Statut NAS
GET    /nas/files               # Lister fichiers NAS
PUT    /nas/config              # Config NAS
POST   /sync/full               # Sync complète
POST   /sync/media/:id          # Sync un seul média
GET    /sync/logs               # Historique syncs
DELETE /media/:id               # Supprimer média (+ option NAS)
PATCH  /media/:id               # Modifier métadonnées
GET    /metadata/search?q=      # Chercher sur TMDB
PUT    /metadata/config         # Gérer clés API
```

---

## Synchronisation NAS

### Flow
1. Backend s'authentifie via SYNO.API.Auth → obtient un sid
2. Liste tous les fichiers vidéo de tous les dossiers configurés
3. Pour chaque fichier : parse le nom (parse-torrent-title) → titre + année
4. Recherche TMDB (movie ET tv) → TMDB détermine si c'est un film ou une série
5. Stocke les métadonnées, met syncStatus = SYNCED
6. **Réconciliation** : compare les fichiers NAS vs DB → si un fichier n'existe plus sur le NAS, supprime l'entrée de la DB

### Détection Films vs Séries
Pas basée sur les répertoires. TMDB détermine le type :
- Recherche d'abord dans /search/movie, puis /search/tv
- Le meilleur match détermine le type (MOVIE ou SERIES)
- Présence de pattern S01E01 dans le filename → priorité à /search/tv

### Scripts NAS
- **sync-on-boot.sh** : triggered task DSM au démarrage → appelle POST /sync/webhook
- **watch-downloads.sh** : cron toutes les 5 min → compare hash des fichiers → appelle webhook si changement

---

## Faisabilité vérifiée

| Point | Statut | Détail |
|-------|--------|--------|
| Railway monorepo | ✅ | Chaque service a un Root Directory configurable |
| React SPA sur Railway | ✅ | Build Vite + nginx via Dockerfile |
| NestJS sur Railway | ✅ | Dockerfile ou Nixpacks |
| PostgreSQL Railway | ✅ | Plugin intégré, $0 dans le crédit |
| TMDB API gratuite | ✅ | Gratuit, `language=fr-FR`, ~50 req/s |
| Synology File Station API | ✅ | Auth, list, delete bien documentés |
| Budget ~$5/mois | ✅ | $5 hobby plan Railway, faible trafic |
| Sync auto download | ⚠️ | Pas de webhook natif, polling cron 5min |
| Suppression fichier NAS disparu | ✅ | Réconciliation pendant chaque sync |
