#!/usr/bin/env bash
# Compile un ffmpeg MINIMAL, sous licence LGPL, pour Zarao (Windows, MSYS2 MINGW64).
#
#   MSYSTEM=MINGW64 /c/msys64/usr/bin/bash.exe -lc "cd /f/Zarao-tauri && tools/ffmpeg-minimal/build.sh"
#
# Variables utiles :
#   FULL_FFMPEG   ffmpeg COMPLET servant à fabriquer les fichiers de test (défaut : celui du PATH)
#   SKIP_CHECK=1  ne pas lancer tools/ffmpeg-check.mjs à la fin
#   LTO=1         édition de liens optimisée (binaire plus petit/rapide, compilation plus longue)
#   SMALL=1       optimise la taille (-Os) au détriment d'un peu de vitesse de décodage
#
# POURQUOI minimal : un ffmpeg "complet" pèse ~185 Mo. Zarao n'a besoin que de : copier des flux (remux), convertir l'audio en AAC,
# réencoder la vidéo en H.264 quand la webview ne la lit pas, et écrire des tags. Voir server/ffmpeg-args.mjs.
#
# POURQUOI LGPL : pas de --enable-gpl ni de --enable-nonfree. Donc pas de libx264 : l'encodeur H.264 est celui de Windows
# (Media Foundation, h264_mf), sans bibliothèque à embarquer. ffmpeg reste un EXÉCUTABLE SÉPARÉ lancé par le serveur (pas lié
# à l'application), ce qui simplifie le respect de la LGPL.
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-8.0}"
FFMPEG_URL="${FFMPEG_URL:-https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz}"
# SHA-256 de l'archive : à renseigner (ou passer en variable) APRÈS l'avoir vérifiée (signature GPG .asc publiée par FFmpeg).
FFMPEG_SHA256="${FFMPEG_SHA256:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="$HERE/.cache"
BUILD="$HERE/.build"
DIST="$HERE/dist"
JOBS="$(nproc 2>/dev/null || echo 4)"

die() { echo "ERREUR : $*" >&2; exit 1; }

# ---------- Prérequis ----------
[ "${MSYSTEM:-}" = "MINGW64" ] || die "à lancer dans un shell MSYS2 MINGW64 (MSYSTEM=MINGW64)."
for t in gcc make nasm pkg-config curl tar sha256sum node; do command -v "$t" >/dev/null || die "outil manquant : $t (pacman -S mingw-w64-x86_64-{gcc,nasm,pkgconf} make)"; done
echo "Compilateur : $(gcc --version | head -1)"

# ---------- Composants : UNIQUEMENT ce dont le serveur a besoin ----------
# Démultiplexeurs : conteneurs que l'on sait recevoir (MKV, MP4, TS, AVI, MPG, WMA…) + images de pochette.
DEMUXERS=(aac ac3 eac3 avi asf flac flv image2 jpeg_pipe png_pipe webp_pipe matroska mov mp3 mpegps mpegts mpegvideo ogg wav truehd dts dtshd)
# Multiplexeurs : MP4 fragmenté (diffusion), + ceux de l'écriture de tags en copie (mp3, flac, ogg, m4a, mkv…), + null (vérifications).
MUXERS=(adts avi asf flac matroska webm mov mp4 ipod 3gp mp3 mpeg mpegts null ogg opus wav)
# Décodeurs audio : tout ce qu'on doit convertir en AAC (AC3, DTS, WMA, Vorbis, MP2…).
DECODERS_AUDIO=(aac aac_latm ac3 eac3 dca mp1 mp1float mp2 mp2float mp3 mp3float vorbis opus flac wmav1 wmav2 wmapro alac truehd mlp pcm_s8 pcm_u8 pcm_s16le pcm_s16be pcm_s24le pcm_s24be pcm_s32le pcm_f32le pcm_f64le pcm_alaw pcm_mulaw)
# Décodeurs vidéo : ceux que la webview ne lit pas et qu'on réencode (HEVC, MPEG-4/2, WMV, 10 bits…) + H.264/VP9 pour les 10 bits.
DECODERS_VIDEO=(h264 hevc mpeg4 mpeg2video mpeg1video msmpeg4v1 msmpeg4v2 msmpeg4v3 wmv1 wmv2 wmv3 vc1 vp8 vp9 theora h263 h263p mjpeg png webp flv vp6 vp6f)
# Encodeurs : AAC natif (aucune dépendance) + H.264 Media Foundation (Windows).
# pcm_s16le + rawvideo : uniquement pour que tools/ffmpeg-check.mjs puisse décoder vers « -f null » (quelques ko).
ENCODERS=(aac h264_mf pcm_s16le rawvideo wrapped_avframe)
PARSERS=(aac aac_latm ac3 av1 dca flac h263 h264 hevc mjpeg mlp mpeg4video mpegaudio mpegvideo opus png vc1 vorbis vp8 vp9 webp)
# Filtres de conversion : redimensionnement (réglages de résolution), formats de pixels/audio.
FILTERS=(scale format aformat aresample anull null setsar setdar setpts asetpts)
# Filtres de flux binaire : AAC ADTS→MP4 (TS), extra-données, superframes VP9, AV1.
BSFS=(aac_adtstoasc extract_extradata h264_mp4toannexb hevc_mp4toannexb vp9_superframe vp9_superframe_split av1_frame_merge av1_frame_split null)
PROTOCOLS=(file pipe)

flags=()
for c in "${DEMUXERS[@]}"; do flags+=("--enable-demuxer=$c"); done
for c in "${MUXERS[@]}"; do flags+=("--enable-muxer=$c"); done
for c in "${DECODERS_AUDIO[@]}" "${DECODERS_VIDEO[@]}"; do flags+=("--enable-decoder=$c"); done
for c in "${ENCODERS[@]}"; do flags+=("--enable-encoder=$c"); done
for c in "${PARSERS[@]}"; do flags+=("--enable-parser=$c"); done
for c in "${FILTERS[@]}"; do flags+=("--enable-filter=$c"); done
for c in "${BSFS[@]}"; do flags+=("--enable-bsf=$c"); done
for c in "${PROTOCOLS[@]}"; do flags+=("--enable-protocol=$c"); done

optim=()
[ "${SMALL:-0}" = "1" ] && optim+=("--enable-small")
[ "${LTO:-0}" = "1" ] && optim+=("--enable-lto")

# ---------- Source ----------
mkdir -p "$CACHE" "$BUILD" "$DIST"
ARCHIVE="$CACHE/ffmpeg-${FFMPEG_VERSION}.tar.xz"
if [ ! -f "$ARCHIVE" ]; then
	echo "Téléchargement : $FFMPEG_URL"
	curl -fL --proto '=https' --tlsv1.2 -o "$ARCHIVE.part" "$FFMPEG_URL"
	mv "$ARCHIVE.part" "$ARCHIVE"
fi
ACTUAL="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
echo "SHA-256 de l'archive : $ACTUAL"
if [ -n "$FFMPEG_SHA256" ] && [ "$ACTUAL" != "$FFMPEG_SHA256" ]; then die "SHA-256 inattendu (attendu $FFMPEG_SHA256). Archive supprimée."; fi
[ -n "$FFMPEG_SHA256" ] || echo "AVERTISSEMENT : FFMPEG_SHA256 non renseigné, l'intégrité n'est pas vérifiée. Vérifiez la signature GPG (.asc) puis figez la valeur."

SRC="$BUILD/ffmpeg-${FFMPEG_VERSION}"
[ -d "$SRC" ] || tar -xf "$ARCHIVE" -C "$BUILD"

# ---------- Configuration et compilation ----------
cd "$SRC"
OUT="$BUILD/obj"; rm -rf "$OUT"; mkdir -p "$OUT"; cd "$OUT"
echo "Configuration (${#flags[@]} composants activés)…"
"$SRC/configure" \
	--prefix="$BUILD/install" \
	--target-os=mingw32 --arch=x86_64 --cc=gcc \
	--disable-everything --disable-autodetect \
	--disable-doc --disable-debug --disable-network --disable-ffplay --disable-ffprobe \
	--enable-static --disable-shared --pkg-config-flags=--static --extra-ldflags="-static" \
	--enable-ffmpeg --enable-avcodec --enable-avformat --enable-avfilter --enable-swscale --enable-swresample \
	--enable-mediafoundation --enable-d3d11va \
	--enable-zlib \
	"${optim[@]}" "${flags[@]}" > "$BUILD/configure.log" 2>&1 || { tail -30 "$BUILD/configure.log"; die "configure a échoué (journal : $BUILD/configure.log)"; }
grep -E "^(License|Enabled (decoders|encoders|demuxers|muxers)):" -A0 "$BUILD/configure.log" | head -4 || true

echo "Compilation (-j$JOBS)…"
make -j"$JOBS" ffmpeg.exe > "$BUILD/make.log" 2>&1 || { tail -30 "$BUILD/make.log"; die "make a échoué (journal : $BUILD/make.log)"; }

# ---------- Résultat ----------
cp ffmpeg.exe "$DIST/ffmpeg.exe"
strip "$DIST/ffmpeg.exe" 2>/dev/null || true
# Pour respecter la LGPL : version, options de configuration et licence livrées avec l'exécutable.
{ echo "ffmpeg ${FFMPEG_VERSION} (source : ${FFMPEG_URL})"; echo "sha256 ${ACTUAL}"; echo; echo "Options de configuration :"; "$DIST/ffmpeg.exe" -hide_banner -buildconf | sed 's/^ *//'; } > "$DIST/BUILD-INFO.txt"
cp "$SRC/COPYING.LGPLv2.1" "$DIST/COPYING.LGPLv2.1" 2>/dev/null || true
# Copie dans les ressources de l'application Tauri (embarqué par src-tauri/tauri.conf.json).
RES="$ROOT/src-tauri/resources/ffmpeg"; mkdir -p "$RES"
cp "$DIST/ffmpeg.exe" "$DIST/BUILD-INFO.txt" "$DIST/COPYING.LGPLv2.1" "$RES/" 2>/dev/null || true
SIZE_MB="$(du -m "$DIST/ffmpeg.exe" | cut -f1)"
echo
echo "ffmpeg minimal : $DIST/ffmpeg.exe  (${SIZE_MB} Mo)"
"$DIST/ffmpeg.exe" -hide_banner -version | head -1
"$DIST/ffmpeg.exe" -hide_banner -L | head -3 | sed 's/^/  /'

# ---------- Vérification avec les mêmes commandes que le serveur ----------
if [ "${SKIP_CHECK:-0}" != "1" ]; then
	FULL="${FULL_FFMPEG:-$(command -v ffmpeg || true)}"
	[ -n "$FULL" ] || die "aucun ffmpeg COMPLET pour fabriquer les fichiers de test : définissez FULL_FFMPEG (ou SKIP_CHECK=1)."
	node "$ROOT/tools/ffmpeg-check.mjs" --ffmpeg "$(cygpath -m "$DIST/ffmpeg.exe")" --fixtures-ffmpeg "$FULL"
fi
