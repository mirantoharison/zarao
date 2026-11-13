import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readRate, saveRate } from "@/lib/rates";
import { localPlayUrl, probeLocal } from "@/lib/api";
import { attachEqualizer, getEqualizer, setEqualizerGain, useEqualizer, wantsEqualizerGraph } from "@/lib/equalizer";
import { applyMediaSink, guessFromName, isSupported, loadMetadata, localUrl, makeItem, needsServerProbe, probeDuration, type MediaItem } from "@/lib/media";
import { clearResume, getResume, resumeMinSeconds, saveResume } from "@/lib/resume";
import { useAudioSettings } from "@/lib/settings";
import { loadSidecarSubtitles, type SubtitleTrack } from "@/lib/subtitles";

/** Pistes jouées récemment (les plus récentes d'abord), mémorisées entre deux sessions par chemin : les identifiants de liste, eux, changent à chaque ajout. */
export type HistoryEntry = { path: string; title: string; artist: string; kind: "audio" | "video"; source: "local" | "online"; at: number };
const HISTORY_KEY = "zarao.local.history";
const HISTORY_MAX = 50;
function readHistory(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((h): h is HistoryEntry => typeof h?.path === "string" && typeof h?.at === "number").slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}

/** Pourquoi une piste a été sautée : format que ni la webview ni le serveur ne lisent, serveur injoignable, conversion échouée, média distant. */
export type UnplayableReason = "unsupported" | "noServer" | "streamFailed" | "network";
export type UnplayableEntry = { id: string; reason: UnplayableReason };

export type RepeatMode = "off" | "all" | "one";
/** Minuterie : arrêt (`off`), fin de la piste, ou un nombre de minutes (les préréglages de SLEEP_MODES ou une durée libre, cf. SleepDialog). */
export type SleepMode = "off" | "track" | number;
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
/**
 * Adresse à donner à l'élément média. Égaliseur engagé : un fichier local lu en direct passe par le serveur local (CORS),
 * car le protocole asset de Tauri rendrait le son muet une fois l'élément routé dans Web Audio (cf. lib/equalizer.ts).
 */
const sourceFor = (item: MediaItem) =>
  getEqualizer().engaged && item.source === "local" && (!item.playMode || item.playMode === "direct") ? localPlayUrl(item.path) : item.url;

export function usePlayer(opts: { storageKey?: string | null; onUnplayable?: (item: MediaItem) => void } = {}) {
  // IMPORTANT : null = pas de persistance (mode en ligne : la playlist se reconstruit depuis le serveur).
  const storageKey = opts.storageKey === undefined ? STORAGE_KEY : opts.storageKey;
  // `onUnplayable` : prévenu quand une piste illisible est sautée (lu via une ref, les handlers de l'élément média ne sont attachés qu'une fois).
  const onUnplayableRef = useRef(opts.onUnplayable);
  onUnplayableRef.current = opts.onUnplayable;
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const eq = useEqualizer();
  const wantsGraph = wantsEqualizerGraph(eq);
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
  /** Reprise proposée pour la vidéo en cours (position mémorisée lors d'une lecture précédente) ; null = rien à proposer. */
  const [resumeOffer, setResumeOffer] = useState<{ id: string; time: number } | null>(null);
  const lastResumeSaveRef = useRef(0);
  /** Reprise à reproposer au prochain « play » après un Arrêt (cf. `stop`). */
  const offerAfterStopRef = useRef<{ id: string; time: number } | null>(null);
  /** Source en cours de chargement (démarrage d'une piste, flux converti à lancer, déplacement dans un flux, tampon vide) : rien ne joue encore. */
  const [loading, setLoading] = useState(false);
  /** Pistes sautées parce qu'illisibles (liste consultable, cf. UnplayableDialog) ; une piste qui finit par jouer en sort. */
  const [unplayable, setUnplayable] = useState<UnplayableEntry[]>([]);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const sleepRef = useRef(sleepMode);
  sleepRef.current = sleepMode;

  // Refs miroir : les handlers de l'élément média sont attachés une fois, ils ne doivent pas lire un état périmé.
  /** File « à suivre » : identifiants de pistes à jouer avant la suite normale de la liste (cf. `next`). */
  const [queue, setQueue] = useState<string[]>([]);
  const stateRef = useRef({ items, currentId, repeat, shuffle, queue });
  stateRef.current = { items, currentId, repeat, shuffle, queue };

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
    // Flux du serveur : d'après la piste, ou d'après l'adresse réellement chargée (repli après erreur, `playMode` pas encore à jour).
    // Un tel flux n'est pas déplaçable nativement : sans ce test, `currentTime` serait ignoré et l'avance rapide ne ferait rien.
    let streamUrl: string | null = item && item.playMode && item.playMode !== "direct" ? item.url : null;
    if (!streamUrl && m.currentSrc.includes("/local/play")) {
      const u = new URL(m.currentSrc);
      u.searchParams.delete("time");
      streamUrl = u.toString();
    }
    if (streamUrl) {
      const resume = autoplay || !m.paused;
      offsetRef.current = target;
      // Lu par le spectre et le visualiseur, qui lisent currentTime directement sur l'élément.
      m.dataset.offset = String(target);
      m.src = `${streamUrl}${streamUrl.includes("?") ? "&" : "?"}time=${target.toFixed(2)}`;
      m.load();
      if (resume) void m.play().catch(() => undefined);
      // IMPORTANT : `load()` annule les événements en attente, dont le « pause » de l'arrêt qui vient d'avoir lieu : sans ceci l'état resterait
      // « en lecture » (bouton pause affiché) alors que rien ne joue.
      else setPlaying(false);
    } else {
      offsetRef.current = 0;
      m.dataset.offset = "0";
      m.currentTime = target;
      if (autoplay) void m.play().catch(() => undefined);
    }
    setTime(target);
  }, []);

  const current = useMemo(() => items.find((i) => i.id === currentId) ?? null, [items, currentId]);

  // Retour : pile des pistes déjà écoutées (la plus récente en dernier), pour rejouer « ce que j'écoutais avant » même en lecture aléatoire,
  // où « précédent » n'a pas de sens dans l'ordre de la liste.
  const [backStack, setBackStack] = useState<string[]>([]);
  const backRef = useRef(backStack);
  backRef.current = backStack;
  const prevIdRef = useRef<string | null>(null);
  /** IMPORTANT : un retour ne doit pas empiler la piste qu'on quitte, sinon deux « retour » feraient la navette entre deux pistes. */
  const goingBackRef = useRef(false);
  useEffect(() => {
    const before = prevIdRef.current;
    prevIdRef.current = currentId;
    if (goingBackRef.current) { goingBackRef.current = false; return; }
    if (before && before !== currentId) setBackStack((s) => [...s.slice(-99), before]);
  }, [currentId]);

  // Vitesse mémorisée par média (cf. lib/rates.ts) : un média sans réglage propre est lu à 1×.
  useEffect(() => { if (current) setRateState(readRate(current.path)); }, [current?.path]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setQueue((prev) => (prev.includes(id) ? prev.filter((q) => q !== id) : prev));
    setCurrentId(id);
    // L'effet sur `current` charge la source ; la lecture démarre dessus (cf. effet plus bas).
  }, []);

  /** Instant à rejoindre dès que la piste visée est chargée (cf. `playAt`, utilisé par les signets d'un autre média). */
  const pendingSeekRef = useRef<{ id: string; t: number } | null>(null);
  /** Lance un média ET se place à `sec` : un `seek` immédiat serait perdu, la source n'étant pas encore chargée. */
  const playAt = useCallback((id: string, sec: number) => {
    if (id === stateRef.current.currentId) { seekTo(sec, true); return; }
    pendingSeekRef.current = { id, t: sec };
    play(id);
  }, [play, seekTo]);

  // Morceau suivant prévu. En lecture aléatoire le tirage est mémorisé : le préchargement et `next` doivent viser la MÊME piste.
  const nextPickRef = useRef<{ from: string | null; id: string } | null>(null);
  const peekNext = useCallback((): MediaItem | null => {
    const { items: list, currentId: id, repeat: rep, shuffle: shuf, queue: q } = stateRef.current;
    if (list.length === 0) return null;
    // La file « à suivre » passe avant tout (mode aléatoire compris) : le préchargement et `next` visent la même piste.
    const queued = q.map((qid) => list.find((i) => i.id === qid)).find(Boolean);
    if (queued) return queued;
    const idx = list.findIndex((i) => i.id === id);
    if (shuf && list.length > 1) {
      const kept = nextPickRef.current;
      const hit = kept && kept.from === id ? list.find((i) => i.id === kept.id) : undefined;
      if (hit) return hit;
      let t: number;
      do { t = Math.floor(Math.random() * list.length); } while (t === idx);
      nextPickRef.current = { from: id, id: list[t].id };
      return list[t];
    }
    if (idx + 1 < list.length) return list[idx + 1];
    return rep === "off" ? null : list[0];
  }, []);

  /** `skipping` : saut d'une piste illisible. « Répéter la piste » ne s'applique alors pas (on rejouerait la piste en échec en boucle). */
  const next = useCallback((auto = false, skipping = false) => {
    const { items: list, currentId: id, repeat: rep, shuffle: shuf } = stateRef.current;
    if (list.length === 0) return;
    if (auto && rep === "one" && !skipping) {
      seekTo(0, true);
      return;
    }
    // File « à suivre » : la première piste encore présente dans la liste ; les identifiants disparus sont purgés au passage.
    const queued = stateRef.current.queue.find((qid) => list.some((i) => i.id === qid));
    if (queued) {
      setQueue((prev) => prev.filter((qid) => qid !== queued && list.some((i) => i.id === qid)));
      setCurrentId(queued);
      return;
    }
    const idx = list.findIndex((i) => i.id === id);
    let target: number;
    if (shuf && list.length > 1) {
      const pick = peekNext();
      target = pick ? list.findIndex((i) => i.id === pick.id) : 0;
    } else {
      target = idx + 1;
      if (target >= list.length) {
        if (auto && rep === "off") { setPlaying(false); return; }
        target = 0;
      }
    }
    setCurrentId(list[target].id);
  }, []);

  /** Pistes illisibles enchaînées depuis la dernière qui a démarré : borne le saut automatique (liste entièrement illisible = on s'arrête). */
  const failStreakRef = useRef(0);
  /**
   * Piste définitivement illisible (aucun repli serveur possible) : on prévient puis on passe à la suivante, au lieu de rester bloqué
   * sur elle à 0:00. Sans effet si l'utilisateur a déjà changé de piste entre-temps.
   */
  const skipUnplayable = useCallback((item: MediaItem, reason: UnplayableReason) => {
    if (stateRef.current.currentId !== item.id) return;
    onUnplayableRef.current?.(item);
    setUnplayable((prev) => (prev.some((u) => u.id === item.id) ? prev.map((u) => (u.id === item.id ? { id: item.id, reason } : u)) : [...prev, { id: item.id, reason }]));
    failStreakRef.current += 1;
    if (failStreakRef.current >= stateRef.current.items.length) { failStreakRef.current = 0; setPlaying(false); return; }
    next(true, true);
  }, [next]);

  /** Revient à la dernière piste écoutée encore présente dans la liste. Renvoie false s'il n'y en a pas. */
  const goBack = useCallback((): boolean => {
    const { items: list, currentId: id } = stateRef.current;
    const stack = [...backRef.current];
    while (stack.length > 0) {
      const target = stack.pop() as string;
      if (target !== id && list.some((i) => i.id === target)) {
        goingBackRef.current = true;
        setBackStack(stack);
        setCurrentId(target);
        return true;
      }
    }
    setBackStack(stack);
    return false;
  }, []);

  const previous = useCallback(() => {
    // En lecture aléatoire, « précédent » = la piste réellement écoutée avant (l'ordre de la liste n'a plus de sens).
    if (stateRef.current.shuffle && goBack()) return;
    const { items: list, currentId: id } = stateRef.current;
    // IMPORTANT : toujours la piste précédente, sans la règle usuelle « après 3 s on revient au début de la piste » :
    // elle faisait croire à un clic sans effet (seule la barre revenait à 0). Pour recommencer la piste : Arrêt, ou la barre de progression.
    const idx = list.findIndex((i) => i.id === id);
    if (list.length > 0) setCurrentId(list[(idx - 1 + list.length) % list.length].id);
  }, [goBack]);

  const togglePlay = useCallback(() => {
    const m = mediaRef.current;
    if (!m) return;
    if (!stateRef.current.currentId && stateRef.current.items[0]) { setCurrentId(stateRef.current.items[0].id); return; }
    if (m.paused) void m.play(); else m.pause();
  }, []);

  const stop = useCallback(() => {
    const m = mediaRef.current;
    if (!m) return;
    // Vidéo arrêtée : on mémorise la position EXACTE (pas celle d'il y a 3 s) et on la reproposera au prochain lancement de la lecture.
    const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
    const at = getTime();
    if (item?.kind === "video") {
      saveResume(item, at, item.duration || (Number.isFinite(m.duration) ? m.duration : 0));
      const saved = getResume(item);
      offerAfterStopRef.current = saved !== null ? { id: item.id, time: saved } : null;
    }
    m.pause();
    seekTo(0);
  }, [seekTo, getTime]);

  // Se déplacer soi-même dans la vidéo vaut réponse à la proposition de reprise : elle disparaît.
  const seek = useCallback((sec: number) => { setResumeOffer(null); seekTo(sec); }, [seekTo]);

  /** « Reprendre » : va à la position mémorisée et lance la lecture. */
  const acceptResume = useCallback(() => {
    if (!resumeOffer) return;
    setResumeOffer(null);
    seekTo(resumeOffer.time, true);
  }, [resumeOffer, seekTo]);
  /** « Recommencer » : oublie la position mémorisée et repart du début (sans relancer un flux converti s'il vient à peine de démarrer). */
  const declineResume = useCallback(() => {
    const item = stateRef.current.items.find((i) => i.id === resumeOffer?.id);
    if (item) clearResume(item);
    setResumeOffer(null);
    if (getTime() > 2) seekTo(0, true);
  }, [resumeOffer, seekTo, getTime]);
  /** Ferme la proposition sans rien effacer (délai écoulé, croix) : la position reste mémorisée pour la fois suivante. */
  const closeResumeOffer = useCallback(() => setResumeOffer(null), []);

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

  /** Piste suspendue par `suspend()` : de quoi reprendre exactement au même endroit. */
  const suspendedRef = useRef<{ id: string; time: number; playing: boolean } | null>(null);

  /**
   * Relâche le fichier de la piste en cours SANS la quitter (Windows refuse de remplacer un fichier encore ouvert).
   * Contrairement à `release()`, la piste reste sélectionnée : `resume()` la recharge à la même position.
   */
  const suspend = useCallback(() => {
    const m = mediaRef.current;
    const id = stateRef.current.currentId;
    if (!m || !id) return;
    suspendedRef.current = { id, time: getTime(), playing: !m.paused };
    m.pause();
    m.removeAttribute("src");
    m.load();
  }, [getTime]);

  /** Recharge la piste suspendue à la position où elle s'était arrêtée ; `newPath` si le fichier a été renommé entre-temps. */
  const resume = useCallback((newPath?: string) => {
    const s = suspendedRef.current;
    suspendedRef.current = null;
    const m = mediaRef.current;
    if (!s || !m || stateRef.current.currentId !== s.id) return;
    const found = stateRef.current.items.find((i) => i.id === s.id);
    if (!found) return;
    const item = newPath && newPath !== found.path ? { ...found, path: newPath, url: localUrl(newPath, found.playMode) } : found;
    const play = () => { if (s.playing) m.play().catch(() => setPlaying(false)); };
    if (item.playMode && item.playMode !== "direct") {
      // Flux produit à la volée : on le relance à l'instant voulu (cf. seekTo).
      offsetRef.current = s.time;
      m.dataset.offset = String(s.time);
      m.src = `${item.url}${item.url.includes("?") ? "&" : "?"}time=${s.time.toFixed(2)}`;
      m.load();
      play();
      return;
    }
    offsetRef.current = 0;
    m.dataset.offset = "0";
    m.src = sourceFor(item);
    m.load();
    m.addEventListener("loadedmetadata", () => { m.currentTime = s.time; play(); }, { once: true });
  }, []);

  const clear = useCallback(() => removeItems(stateRef.current.items.map((i) => i.id)), [removeItems]);

  // Charge la source quand la piste change.
  useEffect(() => {
    setLoop({ a: null, b: null });
    // Vidéo déjà regardée plus d'une minute : on propose de reprendre là où l'on s'était arrêté (la lecture démarre du début en attendant).
    const saved = current ? getResume(current) : null;
    setResumeOffer(current && saved !== null ? { id: current.id, time: saved } : null);
    const m = mediaRef.current;
    if (!m) return;
    offsetRef.current = 0;
    m.dataset.offset = "0";
    if (!current) { m.removeAttribute("src"); m.load(); setTime(0); setDuration(0); return; }
    // Égaliseur actif (ou déjà engagé) : crossOrigin AVANT src, et branchement avant le chargement.
    if (wantsEqualizerGraph() || getEqualizer().engaged) { m.crossOrigin = "anonymous"; attachEqualizer(m); }
    m.src = sourceFor(current);
    m.load();
    m.play().catch(() => setPlaying(false));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Niveau réel de l'élément = volume choisi × ReplayGain × fondu. Un seul endroit le calcule : `applyLevel` est aussi appelé
  // par le fondu (cf. plus bas), qui ne doit pas écraser le gain d'un morceau ni l'inverse.
  const audioSettings = useAudioSettings();
  const gainMode = audioSettings.replayGain;
  const gainDb = !current || gainMode === "off" ? 0
    : (gainMode === "album" ? current.albumGainDb ?? current.trackGainDb : current.trackGainDb ?? current.albumGainDb) ?? 0;
  const levelRef = useRef({ volume: 0.8, muted: false, gainDb: 0, engaged: false, fade: 1 });
  const applyLevel = useCallback(() => {
    const m = mediaRef.current;
    if (!m) return;
    const { volume: v, muted: mu, gainDb: g, engaged, fade } = levelRef.current;
    const linear = 10 ** (g / 20);
    m.muted = mu;
    // Hors Web Audio, `volume` plafonne à 1 : on ne peut qu'atténuer. Dans le graphe, le gain (éventuellement > 1) passe par le limiteur.
    m.volume = Math.max(0, Math.min(1, v * fade * (engaged ? 1 : Math.min(1, linear))));
    setEqualizerGain(engaged ? linear : 1);
  }, []);
  useEffect(() => {
    levelRef.current = { ...levelRef.current, volume, muted, gainDb, engaged: eq.engaged };
    applyLevel();
  }, [volume, muted, gainDb, eq.engaged, applyLevel]);

  // Fondu : sortie sur les N dernières secondes d'une piste audio, entrée sur les N premières. Pas de recouvrement : une seule
  // source tourne à la fois (le lecteur n'a qu'un élément média). Cadence de 100 ms, car `timeupdate` (≈ 4 Hz) ferait des marches d'escalier.
  const fadeSeconds = audioSettings.fadeSeconds;
  useEffect(() => {
    if (fadeSeconds <= 0 || !playing || current?.kind !== "audio") {
      if (levelRef.current.fade !== 1) { levelRef.current.fade = 1; applyLevel(); }
      return;
    }
    const id = setInterval(() => {
      const m = mediaRef.current;
      const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
      if (!m || !item) return;
      const streamed = Boolean(item.playMode && item.playMode !== "direct");
      const length = Number.isFinite(m.duration) && !streamed ? m.duration : item.duration;
      const pos = offsetRef.current + m.currentTime;
      let fade = pos / fadeSeconds;
      if (length > 0) fade = Math.min(fade, (length - pos) / fadeSeconds);
      // Au carré : la perception du volume est logarithmique, une rampe linéaire paraît trop brusque en fin de course.
      fade = Math.max(0, Math.min(1, fade)) ** 2;
      if (Math.abs(fade - levelRef.current.fade) > 0.005) { levelRef.current.fade = fade; applyLevel(); }
    }, 100);
    return () => { clearInterval(id); levelRef.current.fade = 1; applyLevel(); };
  }, [fadeSeconds, playing, current?.id, current?.kind, applyLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Préchargement du morceau suivant (audio lu en direct) : un élément détaché le télécharge pendant que le courant joue,
  // ce qui réchauffe le cache de la webview. IMPORTANT : on ne précharge ni les vidéos ni les flux produits à la volée
  // (ffmpeg partirait pour rien). La coupure entre deux pistes est réduite, pas supprimée : un seul élément média sert à tout.
  const preloadNext = audioSettings.preloadNext;
  useEffect(() => {
    if (!preloadNext || !playing || !current) return;
    let el: HTMLAudioElement | null = null;
    const timer = setTimeout(() => {
      const n = peekNext();
      if (!n || n.id === current.id || n.kind !== "audio" || (n.playMode && n.playMode !== "direct")) return;
      el = new Audio();
      el.preload = "auto";
      el.src = sourceFor(n);
    }, 2000);
    return () => { clearTimeout(timer); if (el) { el.removeAttribute("src"); el.load(); } };
  }, [preloadNext, playing, current?.id, peekNext]); // eslint-disable-line react-hooks/exhaustive-deps

  // Périphérique de sortie choisi dans les Paramètres. Réappliqué à chaque piste : load() ne le réinitialise pas, mais un changement
  // de source peut survenir avant que le périphérique ne soit prêt.
  const sinkId = useAudioSettings().sinkId;
  useEffect(() => {
    const m = mediaRef.current;
    if (m) applyMediaSink(m, sinkId);
  }, [sinkId, current?.id]);

  // IMPORTANT : load() remet playbackRate à defaultPlaybackRate ; on fixe les deux pour que la vitesse
  // survive au changement de piste.
  useEffect(() => {
    const m = mediaRef.current;
    if (m) { m.defaultPlaybackRate = rate; m.playbackRate = rate; }
  }, [rate, current?.id]);

  // Égaliseur activé en cours de lecture : on recharge la piste à la même position avec une source compatible Web Audio.
  useEffect(() => {
    const m = mediaRef.current;
    const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
    if (!m || !wantsGraph || eq.engaged) return;
    m.crossOrigin = "anonymous";
    attachEqualizer(m);
    if (!item) return;
    const resumeAt = getTime();
    const wasPlaying = !m.paused;
    if (item.playMode && item.playMode !== "direct") { seekTo(resumeAt, wasPlaying); return; }
    m.src = sourceFor(item);
    m.load();
    m.addEventListener("loadedmetadata", () => { m.currentTime = resumeAt; if (wasPlaying) void m.play().catch(() => undefined); }, { once: true });
  }, [wantsGraph]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Position de la vidéo mémorisée toutes les 3 s une fois passée la première minute (cf. lib/resume.ts).
      if (t >= resumeMinSeconds() && Date.now() - lastResumeSaveRef.current > 3000) {
        const playing = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
        if (playing?.kind === "video") {
          lastResumeSaveRef.current = Date.now();
          saveResume(playing, t, playing.duration || (Number.isFinite(m.duration) ? m.duration : 0));
        }
      }
    };
    const onMeta = () => {
      const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
      // IMPORTANT : on regarde aussi l'adresse réellement chargée. Dans le repli après une erreur de lecture, le flux du serveur est chargé
      // avant que `playMode` de la piste soit à jour : sans ce test, sa durée provisoire (≈ 2 s) serait affichée puis mémorisée.
      const streamed = Boolean(item?.playMode && item.playMode !== "direct") || m.currentSrc.includes("/local/play");
      // Un flux produit à la volée ne connaît pas sa vraie durée : on garde celle du serveur.
      setDuration(Number.isFinite(m.duration) && !streamed ? m.duration : item?.duration || (Number.isFinite(m.duration) ? m.duration : 0));
      // La durée réelle écrase l'estimation des tags (souvent absente pour les MP3 sans en-tête Xing).
      if (!streamed && Number.isFinite(m.duration)) setItems((prev) => prev.map((i) => (i.id === stateRef.current.currentId ? { ...i, duration: m.duration } : i)));
      // Saut demandé par `playAt` : fait une seule fois, et seulement si la piste chargée est bien celle visée.
      const pending = pendingSeekRef.current;
      if (pending) {
        pendingSeekRef.current = null;
        if (pending.id === stateRef.current.currentId) seekTo(pending.t, true);
      }
    };
    const onPlay = () => {
      setPlaying(true);
      // Lecture relancée après un Arrêt sur la même vidéo : on reproPose la reprise (une seule fois).
      const o = offerAfterStopRef.current;
      offerAfterStopRef.current = null;
      if (o && o.id === stateRef.current.currentId) setResumeOffer(o);
    };
    // Chargement : commence avec la source (ou à une attente de données), finit dès que la lecture est possible, ou en cas d'échec / de source retirée.
    const onLoading = () => setLoading(true);
    const onReady = () => setLoading(false);
    // Une piste a réellement démarré : la série d'échecs est rompue.
    const onPlaying = () => {
      failStreakRef.current = 0;
      setLoading(false);
      const id = stateRef.current.currentId;
      setUnplayable((prev) => (prev.some((u) => u.id === id) ? prev.filter((u) => u.id !== id) : prev));
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      // Vidéo regardée jusqu'au bout : plus rien à reprendre.
      const finished = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
      if (finished) clearResume(finished);
      if (sleepRef.current === "track") { setSleepMode("off"); setPlaying(false); return; }
      next(true);
    };
    m.addEventListener("timeupdate", onTime);
    m.addEventListener("loadedmetadata", onMeta);
    m.addEventListener("play", onPlay);
    m.addEventListener("playing", onPlaying);
    m.addEventListener("loadstart", onLoading);
    m.addEventListener("waiting", onLoading);
    for (const ev of ["canplay", "error", "emptied", "ended"]) m.addEventListener(ev, onReady);
    m.addEventListener("pause", onPause);
    m.addEventListener("ended", onEnded);
    // Repli : un fichier réputé lisible (ex. MP4 en HEVC) échoue dans la webview → on demande au serveur de le convertir, une fois par piste.
    // Sans repli possible (ni conversion par le serveur, ni deuxième tentative), la piste est sautée. IMPORTANT : seulement si elle n'a jamais
    // démarré (position 0) : une erreur en cours de morceau, ou après un déplacement dans un flux, ne doit pas faire perdre la piste.
    const onError = () => {
      const { items: list, currentId: id } = stateRef.current;
      const item = list.find((i) => i.id === id);
      if (!item || !m.getAttribute("src")) return;
      const giveUp = (reason: UnplayableReason) => { if (offsetRef.current + m.currentTime === 0) skipUnplayable(item, reason); };
      if (item.source !== "local") return giveUp("network");
      if (item.playMode || triedRef.current.has(item.id)) return giveUp("streamFailed");
      triedRef.current.add(item.id);
      void probeLocal(item.path).then((probe) => {
        if (stateRef.current.currentId !== item.id) return;
        if (!probe) return giveUp("noServer");
        if (probe.playMode === "direct") return giveUp("unsupported");
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
      m.removeEventListener("playing", onPlaying);
      m.removeEventListener("loadstart", onLoading);
      m.removeEventListener("waiting", onLoading);
      for (const ev of ["canplay", "error", "emptied", "ended"]) m.removeEventListener(ev, onReady);
      m.removeEventListener("pause", onPause);
      m.removeEventListener("ended", onEnded);
    };
  }, [next, skipUnplayable]);

  // Historique : chaque piste qui démarre passe en tête (une même piste n'apparaît qu'une fois). Mémorisé seulement en mode local (storageKey défini).
  const [history, setHistory] = useState<HistoryEntry[]>(() => (storageKey ? readHistory() : []));
  useEffect(() => {
    if (!current) return;
    setHistory((prev) => [{ path: current.path, title: current.title, artist: current.artist, kind: current.kind, source: current.source, at: Date.now() }, ...prev.filter((h) => h.path !== current.path)].slice(0, HISTORY_MAX));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* non bloquant */ }
  }, [history, storageKey]);

  // Une piste retirée de la liste sort aussi de la file « à suivre ».
  useEffect(() => {
    setQueue((prev) => (prev.every((id) => items.some((i) => i.id === id)) ? prev : prev.filter((id) => items.some((i) => i.id === id))));
  }, [items]);

  // Sous-titres : fichiers .srt / .vtt à côté de la vidéo locale en cours, chargés à chaque changement de piste. Le premier s'affiche d'office.
  // Index -1 = désactivés. `cancelled` évite qu'une lecture lente écrase les sous-titres de la piste suivante.
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleIndex, setSubtitleIndex] = useState(-1);
  useEffect(() => {
    setSubtitleTracks([]);
    setSubtitleIndex(-1);
    if (!current || current.kind !== "video" || current.source !== "local") return;
    let cancelled = false;
    void loadSidecarSubtitles(current.path).then((tracks) => {
      if (cancelled || tracks.length === 0) return;
      setSubtitleTracks(tracks);
      setSubtitleIndex(0);
    });
    return () => { cancelled = true; };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pistes audio d'une vidéo locale : le serveur donne la langue de chacune. `audioTrack` = piste choisie (0 = celle par défaut du fichier).
  // Même garde `cancelled` que pour les sous-titres. Une seule piste ou un ancien serveur (sans `audioLangs`) : pas de choix proposé.
  const [audioLangs, setAudioLangs] = useState<string[]>([]);
  const [audioTrack, setAudioTrack] = useState(0);
  useEffect(() => {
    setAudioLangs([]);
    setAudioTrack(0);
    if (!current || current.kind !== "video" || current.source !== "local") return;
    let cancelled = false;
    void probeLocal(current.path).then((probe) => {
      if (!cancelled && probe?.audioLangs && probe.audioLangs.length > 1) setAudioLangs(probe.audioLangs);
    });
    return () => { cancelled = true; };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Change de piste audio sans quitter la vidéo : le serveur sert un flux avec la piste voulue (`audio=N`), relancé à la position actuelle.
   * IMPORTANT : le média passe en lecture « convertie » (flux), donc les déplacements suivants relancent aussi le flux (cf. seekTo).
   */
  const selectAudioTrack = useCallback((index: number) => {
    const m = mediaRef.current;
    const item = stateRef.current.items.find((i) => i.id === stateRef.current.currentId);
    if (!m || !item || item.source !== "local") return;
    const at = getTime();
    const wasPlaying = !m.paused;
    const url = `${localPlayUrl(item.path)}&audio=${index}`;
    setAudioTrack(index);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, playMode: "transcode", url } : i)));
    offsetRef.current = at;
    m.dataset.offset = String(at);
    m.src = `${url}&time=${at.toFixed(2)}`;
    m.load();
    if (wasPlaying) void m.play().catch(() => setPlaying(false));
  }, [getTime]);

  // Un média retiré de la liste ne peut plus être « illisible ».
  useEffect(() => {
    setUnplayable((prev) => (prev.every((u) => items.some((i) => i.id === u.id)) ? prev : prev.filter((u) => items.some((i) => i.id === u.id))));
  }, [items]);

  // Restauration de la dernière session (équivalent de "sauvegarde de votre dernière session").
  useEffect(() => { if (storageKey) addPaths(readStoredPaths(storageKey)); }, [addPaths, storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(items.map((i) => i.path))); } catch { /* quota/private: non bloquant */ }
  }, [items]);

  // ---- Contrôles du système (touches multimédia, panneau de volume Windows, casque Bluetooth) ----
  // La webview (Chromium) relie la Media Session au système : titre, artiste, pochette et boutons précédent / lecture / suivant.
  // IMPORTANT : pas de code natif nécessaire ; hors webview compatible (navigateur de dev ancien) rien ne se passe.
  const mediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
  useEffect(() => {
    if (!mediaSession) return;
    try {
      mediaSession.metadata = current ? new MediaMetadata({ title: current.title, artist: current.artist, album: "Zarao", artwork: current.jacket ? [{ src: current.jacket }] : [] }) : null;
    } catch { /* pochette refusée : on garde au moins le titre */ }
  }, [mediaSession, current?.id, current?.title, current?.artist, current?.jacket]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mediaSession) mediaSession.playbackState = !current ? "none" : playing ? "playing" : "paused";
  }, [mediaSession, current?.id, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Position affichée par le système : mise à jour à la seconde (le `timeupdate` est plus fréquent, inutile de saturer l'API).
  const wholeSecond = Math.floor(time);
  useEffect(() => {
    if (!mediaSession || !current || !Number.isFinite(duration) || duration <= 0) return;
    try { mediaSession.setPositionState({ duration, position: Math.min(Math.max(0, time), duration), playbackRate: rate }); } catch { /* valeurs refusées */ }
  }, [mediaSession, current?.id, duration, wholeSecond, rate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mediaSession) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { if (mediaRef.current?.paused) togglePlay(); }],
      ["pause", () => { if (mediaRef.current && !mediaRef.current.paused) togglePlay(); }],
      ["stop", () => stop()],
      ["previoustrack", () => previous()],
      ["nexttrack", () => next()],
      ["seekbackward", (d) => seekTo(getTime() - (d.seekOffset ?? 10))],
      ["seekforward", (d) => seekTo(getTime() + (d.seekOffset ?? 10))],
      ["seekto", (d) => { if (typeof d.seekTime === "number") seekTo(d.seekTime); }],
    ];
    for (const [action, handler] of handlers) { try { mediaSession.setActionHandler(action, handler); } catch { /* action non prise en charge */ } }
    return () => { for (const [action] of handlers) { try { mediaSession.setActionHandler(action, null); } catch { /* idem */ } } };
  }, [mediaSession, togglePlay, stop, previous, next, seekTo, getTime]);

  return {
    mediaRef, items, current, playing, time, duration, volume, muted, repeat, shuffle, rate, loop, sleepMode, sleepLeft,
    loading, unplayable, clearUnplayable: () => setUnplayable([]),
    audioLangs, audioTrack, selectAudioTrack,
    subtitleTracks, subtitleIndex,
    /** Passe au jeu de sous-titres suivant, puis « désactivés », puis recommence. */
    cycleSubtitles: () => setSubtitleIndex((i) => (i + 1 >= subtitleTracks.length ? -1 : i + 1)),
    queue,
    /** Ajoute des pistes à la fin de la file « à suivre » (une piste déjà en file n'est pas ajoutée deux fois). */
    enqueue: (ids: string[]) => setQueue((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]),
    dequeue: (id: string) => setQueue((prev) => prev.filter((q) => q !== id)),
    clearQueue: () => setQueue([]),
    history, clearHistory: () => setHistory([]),
    resumeOffer, acceptResume, declineResume, closeResumeOffer,
    addPaths, addItems, updateItem, suspend, resume, play, playAt, next, previous, togglePlay, stop, seek, setVolume, removeItems, clear, release, moveItems, moveBefore, setOrder, shuffleOrder,
    setLoopA: () => setLoop({ a: getTime(), b: null }),
    // B doit suivre A ; sinon on ignore le clic plutôt que de créer une boucle vide.
    setLoopB: () => setLoop((l) => { const t = getTime(); return l.a !== null && t > l.a ? { ...l, b: t } : l; }),
    clearLoop: () => setLoop({ a: null, b: null }),
    /** Minuterie libre : nombre de minutes (peut être fractionnaire pour une heure précise), « track » ou « off ». */
    setSleep: (m: SleepMode) => setSleepMode(m),
    goBack, canGoBack: backStack.length > 0,
    cycleSleep: () => setSleepMode((m) => SLEEP_MODES[(SLEEP_MODES.indexOf(m) + 1) % SLEEP_MODES.length]),
    pictureInPicture: () => { const m = mediaRef.current; if (m && document.pictureInPictureEnabled) void (document.pictureInPictureElement ? document.exitPictureInPicture() : m.requestPictureInPicture()).catch(() => undefined); },
    cycleRate: () => { const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; setRateState(r); if (current) saveRate(current.path, r); },
    toggleMute: () => setMuted((m) => !m),
    toggleShuffle: () => setShuffle((s) => !s),
    cycleRepeat: () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
  };
}
