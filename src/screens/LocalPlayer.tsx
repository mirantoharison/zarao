import { AudioVisualizer } from "@/components/AudioVisualizer";
import { useVisualizerTheme } from "@/lib/visualizerTheme";
import { PaletteMenuItems } from "@/components/PaletteMenuItems";
import { RefreshMenuItem } from "@/components/RefreshMenuItem";
import { EmptyState } from "@/components/EmptyState";
import { BookmarksDialog } from "@/components/BookmarksDialog";
import { DuplicatesDialog } from "@/components/DuplicatesDialog";
import { SleepDialog } from "@/components/SleepDialog";
import { AlarmClock, Bookmark, CopyCheck } from "lucide-react";
import { ResumeBar } from "@/components/ResumeBar";
import { MiniPlayer } from "@/components/MiniPlayer";
import { PlaylistsDialog } from "@/components/PlaylistsDialog";
import { QueueDialog } from "@/components/QueueDialog";
import { enterMini, leaveMini } from "@/lib/miniPlayer";
import { useTray } from "@/lib/tray";
import { UnplayableDialog } from "@/components/UnplayableDialog";
import { ZoomMenuItems } from "@/components/ZoomMenuItems";
import { VideoStage, toggleVideoFullscreen, useFullscreenKindSwitch } from "@/components/VideoStage";
import { AmbientBackground } from "@/components/AmbientBackground";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Copy, CornerDownRight, Crosshair, Clock, GripVertical, Shapes, Type, CircleAlert, Library, ListEnd, Minimize2, Download, Pencil, Maximize, Tags, Heart, ChevronDown, ChevronUp, ListChecks, Pin, ArrowDown, ArrowLeftRight, ArrowUp, FileAudio, FilePlus, FolderOpen, ListPlus, LogOut, Save, Trash2, Volume1, FileVideo, GalleryVertical, Grid2x2, LayoutList, ListMusic, Music, Play, Search, Shuffle, SkipBack, SkipForward, Square, Volume2, VolumeX, Disc3, GalleryHorizontal, MicVocal, ChevronLeft, ChevronRight, Rows3, Eraser, SlidersHorizontal, X, History, CaseSensitive, Regex, WholeWord, Pause } from "lucide-react";
import { PlayerBar, SEEK_STEP } from "@/components/PlayerBar";
import { PlayingBars } from "@/components/PlayingBars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ContextViewItems } from "@/components/ContextViewItems";
import { readPlaylists, savePlaylistNamed, type SavedPlaylist } from "@/lib/playlists";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLyrics } from "@/hooks/useLyrics";
import { usePlayer } from "@/hooks/usePlayer";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { audioExt, videoExt } from "@/lib/media";
import { expandDropped, loadPlaylist, pickFiles, pickFolder, savePlaylist } from "@/lib/files";
import { formatSize, formatTime, localUrl, spectrumSourceOf, type MediaItem } from "@/lib/media";
import { cn } from "@/lib/utils";
import { centerInScroller } from "@/lib/scroll";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { FullscreenPlayer } from "@/components/FullscreenPlayer";
import { activeLine, type Lyrics } from "@/lib/lyrics";
import { LyricsPanel } from "@/components/LyricsPanel";
import { EqualizerPanel } from "@/components/EqualizerPanel";
import { MetadataDialog, type MetadataSaved, type MetadataSource } from "@/components/MetadataDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import type { SettingsSection } from "@/components/settings/sections";
import { SettingsMenuItems } from "@/components/settings/SettingsMenuItems";
import { useFolderWatch } from "@/hooks/useFolderWatch";
import { tr, useI18n } from "@/i18n";

type SortKey = "kind" | "artist" | "title" | "duration";
type SearchField = "name" | "title" | "path" | "artist" | "year";
type ViewMode = "list" | "images" | "jackets" | "rows";

const SEARCH_FIELDS: SearchField[] = ["name", "title", "path", "artist", "year"];
const HISTORY_KEY = "zarao.local.search-history";
const VIEW_KEY = "zarao.local.view";
const LAYOUT_KEY = "zarao.local.layout";
/** Dispositions de l'écran : « scène » (pochette + paroles karaoké) ou « paroles et bande » (paroles en grand, file en bande de pochettes). La liste de lecture s'ouvre en tiroir dans les deux. */
type Layout = "scene" | "strip";
const FAV_KEY = "zarao.local.favorites";

/** Raccourcis affichés dans la boîte d'aide (touches, clé de traduction du libellé). */
const SHORTCUTS: [string, "kb.playPause" | "kb.nextPrev" | "kb.seek" | "kb.volume" | "kb.addFiles" | "kb.addFolder" | "kb.openPlaylist" | "kb.savePlaylist" | "kb.search" | "kb.goto" | "kb.bookmarks" | "kb.back" | "kb.quit"][] = [
  ["Space", "kb.playPause"], ["N / P", "kb.nextPrev"], ["← / →", "kb.seek"],
  ["Ctrl + +  /  Ctrl + −", "kb.volume"], ["Ctrl + O", "kb.addFiles"], ["Ctrl + E", "kb.addFolder"],
  ["Ctrl + P", "kb.openPlaylist"], ["Ctrl + S", "kb.savePlaylist"], ["Ctrl + F", "kb.search"], ["Ctrl + G", "kb.goto"], ["Ctrl + B", "kb.bookmarks"], ["B", "kb.back"], ["Ctrl + Alt + Q", "kb.quit"],
];

function readFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}


/** Construit le prédicat de recherche. Une regex invalide ne filtre rien (au lieu de lever une erreur à chaque frappe). */
function buildMatcher(query: string, exact: boolean, matchCase: boolean, useRegex: boolean): (v: string) => boolean {
  if (!query) return () => true;
  if (useRegex) {
    try {
      const re = new RegExp(query, matchCase ? "" : "i");
      return (v) => re.test(v);
    } catch {
      return () => true;
    }
  }
  const norm = (s: string) => (matchCase ? s : s.toLowerCase());
  const q = norm(query);
  return exact ? (v) => norm(v) === q : (v) => norm(v).includes(q);
}

function readHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as string[]; } catch { return []; }
}

/** `onBack` absent = édition « local » : pas d'écran de choix de mode où revenir, l'entrée de menu est masquée. */
export function LocalPlayer({ onBack }: { onBack?: () => void }) {
  const { t, lang } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  // Piste illisible sautée : on le dit un instant (le message s'efface seul, sauf s'il a été remplacé entre-temps).
  const p = usePlayer({
    onUnplayable: (item) => {
      const text = t("msg.skipped", { n: item.title });
      setMessage(text);
      window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 6000);
    },
  });
  useTray(p);
  // Mini-lecteur : petite fenêtre au premier plan (lib/miniPlayer.ts). L'écran compact s'affiche même si la fenêtre ne peut pas être réduite (hors Tauri).
  const [mini, setMini] = useState(false);
  const miniRef = useRef(false);
  const setMiniMode = (on: boolean) => {
    // Une vidéo ne se regarde pas dans le mini-lecteur : on n'y entre pas pendant une vidéo.
    if (on && p.current?.kind === "video") return;
    miniRef.current = on;
    setMini(on);
    // Classe sur <html> : plus aucune barre de défilement (la page dessous déborderait dans une si petite fenêtre), cf. index.css.
    document.documentElement.classList.toggle("mini-mode", on);
    void (on ? enterMini() : leaveMini()).catch(() => undefined);
  };
  // Une vidéo démarre pendant le mini-lecteur (piste suivante, clic dans le carrousel, touche) : retour forcé à la fenêtre normale.
  useEffect(() => { if (mini && p.current?.kind === "video") setMiniMode(false); }, [mini, p.current?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // Quitter l'écran du lecteur en mode mini : la fenêtre retrouve sa taille.
  useEffect(() => () => {
    document.documentElement.classList.remove("mini-mode");
    if (miniRef.current) void leaveMini().catch(() => undefined);
  }, []);
  const [unplayableOpen, setUnplayableOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState("");
  const [field, setField] = useState<SearchField>("title");
  const [exact, setExact] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<string[]>(readHistory);
  const [favorites, setFavorites] = useState<Set<string>>(readFavorites);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Page des Paramètres ouverte (null = fermé) : chaque page est une entrée du menu « Paramètres ».
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  // Incrémenté après une modification des paroles : recharge celles de la piste en cours.
  const [lyricsRefresh, setLyricsRefresh] = useState(0);
  const lyrics = useLyrics(p.current, lyricsRefresh);
  const [metaTarget, setMetaTarget] = useState<{ id: string; source: MetadataSource } | null>(null);
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || "list");
  const [layout, setLayout] = useState<Layout>(() => {
    // Les anciennes valeurs (library, grid, focus) retombent sur la scène.
    try { return localStorage.getItem(LAYOUT_KEY) === "strip" ? "strip" : "scene"; } catch { return "scene"; }
  });
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* non bloquant */ } }, [layout]);
  // Tiroir de la liste de lecture. IMPORTANT : un dépôt de fichiers l'ouvre de force, sinon la zone de dépôt serait invisible.
  const [listOpen, setListOpen] = useState(false);
  const shownView: ViewMode = view;

  // --- Dépôt de fichiers depuis l'explorateur ---
  // IMPORTANT : l'API HTML5 de drop ne reçoit pas les chemins disque dans Tauri ; seul l'événement natif du webview les fournit.
  const [dropActive, setDropActive] = useState(false);
  // Nouveaux fichiers des dossiers surveillés : ajoutés à la liste de lecture (doublons écartés par addPaths).
  useFolderWatch(p.addPaths);
  const addPathsRef = useRef(p.addPaths);
  addPathsRef.current = p.addPaths;
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview().onDragDropEvent(async (e) => {
      const ev = e.payload;
      if (ev.type === "enter" || ev.type === "over") setDropActive(true);
      else if (ev.type === "leave") setDropActive(false);
      else if (ev.type === "drop") {
        setDropActive(false);
        const media = await expandDropped(ev.paths);
        if (media.length === 0) setMessage(tr("drop.none"));
        else { setMessage(null); addPathsRef.current(media); }
      }
    }).then((fn) => { if (disposed) fn(); else off = fn; }).catch(() => undefined);
    return () => { disposed = true; off?.(); };
  }, []);

  // --- Réordonnancement par glisser (pointeur, pas HTML5 DnD : ce dernier est désactivé par le drop natif de Tauri sous Windows) ---
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const startRowDrag = (e: React.PointerEvent, id: string) => {
    if (!canReorder || e.button !== 0 || (e.target as HTMLElement).closest("button, input, [role=checkbox]")) return;
    const startY = e.clientY;
    const ids = selected.has(id) ? [...selected] : [id];
    let active = false;
    let target: string | null | undefined;
    const rowAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row-id]") ?? null;
    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientY - startY) < 6) return; // seuil : évite de confondre un clic avec un glisser
      active = true;
      const row = rowAt(ev.clientX, ev.clientY);
      target = row ? row.dataset.rowId : undefined;
      setDropTarget(target ?? null);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setDropTarget(null);
      if (active && target) p.moveBefore(ids, target);
    };
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  useEffect(() => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favorites])); } catch { /* non bloquant */ } }, [favorites]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* non bloquant */ } }, [view]);

  const visible = useMemo(() => {
    const match = buildMatcher(query, exact, matchCase, useRegex);
    let list = p.items.filter((i) => (!favoritesOnly || favorites.has(i.path)) && match(String(i[field] ?? "")));
    if (sort) {
      const { key, dir } = sort;
      list = [...list].sort((a, b) => {
        const av = a[key], bv = b[key];
        return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), lang)) * dir;
      });
    }
    return list;
  }, [p.items, query, field, exact, matchCase, useRegex, sort, favorites, favoritesOnly, lang]);

  // Réordonner n'a de sens que sur la liste complète dans l'ordre manuel.
  const canReorder = !sort && !query;
  const selectedDuration = useMemo(() => p.items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.duration, 0), [p.items, selected]);
  const totalDuration = useMemo(() => p.items.reduce((s, i) => s + i.duration, 0), [p.items]);

  const toggleSort = (key: SortKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  const toggleRow = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  const fail = (e: unknown) => setMessage(e instanceof Error ? e.message : t("msg.error"));
  const addFrom = async (fn: () => Promise<string[]>) => { try { setMessage(null); p.addPaths(await fn()); } catch (e) { fail(e); } };
  const openPlaylistReplace = async () => {
    try {
      setMessage(null);
      const paths = await loadPlaylist();
      if (paths.length === 0) return;
      p.clear();
      setSelected(new Set());
      p.addPaths(paths);
    } catch (e) { fail(e); }
  };
  const save = () => savePlaylist(p.items.map((i) => i.path)).catch(() => setMessage(t("msg.saveFail")));
  const dump = () => { p.clear(); setSelected(new Set()); };
  /** Cible des métadonnées : l'unique élément sélectionné, sinon celui en cours de lecture. */
  const openMetadata = () => {
    const picked = selected.size === 1 ? p.items.find((i) => selected.has(i.id)) : p.current;
    if (!picked) return setMessage(t("meta.noSelection"));
    setMessage(null);
    setMetaTarget({ id: picked.id, source: { kind: "local", path: picked.path, isVideo: picked.kind === "video" } });
  };
  /** Répercute l'enregistrement dans la liste (et migre les favoris si le fichier a été renommé). */
  const onMetadataSaved = (saved: MetadataSaved) => {
    setLyricsRefresh((n) => n + 1);
    if (!metaTarget || metaTarget.source.kind !== "local") return;
    const oldPath = metaTarget.source.path;
    // Le dialogue reste ouvert après l'enregistrement : sa cible suit le fichier renommé.
    if (saved.path && saved.path !== oldPath) setMetaTarget((m) => (m && m.source.kind === "local" ? { ...m, source: { ...m.source, path: saved.path as string } } : m));
    p.updateItem(metaTarget.id, (i) => ({
      ...i,
      title: saved.tags.title || i.title, artist: saved.tags.artist, year: saved.tags.date, jacket: saved.jacket || undefined,
      ...(saved.path && saved.path !== oldPath ? { path: saved.path, url: localUrl(saved.path, i.playMode), name: saved.name ?? i.name } : {}),
    }));
    if (saved.path && saved.path !== oldPath) setFavorites((f) => { if (!f.has(oldPath)) return f; const n = new Set(f); n.delete(oldPath); n.add(saved.path as string); return n; });
  };
  const removeSelected = () => { p.removeItems([...selected]); setSelected(new Set()); };
  const fullscreen = toggleVideoFullscreen;
  /** Vidéo : plein écran natif ; audio : visualiseur. */
  const openFullscreen = () => { if (!p.current) return; if (p.current.kind === "video") fullscreen(); else setVisualizerOpen(true); };
  const toggleFavorite = (path: string) => setFavorites((f) => { const n = new Set(f); n.has(path) ? n.delete(path) : n.add(path); return n; });
  const reveal = () => { if (p.current) revealItemInDir(p.current.path).catch(() => setMessage(t("msg.revealFail"))); };
  const copyTitle = () => { if (p.current) void navigator.clipboard?.writeText(p.current.artist ? `${p.current.artist} - ${p.current.title}` : p.current.title); };
  const isFavorite = p.current ? favorites.has(p.current.path) : false;

  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);

  // --- Aller à… ---
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoValue, setGotoValue] = useState("");
  const [gotoError, setGotoError] = useState<string | null>(null);
  const openGoto = () => { setGotoValue(""); setGotoError(null); setGotoOpen(true); };
  /**
   * Fait défiler la liste jusqu'à une piste et la sélectionne.
   * IMPORTANT : la piste peut être masquée par la recherche ou le filtre « favoris » (on les lève), et le tiroir de la liste peut être
   * fermé (on l'ouvre). Le défilement attend le rendu suivant ; il ne vise que le conteneur de la liste (cf. lib/scroll).
   */
  const revealTrack = (id: string) => {
    if (!visible.some((i) => i.id === id)) { setQuery(""); setFavoritesOnly(false); }
    setListOpen(true);
    setSelected(new Set([id]));
    window.setTimeout(() => {
      const el = document.querySelector(`[data-track-id="${CSS.escape(id)}"]`);
      const scroller = el?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
      if (el && scroller) centerInScroller(scroller, el, "y");
    }, 120);
  };
  const goToCurrent = () => { if (p.current) revealTrack(p.current.id); else setMessage(t("goto.noCurrent")); };
  /** Sans accents ni majuscules : « edith » retrouve « Édith ». */
  const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  /** Interprète la saisie : n° de piste (« 42 » ou « #42 »), moment (« 3:25 », « 1:02:10 ») ou début de titre/artiste. Renvoie un message d'erreur, ou null si réussi. */
  const runGoto = (raw: string): string | null => {
    const input = raw.trim();
    if (!input) return t("goto.errNone");
    if (/^\d+(:\d{1,2}){1,2}$/.test(input)) {
      if (!p.current) return t("goto.errNoCurrent");
      const sec = input.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
      if (p.duration && sec > p.duration) return t("goto.errTime", { d: formatTime(p.duration) });
      p.seek(sec);
      return null;
    }
    if (/^#?\d+$/.test(input)) {
      // Numérotation de la colonne « # » : celle de la liste affichée (tri et recherche compris).
      const n = Number(input.replace("#", ""));
      if (n < 1 || n > visible.length) return t("goto.errRange", { max: visible.length });
      revealTrack(visible[n - 1].id);
      return null;
    }
    const q = fold(input);
    const hit = (i: MediaItem) => fold(i.title).includes(q) || fold(i.artist ?? "").includes(q);
    // Départ après la sélection actuelle : relancer la même saisie passe à l'occurrence suivante.
    const from = visible.findIndex((i) => selected.has(i.id));
    const ordered = [...visible.slice(from + 1), ...visible.slice(0, from + 1)];
    const found = ordered.find(hit) ?? p.items.find(hit);
    if (!found) return t("goto.errNone");
    revealTrack(found.id);
    return null;
  };
  const submitGoto = () => { const err = runGoto(gotoValue); setGotoError(err); if (!err) setGotoOpen(false); };

  // --- Menu contextuel (clic droit) d'une piste ---
  /** Piste sous le curseur au moment du clic droit (null = hors piste : aucun menu). */
  const [ctxId, setCtxId] = useState<string | null>(null);
  const ctxItem = ctxId ? p.items.find((i) => i.id === ctxId) ?? null : null;
  /** Clic droit sur une piste cochée : l'action vaut pour toute la sélection ; sinon pour la seule piste visée. */
  const ctxIds = ctxId ? (selected.has(ctxId) ? [...selected] : [ctxId]) : [];
  /** Playlists enregistrées, relues à chaque ouverture du menu (une autre fenêtre a pu les modifier). */
  const [playlistChoices, setPlaylistChoices] = useState<SavedPlaylist[]>([]);
  /** Ajoute la piste visée (ou la sélection) à une playlist enregistrée, sans doublon. */
  const addCtxToPlaylist = (l: SavedPlaylist) => {
    const paths = p.items.filter((i) => ctxIds.includes(i.id)).map((i) => i.path);
    savePlaylistNamed(l.name, [...l.paths, ...paths.filter((x) => !l.paths.includes(x))]);
  };
  /**
   * Clic droit n'importe où dans l'écran. Phase de capture : décide AVANT le déclencheur Radix.
   * IMPORTANT : champs de texte et fenêtres (portails React) -> stopPropagation sans preventDefault, donc le menu natif
   * (Copier/Coller) reste disponible et Radix n'ouvre rien.
   */
  const onScreenContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.closest("input, textarea, [contenteditable=true], [role=dialog]")) { e.stopPropagation(); return; }
    setCtxId(target.closest<HTMLElement>("[data-track-id]")?.dataset.trackId ?? null);
    setPlaylistChoices(readPlaylists());
  };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const commitSearch = () => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...history.filter((h) => h !== q)].slice(0, 8);
    setHistory(next);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* non bloquant */ }
  };
  const clearHistory = () => { setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch { /* non bloquant */ } };

  // Raccourcis de l'ancienne version (Ctrl+O/E/P/S, Espace, n, p, Ctrl +/-).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "q") { e.preventDefault(); void getCurrentWindow().close(); }
      else if (e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "o") { e.preventDefault(); void addFrom(pickFiles); }
        else if (k === "e") { e.preventDefault(); void addFrom(pickFolder); }
        else if (k === "p") { e.preventDefault(); void openPlaylistReplace(); }
        else if (k === "s") { e.preventDefault(); void save(); }
        else if (k === "f") { e.preventDefault(); setSearchOpen(true); }
        else if (k === "g") { e.preventDefault(); openGoto(); }
        else if (k === "b") { e.preventDefault(); setBookmarksOpen(true); }
        else if (e.key === "+" || e.key === "=") { e.preventDefault(); p.setVolume(clamp(p.volume + 0.05)); }
        else if (e.key === "-") { e.preventDefault(); p.setVolume(clamp(p.volume - 0.05)); }
      } else if (!e.ctrlKey && !e.altKey) {
        if (e.code === "Space") { e.preventDefault(); p.togglePlay(); }
        else if (e.key === "n") p.next();
        else if (e.key === "b") p.goBack();
        else if (e.key === "c") p.cycleSubtitles();
        else if (e.key === "f") openFullscreen();
        else if (e.key === "l") setLyricsOpen((o) => !o);
        else if (e.key === "ArrowLeft") { e.preventDefault(); p.seek(Math.max(0, p.time - SEEK_STEP)); }
        else if (e.key === "ArrowRight") { e.preventDefault(); p.seek(Math.min(p.duration || 0, p.time + SEEK_STEP)); }
        else if (e.key === "p") p.previous();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Expression invalide : buildMatcher n'applique alors aucun filtre ; on le signale au lieu de laisser croire à « aucun résultat ».
  const regexError = useRegex && query !== "" && (() => { try { new RegExp(query); return false; } catch { return true; } })();

  const SortIcon = ({ k }: { k: SortKey }) => (sort?.key === k ? (sort.dir === 1 ? <ArrowUp className="ml-1 inline size-3" /> : <ArrowDown className="ml-1 inline size-3" />) : null);
  const isVideo = p.current?.kind === "video";
  useFullscreenKindSwitch(p.current?.kind, visualizerOpen, setVisualizerOpen);

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div className="relative isolate flex h-screen flex-col" onContextMenuCapture={onScreenContextMenu}>
      <AmbientBackground playing={p.playing} />
      {/* Barre de menus (mêmes entrées que l'ancienne version) */}
      <header className="flex items-center gap-2 border-b py-1 pl-2 pr-6">
        <Menubar className="border-0 bg-transparent shadow-none">
          <MenubarMenu>
            <MenubarTrigger>{t("menu.file")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onClick={() => addFrom(pickFiles)}><FilePlus /> {t("file.addFiles")} <MenubarShortcut>Ctrl + O</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={() => addFrom(pickFolder)}><FolderOpen /> {t("file.addFolder")} <MenubarShortcut>Ctrl + E</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={openPlaylistReplace}><ListMusic /> {t("file.openPlaylist")} <MenubarShortcut>Ctrl + P</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={() => addFrom(loadPlaylist)}><ListPlus /> {t("file.appendPlaylist")}</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={() => setPlaylistsOpen(true)}><Library /> {t("mypl.menu")}</MenubarItem>
              <MenubarItem disabled={p.items.length === 0} onClick={save}><Save /> {t("file.saveAs")} <MenubarShortcut>Ctrl + S</MenubarShortcut></MenubarItem>
              <MenubarSeparator />
              <MenubarItem disabled={p.items.length === 0} onClick={dump}><Trash2 /> {t("file.dump")}</MenubarItem>
              <MenubarSeparator />
              {onBack && <MenubarItem onClick={onBack}><ArrowLeftRight /> {t("file.changeMode")}</MenubarItem>}
              <MenubarItem onClick={() => void getCurrentWindow().close()}><LogOut /> {t("file.quit")} <MenubarShortcut>Ctrl + Alt + Q</MenubarShortcut></MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>{t("menu.actions")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onClick={p.togglePlay}><Play /> {t("act.playPause")} <MenubarShortcut>Space</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={p.stop}><Square /> {t("act.stop")}</MenubarItem>
              <MenubarItem onClick={openMetadata}><Tags /> {t("meta.open")}</MenubarItem>
              <MenubarItem onClick={() => p.next()}><SkipForward /> {t("act.next")} <MenubarShortcut>N</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={p.previous}><SkipBack /> {t("act.previous")} <MenubarShortcut>P</MenubarShortcut></MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={() => p.setVolume(clamp(p.volume + 0.05))}><Volume2 /> {t("act.volUp")} <MenubarShortcut>Ctrl + +</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={() => p.setVolume(clamp(p.volume - 0.05))}><Volume1 /> {t("act.volDown")} <MenubarShortcut>Ctrl + -</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={p.toggleMute}><VolumeX /> {t("act.mute")}</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={() => setQueueOpen(true)}><ListEnd /> {t("q.menu", { n: p.queue.length })}</MenubarItem>
              <MenubarItem disabled={p.unplayable.length === 0} onClick={() => setUnplayableOpen(true)}><CircleAlert /> {t("unp.menu", { n: p.unplayable.length })}</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>{t("menu.settings")}</MenubarTrigger>
            <MenubarContent>
              <SettingsMenuItems onOpen={setSettingsSection} />
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>{t("menu.view")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem disabled={!p.current} onClick={openFullscreen}><Maximize /> {t("fs.open")}</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={() => setView("list")}><LayoutList /> {t("view.list")}</MenubarItem>
              <MenubarItem onClick={() => setView("images")}><Grid2x2 /> {t("view.images")}</MenubarItem>
              <MenubarItem onClick={() => setView("jackets")}><GalleryVertical /> {t("view.jackets")}</MenubarItem>
              <MenubarItem onClick={() => setView("rows")}><Rows3 /> {t("view.rows")}</MenubarItem>
              <MenubarSeparator />
              <MenubarItem disabled={p.current?.kind === "video"} onClick={() => setMiniMode(true)}><Minimize2 /> {t("mini.open")}</MenubarItem>
              <MenubarItem onClick={() => setSearchOpen((o) => !o)}><Search /> {t("view.search")} <MenubarShortcut>Ctrl + F</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={openGoto}><CornerDownRight /> {t("goto.menu")} <MenubarShortcut>Ctrl + G</MenubarShortcut></MenubarItem>
              <MenubarItem disabled={!p.current} onClick={goToCurrent}><Crosshair /> {t("goto.current")}</MenubarItem>
              <MenubarItem disabled={!p.current} onClick={() => setBookmarksOpen(true)}><Bookmark /> {t("bm.title")} <MenubarShortcut>Ctrl + B</MenubarShortcut></MenubarItem>
              <MenubarItem onClick={() => setSleepOpen(true)}><AlarmClock /> {t("slp.title")}</MenubarItem>
              <MenubarItem onClick={() => setDupOpen(true)}><CopyCheck /> {t("dup.menu")}</MenubarItem>
              <MenubarSeparator />
              <ZoomMenuItems />
              <MenubarSeparator />
              <PaletteMenuItems />
              <MenubarSeparator />
              <RefreshMenuItem />
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <div className="ml-auto flex items-center gap-1">
          {/* Choix de disposition (mémorisé) + tiroir de la liste de lecture */}
          <div className="flex items-center gap-0.5" role="group" aria-label={t("layout.title")}>
            {([["scene", Disc3, "layout.scene"], ["strip", GalleryHorizontal, "layout.strip"]] as const).map(([k, Icon, label]) => (
              <Button key={k} size="icon" variant={layout === k ? "secondary" : "ghost"} className="size-8" onClick={() => setLayout(k)} title={t(label)} aria-pressed={layout === k}><Icon /></Button>
            ))}
          </div>
          <span className="mx-1 h-5 w-px bg-border" />
          <LanguageSwitch />
        </div>
      </header>
      {message && (
        <div className="flex items-center gap-3 border-b bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
          <p className="min-w-0 flex-1">{message}</p>
          {p.unplayable.length > 0 && <Button size="xs" variant="outline" onClick={() => setUnplayableOpen(true)}>{t("unp.view")}</Button>}
        </div>
      )}

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Égaliseur : volet à gauche (premier enfant en flux ; la liste, elle, est superposée à droite). */}
        {/* Toujours monté : la largeur s'anime (ouverture ET fermeture) ; `inert` retire le volet fermé du clavier et des lecteurs d'écran. */}
        <aside inert={!eqOpen} aria-hidden={!eqOpen} className={cn("shrink-0 overflow-hidden bg-background/90 backdrop-blur-2xl transition-[width,border-color] duration-300 ease-out", eqOpen ? "w-[30rem] border-r" : "w-0 border-r-0")}>
          <EqualizerPanel className={cn("h-full w-[30rem] transition-opacity duration-300", eqOpen ? "opacity-100" : "opacity-0")} onClose={() => setEqOpen(false)} />
        </aside>
        {/* Playlist */}
        {/* Tiroir : toujours monté (le glisser-déposer et la liste gardent leur état), glisse depuis la droite. */}
        <section className={cn("absolute inset-y-0 right-0 z-30 flex w-[min(52rem,80%)] flex-col overflow-hidden border-l bg-background/90 shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-out", listOpen || dropActive ? "translate-x-0" : "pointer-events-none translate-x-full")}>
          {/* Barre du haut : recherche simplifiée, tri et choix de vue. Les actions sur la sélection sont dans le rail de gauche. */}
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="relative min-w-44 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 pl-9 pr-8" placeholder={t("search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitSearch(); }} />
              {query && <button type="button" aria-label={t("search.reset")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent" onClick={() => setQuery("")}><X className="size-3.5" /></button>}
            </div>
            <Button size="icon" variant={searchOpen ? "secondary" : "ghost"} className="size-9 [&_svg]:size-4.5" onClick={() => setSearchOpen((o) => !o)} title={t("search.title")}><SlidersHorizontal /></Button>
            <Select value={sort?.key ?? "manual"} onValueChange={(v) => setSort(v === "manual" ? null : { key: v as SortKey, dir: sort?.dir ?? 1 })}>
              <SelectTrigger className="w-36" title={t("tool.sort")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual"><GripVertical /> {t("sort.manual")}</SelectItem>
                <SelectItem value="artist"><MicVocal /> {t("sort.artist")}</SelectItem>
                <SelectItem value="title"><Type /> {t("sort.title")}</SelectItem>
                <SelectItem value="duration"><Clock /> {t("sort.duration")}</SelectItem>
                <SelectItem value="kind"><Shapes /> {t("sort.type")}</SelectItem>
              </SelectContent>
            </Select>
            {sort && <Button size="icon" variant="ghost" className="size-9 [&_svg]:size-4.5" title={t("tool.reverseSort")} onClick={() => setSort({ ...sort, dir: sort.dir === 1 ? -1 : 1 })}>{sort.dir === 1 ? <ArrowUp /> : <ArrowDown />}</Button>}
            {sort && !query && <Button size="icon" variant="secondary" className="size-9 [&_svg]:size-4.5" title={t("tool.freezeTitle")} onClick={() => { p.setOrder(visible.map((i) => i.id)); setSort(null); }}><Pin /></Button>}
            <div className="flex items-center gap-0.5" role="group" aria-label={t("menu.view")}>
              {([["list", LayoutList, "view.list"], ["images", Grid2x2, "view.images"], ["jackets", GalleryVertical, "view.jackets"], ["rows", Rows3, "view.rows"]] as const).map(([k, Icon, label]) => (
                <Button key={k} size="icon" variant={view === k ? "secondary" : "ghost"} className="size-8" onClick={() => setView(k)} title={t(label)} aria-pressed={view === k}><Icon /></Button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Rail vertical, par groupes : sélection, lecture, ordre et édition, liste ; la suppression est isolée en bas */}
            <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r px-1 py-2" role="toolbar" aria-orientation="vertical">
              <RailGroup>
                <label className="flex size-9 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-[0.62rem] tabular-nums text-muted-foreground hover:bg-primary/15" title={selected.size > 0 ? t("tool.selectedCount", { n: selected.size }) : t("tool.selectAll")}>
                  <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(visible.map((i) => i.id)) : new Set())} />
                </label>
                <RailButton disabled={visible.length === 0} title={t("tool.invertTitle")} onClick={() => setSelected(new Set(visible.filter((i) => !selected.has(i.id)).map((i) => i.id)))}><ListChecks /></RailButton>
              </RailGroup>
              <RailGroup>
                <RailButton disabled={selected.size === 0} title={t("tool.playTitle")} onClick={() => { const first = visible.find((i) => selected.has(i.id)); if (first) p.play(first.id); }}><Play /></RailButton>
                {/* Lire ensuite : ajoute la sélection, dans l'ordre d'affichage, à la file « à suivre » */}
                <RailButton disabled={selected.size === 0} title={t("q.playNextTitle")} aria-label={t("q.playNext")} onClick={() => p.enqueue(visible.filter((i) => selected.has(i.id)).map((i) => i.id))}><ListEnd /></RailButton>
                <RailButton disabled={p.items.length < 2} title={t("tool.shuffleTitle")} onClick={() => { p.shuffleOrder(); setSort(null); }}><Shuffle /></RailButton>
              </RailGroup>
              <RailGroup>
                <RailButton disabled={selected.size === 0 || !canReorder} title={canReorder ? t("tool.up") : t("tool.reorderHint")} onClick={() => p.moveItems([...selected], -1)}><ChevronUp /></RailButton>
                <RailButton disabled={selected.size === 0 || !canReorder} title={canReorder ? t("tool.down") : t("tool.reorderHint")} onClick={() => p.moveItems([...selected], 1)}><ChevronDown /></RailButton>
                <RailButton disabled={selected.size > 1 || (selected.size === 0 && !p.current)} title={t("meta.openTitle")} onClick={openMetadata}><Tags /></RailButton>
              </RailGroup>
              <RailGroup>
                <RailButton active={favoritesOnly} title={`${t("tool.favoritesTitle")} (${p.items.filter((i) => favorites.has(i.path)).length})`} onClick={() => setFavoritesOnly((v) => !v)}><Heart className={cn(favoritesOnly && "fill-current")} /></RailButton>
                <RailButton disabled={p.items.length === 0} title={t("tool.clearTitle")} onClick={dump}><Eraser /></RailButton>
              </RailGroup>
              <RailGroup className="mt-auto">
                <RailButton danger disabled={selected.size === 0} title={t("tool.removeTitle")} onClick={removeSelected}><Trash2 /></RailButton>
              </RailGroup>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {/* IMPORTANT : hauteur imposée par un conteneur absolu, sinon le ScrollArea prend la hauteur de son contenu et ne défile pas. */}
              <div className="relative min-h-0 flex-1"><div className="absolute inset-0">
          <ScrollArea className="size-full">
          {p.items.length === 0 ? (
            <div className="flex min-h-[20rem] flex-col items-center justify-center gap-6 p-8">
              <EmptyState
                className="w-full max-w-2xl bg-card/40"
                icon={ListMusic}
                title={t("plist.emptyTitle")}
                description={t("plist.emptyBody")}
                tips={[t("plist.tip1"), t("plist.tip2"), t("plist.tip3")]}
                actions={[
                  { label: t("plist.btnFiles"), icon: FilePlus, onClick: () => addFrom(pickFiles) },
                  { label: t("plist.btnFolder"), icon: FolderOpen, onClick: () => addFrom(pickFolder) },
                  { label: t("plist.btnPlaylist"), icon: Library, onClick: openPlaylistReplace },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Zarao © 2026 - made with <span aria-label="arc-en-ciel, avocat, éléphant, poulet">🌈🥑🐘🐔</span> by Miranto Harison [mirantohrs@mail.com]
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[20rem] flex-col items-center justify-center gap-3 p-10 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-muted"><Search className="size-6 text-muted-foreground" /></span>
              <h2 className="text-lg font-semibold">{t("nores.title")}</h2>
              {query && <p className="max-w-md break-words text-sm font-medium">{t("nores.forQuery", { q: query })}</p>}
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t("nores.body")}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {query && <Button size="sm" variant="secondary" onClick={() => setQuery("")}><X /> {t("search.reset")}</Button>}
                <Button size="sm" variant="outline" onClick={() => setSearchOpen(true)}><SlidersHorizontal /> {t("search.title")}</Button>
                {favoritesOnly && <Button size="sm" variant="outline" onClick={() => setFavoritesOnly(false)}><Heart /> {t("nores.favorites")}</Button>}
              </div>
            </div>
          ) : shownView === "list" ? (
            <Table className="text-[0.95rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4"><Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(visible.map((i) => i.id)) : new Set())} /></TableHead>
                  <TableHead className="w-10 text-center text-xs uppercase tracking-wide text-muted-foreground">#</TableHead>
                  <TableHead className="w-14 cursor-pointer text-xs uppercase tracking-wide text-muted-foreground" onClick={() => toggleSort("kind")}>{t("col.type")}<SortIcon k="kind" /></TableHead>
                  <TableHead className="w-[22%] cursor-pointer text-xs uppercase tracking-wide text-muted-foreground" onClick={() => toggleSort("artist")}>{t("col.artist")}<SortIcon k="artist" /></TableHead>
                  <TableHead className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground" onClick={() => toggleSort("title")}>{t("col.title")}<SortIcon k="title" /></TableHead>
                  <TableHead className="w-24 text-right text-xs uppercase tracking-wide text-muted-foreground">{t("col.size")}</TableHead>
                  <TableHead className="w-28 cursor-pointer pr-4 text-right text-xs uppercase tracking-wide text-muted-foreground" onClick={() => toggleSort("duration")}>{t("col.total")}<SortIcon k="duration" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((i, n) => {
                  const isCurrent = p.current?.id === i.id;
                  return (
                    <TableRow key={i.id} data-row-id={i.id} data-track-id={i.id} onPointerDown={(e) => startRowDrag(e, i.id)} data-state={selected.has(i.id) ? "selected" : undefined} className={cn("group/row cursor-default border-b-0 [&>td]:py-2 [&>td]:shadow-[inset_0_-1px_0_var(--color-border)]", isCurrent && "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]", dropTarget === i.id && "[&>td]:shadow-[inset_0_2px_0_0_var(--color-ring)]")} onDoubleClick={() => p.play(i.id)}>
                      <TableCell className="pl-4"><Checkbox checked={selected.has(i.id)} onCheckedChange={() => toggleRow(i.id)} /></TableCell>
                      <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                        {isCurrent ? <PlayingBars playing={p.playing} /> : n + 1}
                      </TableCell>
                      <TableCell>{i.kind === "video" ? <FileVideo className="size-4 text-muted-foreground" /> : <FileAudio className="size-4 text-muted-foreground" />}</TableCell>
                      <TableCell className="truncate text-muted-foreground">{i.artist || "—"}</TableCell>
                      <TableCell className={cn("relative max-w-0 truncate", isCurrent && "font-medium")} title={i.title}>{favorites.has(i.path) && <Heart className="mr-1.5 inline size-3 fill-current text-rose-400" />}{i.title}<ResumeBar item={i} className="opacity-0 transition-opacity group-hover/row:opacity-100" /></TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{formatSize(i.size)}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{formatTime(i.duration)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : shownView === "images" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6 p-4">
              {visible.map((i) => <MediaCard key={i.id} item={i} active={p.current?.id === i.id} playing={p.playing && p.current?.id === i.id} selected={selected.has(i.id)} favorite={favorites.has(i.path)} onToggle={() => toggleRow(i.id)} onToggleFavorite={() => toggleFavorite(i.path)} onPlay={() => p.play(i.id)} />)}
            </div>
          ) : shownView === "rows" ? (
            <div className="p-2">
              {visible.map((i) => <MediaRow key={i.id} item={i} active={p.current?.id === i.id} playing={p.playing && p.current?.id === i.id} selected={selected.has(i.id)} favorite={favorites.has(i.path)} onToggle={() => toggleRow(i.id)} onToggleFavorite={() => toggleFavorite(i.path)} onPlay={() => p.play(i.id)} />)}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 p-3">
              {visible.map((i) => <JacketTile key={i.id} item={i} active={p.current?.id === i.id} onPlay={() => p.play(i.id)} />)}
            </div>
          )}
          </ScrollArea>
              </div></div>
              {/* Pied : totaux */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-sm text-muted-foreground">
                <span><Music className="mr-1 inline size-3" />{t("tool.items", { v: visible.length, t: p.items.length })}</span>
                {selected.size > 0 && <span className="font-medium text-primary">{t("tool.selectedCount", { n: selected.size })}</span>}
                {selected.size > 0 && <span>{t("tool.selection", { d: formatTime(selectedDuration) })}</span>}
                <span className="ml-auto">{t("tool.total", { d: formatTime(totalDuration) })}</span>
              </div>
            </div>
          </div>
          {dropActive && (
            <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-ring bg-background/90 p-8 text-center shadow-lg backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
              {/* Anneau pulsant : signale que la zone est prête à recevoir le dépôt. */}
              <span className="relative flex size-20 items-center justify-center rounded-full bg-muted text-foreground">
                <span className="absolute inset-0 animate-ping rounded-full bg-muted-foreground/20" />
                <Download className="relative size-9" />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">{t("drop.title")}</h2>
              <p className="max-w-md text-sm text-muted-foreground">{t("drop.body")}</p>
              <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                {[...audioExt(), ...videoExt()].map((x) => <Badge key={x} variant="secondary">.{x}</Badge>)}
              </div>
            </div>
          )}
        </section>

        {/* IMPORTANT : l'élément média reste toujours monté, sinon changer de piste coupe la lecture. */}
        <VideoStage p={p} visible={isVideo} lyrics={lyrics.lyrics} />

        {!isVideo && layout === "scene" && <SceneStage p={p} lyrics={lyrics.lyrics} onOpenLyrics={() => setLyricsOpen(true)} onFullscreen={openFullscreen} />}
        {!isVideo && layout === "strip" && (
          <StripStage p={p} lyrics={lyrics.lyrics} loading={lyrics.loading} onSearchOnline={lyrics.searchOnline} source={lyrics.source} onAddFiles={() => void addFrom(pickFiles)}
            onEdit={() => p.current && setMetaTarget({ id: p.current.id, source: { kind: "local", path: p.current.path, isVideo: p.current.kind === "video" } })} />
        )}

        {/* Paroles : volet latéral, synchronisé avec la lecture */}
        {lyricsOpen && layout === "scene" && (
          <aside className="w-[30rem] shrink-0 border-l">
            <LyricsPanel
              className="h-full"
              lyrics={lyrics.lyrics}
              loading={lyrics.loading}
              hasTrack={Boolean(p.current)}
              time={p.time}
              onSeek={p.seek}
              onSearchOnline={lyrics.searchOnline}
              source={lyrics.source}
              onClose={() => setLyricsOpen(false)}
              onEdit={() => p.current && setMetaTarget({ id: p.current.id, source: { kind: "local", path: p.current.path, isVideo: p.current.kind === "video" } })}
            />
          </aside>
        )}
      </main>

      <PlayerBar
        p={p}
        isFavorite={isFavorite}
        onGoto={openGoto}
        onBookmarks={() => setBookmarksOpen(true)}
        onSleepCustom={() => setSleepOpen(true)}
        onToggleFavorite={() => p.current && toggleFavorite(p.current.path)}
        onReveal={reveal}
        onCopy={copyTitle}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onOpenVisualizer={openFullscreen}
        lyricsOpen={lyricsOpen}
        eqOpen={eqOpen}
        onToggleEq={() => setEqOpen((o) => !o)}
        listOpen={listOpen}
        onToggleList={() => setListOpen((o) => !o)}
        onToggleLyrics={() => setLyricsOpen((o) => !o)}
      />
      <FullscreenPlayer p={p} open={visualizerOpen} onClose={() => setVisualizerOpen(false)} lyrics={lyrics.lyrics} />

      {/* Recherche : fenêtre détachée, fond flouté (le filtre s'applique en direct à la liste derrière) */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => { e.preventDefault(); searchInputRef.current?.focus(); }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Search className="size-5" /></span>
              <div className="min-w-0">
                <DialogTitle>{t("search.title")}</DialogTitle>
                <DialogDescription>{t("search.desc")}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5">
            {/* Champ de recherche large, avec effacement et résultat en direct */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  className="h-11 pl-9 pr-9 text-base"
                  placeholder={t("search.placeholder")}
                  value={query}
                  aria-invalid={regexError}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitSearch(); setSearchOpen(false); } }}
                />
                {query && <button type="button" aria-label={t("search.reset")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent" onClick={() => setQuery("")}><X className="size-4" /></button>}
              </div>
              {regexError
                ? <p className="text-xs text-destructive" role="alert">{t("search.regexInvalid")}</p>
                : <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <span className={cn("size-2 rounded-full", !query ? "bg-muted-foreground/40" : visible.length > 0 ? "bg-emerald-500" : "bg-destructive")} />
                    {query ? t("search.results", { n: visible.length, m: p.items.length }) : t("search.enter")}
                  </p>}
            </div>

            {/* Champ visé : pastilles au lieu d'une liste déroulante, pour voir toutes les options d'un coup d'œil */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("search.in")}</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("search.in")}>
                {SEARCH_FIELDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={field === k}
                    onClick={() => setField(k)}
                    className={cn("rounded-full border px-3 py-1 text-sm transition-colors", field === k ? "border-primary/50 bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                  >{t(`field.${k}` as const)}</button>
                ))}
              </div>
            </div>

            {/* Options : trois interrupteurs avec icône, plus lisibles que trois cases */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("search.options")}</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  [exact, setExact, WholeWord, "search.exact"],
                  [matchCase, setMatchCase, CaseSensitive, "search.case"],
                  [useRegex, setUseRegex, Regex, "search.regex"],
                ] as const).map(([on, set, Icon, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set(!on)}
                    className={cn("flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs transition-colors", on ? "border-primary/50 bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                  ><Icon className="size-5" />{t(label)}</button>
                ))}
              </div>
            </div>

            {/* Recherches récentes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><History className="size-3.5" />{t("search.recent")}</p>
                {history.length > 0 && <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={clearHistory}>{t("search.clear")}</button>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {history.length === 0 && <span className="text-sm text-muted-foreground">{t("search.noRecent")}</span>}
                {history.map((h) => <button key={h} type="button" className="max-w-full truncate rounded-full border px-2.5 py-0.5 text-sm hover:bg-accent" onClick={() => setQuery(h)}>{h}</button>)}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" disabled={!query} onClick={() => setQuery("")}>{t("search.reset")}</Button>
            <Button className="flex-1" onClick={() => { commitSearch(); setSearchOpen(false); }}><Search /> {t("search.run")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <SettingsDialog section={settingsSection} onClose={() => setSettingsSection(null)} />
      <PlaylistsDialog p={p} open={playlistsOpen} onClose={() => setPlaylistsOpen(false)} />
      <BookmarksDialog p={p} open={bookmarksOpen} onClose={() => setBookmarksOpen(false)} />
      <SleepDialog p={p} open={sleepOpen} onClose={() => setSleepOpen(false)} />
      <DuplicatesDialog p={p} open={dupOpen} onClose={() => setDupOpen(false)} />
      <UnplayableDialog p={p} open={unplayableOpen} onClose={() => setUnplayableOpen(false)} />
      <QueueDialog p={p} open={queueOpen} onClose={() => setQueueOpen(false)} />
      {mini && <MiniPlayer p={p} onExit={() => setMiniMode(false)} />}
      <MetadataDialog
        source={metaTarget?.source ?? null}
        onClose={() => setMetaTarget(null)}
        onSaved={onMetadataSaved}
        beforeSave={() => { if (metaTarget && p.current?.id === metaTarget.id) p.suspend(); }}
        afterSave={(newPath) => p.resume(newPath)}
      />

      <Dialog open={gotoOpen} onOpenChange={setGotoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CornerDownRight className="size-5 text-primary" /> {t("goto.title")}</DialogTitle>
            <DialogDescription>{t("goto.desc")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submitGoto(); }}>
            <div className="flex gap-2">
              <Input autoFocus value={gotoValue} onChange={(e) => { setGotoValue(e.target.value); setGotoError(null); }} placeholder={t("goto.placeholder")} aria-label={t("goto.title")} aria-invalid={gotoError !== null} />
              <Button type="submit" disabled={!gotoValue.trim()}>{t("goto.btn")}</Button>
            </div>
            {gotoError && <p role="alert" className="text-sm text-destructive">{gotoError}</p>}
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("kb.title")}</DialogTitle>
            <DialogDescription>{t("kb.desc")}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {SHORTCUTS.map(([keys, label]) => (<div key={keys} className="contents"><dt><code className="rounded border px-1.5 py-0.5 text-xs">{keys}</code></dt><dd className="text-muted-foreground">{t(label)}</dd></div>))}
          </dl>
        </DialogContent>
      </Dialog>

      {/* Menu contextuel : piste sous le curseur, sinon fond de l'écran. */}
      <ContextMenuContent>
        {ctxItem ? (
          <>
            <ContextMenuItem onSelect={() => p.play(ctxItem.id)}><Play /> {t("tool.play")}</ContextMenuItem>
            <ContextMenuItem onSelect={() => p.enqueue(ctxIds)}><ListEnd /> {t("q.playNext")}</ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger><ListPlus /> {t("ctx.addToPlaylist")}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {playlistChoices.length === 0
                  ? <ContextMenuItem disabled>{t("ctx.noPlaylist")}</ContextMenuItem>
                  : playlistChoices.map((l) => <ContextMenuItem key={l.id} onSelect={() => addCtxToPlaylist(l)}><Library /> <span className="max-w-56 truncate">{l.name}</span></ContextMenuItem>)}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => toggleFavorite(ctxItem.path)}>
              <Heart /> {favorites.has(ctxItem.path) ? t("fav.remove") : t("fav.add")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => { setMessage(null); setMetaTarget({ id: ctxItem.id, source: { kind: "local", path: ctxItem.path, isVideo: ctxItem.kind === "video" } }); }}><Tags /> {t("meta.open")}</ContextMenuItem>
            <ContextMenuItem onSelect={() => { revealItemInDir(ctxItem.path).catch(() => setMessage(t("msg.revealFail"))); }}><FolderOpen /> {t("player.reveal")}</ContextMenuItem>
            <ContextMenuItem onSelect={() => { void navigator.clipboard?.writeText(ctxItem.artist ? `${ctxItem.artist} - ${ctxItem.title}` : ctxItem.title); }}><Copy /> {t("player.copy")}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => { p.removeItems(ctxIds); setSelected((s) => { const n = new Set(s); ctxIds.forEach((id) => n.delete(id)); return n; }); }}><Trash2 /> {t("tool.remove")}</ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => setPlaylistsOpen(true)}><Library /> {t("mypl.menu")}</ContextMenuItem>
            <ContextMenuItem disabled={!p.current} onSelect={goToCurrent}><Crosshair /> {t("goto.current")}</ContextMenuItem>
            <ContextMenuItem onSelect={openGoto}><CornerDownRight /> {t("goto.menu")}</ContextMenuItem>
            <ContextMenuItem onSelect={() => setDupOpen(true)}><CopyCheck /> {t("dup.menu")}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextViewItems />
          </>
        )}
      </ContextMenuContent>
    </div>
    </ContextMenuTrigger>
    </ContextMenu>
  );
}

type MediaViewProps = { item: MediaItem; active: boolean; playing: boolean; selected: boolean; favorite: boolean; onToggle: () => void; onToggleFavorite: () => void; onPlay: () => void };

/** Image de pochette, ou icône du type de média à défaut. */
function Thumb({ item, className, iconClass }: { item: MediaItem; className?: string; iconClass?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {item.jacket
        ? <img src={item.jacket} alt="" className="size-full object-cover" />
        : <div className="grid size-full place-items-center">{item.kind === "video" ? <FileVideo className={cn("text-muted-foreground", iconClass)} /> : <Music className={cn("text-muted-foreground", iconClass)} />}</div>}
    </div>
  );
}

/** Groupe de boutons du rail : une pastille discrète qui regroupe des actions voisines. */
function RailGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex w-10 flex-col items-center gap-0.5 rounded-xl bg-foreground/5 p-0.5", className)}>{children}</div>;
}

/** Bouton du rail : même gabarit partout, teinte d'accent au survol, `active` pour un filtre activé, `danger` pour la suppression. */
function RailButton({ active, danger, className, ...props }: React.ComponentProps<typeof Button> & { active?: boolean; danger?: boolean }) {
  return (
    <Button size="icon" variant="ghost" aria-pressed={active}
      className={cn("size-9 rounded-lg transition-colors hover:bg-primary/15 hover:text-primary [&_svg]:size-[1.15rem]",
        active && "bg-primary/20 text-primary ring-1 ring-primary/50 hover:bg-primary/25",
        danger && "text-destructive hover:bg-destructive/15 hover:text-destructive", className)} {...props} />
  );
}

/**
 * Carte de la vue « Images » : pochette pleine sans cadre, durée en pastille, texte dessous.
 * IMPORTANT : case à cocher, lecture et favori n'apparaissent qu'au survol (ou si déjà actifs) pour garder la grille calme.
 */
function MediaCard({ item, active, playing, selected, favorite, onToggle, onToggleFavorite, onPlay }: MediaViewProps) {
  const { t } = useI18n();
  return (
    <div className="group min-w-0 cursor-default" data-track-id={item.id} onDoubleClick={onPlay}>
      <div className={cn("relative aspect-square overflow-hidden rounded-xl bg-muted shadow-sm transition-shadow group-hover:shadow-lg", active && "ring-2 ring-ring", selected && "ring-2 ring-primary")}>
        <Thumb item={item} className="size-full" iconClass="size-12" />
        {/* IMPORTANT : case et favori au-dessus (z-10) du voile de survol, sinon celui-ci intercepte leurs clics. */}
        <Checkbox className={cn("absolute left-2 top-2 z-10 bg-background transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")} checked={selected} onCheckedChange={onToggle} />
        <button type="button" aria-label={t("tool.favorites")} onClick={onToggleFavorite} className={cn("absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1.5 transition-opacity", favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          <Heart className={cn("size-3.5", favorite && "fill-current text-rose-400")} />
        </button>
        {/* Simple indication au survol : la lecture se lance au DOUBLE clic (sur la carte), pas au clic, pour ne pas interrompre une sélection. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-background/90 text-foreground shadow-lg"><Play className="size-5" /></span>
        </div>
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.7rem] tabular-nums text-white">{formatTime(item.duration)}</span>
        <ResumeBar item={item} />
        {active && <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-1"><PlayingBars playing={playing} className="text-white" /></span>}
      </div>
      <p className={cn("mt-2 truncate text-sm font-medium", active && "text-foreground")} title={item.title}>{item.title}</p>
      <p className="truncate text-xs text-muted-foreground" title={item.artist}>{item.artist || "—"}</p>
    </div>
  );
}

/** Ligne de la vue « Liste riche » : miniature, titre et artiste, taille, durée, favori ; le morceau en cours est surligné. */
function MediaRow({ item, active, playing, selected, favorite, onToggle, onToggleFavorite, onPlay }: MediaViewProps) {
  const { t } = useI18n();
  return (
    <div className={cn("group flex cursor-default items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/60", active && "bg-accent", selected && "ring-1 ring-ring")} data-track-id={item.id} onDoubleClick={onPlay}>
      <Checkbox checked={selected} onCheckedChange={onToggle} className={cn("transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
      <button type="button" aria-label={t("tool.play")} onClick={onPlay} className="relative size-11 shrink-0 overflow-hidden rounded-md">
        <Thumb item={item} className="size-full" iconClass="size-5" />
        <ResumeBar item={item} className="h-[0.15rem]" />
        <span className={cn("absolute inset-0 grid place-items-center bg-black/45 text-white transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {active ? <PlayingBars playing={playing} className="text-white" /> : <Play className="size-4" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.title}>{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">{item.artist || "—"} · {formatSize(item.size)}</p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatTime(item.duration)}</span>
      <button type="button" aria-label={t("tool.favorites")} onClick={onToggleFavorite} className={cn("shrink-0 rounded-full p-1.5 transition-opacity hover:bg-background", favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
        <Heart className={cn("size-4", favorite && "fill-current text-rose-400")} />
      </button>
    </div>
  );
}

/** Mur de pochettes : affiche les titres au survol, comme la vue "jacket" d'origine. */
function JacketTile({ item, active, onPlay }: { item: MediaItem; active: boolean; onPlay: () => void }) {
  return (
    <div className={cn("group relative aspect-square cursor-default overflow-hidden rounded-md bg-muted", active && "ring-2 ring-ring")} data-track-id={item.id} onDoubleClick={onPlay} title={`${item.artist} — ${item.title}`}>
      {item.jacket ? <img src={item.jacket} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Music className="size-8 text-muted-foreground" /></div>}
      <ResumeBar item={item} />
      <div className="absolute inset-x-0 bottom-0 translate-y-full bg-background/85 p-1.5 text-xs transition-transform group-hover:translate-y-0">
        <p className="truncate font-medium">{item.title}</p>
        <p className="truncate text-muted-foreground">{item.artist || "---"}</p>
      </div>
    </div>
  );
}

/** Pochette carrée : l'image si elle existe, sinon le logo sur fond neutre. */
function Cover({ item, className }: { item: MediaItem | null; className?: string }) {
  return (
    <div
      className={cn("aspect-square rounded-xl bg-muted bg-cover bg-center shadow-lg", className)}
      style={item?.jacket ? { backgroundImage: `url(${item.jacket})` } : undefined}
    >
      {!item?.jacket && <div className="grid size-full place-items-center"><img src="/zarao-logo.png" alt="" className="size-1/2 opacity-60" /></div>}
    </div>
  );
}

/** Nombre de pochettes affichées de chaque côté de celle du centre. */
const FLOW_SIDE = 3;
/** Cumul de molette (px) nécessaire pour avancer d'une pochette : évite qu'un trackpad ne fasse défiler tout le carrousel d'un geste. */
const FLOW_WHEEL_STEP = 60;

/**
 * Carrousel de pochettes en 3D (cover flow) : la pochette centrée est de face, les autres pivotent et reculent.
 * IMPORTANT : `focus` (ce qu'on regarde) est distinct du morceau joué ; un clic sur la pochette du centre lance la lecture,
 * un clic sur une voisine la ramène au centre.
 */
function CoverFlow({ items, focus, currentId, onFocus, onPlay }: { items: MediaItem[]; focus: number; currentId?: string; onFocus: (i: number) => void; onPlay: (id: string) => void }) {
  const wheelAcc = useRef(0);
  const wheelAt = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    // Molette verticale ou horizontale : on retient l'axe dominant. Le cumul est remis à zéro après une pause.
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    if (now - wheelAt.current > 250) wheelAcc.current = 0;
    wheelAt.current = now;
    wheelAcc.current += delta;
    if (Math.abs(wheelAcc.current) >= FLOW_WHEEL_STEP) {
      onFocus(Math.max(0, Math.min(items.length - 1, focus + Math.sign(wheelAcc.current))));
      wheelAcc.current = 0;
    }
  };
  // IMPORTANT : la géométrie est calculée en pixels à partir de la hauteur réelle du conteneur. Des pourcentages + une pochette
  // à 100 % de la hauteur faisaient dépasser celle du centre (rognée en haut) et chevaucher ses voisines.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxH, setBoxH] = useState(300);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight || 300));
    ro.observe(el);
    setBoxH(el.clientHeight || 300);
    return () => ro.disconnect();
  }, []);
  const size = Math.round(boxH * 0.78); // côté de la pochette du centre : laisse une marge, rien n'est rogné
  const visible = items.map((item, i) => ({ item, i, off: i - focus })).filter((x) => Math.abs(x.off) <= FLOW_SIDE);
  return (
    <div ref={boxRef} className="relative min-h-[5rem] w-full max-h-[34rem] flex-1" style={{ perspective: "1200px" }} onWheel={onWheel}>
      {visible.map(({ item, i, off }) => {
        const abs = Math.abs(off);
        const dir = Math.sign(off);
        const isCenter = off === 0;
        // Première voisine dégagée du centre, les suivantes plus serrées ; elles reculent et pivotent.
        const x = isCenter ? 0 : dir * (size * 0.72 + (abs - 1) * size * 0.3);
        const z = isCenter ? 0 : -140 - (abs - 1) * 90;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.title}
            title={item.title}
            onClick={() => (isCenter ? onPlay(item.id) : onFocus(i))}
            className="absolute left-1/2 top-1/2 transition-transform duration-500 ease-out"
            style={{
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              transform: `translateX(${x}px) translateZ(${z}px) rotateY(${isCenter ? 0 : -dir * 55}deg)`,
              zIndex: 10 - abs,
            }}
          >
            {/* IMPORTANT : pas d'ombre portée ni de filtre sur une carte en 3D (la rotation les étale en traînée sombre) ; liseré fin + voile pour les voisines. */}
            <Cover item={item} className={cn("size-full bg-secondary shadow-none ring-1 ring-white/15", item.id === currentId && "ring-2 ring-ring")} />
            {/* Cartes toujours opaques : l'éloignement se lit par un voile noir croissant, pas par de la transparence (le fond animé transparaîtrait). */}
            {!isCenter && <span className="pointer-events-none absolute inset-0 rounded-xl bg-black" style={{ opacity: 0.2 + abs * 0.12 }} />}
            {isCenter && item.id !== currentId && (
              <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/30 opacity-0 transition-opacity hover:opacity-100"><Play className="size-12 text-white" /></span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Disposition « scène » : carrousel de pochettes (molette, clic, boutons précédent/suivant) et parole en cours en grand. */
function SceneStage({ p, lyrics, onOpenLyrics, onFullscreen }: { p: ReturnType<typeof usePlayer>; lyrics: Lyrics | null; onOpenLyrics: () => void; onFullscreen: () => void }) {
  const { t } = useI18n();
  const cur = p.current;
  const active = lyrics?.synced ? activeLine(lyrics, p.time) : -1;
  const currentIndex = Math.max(0, p.items.findIndex((i) => i.id === cur?.id));
  const [focus, setFocus] = useState(currentIndex);
  // Le carrousel suit le morceau joué (changement de piste, fin de morceau) ; la navigation manuelle reste libre entre-temps.
  useEffect(() => { setFocus(currentIndex); }, [cur?.id, currentIndex]);
  const safeFocus = Math.min(focus, Math.max(0, p.items.length - 1));
  const shown = p.items[safeFocus] ?? cur;
  const go = (i: number) => setFocus(Math.max(0, Math.min(p.items.length - 1, i)));

  // Fiche de la liste : totaux, temps restant (fin du morceau en cours + morceaux suivants) et prochains titres.
  const totalSec = p.items.reduce((sum, i) => sum + i.duration, 0);
  const upcoming = p.items.slice(currentIndex + 1, currentIndex + 4);
  const remainingSec = cur ? Math.max(0, cur.duration - p.time) + p.items.slice(currentIndex + 1).reduce((sum, i) => sum + i.duration, 0) : totalSec;
  const videos = p.items.filter((i) => i.kind === "video").length;
  const isShownPlaying = Boolean(shown) && shown?.id === cur?.id && p.playing;
  const playShown = () => { if (!shown) return; if (shown.id === cur?.id) p.togglePlay(); else p.play(shown.id); };

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      {/* Fond : la pochette du morceau regardé, très floue (le logo à défaut) ; change en fondu avec le carrousel. */}
      <img key={shown?.id ?? "none"} src={shown?.jacket ?? "/zarao-logo.png"} alt="" className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-25 blur-3xl animate-in fade-in duration-700" />
      {/* IMPORTANT : AUCUN défilement sur cette scène. Le conteneur est une « container query » en hauteur : le carrousel (flex-1) absorbe
          d'abord le manque de place, puis les groupes les moins importants disparaissent quand la fenêtre est trop basse
          (cartes d'abord, puis fiche du morceau, puis paroles). Les seuils sont en rem car la hauteur du contenu est en rem. */}
      <div className="absolute inset-0 overflow-hidden" style={{ containerType: "size" }}>
          <div className="flex h-full flex-col items-center justify-center gap-[clamp(0.5rem,3.2vh,2.5rem)] p-[clamp(0.75rem,3vh,2.5rem)]">
      {p.items.length > 0
        ? <CoverFlow items={p.items} focus={safeFocus} currentId={cur?.id} onFocus={go} onPlay={p.play} />
        : <Cover item={null} className="min-h-[5rem] max-h-[34rem] flex-1" />}

      <div className="flex w-full max-w-xl items-center gap-3">
        <Button size="icon" variant="outline" className="size-10 shrink-0 rounded-full" onClick={() => go(safeFocus - 1)} disabled={safeFocus <= 0} title={t("ctl.previous")}><ChevronLeft /></Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-xl font-semibold" title={shown?.title}>{shown?.title ?? t("np.none")}</p>
          <p className="truncate text-sm text-muted-foreground">{shown?.artist || "—"}{p.items.length > 0 && <span className="ml-2 tabular-nums">· {safeFocus + 1}/{p.items.length}</span>}</p>
        </div>
        <Button size="icon" variant="outline" className="size-10 shrink-0 rounded-full" onClick={() => go(safeFocus + 1)} disabled={safeFocus >= p.items.length - 1} title={t("ctl.next")}><ChevronRight /></Button>
      </div>

      {/* Fiche du morceau regardé : format, taille, année, durée */}
      {shown && (
        <div className="hidden flex-wrap justify-center gap-1.5 [@container(min-height:30rem)]:flex">
          <Badge variant="secondary">{shown.ext.toUpperCase()}</Badge>
          <Badge variant="outline">{formatTime(shown.duration)}</Badge>
          {shown.size > 0 && <Badge variant="outline">{formatSize(shown.size)}</Badge>}
          {shown.year && <Badge variant="outline">{shown.year}</Badge>}
          <Badge variant="outline">{t(shown.kind === "video" ? "dlg.video" : "dlg.audio")}</Badge>
        </div>
      )}

      {/* Actions : lire le morceau regardé (le carrousel peut montrer un autre que celui qui joue), paroles, plein écran */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button className="min-w-32 rounded-full" disabled={!shown} onClick={playShown}>{isShownPlaying ? <Pause /> : <Play />} {isShownPlaying ? t("ctl.pause") : t("ctl.play")}</Button>
        <Button variant="outline" className="rounded-full" onClick={onOpenLyrics}><MicVocal /> {t("scene.openLyrics")}</Button>
        <Button variant="ghost" className="rounded-full" onClick={onFullscreen} disabled={!cur}><Maximize /> {t("np.open")}</Button>
      </div>

      <div className="hidden w-full space-y-1 px-8 text-center [@container(min-height:24rem)]:block">
        {lyrics?.synced ? (
          [active - 1, active, active + 1].map((i, k) => {
            const text = i >= 0 && i < lyrics.lines.length ? lyrics.lines[i].text : "";
            return <p key={`${i}-${k}`} className={cn("min-h-7 truncate transition-all duration-300", k === 1 ? "text-2xl font-semibold" : "text-base text-muted-foreground/60")}>{text || "\u00A0"}</p>;
          })
        ) : (
          <p className="pt-2 text-xs text-muted-foreground">{t("scene.noSync")}</p>
        )}
      </div>

      {/* Cartes d'information : prochains titres, fiche de la liste, raccourcis */}
      <div className="hidden w-full max-w-4xl gap-3 pt-[clamp(0rem,1.5vh,1rem)] sm:grid-cols-3 [@container(min-height:40rem)]:grid">
        <section className="min-w-0 rounded-xl bg-card/60 p-3 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("scene.next")}</h3>
          {upcoming.length === 0
            ? <p className="text-sm text-muted-foreground">{t("scene.endOfList")}</p>
            : <ul className="space-y-0.5">{upcoming.map((i) => (
                <li key={i.id}><button type="button" className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent" onClick={() => p.play(i.id)} title={i.title}>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(i.duration)}</span>
                </button></li>
              ))}</ul>}
        </section>

        <section className="min-w-0 rounded-xl bg-card/60 p-3 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("scene.stats")}</h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("scene.titles", { n: p.items.length })}</dt><dd className="truncate text-xs text-muted-foreground">{t("scene.mix", { a: p.items.length - videos, v: videos })}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("scene.total")}</dt><dd className="tabular-nums">{formatTime(totalSec)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("scene.remaining")}</dt><dd className="tabular-nums">{formatTime(remainingSec)}</dd></div>
          </dl>
        </section>

        <section className="min-w-0 rounded-xl bg-card/60 p-3 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("scene.shortcuts")}</h3>
          <dl className="space-y-1.5 text-sm">
            {SHORTCUTS.slice(0, 4).map(([keys, label]) => (
              <div key={keys} className="flex items-center justify-between gap-2"><dd className="min-w-0 truncate text-muted-foreground">{t(label)}</dd><dt><code className="whitespace-nowrap rounded border px-1.5 py-0.5 text-[0.7rem]">{keys}</code></dt></div>
            ))}
          </dl>
        </section>
      </div>
          </div>
      </div>
    </div>
  );
}

/** Disposition « paroles et bande » : paroles en grand, petite pochette, file de lecture en bande horizontale de pochettes. */
function StripStage({ p, lyrics, loading, onEdit, onSearchOnline, source, onAddFiles }: { p: ReturnType<typeof usePlayer>; lyrics: Lyrics | null; loading: boolean; onEdit: () => void; onSearchOnline: () => Promise<boolean>; source: "lrclib" | null; onAddFiles: () => void }) {
  const { t } = useI18n();
  const cur = p.current;
  const trackRef = useRef<HTMLDivElement>(null);
  // La carte du morceau en cours reste centrée quand il change (la navigation manuelle reste libre entre-temps).
  useEffect(() => {
    const track = trackRef.current;
    const card = track?.querySelector('[data-current="true"]');
    if (track && card) centerInScroller(track, card, "x");
  }, [cur?.id]);
  const scrollQueue = (dir: 1 | -1) => trackRef.current?.scrollBy({ left: dir * 3 * 240, behavior: "smooth" });
  // Molette verticale : convertie en défilement horizontal (sinon la bande ne répond qu'au trackpad ou à la barre).
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && trackRef.current) trackRef.current.scrollLeft += e.deltaY;
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Sans paroles (et pas en cours de recherche), la zone n'est plus vide : visualiseur + actions utiles. */}
        {lyrics || loading
          ? <LyricsPanel className="min-w-0 flex-1" lyrics={lyrics} loading={loading} hasTrack={Boolean(cur)} time={p.time} onSeek={p.seek} onEdit={onEdit} onSearchOnline={onSearchOnline} source={source} />
          : <NoLyricsStage p={p} onEdit={onEdit} onSearchOnline={onSearchOnline} onAddFiles={onAddFiles} />}
        <aside className="hidden w-48 shrink-0 flex-col gap-2 border-l p-4 md:flex">
          <Cover item={cur} className="w-full" />
          <p className="truncate text-sm font-medium" title={cur?.title}>{cur?.title ?? t("np.none")}</p>
          <p className="truncate text-xs text-muted-foreground">{cur?.artist || "—"}</p>
        </aside>
      </div>
      <div className="border-t">
        <h3 className="px-4 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("np.queue")}</h3>
        {/* Carrousel de cartes : défilement aimanté, morceau en cours centré, flèches sur les bords et fondus pour signaler la suite. */}
        <div className="relative">
          {/* IMPORTANT : div natif plutôt que ScrollArea — barre masquée (webkit + Firefox) mais le défilement (molette, tactile, flèches) reste actif. */}
          <div ref={trackRef} onWheel={onWheel} className="w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-3 px-12 py-3">
              {p.items.map((i, n) => {
                const isCur = cur?.id === i.id;
                return (
                  <button
                    key={i.id}
                    data-current={isCur}
                    className={cn("flex w-56 shrink-0 snap-center items-center gap-3 rounded-xl border p-2 text-left transition-colors hover:bg-accent", isCur ? "border-primary bg-accent" : "border-border")}
                    onClick={() => p.play(i.id)}
                    title={i.title}
                  >
                    <Cover item={i} className="size-12 shrink-0 rounded-lg shadow-none" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{i.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{i.artist || "—"}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                        {isCur ? <PlayingBars playing={p.playing} className="mx-0" /> : <span>{n + 1}</span>}
                        <span>· {formatTime(i.duration)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent" />
          <Button size="icon" variant="secondary" className="absolute left-2 top-1/2 z-10 size-9 -translate-y-1/2 rounded-full shadow-md" onClick={() => scrollQueue(-1)} title={t("ctl.previous")}><ChevronLeft /></Button>
          <Button size="icon" variant="secondary" className="absolute right-2 top-1/2 z-10 size-9 -translate-y-1/2 rounded-full shadow-md" onClick={() => scrollQueue(1)} title={t("ctl.next")}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Zone des paroles quand il n'y en a pas : le visualiseur occupe l'espace (logo Zarao au repos, pochette en lecture),
 * avec en bas de quoi agir — chercher en ligne ou saisir les paroles ; sans morceau, lancer la lecture ou ajouter des fichiers.
 */
function NoLyricsStage({ p, onEdit, onSearchOnline, onAddFiles }: { p: ReturnType<typeof usePlayer>; onEdit: () => void; onSearchOnline: () => Promise<boolean>; onAddFiles: () => void }) {
  const { t } = useI18n();
  const [theme] = useVisualizerTheme();
  const cur = p.current;
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // Un résultat « introuvable » ne vaut que pour le morceau où il a été obtenu.
  useEffect(() => { setNotFound(false); }, [cur?.id]);
  const needTags = Boolean(cur) && (!cur?.artist || !cur?.title);
  const search = async () => { setSearching(true); try { setNotFound(!(await onSearchOnline())); } finally { setSearching(false); } };

  return (
    // IMPORTANT : le visualiseur et la carte d'actions sont deux blocs l'un sous l'autre (pas de superposition) :
    // la carte posée par-dessus masquait le bas du spectre.
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <AudioVisualizer className="absolute inset-0" mediaRef={p.mediaRef} playing={p.playing} source={spectrumSourceOf(cur)} jacket={cur?.jacket} theme={theme} />
      </div>
      <div className="mx-auto mb-4 flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-2xl bg-card/70 px-4 py-3 shadow-lg backdrop-blur-xl">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><MicVocal className="size-4" /></span>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium">{cur ? t("lyr.none") : t("lyr.noTrack")}</p>
          {cur && (notFound || needTags) && <p className="truncate text-xs text-muted-foreground">{needTags ? t("lyr.needTags") : t("lyr.notFound")}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {cur ? (
            <>
              <Button size="sm" disabled={searching || needTags} onClick={() => void search()}><Search /> {searching ? t("lyr.loading") : t("lyr.search")}</Button>
              <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> {t("lyr.add")}</Button>
            </>
          ) : (
            <>
              {p.items.length > 0 && <Button size="sm" onClick={() => p.play(p.items[0].id)}><Play /> {t("ctl.play")}</Button>}
              <Button size="sm" variant={p.items.length > 0 ? "outline" : "default"} onClick={onAddFiles}><FilePlus /> {t("file.addFiles")}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
