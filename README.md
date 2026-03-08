# Nasflix

Application web personnelle de type Netflix pour cataloguer les films et séries stockés sur un NAS Synology. Les métadonnées (affiches, synopsis, casting...) sont récupérées automatiquement depuis TMDB et stockées en base de données, permettant de consulter le catalogue même lorsque le NAS est éteint.

## Stack technique

| Couche | Technologie |
|--------|------------|
| Frontend | React 19, Vite 6, React Router 7, TypeScript |
| UI | ShadCN/ui, TailwindCSS 4, Embla Carousel |
| State | TanStack Query (React Query) 5 |
| Backend | NestJS 11, TypeScript |
| ORM | Prisma 6 |
| Base de données | PostgreSQL 16 |
| Auth | JWT (access + refresh token), bcrypt |
| Métadonnées | TMDB API v3 (`language=fr-FR`) |
| Monorepo | pnpm workspaces, Turborepo |

## Prérequis

- **Node.js** 20 LTS (recommandé via [fnm](https://github.com/Schniz/fnm))
- **pnpm** 10.30+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker Desktop** (pour PostgreSQL local)
- **Clé API TMDB** gratuite sur [themoviedb.org](https://www.themoviedb.org/settings/api)

## Structure du projet

```
nasflix/
├── apps/
│   ├── api/            # Backend NestJS (port 4000)
│   └── web/            # Frontend React + Vite (port 5173)
├── packages/
│   └── shared/         # Types TypeScript partagés
├── scripts/
│   └── nas/            # Scripts de sync pour Synology DSM
├── docker-compose.yml  # PostgreSQL local
├── turbo.json          # Config Turborepo
└── pnpm-workspace.yaml
```

## Installation

```bash
# Cloner le repo
git clone git@github.com:klewar2/nasflix.git
cd nasflix

# Utiliser la bonne version de Node (si fnm installé)
fnm use

# Installer les dépendances
pnpm install

# Lancer PostgreSQL
docker compose up -d

# Configurer les variables d'environnement
cp apps/api/.env.example apps/api/.env
# Éditer apps/api/.env avec vos valeurs
```

### Variables d'environnement (`apps/api/.env`)

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | URL de connexion PostgreSQL |
| `JWT_SECRET` | Secret pour les tokens d'accès |
| `JWT_REFRESH_SECRET` | Secret pour les refresh tokens |
| `ADMIN_USERNAME` | Nom d'utilisateur du backoffice |
| `ADMIN_PASSWORD_HASH` | Hash bcrypt du mot de passe admin |
| `TMDB_API_KEY` | Clé API TMDB |
| `CORS_ORIGIN` | Origine autorisée (ex: `http://localhost:5173`) |
| `SYNC_WEBHOOK_SECRET` | Secret pour le webhook de sync NAS |
| `PORT` | Port du backend (défaut: 4000) |

### Générer un hash de mot de passe admin

```bash
node -e "require('bcryptjs').hash('votre-mot-de-passe', 10).then(console.log)"
```

### Initialiser la base de données

```bash
# Générer le client Prisma
pnpm db:generate

# Appliquer les migrations
pnpm db:migrate
```

## Développement

```bash
# Lancer le backend + frontend en parallèle
pnpm dev

# Backend seul (http://localhost:4000)
pnpm --filter @nasflix/api dev

# Frontend seul (http://localhost:5173)
pnpm --filter @nasflix/web dev
```

### Commandes utiles

```bash
pnpm build          # Build de production (API + Web)
pnpm type-check     # Vérification TypeScript
pnpm lint           # Lint ESLint
pnpm db:generate    # Regénérer le client Prisma
pnpm db:migrate     # Appliquer les migrations Prisma
```

## Fonctionnalités

### Webapp (publique, sans auth)

- Page d'accueil avec carrousels par genre (style Netflix)
- Catalogue Films et Séries avec grille responsive
- Fiche détaillée : affiche, synopsis FR, casting, bande-annonce, saisons/épisodes
- Recherche par titre VF
- Section "Dernièrement ajouté"
- Affichage du chemin NAS pour chaque média

### Backoffice (protégé par JWT)

- Dashboard avec statut NAS (en ligne / hors ligne), compteurs
- Liste des médias avec recherche et actions (sync, suppression)
- Synchronisation manuelle ou automatique depuis le NAS
- Configuration NAS (URL, identifiants, dossiers à scanner)
- Gestion des clés API (TMDB)

### Synchronisation NAS

- Scan des fichiers vidéo sur le NAS Synology (API File Station)
- Parsing automatique des noms de fichiers (titre, année, saison/épisode)
- Matching automatique avec TMDB pour récupérer les métadonnées en français
- Réconciliation : les fichiers supprimés du NAS sont retirés de la base
- Webhook pour déclencher une sync depuis un script DSM

## Attribution

Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.

![TMDB Logo](https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg)
