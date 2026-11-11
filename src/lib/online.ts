import { playUrl, type ServerMedia, type ServerMediaMeta } from "@/lib/api";
import type { MediaItem } from "@/lib/media";

/** "HH:MM:SS" (format du serveur) → secondes. */
export function parseDuration(text?: string): number {
  if (!text) return 0;
  const parts = text.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const mediaId = (m: ServerMedia) => m.fileid ?? m._id;

/**
 * Transforme un média serveur en élément de lecture.
 * IMPORTANT : `path` sert de clé unique (dédoublonnage, favoris) ; pour un média distant c'est "online:<id>".
 * Le type audio/vidéo n'est pas dans les listes : il est corrigé quand les métadonnées arrivent (cf. applyMeta).
 */
export function toMediaItem(m: ServerMedia, kind: "audio" | "video" = "audio"): MediaItem {
  const id = mediaId(m);
  return {
    id: `online:${id}`,
    source: "online",
    remoteId: id,
    path: `online:${id}`,
    url: playUrl(id),
    name: m.title ?? id,
    ext: "",
    kind,
    title: m.title ?? "—",
    artist: m.artist ?? "",
    year: "",
    duration: parseDuration(m.duration),
    size: m.size ?? 0,
  };
}

/** Complète un élément avec les métadonnées complètes (pochette, format, année, type réel). */
export function applyMeta(item: MediaItem, meta: ServerMediaMeta): MediaItem {
  return {
    ...item,
    playMode: meta.playMode,
    ext: meta.ext ?? item.ext,
    kind: meta.isVideo ? "video" : "audio",
    year: meta.date ?? meta.year ?? item.year,
    duration: meta.durationFloat || item.duration,
    size: meta.size ?? item.size,
    jacket: meta.jacket || undefined,
  };
}

export { mediaId };
