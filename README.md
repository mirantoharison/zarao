# Zarao

Lecteur de médias malagasy (audio et vidéo) pour le bureau, construit avec **Tauri 2**. L'interface est en React ; la lecture
passe par un petit backend Node/Express embarqué qui s'appuie sur **ffmpeg**.

## Architecture

| Couche | Rôle | Emplacement |
| --- | --- | --- |
| Interface | React 19, TypeScript, Vite, Tailwind CSS 4, Radix UI | `src/` |
| Coque native | Tauri 2 (Rust) : fenêtre, icône de la zone de notification, instance unique, plugins `dialog`, `fs`, `opener`, `shell` | `src-tauri/` |
| Backend | Express + SQLite (`better-sqlite3`), lancé par Tauri avec le Node embarqué ; ffmpeg pour le transcodage | `server/` |

Le backend a deux rôles, choisis par la variable `ZARAO_ROLE` :

- `local` : fichiers du disque, ffmpeg, réglages. Écoute sur `127.0.0.1:4000` et stocke ses données dans `~/zarao-data`.
- `online` : comptes, catalogue, playlists, partage, connexion OAuth (Google, GitHub). Port `4001`, données dans
  `~/zarao-online-data`. Il peut être déployé sur un vrai serveur derrière un proxy HTTPS (`ZARAO_HOST=0.0.0.0`).
- `all` (défaut hors Tauri) : les deux dans un seul processus.

À la fermeture de l'application, Tauri ferme le `stdin` du backend, qui s'arrête proprement (ffmpeg tués, dossier temporaire vidé,
base fermée). Au bout de 2,5 s, l'arbre de processus est arrêté de force.

## Deux éditions

- **Complète** : écran de connexion/inscription, choix du mode, bibliothèque en ligne et lecteur local.
- **Local** (`VITE_ZARAO_EDITION=local`, cf. `.env.localonly`) : splash puis lecteur local directement. Tout le code « en ligne »
  est éliminé au build. Produit « Zarao Local » (`mg.zarao.local`) avec `src-tauri/tauri.local.conf.json`.

## Fonctionnalités du lecteur local

- Lecture audio et vidéo : mp4, mkv, webm, avi, mov, m4v, mpg, ts, ogv, wmv, flv, 3gp, etc. Les formats non lisibles
  directement sont transcodés à la volée par ffmpeg (encodeurs vidéo détectés, réglages dans les Paramètres).
- Bibliothèque et listes de lecture, reprise de lecture, dossiers surveillés.
- Égaliseur 10 bandes, analyse spectrale et visualiseur.
- Paroles synchronisées (LRC) ou non, lues dans les fichiers ou les balises ; écriture des paroles dans les ID3 des MP3.
- Édition des balises, sous-titres, pistes audio.
- Signets sur les barres de progression, avec export.
- Mini-lecteur, plein écran, zoom, palettes de couleurs, icône dans la zone de notification.
- Raccourcis clavier personnalisables.
- Ouverture depuis l'Explorateur Windows (menu clic droit via le registre) et instance unique.
- Interface traduite (`src/i18n.tsx`), sauvegarde et restauration des réglages.

## Prérequis

- Node.js et npm
- Rust et les [prérequis Tauri 2](https://tauri.app/start/prerequisites/)
- ffmpeg (complet ou minimal) : binaire embarqué dans `src-tauri/resources/ffmpeg`, ou chemin défini dans les Paramètres ou
  via `ZARAO_FFMPEG`, sinon `ffmpeg` du `PATH`

## Démarrage

```bash
npm install
npm --prefix server install
```

Application complète :

```bash
npm run tauri dev
npm run tauri build
```

Édition locale :

```bash
npm run tauri:dev:local
npm run tauri:build:local
```

Les commandes Tauri exécutent d'abord `npm run bundle-node`, qui copie le Node embarqué dans `src-tauri/resources/node`.

Développement sans Tauri :

```bash
npm run dev            # interface (Vite, port 1420)
npm run dev:local      # interface, édition locale
npm run server:local   # backend local
npm run server:online  # backend en ligne
npm run lint           # oxlint
```

## Configuration du serveur

| Variable | Rôle |
| --- | --- |
| `ZARAO_ROLE` | `local`, `online` ou `all` |
| `ZARAO_PORT`, `ZARAO_HOST` | port et adresse d'écoute (priment sur les Paramètres) |
| `ZARAO_DATA_DIR` | dossier de données (base `zarao.db`, médias, temporaire) |
| `ZARAO_FFMPEG` | chemin de ffmpeg (les Paramètres priment) |
| `ZARAO_VIDEO_ENCODERS` | encodeurs vidéo autorisés |
| `ZARAO_EXTRA_ORIGINS` | origines CORS supplémentaires |
| `ZARAO_OAUTH_REDIRECT_BASE` | base de l'URL de retour OAuth |
| `ZARAO_<GOOGLE\|GITHUB>_CLIENT_ID` / `_CLIENT_SECRET` | identifiants OAuth, ou `oauth.json` dans le dossier de données |

## Outils

- `tools/bundle-node.mjs` : copie le Node embarqué pour l'empaquetage.
- `tools/ffmpeg-check.mjs` : vérifie qu'un binaire ffmpeg sait faire tout ce que le serveur lui demande. Utile pour valider
  un ffmpeg minimal avant de l'embarquer (`node tools/ffmpeg-check.mjs --ffmpeg <chemin>`).
