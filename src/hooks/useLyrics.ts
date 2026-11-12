import { useCallback, useEffect, useRef, useState } from "react";
import { getMeta } from "@/lib/api";
import { fetchOnlineLyrics, hasLyricsSidecar, loadLocalLyricsText, parseLyrics, saveLocalLyricsText, type Lyrics } from "@/lib/lyrics";
import type { MediaItem } from "@/lib/media";

/** `source` : "lrclib" quand les paroles viennent d'être récupérées en ligne. IMPORTANT : non conservé ensuite — une fois mémorisées par l'application, elles se relisent comme des paroles locales. */
export type LyricsState = { lyrics: Lyrics | null; loading: boolean; source: "lrclib" | null };

/**
 * Paroles de la piste en cours : tag intégré, mémoire de l'application ou ancien fichier voisin en lecture seule (local), ou paroles enregistrées avec le média (en ligne).
 * Sans paroles, on les cherche sur LRCLIB ; pour un fichier local elles sont mémorisées par l'application, sans écrire aucun fichier sur le disque (donc hors ligne ensuite).
 * `refreshKey` force un rechargement (après une modification des paroles).
 */
export function useLyrics(item: MediaItem | null, refreshKey = 0): LyricsState & { searchOnline: () => Promise<boolean> } {
  const [state, setState] = useState<LyricsState>({ lyrics: null, loading: false, source: null });
  const id = item?.id ?? null;
  const source = item?.source;
  const path = item?.path;
  const remoteId = item?.remoteId;
  const title = item?.title;
  const artist = item?.artist;
  // Durée en ref : elle arrive après coup (sonde du média) et ne doit pas relancer toute la recherche.
  const durationRef = useRef(0);
  durationRef.current = item?.duration ?? 0;

  /** Cherche sur LRCLIB et affiche le résultat ; les mémorise dans l'application si la piste est locale. */
  const fetchAndStore = useCallback(async (): Promise<Lyrics | null> => {
    if (!title || !artist) return null;
    const raw = await fetchOnlineLyrics(artist, title, durationRef.current);
    if (!raw) return null;
    if (source === "local" && path) await saveLocalLyricsText(path, raw).catch((err) => console.warn("[zarao] enregistrement des paroles impossible :", err));
    return parseLyrics(raw);
  }, [title, artist, source, path]);

  useEffect(() => {
    if (!id) { setState({ lyrics: null, loading: false, source: null }); return; }
    let cancelled = false;
    setState({ lyrics: null, loading: true, source: null });
    (async () => {
      try {
        const raw = source === "online" && remoteId
          ? (await getMeta(remoteId))?.lyrics ?? null
          : path ? await loadLocalLyricsText(path) : null;
        if (raw && raw.trim()) { if (!cancelled) setState({ lyrics: parseLyrics(raw), loading: false, source: null }); return; }
        // Rien en local : récupération automatique, sauf si l'utilisateur a effacé les paroles lui-même.
        const cleared = source === "local" && path ? await hasLyricsSidecar(path) : false;
        const found = cleared ? null : await fetchAndStore();
        if (!cancelled) setState({ lyrics: found, loading: false, source: found ? "lrclib" : null });
      } catch {
        if (!cancelled) setState({ lyrics: null, loading: false, source: null });
      }
    })();
    return () => { cancelled = true; };
  }, [id, source, path, remoteId, refreshKey, fetchAndStore]);

  /** Recherche manuelle (bouton) : ignore la marque « effacé » laissée par un effacement. */
  const searchOnline = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const found = await fetchAndStore();
    setState({ lyrics: found, loading: false, source: found ? "lrclib" : null });
    return found !== null;
  }, [fetchAndStore]);

  return { ...state, searchOnline };
}
