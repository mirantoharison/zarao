import { useEffect, useState } from "react";
import { getMeta } from "@/lib/api";
import { loadLocalLyricsText, parseLyrics, type Lyrics } from "@/lib/lyrics";
import type { MediaItem } from "@/lib/media";

export type LyricsState = { lyrics: Lyrics | null; loading: boolean };

/**
 * Paroles de la piste en cours : fichier voisin ou tag intégré (local), ou paroles enregistrées avec le média (en ligne).
 * `refreshKey` force un rechargement (après une modification des paroles).
 */
export function useLyrics(item: MediaItem | null, refreshKey = 0): LyricsState {
  const [state, setState] = useState<LyricsState>({ lyrics: null, loading: false });
  const id = item?.id ?? null;
  const source = item?.source;
  const path = item?.path;
  const remoteId = item?.remoteId;

  useEffect(() => {
    if (!id) { setState({ lyrics: null, loading: false }); return; }
    let cancelled = false;
    setState({ lyrics: null, loading: true });
    (async () => {
      try {
        const raw = source === "online" && remoteId
          ? (await getMeta(remoteId))?.lyrics ?? null
          : path ? await loadLocalLyricsText(path) : null;
        if (!cancelled) setState({ lyrics: raw && raw.trim() ? parseLyrics(raw) : null, loading: false });
      } catch {
        if (!cancelled) setState({ lyrics: null, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [id, source, path, remoteId, refreshKey]);

  return state;
}
