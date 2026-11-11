import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localPlayUrl, probeLocal } from "@/lib/api";
import { guessFromName, isSupported, loadMetadata, makeItem, needsServerProbe, probeDuration, type MediaItem } from "@/lib/media";

export type RepeatMode = "off" | "all" | "one";
export type SleepMode = "off" | "track" | 15 | 30 | 60;
export const SLEEP_MODES: SleepMode[] = ["off", 15, 30, 60, "track"];
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const STORAGE_KEY = "zarao.local.playlist";

function readStoredPaths(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * État du lecteur local.
 * IMPORTANT : un seul élément <video> sert pour l'audio comme pour la vidéo — il évite de
 * dupliquer toute la logique de lecture et de changer d'élément (donc de perdre le volume) entre deux pistes.
 */
export function usePlayer(opts: { storageKey?: string | null } = {}) {
  // IMPORTANT : null = pas de persistance (mode en ligne : la playlist se reconstruit depuis le serveur).
  const storageKey = opts.storageKey === undefined ? STORAGE_KEY : opts.storageKey;
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [rate, setRateState] = useState(1);
  // Boucle A-B (secondes) et minuterie de sommeil ("track" = arrêt à la fin de la piste en cours).
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [sleepMode, setSleepMode] = useState<SleepMode>("off");
  const [sleepLeft, setSleepLeft] = useState(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const sleepRef = useRef(sleepMode);
  sleepRef.current = sleepMode;

  // Refs miroir : les handlers de l'élément média sont attachés une fois, ils ne doivent pas lire un état périmé.
  const stateRef = useRef({ items, currentId, repeat, shuffle });
  stateRef.current = { items, currentId, repeat, shuffle };

  // Flux non directs (remux, transcodage) : produits à la volée, donc sans déplacement natif. On les relance avec ?time=
  // et `offsetRef` garde l'instant de départ : la vraie position est offset + currentTime.
  const offsetRef = useRef(0);
  /** Pistes locales déjà repliées sur le serveur après une erreur de lecture (une seule tentative chacune). */
  const triedRef = useRef(new Set<string>());
  const getTime = useCallback(() => offsetRef.current + (mediaRef.current?.currentTime ?? 0), []);
  const seekTo = useCallback((sec: number, autoplay = false) => {
    const m = mediaRef.current;
    if (!m) return;
    const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
    const target = Math.max(0, sec);
    if (item && item.playMode && item.playMode !== "direct") {
      const resume = autoplay || !m.paused;
      offsetRef.current = target;
      // Lu par le spectre et le visualiseur, qui lisent currentTime directement sur l'élément.
      m.dataset.offset = String(target);
      m.src = `${item.url}${item.url.includes("?") ? "&" : "?"}time=${target.toFixed(2)}`;
      m.load();
      if (resume) void m.play().catch(() => undefined);
    } else {
      offsetRef.current = 0;
      m.dataset.offset = "0";
      m.currentTime = target;
      if (autoplay) void m.play().catch(() => undefined);
    }
    setTime(target);
  }, []);

  const current = useMemo(() => items.find((i) => i.id === currentId) ?? null, [items, currentId]);

  const addPaths = useCallback((paths: string[]) => {
    const fresh = paths.filter(isSupported).map(makeItem);
    if (fresh.length === 0) return;
    setItems((prev) => {
      const known = new Set(prev.map((i) => i.path));
      return [...prev, ...fresh.filter((i) => !known.has(i.path))];
    });
    // Métadonnées en différé : la liste s'affiche tout de suite, les tags arrivent ensuite.
    fresh.forEach(async (item) => {
      const meta = await loadMetadata(item);
      // Tags absents (fréquent sur les rips web) : on devine l'artiste depuis le nom de fichier.
      if (!meta.artist) {
        const guess = guessFromName(meta.title ?? item.title);
        if (guess) Object.assign(meta, guess);
      }
      setItems((prev) => prev.map((i) => (i.path === item.path ? { ...i, ...meta } : i)));
      // Format que la webview ne lit pas d'ordinaire (TS, AVI, MKV, WMA…) : le serveur dit comment le lire et donne la durée.
      if (needsServerProbe(item.ext)) {
        const probe = await probeLocal(item.path);
        if (probe && probe.playMode !== "direct") {
          setItems((prev) => prev.map((i) => (i.path === item.path ? { ...i, playMode: probe.playMode, url: localPlayUrl(item.path), duration: probe.duration || i.duration, kind: probe.isVideo ? "video" : "audio" } : i)));
          return;
        }
      }
      if (!meta.duration) {
        const duration = await probeDuration(item.url, item.kind);
        if (duration) setItems((prev) => prev.map((i) => (i.path === item.path ? { ...i, duration } : i)));
      }
    });
  }, []);

  /** Ajoute des médias déjà décrits (mode en ligne) : pas de lecture disque ni de sonde de métadonnées. */
  const addItems = useCallback((fresh: MediaItem[]) => {
    if (fresh.length === 0) return;
    setItems((prev) => {
      const known = new Set(prev.map((i) => i.path));
      return [...prev, ...fresh.filter((i) => !known.has(i.path))];
    });
  }, []);

  /** Met à jour un élément (métadonnées arrivées après coup, mode en ligne). */
  const updateItem = useCallback((id: string, fn: (item: MediaItem) => MediaItem) => {
    setItems((prev) => prev.map((i) => (i.id === id ? fn(i) : i)));
  }, []);

  const play = useCallback((id: string) => {
    // Rejouer la piste déjà chargée (ex. double-clic sur un titre terminé ou en pause) : l'identifiant ne change pas,
    // donc l'effet de chargement ne se déclenche pas ; on repart explicitement du début.
    if (id === stateRef.current.currentId) { seekTo(0, true); return; }
    setCurrentId(id);
    // L'effet sur `current` charge la source ; la lecture démarre dessus (cf. effet plus bas).
  }, []);

  const next = useCallback((auto = false) => {
    const { items: list, currentId: id, repeat: rep, shuffle: shuf } = stateRef.current;
    if (list.length === 0) return;
    if (auto && rep === "one") {
      seekTo(0, true);
      return;
    }
    const idx = list.findIndex((i) => i.id === id);
    let target: number;
    if (shuf && list.length > 1) {
      do { target = Math.floor(Math.random() * list.length); } while (target === idx);
    } else {
      target = idx + 1;
      if (target >= list.length) {
        if (auto && rep === "off") { setPlaying(false); return; }
        target = 0;
      }
    }
    setCurrentId(list[target].id);
  }, []);

  const previous = useCallback(() => {
    const { items: list, currentId: id } = stateRef.current;
    const m = mediaRef.current;
    // Convention des lecteurs : après 3 s, "précédent" revient au début de la piste.
    if (m && getTime() > 3) { seekTo(0); return; }
    const idx = list.findIndex((i) => i.id === id);
    if (list.length > 0) setCurrentId(list[(idx - 1 + list.length) % list.length].id);
  }, []);

  const togglePlay = useCallback(() => {
    const m = mediaRef.current;
    if (!m) return;
    if (!stateRef.current.currentId && stateRef.current.items[0]) { setCurrentId(stateRef.current.items[0].id); return; }
    if (m.paused) void m.play(); else m.pause();
  }, []);

  const stop = useCallback(() => {
    const m = mediaRef.current;
    if (!m) return;
    m.pause();
    seekTo(0);
  }, [seekTo]);

  const seek = useCallback((sec: number) => seekTo(sec), [seekTo]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (v > 0) setMuted(false);
  }, []);

  const removeItems = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setItems((prev) => prev.filter((i) => !set.has(i.id)));
    if (stateRef.current.currentId && set.has(stateRef.current.currentId)) {
      mediaRef.current?.pause();
      setCurrentId(null);
    }
  }, []);

  /** Déplace les éléments sélectionnés d'un cran (delta -1 = vers le haut, +1 = vers le bas), en conservant leur ordre relatif. */
  const moveItems = useCallback((ids: string[], delta: -1 | 1) => {
    const set = new Set(ids);
    setItems((prev) => {
      const list = [...prev];
      const indexes = list.map((_, i) => i);
      // On parcourt dans le sens du déplacement inverse pour ne pas enjamber un autre élément sélectionné.
      for (const i of delta === -1 ? indexes : indexes.reverse()) {
        const j = i + delta;
        if (set.has(list[i].id) && j >= 0 && j < list.length && !set.has(list[j].id)) [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    });
  }, []);

  /** Place les éléments `ids` juste avant `targetId` (null = à la fin), en conservant leur ordre relatif. Sert au glisser-déposer. */
  const moveBefore = useCallback((ids: string[], targetId: string | null) => {
    const set = new Set(ids);
    if (targetId && set.has(targetId)) return;
    setItems((prev) => {
      const moved = prev.filter((i) => set.has(i.id));
      const rest = prev.filter((i) => !set.has(i.id));
      const at = targetId ? rest.findIndex((i) => i.id === targetId) : -1;
      if (at === -1) return [...rest, ...moved];
      return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
    });
  }, []);

  /** Impose un nouvel ordre (liste d'ids) ; les ids absents sont conservés à la suite. */
  const setOrder = useCallback((ids: string[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      const ordered = ids.map((id) => byId.get(id)).filter((i): i is MediaItem => Boolean(i));
      const seen = new Set(ids);
      return [...ordered, ...prev.filter((i) => !seen.has(i.id))];
    });
  }, []);

  const shuffleOrder = useCallback(() => {
    setItems((prev) => {
      const list = [...prev];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    });
  }, []);

  /** Arrête et décharge la piste en cours : libère le fichier (Windows refuse de remplacer un fichier encore ouvert). */
  const release = useCallback(() => {
    mediaRef.current?.pause();
    setCurrentId(null);
  }, []);

  const clear = useCallback(() => removeItems(stateRef.current.items.map((i) => i.id)), [removeItems]);

  // Charge la source quand la piste change.
  useEffect(() => {
    setLoop({ a: null, b: null });
    const m = mediaRef.current;
    if (!m) return;
    offsetRef.current = 0;
    m.dataset.offset = "0";
    if (!current) { m.removeAttribute("src"); m.load(); setTime(0); setDuration(0); return; }
    m.src = current.url;
    m.load();
    m.play().catch(() => setPlaying(false));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = mediaRef.current;
    if (m) { m.volume = volume; m.muted = muted; }
  }, [volume, muted]);

  // IMPORTANT : load() remet playbackRate à defaultPlaybackRate ; on fixe les deux pour que la vitesse
  // survive au changement de piste.
  useEffect(() => {
    const m = mediaRef.current;
    if (m) { m.defaultPlaybackRate = rate; m.playbackRate = rate; }
  }, [rate, current?.id]);

  // Minuterie : compte à rebours en secondes, pause à zéro.
  useEffect(() => {
    if (typeof sleepMode !== "number") { setSleepLeft(0); return; }
    const end = Date.now() + sleepMode * 60_000;
    setSleepLeft(sleepMode * 60);
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setSleepLeft(left);
      if (left === 0) { mediaRef.current?.pause(); setSleepMode("off"); }
    }, 1000);
    return () => clearInterval(id);
  }, [sleepMode]);

  // Listeners de l'élément média.
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;
    const onTime = () => {
      const t = offsetRef.current + m.currentTime;
      setTime(t);
      const { a, b } = loopRef.current;
      if (a !== null && b !== null && t >= b) seekTo(a);
    };
    const onMeta = () => {
      const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
      const streamed = Boolean(item?.playMode && item.playMode !== "direct");
      // Un flux produit à la volée ne connaît pas sa vraie durée : on garde celle du serveur.
      setDuration(Number.isFinite(m.duration) && !streamed ? m.duration : item?.duration || (Number.isFinite(m.duration) ? m.duration : 0));
      // La durée réelle écrase l'estimation des tags (souvent absente pour les MP3 sans en-tête Xing).
      if (!streamed && Number.isFinite(m.duration)) setItems((prev) => prev.map((i) => (i.id === stateRef.current.currentId ? { ...i, duration: m.duration } : i)));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (sleepRef.current === "track") { setSleepMode("off"); setPlaying(false); return; }
      next(true);
    };
    m.addEventListener("timeupdate", onTime);
    m.addEventListener("loadedmetadata", onMeta);
    m.addEventListener("play", onPlay);
    m.addEventListener("pause", onPause);
    m.addEventListener("ended", onEnded);
    // Repli : un fichier réputé lisible (ex. MP4 en HEVC) échoue dans la webview → on demande au serveur de le convertir, une fois par piste.
    const onError = () => {
      const { items: list, currentId: id } = stateRef.current;
      const item = list.find((i) => i.id === id);
      if (!item || item.source !== "local" || item.playMode || triedRef.current.has(item.id)) return;
      triedRef.current.add(item.id);
      void probeLocal(item.path).then((probe) => {
        if (!probe || probe.playMode === "direct" || stateRef.current.currentId !== item.id) return;
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, playMode: probe.playMode, url: localPlayUrl(item.path), duration: probe.duration || i.duration } : i)));
        offsetRef.current = 0;
        m.dataset.offset = "0";
        m.src = localPlayUrl(item.path);
        m.load();
        m.play().catch(() => setPlaying(false));
      });
    };
    m.addEventListener("error", onError);
    return () => {
      m.removeEventListener("error", onError);
      m.removeEventListener("timeupdate", onTime);
      m.removeEventListener("loadedmetadata", onMeta);
      m.removeEventListener("play", onPlay);
      m.removeEventListener("pause", onPause);
      m.removeEventListener("ended", onEnded);
    };
  }, [next]);

  // Restauration de la dernière session (équivalent de "sauvegarde de votre dernière session").
  useEffect(() => { if (storageKey) addPaths(readStoredPaths(storageKey)); }, [addPaths, storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(items.map((i) => i.path))); } catch { /* quota/private: non bloquant */ }
  }, [items]);

  return {
    mediaRef, items, current, playing, time, duration, volume, muted, repeat, shuffle, rate, loop, sleepMode, sleepLeft,
    addPaths, addItems, updateItem, play, next, previous, togglePlay, stop, seek, setVolume, removeItems, clear, release, moveItems, moveBefore, setOrder, shuffleOrder,
    setLoopA: () => setLoop({ a: getTime(), b: null }),
    // B doit suivre A ; sinon on ignore le clic plutôt que de créer une boucle vide.
    setLoopB: () => setLoop((l) => { const t = getTime(); return l.a !== null && t > l.a ? { ...l, b: t } : l; }),
    clearLoop: () => setLoop({ a: null, b: null }),
    cycleSleep: () => setSleepMode((m) => SLEEP_MODES[(SLEEP_MODES.indexOf(m) + 1) % SLEEP_MODES.length]),
    pictureInPicture: () => { const m = mediaRef.current; if (m && document.pictureInPictureEnabled) void (document.pictureInPictureElement ? document.exitPictureInPicture() : m.requestPictureInPicture()).catch(() => undefined); },
    cycleRate: () => setRateState((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length]),
    toggleMute: () => setMuted((m) => !m),
    toggleShuffle: () => setShuffle((s) => !s),
    cycleRepeat: () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
  };
}
