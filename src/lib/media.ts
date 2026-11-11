import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-fs";
import { parseBlob } from "music-metadata";
import { getExtensions } from "@/lib/settings";
import { localPlayUrl } from "@/lib/api";

// Lues à chaque appel : l'utilisateur peut les modifier dans les réglages sans relancer l'app.
export const audioExt = () => getExtensions().audio;
export const videoExt = () => getExtensions().video;

export type MediaItem = {
  id: string;
  /** "local" : fichier disque ; "online" : média du serveur (url HTTP, `remoteId` = id serveur). */
  source: "local" | "online";
  /** Mode de lecture décidé par le serveur ; absent = lecture directe (déplacement natif). */
  playMode?: "direct" | "remux" | "transcode";
  remoteId?: string;
  path: string;
  url: string;
  name: string;
  ext: string;
  kind: "audio" | "video";
  title: string;
  artist: string;
  year: string;
  /** Secondes ; 0 tant qu'inconnue (complétée au chargement du média). */
  duration: number;
  /** Octets ; 0 tant que non lu. */
  size: number;
  jacket?: string;
};

/** Extensions que la webview lit en principe telles quelles : pas de sonde du serveur à l'ajout (liste affichée vite, hors ligne). */
const WEBVIEW_NATIVE_EXT = new Set(["mp4", "m4v", "webm", "mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus"]);
export const needsServerProbe = (ext: string) => !WEBVIEW_NATIVE_EXT.has(ext);
/** Adresse de lecture d'un fichier local : flux du serveur si le mode n'est pas "direct", fichier brut sinon. */
export const localUrl = (path: string, playMode?: MediaItem["playMode"]) => (playMode && playMode !== "direct" ? localPlayUrl(path) : convertFileSrc(path));
/**
 * Source de l'analyse du spectre : chemin disque (local) ou URL (en ligne).
 * Un fichier local converti ne se décode pas depuis le disque ; son flux, lui, se décode (audio seul : léger).
 * Pour une vidéo convertie on s'abstient : décoder tout le flux relancerait ffmpeg sur un film entier.
 */
export function spectrumSourceOf(item: MediaItem | null): string | null {
  if (!item) return null;
  if (item.source === "online") return item.url;
  if (item.playMode && item.playMode !== "direct") return item.kind === "audio" ? item.url : null;
  return item.path;
}

const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const isSupported = (p: string) => [...audioExt(), ...videoExt()].includes(extOf(p));

/** Item minimal, sans lecture disque : permet d'afficher la liste immédiatement. */
export function makeItem(path: string): MediaItem {
  const ext = extOf(path);
  const name = baseName(path);
  return {
    id: crypto.randomUUID(),
    source: "local",
    path,
    url: convertFileSrc(path),
    name,
    ext,
    kind: videoExt().includes(ext) ? "video" : "audio",
    title: name.replace(/\.[^.]+$/, ""),
    artist: "",
    year: "",
    duration: 0,
    size: 0,
  };
}

/**
 * Complète titre/artiste/année/pochette/durée.
 * IMPORTANT : on ne lit que le début du fichier (Range) — les tags ID3 y sont, et charger
 * un film entier en mémoire pour lire un titre serait inacceptable.
 */
export async function loadMetadata(item: MediaItem): Promise<Partial<MediaItem>> {
  try {
    // IMPORTANT : lecture via le plugin fs et non fetch(asset://) — le protocole asset est cross-origin
    // et fetch y échoue sans en-tête CORS, ce qui laissait tags, taille et durée vides.
    const handle = await openFile(item.path, { read: true });
    let size = 0;
    let blob: Blob;
    try {
      size = (await handle.stat()).size;
      const buf = new Uint8Array(1024 * 1024);
      const n = (await handle.read(buf)) ?? 0;
      blob = new Blob([buf.slice(0, n)]);
    } finally {
      await handle.close();
    }
    const meta = await parseBlob(blob, { duration: false, skipPostHeaders: true });
    const picture = meta.common.picture?.[0];
    let jacket: string | undefined;
    if (picture) {
      const bytes = picture.data;
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      jacket = `data:${picture.format};base64,${btoa(bin)}`;
    }
    return {
      title: meta.common.title || item.title,
      artist: meta.common.artist ?? "",
      year: meta.common.year ? String(meta.common.year) : "",
      duration: meta.format.duration ?? 0,
      size,
      jacket,
    };
  } catch (err) {
    console.warn("[zarao] lecture des métadonnées impossible :", item.path, err);
    return {};
  }
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "--:--";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["o", "Ko", "Mo", "Go"];
  let v = bytes, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

/**
 * Lit la durée via un élément média détaché (preload="metadata").
 * IMPORTANT : music-metadata ne voit que le premier Mo, donc la durée des MP3 sans en-tête Xing
 * est inconnue ; le navigateur, lui, sait la déduire sans lire tout le fichier.
 */
export function probeDuration(url: string, kind: "audio" | "video"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const done = (v: number) => { el.removeAttribute("src"); el.load(); resolve(v); };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    el.src = url;
  });
}

/** Sans tag artiste, déduit "Artiste - Titre" depuis le nom de fichier (ex. "Sigala - Lasting Lover"). */
export function guessFromName(title: string): { artist: string; title: string } | null {
  const i = title.indexOf(" - ");
  if (i <= 0 || i >= title.length - 3) return null;
  return { artist: title.slice(0, i).trim(), title: title.slice(i + 3).trim() };
}
