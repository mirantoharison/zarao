# ffmpeg minimal pour Zarao

Un ffmpeg « complet » pèse ~185 Mo. Zarao n'en utilise qu'une petite partie : ce dossier fabrique un binaire qui ne contient
que cela, sous **licence LGPL** (pas de libx264, pas de GPL).

## Ce que le serveur demande à ffmpeg

Tout vient de [`server/ffmpeg-args.mjs`](../../server/ffmpeg-args.mjs) :

| Besoin | Moyen |
| --- | --- |
| Lire un MKV/TS/AVI/MPG dont les codecs sont bons | **remux** : copie des flux dans un MP4 fragmenté |
| Audio non lisible (AC3, DTS, WMA, Vorbis…) | décodage + **encodeur AAC natif** de ffmpeg |
| Vidéo non lisible (HEVC, MPEG-2/4, H.264 10 bits…) | décodage + encodeur **H.264** (voir ci-dessous) |
| Se déplacer dans un flux produit à la volée | `-ss` + réencodage de la vidéo (précision) |
| Écrire des tags et une pochette | copie sans réencodage, muxers MP3/FLAC/OGG/M4A/MKV |
| Résolution / ratio réglés | filtre `scale` |

L'audio seul est toujours converti en **AAC** (MP4 fragmenté), jamais en MP3 : l'encodeur MP3 (libmp3lame) est une bibliothèque
externe dont on se passe.

### Encodeur H.264 sans libx264

libx264 est sous GPL. Le serveur choisit parmi les encodeurs que le binaire possède, dans cet ordre, et **passe au suivant si l'un
échoue à l'exécution** (NVENC sans pilote, par exemple) :

`libx264` → `libopenh264` → `h264_mf` (Windows) → `h264_videotoolbox` (macOS) → `h264_qsv` → `h264_nvenc` → `h264_amf` → `h264_vaapi`

Sur Windows, le build minimal embarque **`h264_mf`** (Media Foundation) : encodeur H.264 fourni par le système, donc aucune
bibliothèque de plus à livrer. Le script ci-dessous cible Windows ; pour macOS/Linux il faudrait remplacer cet encodeur
(`h264_videotoolbox`, ou `libopenh264`).

## Compiler

Prérequis : MSYS2 avec `mingw-w64-x86_64-{gcc,nasm,pkgconf}` et `make`, ainsi que Node et un ffmpeg **complet** (pour fabriquer les
fichiers de test).

```bash
MSYSTEM=MINGW64 MSYS2_PATH_TYPE=inherit FULL_FFMPEG="/c/Program Files/Ffmpeg/ffmpeg.exe" \
  /c/msys64/usr/bin/bash.exe -lc "cd /f/Zarao-tauri && tools/ffmpeg-minimal/build.sh"
```

Le script télécharge l'archive officielle (`ffmpeg.org/releases`), affiche son SHA-256, configure avec la liste de composants
de `build.sh`, compile, puis lance la vérification. Résultat dans `dist/` : `ffmpeg.exe`, `BUILD-INFO.txt` (version et options,
à livrer avec l'exécutable pour la LGPL) et `COPYING.LGPLv2.1`.

Variables : `FFMPEG_VERSION`, `FFMPEG_SHA256` (à figer après vérification de la signature GPG `.asc`), `LTO=1`, `SMALL=1`,
`SKIP_CHECK=1`.

## Vérifier un binaire (le vôtre, un build téléchargé, etc.)

```bash
node tools/ffmpeg-check.mjs --ffmpeg <ffmpeg à tester> --fixtures-ffmpeg <ffmpeg complet>
node tools/ffmpeg-check.mjs --ffmpeg <ffmpeg> --without libx264,h264_qsv   # simule un build sans ces encodeurs
```

22 tests rejouent exactement les commandes du serveur : 11 lectures à la volée (audio WMA, AVI, MPG, TS, MKV 10 bits, HEVC, AC3,
Vorbis, VP9…), 3 déplacements dans la piste, résolution/ratio, et 7 écritures de tags. Le code de sortie est non nul si l'un
échoue, ce qui permet de l'utiliser en CI.

## Licence

Un binaire LGPL doit être accompagné de sa licence, de sa version et de ses options de configuration (`dist/BUILD-INFO.txt`), et il
faut pouvoir en fournir les sources. Zarao lance ffmpeg comme **programme séparé** (il n'est pas lié à l'application), ce qui évite
les contraintes de liaison de la LGPL.
