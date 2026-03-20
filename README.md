# Nasflix

Application web personnelle de type Netflix pour cataloguer les films et séries stockés sur un NAS Synology. Les métadonnées (affiches, synopsis, casting…) sont récupérées automatiquement depuis TMDB et stockées en base de données — le catalogue reste consultable même lorsque le NAS est éteint.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | React 19, Vite 6, React Router 7, TypeScript |
| UI | ShadCN/ui, TailwindCSS 4, Embla Carousel |
| State | TanStack Query 5 |
| Backend | NestJS 11, TypeScript |
| ORM | Prisma 6 |
| Base de données | PostgreSQL 16 |
| Auth | JWT (access + refresh token), bcrypt |
| Métadonnées | TMDB API v3 (`language=fr-FR`) |
| Streaming | VideoStation API (Synology) avec fallback FFmpeg |
| Temps réel | Socket.IO (WebSocket) |
| Queue | BullMQ + Redis |
| Monorepo | pnpm workspaces + Turborepo |

---

## Fonctionnalités

### Webapp publique

- Page d'accueil avec carrousels style Netflix (par genre, récents, qualité)
- Catalogue Films et Séries avec grille responsive et index alphabétique
- Fiche détaillée : affiche, synopsis FR, casting, bande-annonce, saisons/épisodes
- Recherche par titre
- Section "Dernièrement ajouté"

### Streaming vidéo (membres authentifiés)

- Lecture directe depuis le NAS via VideoStation API — le navigateur se connecte directement au NAS (zéro transit par le serveur)
- Flux HLS segmenté : seek natif, démarrage rapide, transcodage hardware Synology
- Fallback automatique sur proxy FFmpeg si VideoStation n'est pas disponible
- Téléchargement direct du fichier original
- Recherche du fichier dans VideoStation par chemin (`nasPath`) puis par titre extrait du nom de fichier

### Backoffice (admin JWT)

- Dashboard : statut NAS en temps réel, compteurs, **bouton "Allumer le NAS"** (Wake-on-LAN)
- Liste des médias avec recherche, filtres, actions (re-sync, suppression)
- Synchronisation manuelle ou via webhook
- Paramètres : URL NAS, dossiers scannés, clé TMDB, **configuration WoL**, **gestion du secret webhook**

### Synchronisation NAS

- Scan récursif des fichiers vidéo (API File Station Synology)
- Parsing automatique des noms de fichiers : titre, année, saison/épisode, qualité, HDR, Atmos…
- Matching TMDB avec scoring (correspondance de titre, année, popularité)
- Déduplication des séries : plusieurs épisodes → une seule fiche série
- Webhook déclenché depuis le NAS (ajout/suppression/déplacement de fichiers ou démarrage)
- Identification du CineClub par secret webhook — les scripts NAS n'ont pas besoin de connaître l'ID du CineClub

### Wake-on-LAN

- Envoi d'un magic packet UDP depuis le serveur Railway vers le NAS
- Détection automatique du démarrage via le webhook de boot (`sync-on-boot.sh`)
- Notification WebSocket instantanée au frontend quand le NAS est prêt
- Réservé aux membres ADMIN

---

## Structure du projet

```
nasflix/
├── apps/
│   ├── api/                # Backend NestJS (port 4000)
│   │   ├── prisma/         # Schéma et migrations PostgreSQL
│   │   └── src/
│   │       ├── auth/       # JWT, guards, stratégies
│   │       ├── cineclubs/  # Gestion des CineClubs et membres
│   │       ├── media/      # Catalogue films/séries
│   │       ├── metadata/   # Client TMDB
│   │       ├── nas/        # Streaming, WoL, VideoStation, FileStation
│   │       └── sync/       # Scan NAS, queue BullMQ, gateway WebSocket
│   └── web/                # Frontend React + Vite (port 5173)
├── packages/
│   └── shared/             # Types TypeScript partagés (API + Web)
├── scripts/
│   └── nas/                # Scripts DSM Synology
│       ├── sync-on-boot.sh # Déclenché au démarrage du NAS
│       └── watch-downloads.sh  # Détection des changements de fichiers (toutes les 5 min)
├── docker-compose.yml      # PostgreSQL + Redis local
├── turbo.json
└── pnpm-workspace.yaml
```

---

## Prérequis

- **Node.js** 20 LTS (recommandé via [fnm](https://github.com/Schniz/fnm))
- **pnpm** 10.30+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker Desktop** (PostgreSQL + Redis local)
- **Clé API TMDB** gratuite sur [themoviedb.org](https://www.themoviedb.org/settings/api)
- **NAS Synology** avec DSM 6 ou 7, File Station activé
- **VideoStation** installé sur le NAS pour le streaming optimisé (optionnel — fallback FFmpeg sinon)

---

## Installation locale

```bash
git clone git@github.com:klewar2/nasflix.git
cd nasflix

# Utiliser la bonne version de Node
fnm use

# Installer les dépendances
pnpm install

# Lancer PostgreSQL + Redis
docker compose up -d

# Configurer les variables d'environnement
cp apps/api/.env.example apps/api/.env
# Éditer apps/api/.env avec vos valeurs

# Initialiser la base de données
pnpm db:generate
pnpm db:migrate

# Lancer en développement
pnpm dev
```

### Variables d'environnement (`apps/api/.env`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | URL de connexion PostgreSQL |
| `JWT_SECRET` | Secret pour les access tokens |
| `JWT_REFRESH_SECRET` | Secret pour les refresh tokens |
| `TMDB_API_KEY` | Clé API TMDB par défaut (surchargeable par CineClub) |
| `CORS_ORIGIN` | Origines autorisées, séparées par des virgules |
| `SYNC_WEBHOOK_SECRET` | *(Legacy)* Secret webhook global — remplacé par le secret par CineClub généré dans le backoffice |
| `PORT` | Port du backend (défaut : `4000`) |

> Les identifiants admin (username / hash bcrypt du mot de passe) sont gérés directement dans la base via le backoffice super-admin.

### Générer un hash de mot de passe

```bash
node -e "require('bcryptjs').hash('votre-mot-de-passe', 10).then(console.log)"
```

### Commandes utiles

```bash
pnpm dev            # Backend + frontend en parallèle
pnpm build          # Build de production
pnpm type-check     # Vérification TypeScript
pnpm lint           # ESLint
pnpm db:generate    # Regénérer le client Prisma
pnpm db:migrate     # Appliquer les migrations
```

---

## Configuration NAS Synology

### 1. Activer File Station

DSM → **Panneau de configuration** → **Services de fichiers** → **File Station** → cocher **Activer File Station**.

### 2. Activer VideoStation (recommandé pour le streaming)

1. Installer **VideoStation** depuis le Centre de paquets DSM
2. Ouvrir VideoStation → **Paramètres** → **Bibliothèque** → ajouter les dossiers contenant vos fichiers vidéo
3. Laisser VideoStation indexer la bibliothèque (peut prendre quelques minutes)

> Sans VideoStation, le streaming passe par un proxy FFmpeg hébergé sur Railway — plus lent et avec des limitations de seek sur certains codecs.

### 3. Configurer les scripts de synchronisation

Les scripts `scripts/nas/` doivent être installés sur le NAS et configurés dans le **Planificateur de tâches DSM** (Panneau de configuration → Planificateur de tâches).

#### Variables à renseigner dans chaque script

| Variable | Valeur |
|----------|--------|
| `API_URL` | URL publique de l'API, ex: `https://nasflix-api.railway.app/api` |
| `SECRET` | Secret webhook généré dans le backoffice Nasflix (Paramètres → Secret webhook → Générer) |

> Le `SECRET` identifie automatiquement le CineClub — **aucun autre paramètre n'est nécessaire**.

#### `sync-on-boot.sh` — Démarrage du NAS

- **Type** : Tâche déclenchée → Démarrage
- **Utilisateur** : `root`
- **Action** : notifie l'API que le NAS a démarré → déclenche la sync des métadonnées en attente + notifie le frontend en temps réel
- Attend 60 secondes après le boot pour que le réseau soit prêt

#### `watch-downloads.sh` — Surveillance des fichiers

- **Type** : Tâche planifiée → toutes les 5 minutes
- **Utilisateur** : `root`
- **Action** : compare l'état du dossier vidéo avec l'état précédent, envoie au webhook uniquement les fichiers ajoutés/supprimés/déplacés
- Modifier `WATCH_DIRS` pour pointer vers vos dossiers vidéo
- Modifier `STATE_FILE` et `LOG_FILE` pour pointer vers un dossier accessible par root

**Installation dans DSM :**

1. DSM → **Panneau de configuration** → **Planificateur de tâches** → **Créer**
2. Onglet **Général** : nommer la tâche, choisir l'utilisateur `root`
3. Onglet **Planification** : configurer le déclencheur
4. Onglet **Paramètres de la tâche** → **Exécuter la commande** → coller le contenu du script (après avoir remplacé `API_URL` et `SECRET`)

---

## Configuration Wake-on-LAN

Permet à un administrateur d'allumer le NAS depuis l'interface web quand il est éteint.

### Étape 1 — Activer WoL sur le NAS

1. DSM → **Panneau de configuration** → **Matériel et alimentation** → onglet **Général**
2. Cocher **Activer Wake on LAN** → Appliquer
3. Relever l'adresse MAC : DSM → **Panneau de configuration** → **Réseau** → **Interface réseau** → sélectionner l'interface filaire → onglet **Informations**

### Étape 2 — Fixer l'IP locale du NAS

Le port-forward routeur doit cibler une IP stable. Deux options :
- **IP statique** dans DSM → Réseau → Interface réseau → Modifier → Manuel
- **Bail DHCP permanent** (réservation MAC) dans l'interface de votre routeur

### Étape 3 — Port-forwarding UDP sur le routeur

| Paramètre | Valeur |
|-----------|--------|
| Protocole | UDP |
| Port externe | 9 |
| Port interne | 9 |
| IP de destination | IP fixe du NAS (ex : `192.168.1.100`) |

> Si le routeur refuse le forward UDP vers une IP locale (certaines box), essayer le port 7.

### Étape 4 — Renseigner les infos dans le backoffice

Backoffice → **Paramètres** → section **Wake-on-LAN** :
- **Adresse MAC** : `XX:XX:XX:XX:XX:XX`
- **Hôte WoL** : DynDNS Synology (ex : `mon-nas.synology.me`) ou IP publique
- **Port** : `9`

Le bouton **"Allumer le NAS"** apparaît automatiquement sur le dashboard quand le NAS est hors ligne et que la MAC est configurée. Il est visible uniquement par les membres ADMIN.

---

## Configuration du secret webhook

Le secret webhook identifie le CineClub auprès de l'API — les scripts NAS n'ont pas besoin de connaître l'ID du CineClub.

1. Backoffice → **Paramètres** → section **Secret webhook NAS**
2. Cliquer **Générer un secret**
3. Copier la valeur affichée (elle n'est montrée qu'une fois)
4. Coller cette valeur comme valeur de `SECRET` dans `watch-downloads.sh` et `sync-on-boot.sh` sur le NAS

> La variable d'env `SYNC_WEBHOOK_SECRET` reste supportée pour la compatibilité descendante, mais le secret par CineClub est recommandé.

---

## Déploiement (Railway)

1. Créer deux services Railway : un pour l'API (`apps/api`), un pour le frontend (`apps/web`)
2. Configurer les variables d'environnement sur le service API
3. Ajouter un service **PostgreSQL** et un service **Redis** dans Railway
4. `DATABASE_URL` et `REDIS_URL` sont injectés automatiquement par Railway

---

## Attribution

Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.

![TMDB Logo](https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg)
