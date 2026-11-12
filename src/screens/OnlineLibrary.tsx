import { PaletteMenuItems } from "@/components/PaletteMenuItems";
import { ZoomMenuItems } from "@/components/ZoomMenuItems";
import { VideoStage, toggleVideoFullscreen } from "@/components/VideoStage";
import { AmbientBackground } from "@/components/AmbientBackground";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeftRight, Compass, Download, Film, Home, Library, ListMusic, ListPlus, LogOut, Music, Plus, RefreshCw, Search, SearchX, Settings, Sparkles, Trash2, UserRound, X, PanelLeftClose, PanelLeftOpen, Grid2x2, Rows3, GalleryHorizontal } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { InfoNote, boldMarkup } from "@/components/InfoNote";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { FullscreenPlayer } from "@/components/FullscreenPlayer";
import { LyricsPanel } from "@/components/LyricsPanel";
import { EqualizerPanel } from "@/components/EqualizerPanel";
import { MetadataDialog, type MetadataSaved } from "@/components/MetadataDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { PlayerBar, SEEK_STEP } from "@/components/PlayerBar";
import { PlayingBars } from "@/components/PlayingBars";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarTrigger } from "@/components/ui/menubar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLyrics } from "@/hooks/useLyrics";
import { useSocial, useViewTracker } from "@/hooks/useSocial";
import { usePlayer } from "@/hooks/usePlayer";
import { useI18n, type TKey } from "@/i18n";
import { addToPlaylist, createPlaylist, deleteMedia, listAll, listNews, listOwn, searchMedia, type ServerMedia, type SessionUser } from "@/lib/api";
import { formatTime } from "@/lib/media";
import { applyMeta, mediaId, toMediaItem } from "@/lib/online";
import { cn } from "@/lib/utils";
import { getMeta } from "@/lib/api";
import { AccountPanel } from "@/screens/online/AccountPanel";
import { DetailDialog } from "@/screens/online/DetailDialog";
import { HomeHero, MediaCarousel, MediaGrid, type MediaView } from "@/screens/online/MediaGrid";
import { AddToPlaylistDialog, NamePlaylistDialog } from "@/screens/online/PlaylistDialogs";
import { PlaylistDetail, PlaylistList } from "@/screens/online/PlaylistViews";
import { UploadForm } from "@/screens/online/UploadForm";
import { useDownloads } from "@/screens/online/useDownloads";

type View = "home" | "search" | "music" | "videos" | "playlists" | "playlist" | "queue" | "downloads" | "upload" | "account";
const PAGE = 12;
const FAV_KEY = "zarao.online.favorites";

const NAV: { view: View; icon: typeof Home; label: TKey }[] = [
  { view: "home", icon: Home, label: "nav.home" },
  { view: "music", icon: Music, label: "nav.music" },
  { view: "videos", icon: Film, label: "nav.videos" },
  { view: "playlists", icon: Library, label: "nav.playlists" },
  { view: "queue", icon: ListMusic, label: "nav.queue" },
  { view: "downloads", icon: Download, label: "nav.downloads" },
  { view: "upload", icon: Plus, label: "nav.upload" },
  { view: "account", icon: UserRound, label: "nav.account" },
];

/** Note (toujours visible, façon Nemo) et avertissement éventuel de chaque écran ; l'avertissement est réservé à ce qu'une action engage. */
const PAGE_NOTES: Record<View, { note: TKey; warning?: TKey }> = {
  home: { note: "note.home" },
  search: { note: "note.search" },
  music: { note: "note.music", warning: "note.musicWarning" },
  videos: { note: "note.videos", warning: "note.videosWarning" },
  playlists: { note: "note.playlists" },
  playlist: { note: "note.playlist" },
  queue: { note: "note.queue", warning: "note.queueWarning" },
  downloads: { note: "note.downloads", warning: "note.downloadsWarning" },
  upload: { note: "note.upload", warning: "note.uploadWarning" },
  account: { note: "note.account", warning: "note.accountWarning" },
};

function readFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

type Props = { user: SessionUser; onLogout: () => void; onBack: () => void; onUserChange: (u: SessionUser) => void };

/** Bibliothèque en ligne : accueil (nouveautés, suggestions), recherche, mes médias, file de lecture, téléchargements, téléversement. */
export function OnlineLibrary({ user, onLogout, onBack, onUserChange }: Props) {
  const { t } = useI18n();
  // IMPORTANT : pas de persistance de la file — elle se reconstruit depuis le serveur, et ne doit pas se mélanger à la playlist locale.
  const p = usePlayer({ storageKey: null });
  const downloads = useDownloads();

  const [view, setView] = useState<View>("home");
  const [notice, setNotice] = useState<string | null>(null);
  // Présentation des listes de médias : cartes, liste riche ou étagères ; mémorisée d'une session à l'autre.
  const [mediaView, setMediaView] = useState<MediaView>(() => {
    try { const v = localStorage.getItem("zarao.online.mediaView"); return v === "rows" || v === "shelves" ? v : "cards"; } catch { return "cards"; }
  });
  useEffect(() => { try { localStorage.setItem("zarao.online.mediaView", mediaView); } catch { /* non bloquant */ } }, [mediaView]);
  // Menu latéral : libellés visibles ou icônes seules, mémorisé d'une session à l'autre.
  const [navCollapsed, setNavCollapsed] = useState(() => { try { return localStorage.getItem("zarao.online.navCollapsed") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("zarao.online.navCollapsed", navCollapsed ? "1" : "0"); } catch { /* non bloquant */ } }, [navCollapsed]);
  const [serverError, setServerError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(readFavorites);

  const [news, setNews] = useState<ServerMedia[] | null>(null);
  const [suggested, setSuggested] = useState<ServerMedia[]>([]);
  const [suggestedMore, setSuggestedMore] = useState(true);
  const [own, setOwn] = useState<Record<"music" | "video", ServerMedia[] | null>>({ music: null, video: null });

  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ServerMedia[]>([]);
  const [resultsMore, setResultsMore] = useState(false);
  const [searching, setSearching] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Barre de recherche collante : sa hauteur réelle est répercutée sur l'en-tête du volet des paroles.
  const [searchEl, setSearchEl] = useState<HTMLFormElement | null>(null);
  const [searchBarH, setSearchBarH] = useState<number>();
  useEffect(() => {
    if (!searchEl) { setSearchBarH(undefined); return; }
    const ro = new ResizeObserver(() => setSearchBarH(searchEl.offsetHeight));
    ro.observe(searchEl);
    setSearchBarH(searchEl.offsetHeight);
    return () => ro.disconnect();
  }, [searchEl]);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [lyricsRefresh, setLyricsRefresh] = useState(0);
  const lyrics = useLyrics(p.current, lyricsRefresh);
  // Réactions du média en cours + comptabilisation du temps écouté (envoyé au changement de piste).
  const social = useSocial(p.current?.remoteId, user._id);
  useViewTracker(p.mediaRef, p.current?.remoteId, user._id);
  const [editId, setEditId] = useState<string | null>(null);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  /** Médias en cours d'ajout à une playlist (fenêtre de choix) ; null = fermée. */
  const [addIds, setAddIds] = useState<string[] | null>(null);
  const [saveQueueOpen, setSaveQueueOpen] = useState(false);
  // Incrémenté quand une playlist change : recharge la liste et le détail.
  const [plRefresh, setPlRefresh] = useState(0);
  // Incrémenté après une modification : remonte les cartes pour recharger pochette et titre.
  const [refreshToken, setRefreshToken] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ServerMedia | null>(null);

  const flash = useCallback((msg: string) => { setNotice(msg); window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3000); }, []);
  const guard = useCallback(<T,>(promise: Promise<T>): Promise<T | null> => promise.then((v) => { setServerError(false); return v; }).catch(() => { setServerError(true); return null; }), []);

  useEffect(() => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favorites])); } catch { /* non bloquant */ } }, [favorites]);

  // --- Chargements ---
  const loadNews = useCallback(async () => {
    setNews(null);
    const d = await guard(listNews(user._id));
    setNews(d?.list ?? []);
  }, [guard, user._id]);

  const loadSuggested = useCallback(async (reset: boolean) => {
    const offset = reset ? 0 : suggested.length;
    const d = await guard(listAll(user._id, PAGE, offset));
    if (!d) return;
    setSuggested((prev) => (reset ? d.list : [...prev, ...d.list]));
    setSuggestedMore(d.list.length === PAGE);
  }, [guard, suggested.length, user._id]);

  const loadOwn = useCallback(async (type: "music" | "video") => {
    setOwn((o) => ({ ...o, [type]: null }));
    const d = await guard(listOwn(type, user._id));
    setOwn((o) => ({ ...o, [type]: d?.list ?? [] }));
  }, [guard, user._id]);

  const refreshHome = useCallback(() => { void loadNews(); void loadSuggested(true); }, [loadNews, loadSuggested]);

  // Premier chargement de l'accueil, puis rechargement des listes personnelles à l'ouverture de leur section.
  useEffect(() => { refreshHome(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (view === "music") void loadOwn("music");
    if (view === "videos") void loadOwn("video");
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Recherche ---
  const runSearch = useCallback(async (q: string, append: boolean) => {
    const text = q.trim();
    if (!text) return;
    setSearching(true);
    setSearchQuery(text);
    setView("search");
    const found = await guard(searchMedia(text, append ? results.length : 0));
    setSearching(false);
    if (!found) return;
    setResults((prev) => (append ? [...prev, ...found] : found));
    setResultsMore(found.length === 10);
  }, [guard, results.length]);

  const submitSearch = (e: FormEvent) => { e.preventDefault(); void runSearch(searchText, false); };
  const clearSearch = () => { setSearchText(""); setSearchQuery(""); setResults([]); setView("home"); };

  // --- Actions sur les médias ---
  /** Ajoute à la file ; le type réel (audio/vidéo), la pochette et l'année arrivent ensuite via les métadonnées. */
  const enqueue = useCallback((m: ServerMedia, play: boolean) => {
    const item = toMediaItem(m);
    p.addItems([item]);
    void getMeta(mediaId(m)).then((meta) => { if (meta) p.updateItem(item.id, (i) => applyMeta(i, meta)); });
    if (play) p.play(item.id); else flash(t("card.added"));
  }, [flash, p, t]);

  /** Remplace la file par ces médias et lance celui d'index `start` (lecture d'une playlist). */
  const playAll = useCallback((list: ServerMedia[], start: number) => {
    if (list.length === 0) return;
    const items = list.map((m) => toMediaItem(m));
    p.clear();
    p.addItems(items);
    items.forEach((item, i) => void getMeta(mediaId(list[i])).then((meta) => { if (meta) p.updateItem(item.id, (it) => applyMeta(it, meta)); }));
    p.play(items[Math.min(Math.max(start, 0), items.length - 1)].id);
  }, [p]);

  const enqueueAll = useCallback((list: ServerMedia[]) => {
    const items = list.map((m) => toMediaItem(m));
    p.addItems(items);
    items.forEach((item, i) => void getMeta(mediaId(list[i])).then((meta) => { if (meta) p.updateItem(item.id, (it) => applyMeta(it, meta)); }));
    flash(t("card.added"));
  }, [flash, p, t]);

  const actions = useMemo(() => ({
    onAddToPlaylist: (m: ServerMedia) => setAddIds([mediaId(m)]),
    onPlay: (m: ServerMedia) => enqueue(m, true),
    onQueue: (m: ServerMedia) => enqueue(m, false),
    onDetails: (m: ServerMedia) => setDetailId(mediaId(m)),
    onDownload: (m: ServerMedia) => { setView("downloads"); downloads.start(mediaId(m), m.title ?? "media").catch(() => flash(t("dl.error"))); },
  }), [downloads, enqueue, flash, t]);

  const queueRemoteIds = p.items.filter((i) => i.source === "online" && i.remoteId).map((i) => i.remoteId as string);

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const id = mediaId(target);
    const ok = await guard(deleteMedia(id));
    if (!ok) return;
    p.removeItems([`online:${id}`]);
    const drop = (list: ServerMedia[] | null) => list && list.filter((m) => mediaId(m) !== id);
    setOwn((o) => ({ music: drop(o.music), video: drop(o.video) }));
    setNews((n) => drop(n)); setSuggested((s) => s.filter((m) => mediaId(m) !== id));
  };

  /** Après modification : recharge les listes, oublie le cache et met à jour la file de lecture. */
  const onMetadataSaved = (saved: MetadataSaved) => {
    setLyricsRefresh((n) => n + 1);
    const id = editId;
    if (!id) return;
    setRefreshToken((n) => n + 1);
    refreshHome();
    if (view === "music") void loadOwn("music");
    if (view === "videos") void loadOwn("video");
    p.updateItem(`online:${id}`, (i) => ({ ...i, title: saved.tags.title || i.title, artist: saved.tags.artist, year: saved.tags.date, jacket: saved.jacket || undefined }));
  };

  const toggleFavorite = () => {
    const id = p.current?.remoteId;
    if (!id) return;
    setFavorites((f) => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const copyTitle = () => { if (p.current) void navigator.clipboard?.writeText(p.current.artist ? `${p.current.artist} - ${p.current.title}` : p.current.title); };

  // Raccourcis : sous-ensemble de ceux du lecteur local (pas d'ajout de fichiers ici).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") { e.preventDefault(); p.togglePlay(); }
      else if (e.key === "n") p.next();
      else if (e.key === "l") setLyricsOpen((o) => !o);
      else if (e.key === "f" && p.current) { if (p.current.kind === "video") toggleVideoFullscreen(); else setVisualizerOpen(true); }
      else if (e.key === "p") p.previous();
      else if (e.key === "ArrowLeft") { e.preventDefault(); p.seek(Math.max(0, p.time - SEEK_STEP)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); p.seek(Math.min(p.duration || 0, p.time + SEEK_STEP)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isVideo = p.current?.kind === "video";
  const currentRemoteId = p.current?.remoteId;

  // --- Rendu des sections ---
  const section = (title: string, children: React.ReactNode, extra?: React.ReactNode, Icon?: React.ComponentType<{ className?: string }>) => (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          {Icon && <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary"><Icon className="size-4" /></span>}
          {title}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
  const goUpload = { label: t("nav.upload"), icon: Plus, onClick: () => setView("upload") };
  const emptyNews = <EmptyState icon={Sparkles} title={t("em.catalogTitle")} description={t("em.catalogBody")} actions={[goUpload, { label: t("em.refresh"), icon: RefreshCw, onClick: refreshHome }]} />;
  const emptySuggested = <EmptyState icon={Compass} title={t("em.suggestedTitle")} description={t("em.suggestedBody")} actions={[{ label: t("em.refresh"), icon: RefreshCw, onClick: refreshHome }]} />;
  const emptyResults = <EmptyState icon={SearchX} title={t("em.noResultsTitle")} description={t("em.noResultsBody")} tips={[t("em.tip1"), t("em.tip2"), t("em.tip3")]} actions={[{ label: t("on.clearSearch"), icon: X, onClick: clearSearch }]} />;
  const emptyMusic = <EmptyState icon={Music} title={t("em.musicTitle")} description={t("em.musicBody")} actions={[goUpload]} />;
  const emptyVideos = <EmptyState icon={Film} title={t("em.videosTitle")} description={t("em.videosBody")} actions={[goUpload]} />;
  const emptyQueue = <EmptyState icon={ListMusic} title={t("em.queueTitle")} description={t("em.queueBody")} actions={[{ label: t("em.queueBrowse"), icon: Compass, onClick: () => setView("home") }]} />;
  const emptyDownloads = <EmptyState icon={Download} title={t("em.dlTitle")} description={t("em.dlBody")} actions={[{ label: t("em.queueBrowse"), icon: Compass, onClick: () => setView("home") }]} />;
  const loadingOf = (k: "news" | "search" | "music" | "videos") => <LoadingState title={t(`ld.${k}`)} description={t(`ld.${k}Body`)} />;
  const grid = (items: ServerMedia[], own?: { onDelete: (m: ServerMedia) => void }) => <MediaGrid view={mediaView} items={items} currentRemoteId={currentRemoteId} refreshToken={refreshToken} {...actions} onEdit={own ? (m) => setEditId(mediaId(m)) : undefined} onDelete={own?.onDelete} />;

  const content = (() => {
    switch (view) {
      case "home":
        return (
          <div className="space-y-8">
            {/* Accueil éditorial : bandeau « à la une » (média le plus récent), liste numérotée du reste, puis carrousel de suggestions. */}
            {news !== null && news.length > 0 && <HomeHero items={news.slice(0, 10)} onPlay={actions.onPlay} onQueue={actions.onQueue} onDetails={actions.onDetails} onRefresh={refreshHome} />}
            {(news === null || news.length !== 1) && section(t("on.news"), news === null ? loadingOf("news") : news.length === 0 ? emptyNews : (
              <MediaGrid view="rows" numbered items={news} currentRemoteId={currentRemoteId} refreshToken={refreshToken} {...actions} />
            ), news !== null && news.length === 0 ? (
              <Button size="sm" variant="outline" className="rounded-full" onClick={refreshHome}><RefreshCw /> {t("on.refresh")}</Button>
            ) : undefined, Sparkles)}
            {section(t("on.suggested"), suggested.length === 0 ? emptySuggested : (
              <>
                <MediaCarousel items={suggested} currentRemoteId={currentRemoteId} refreshToken={refreshToken} {...actions} />
                {suggestedMore && <div className="flex justify-center pt-2"><Button variant="outline" className="rounded-full" onClick={() => void loadSuggested(false)}><Plus /> {t("on.more")}</Button></div>}
              </>
            ), undefined, Compass)}
          </div>
        );
      case "search":
        return section(t("on.results", { q: searchQuery }), searching && results.length === 0 ? loadingOf("search") : results.length === 0 ? emptyResults : (
          <>
            {grid(results)}
            {resultsMore && <div className="flex justify-center pt-2"><Button variant="outline" disabled={searching} onClick={() => void runSearch(searchQuery, true)}><Plus /> {t("on.more")}</Button></div>}
          </>
        ));
      case "music":
        return section(t("nav.music"), own.music === null ? loadingOf("music") : own.music.length === 0 ? emptyMusic : grid(own.music, { onDelete: setDeleteTarget }),
          <Button size="sm" onClick={() => setView("upload")}><Plus /> {t("nav.upload")}</Button>);
      case "videos":
        return section(t("nav.videos"), own.video === null ? loadingOf("videos") : own.video.length === 0 ? emptyVideos : grid(own.video, { onDelete: setDeleteTarget }),
          <Button size="sm" onClick={() => setView("upload")}><Plus /> {t("nav.upload")}</Button>);
      case "queue":
        return section(t("nav.queue"), p.items.length === 0 ? emptyQueue : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>{t("col.artist")}</TableHead>
                <TableHead>{t("col.title")}</TableHead>
                <TableHead className="w-24 text-right">{t("col.total")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.items.map((i, n) => {
                const isCurrent = p.current?.id === i.id;
                return (
                  <TableRow key={i.id} className={cn("cursor-default [&>td]:py-1", isCurrent && "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]")} onDoubleClick={() => p.play(i.id)}>
                    <TableCell className="text-center text-xs tabular-nums text-muted-foreground">{isCurrent ? <PlayingBars playing={p.playing} /> : n + 1}</TableCell>
                    <TableCell className="truncate text-muted-foreground">{i.artist || "—"}</TableCell>
                    <TableCell className={cn("max-w-0 truncate", isCurrent && "font-medium")}>{i.title}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTime(i.duration)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" className="size-7" onClick={() => p.removeItems([i.id])} title={t("tool.remove")}><Trash2 /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ), <Button size="sm" variant="secondary" disabled={queueRemoteIds.length === 0} onClick={() => setSaveQueueOpen(true)}><ListPlus /> {t("pl.saveQueue")}</Button>);
      case "playlists":
        return <PlaylistList user={user} refreshToken={plRefresh} onOpen={(id) => { setPlaylistId(id); setView("playlist"); }} />;
      case "playlist":
        return playlistId ? (
          <PlaylistDetail
            user={user} id={playlistId} refreshToken={plRefresh}
            currentRemoteId={currentRemoteId} playing={p.playing}
            onBack={() => setView("playlists")} onBrowse={() => setView("home")} onPlayAll={playAll} onEnqueueAll={enqueueAll}
            onChanged={() => setPlRefresh((n) => n + 1)}
          />
        ) : null;
      case "downloads":
        return section(t("dl.title"), downloads.entries.length === 0 ? emptyDownloads : (
          <ul className="space-y-2">
            {downloads.entries.map((d) => (
              <li key={d.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {d.status === "running" ? t("dl.saving", { p: d.progress }) : d.status === "done" ? t("dl.done") : d.status === "canceled" ? t("dl.canceled") : t("dl.error")}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full transition-[width]", d.status === "error" ? "bg-destructive" : "bg-primary")} style={{ width: `${d.progress}%` }} /></div>
                {d.path && <p className="mt-1 truncate text-xs text-muted-foreground">{d.path}</p>}
                {d.status === "running" && <Button size="sm" variant="ghost" className="mt-1" onClick={() => downloads.cancel(d.id)}>{t("card.cancel")}</Button>}
              </li>
            ))}
          </ul>
        ));
      case "upload":
        return <UploadForm userid={user._id} onUploaded={() => setView("music")} />;
      case "account":
        return <AccountPanel user={user} onUserChange={onUserChange} />;
    }
  })();

  const notes = PAGE_NOTES[view];
  const showSearchBar =view === "home" || view === "search" || view === "music" || view === "videos";

  return (
    <div className="relative isolate flex h-screen flex-col">
      <AmbientBackground playing={p.playing} />
      <header className="flex items-center gap-2 border-b py-1 pl-2 pr-6">
        <Menubar className="border-0 bg-transparent shadow-none">
          <MenubarMenu>
            <MenubarTrigger>{t("menu.file")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onClick={() => setView("upload")}><Plus /> {t("nav.upload")}</MenubarItem>
              <MenubarItem onClick={() => setView("account")}><UserRound /> {t("nav.account")}</MenubarItem>
              <MenubarItem onClick={() => setSettingsOpen(true)}><Settings /> {t("set.title")}…</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={onLogout}><LogOut /> {t("on.logout")}</MenubarItem>
              <MenubarItem onClick={onBack}><ArrowLeftRight /> {t("file.changeMode")}</MenubarItem>
              <MenubarItem onClick={() => void getCurrentWindow().close()}><X /> {t("file.quit")}</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>{t("menu.view")}</MenubarTrigger>
            <MenubarContent>
              <ZoomMenuItems />
              <MenubarSeparator />
              <PaletteMenuItems />
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <div className="ml-auto flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={() => setView("account")} title={t("nav.account")}>
            {user.profilphoto
              ? <img src={user.profilphoto} alt="" className="size-7 rounded-full object-cover" />
              : <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-semibold">{user.username[0]?.toUpperCase()}</span>}
            {t("on.signedIn", { u: user.username })}
          </button>
          <LanguageSwitch />
        </div>
      </header>
      {serverError && <p className="border-b bg-destructive/10 px-3 py-1.5 text-sm text-destructive">{t("on.serverDown")}</p>}
      {notice && <p className="border-b bg-accent px-3 py-1.5 text-sm">{notice}</p>}

      <main className="flex min-h-0 flex-1">
        {/* Égaliseur : volet à gauche, à l'opposé des paroles. */}
        {/* Toujours monté : la largeur s'anime (ouverture ET fermeture) ; `inert` retire le volet fermé du clavier et des lecteurs d'écran. */}
        <aside inert={!eqOpen} aria-hidden={!eqOpen} className={cn("shrink-0 overflow-hidden bg-background/90 backdrop-blur-2xl transition-[width,border-color] duration-300 ease-out", eqOpen ? "w-[30rem] border-r" : "w-0 border-r-0")}>
          <EqualizerPanel className={cn("h-full w-[30rem] transition-opacity duration-300", eqOpen ? "opacity-100" : "opacity-0")} onClose={() => setEqOpen(false)} />
        </aside>
        {/* IMPORTANT : largeur adaptée au contenu (libellés plus longs en anglais), bornée pour ne pas manger la place du contenu. */}
        <nav className={cn("flex shrink-0 flex-col gap-1 border-r p-0 transition-[width] duration-300", navCollapsed ? "w-14 items-start" : "w-56")}>
          {NAV.map(({ view: v, icon: Icon, label }) => {
            const isActive = (view === "playlist" ? "playlists" : view) === v;
            const count = v === "queue" ? p.items.length : 0;
            return (
              <Button
                key={v}
                variant="ghost"
                aria-current={isActive ? "page" : undefined}
                aria-label={t(label)}
                title={t(label)}
                // IMPORTANT : suffixe ! (important) car le Button ne fusionne pas les classes qui se contredisent ; sélection = aucune teinte de fond, seulement un trait épais à gauche.
                className={cn("relative text-base text-muted-foreground", navCollapsed ? "h-10 w-full justify-center px-0" : "w-full justify-start gap-2 whitespace-nowrap px-3", isActive && "rounded-l-none bg-transparent! text-foreground! shadow-[inset_4px_0_0_var(--color-primary)] hover:bg-transparent! [&_svg]:text-foreground")}
                onClick={() => setView(v)}
              >
                <Icon />
                {!navCollapsed && <span className="truncate">{t(label)}</span>}
                {count > 0 && (navCollapsed
                  ? <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-medium leading-4 text-primary-foreground">{count}</span>
                  : <span className="ml-auto rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>)}
              </Button>
            );
          })}
          <Button variant="ghost" size={navCollapsed ? "icon" : "default"} className={cn("mt-auto text-muted-foreground", navCollapsed ? "h-10 w-full" : "w-full justify-start gap-2 px-3 text-base")} onClick={() => setNavCollapsed((c) => !c)} title={navCollapsed ? t("nav.expand") : t("nav.collapse")} aria-expanded={!navCollapsed}>
            {navCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!navCollapsed && <span className="truncate">{t("nav.collapse")}</span>}
          </Button>
        </nav>

        <ScrollArea className={cn("min-w-0 flex-1", isVideo && "max-w-[45%] border-r")}>
          {showSearchBar && (
            <form ref={setSearchEl} onSubmit={submitSearch} className="sticky top-0 z-10 flex gap-2 border-b bg-background/90 p-3 backdrop-blur">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder={t("on.searchPlaceholder")} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
              </div>
              <Button type="submit" disabled={!searchText.trim()}>{t("search.run")}</Button>
              {(searchQuery || searchText) && <Button type="button" variant="outline" onClick={clearSearch} title={t("on.clearSearch")}><X /></Button>}
              <div className="flex items-center gap-0.5" role="group" aria-label={t("mv.title")}>
                {([["cards", Grid2x2, "mv.cards"], ["rows", Rows3, "mv.rows"], ["shelves", GalleryHorizontal, "mv.shelves"]] as const).map(([k, Icon, label]) => (
                  <Button key={k} type="button" size="icon" variant={mediaView === k ? "secondary" : "ghost"} className="size-8" onClick={() => setMediaView(k)} title={t(label)} aria-pressed={mediaView === k}><Icon /></Button>
                ))}
              </div>
            </form>
          )}
          <div className="space-y-6 p-4">
            {notes && (
              // IMPORTANT : pleine largeur sur tous les écrans, y compris upload et compte dont le formulaire est centré dans une colonne étroite.
              <div className="space-y-2">
                <InfoNote id={view}>{boldMarkup(t(notes.note))}</InfoNote>
                {notes.warning && <InfoNote tone="warning">{boldMarkup(t(notes.warning))}</InfoNote>}
              </div>
            )}
            {content}
          </div>
        </ScrollArea>

        {/* IMPORTANT : l'élément média reste toujours monté, sinon changer de piste coupe la lecture. */}
        <VideoStage p={p} visible={isVideo} lyrics={lyrics.lyrics} />

        {/* Paroles : volet latéral, synchronisé avec la lecture */}
        {lyricsOpen && (
          <aside className="w-[30rem] shrink-0 border-l">
            <LyricsPanel
              className="h-full"
              // Hauteur MESURÉE de la barre de recherche voisine : les deux traits du bas s'alignent quelle que soit la taille réelle.
              headerHeight={showSearchBar ? searchBarH : undefined}
              lyrics={lyrics.lyrics}
              loading={lyrics.loading}
              hasTrack={Boolean(p.current)}
              time={p.time}
              onSeek={p.seek}
              onSearchOnline={lyrics.searchOnline}
              source={lyrics.source}
              onClose={() => setLyricsOpen(false)}
              onEdit={() => p.current?.remoteId && setEditId(p.current.remoteId)}
            />
          </aside>
        )}
      </main>

      <PlayerBar
        p={p}
        isFavorite={currentRemoteId ? favorites.has(currentRemoteId) : false}
        onToggleFavorite={toggleFavorite}
        onCopy={copyTitle}
        onShowShortcuts={() => flash("Space · N / P · F · ← / →")}
        onOpenVisualizer={() => setVisualizerOpen(true)}
        lyricsOpen={lyricsOpen}
        eqOpen={eqOpen}
        onToggleEq={() => setEqOpen((o) => !o)}
        social={p.current?.remoteId ? { data: social.social, onReact: (k) => void social.react(k), onOpenComments: () => setDetailId(p.current?.remoteId ?? null) } : undefined}
        onToggleLyrics={() => setLyricsOpen((o) => !o)}
      />
      <FullscreenPlayer p={p} open={visualizerOpen} onClose={() => setVisualizerOpen(false)} lyrics={lyrics.lyrics} />

      <DetailDialog id={detailId} user={user} onClose={() => { setDetailId(null); social.reload(); }} />
      <AddToPlaylistDialog mediaIds={addIds} userid={user._id} onClose={() => setAddIds(null)} onDone={(msg) => { flash(msg); setPlRefresh((n) => n + 1); }} />
      <NamePlaylistDialog
        open={saveQueueOpen}
        mode="create"
        initialName={t("pl.queueDefault")}
        onClose={() => setSaveQueueOpen(false)}
        onSubmit={async (name) => {
          const res = await createPlaylist(user._id, name);
          if (!res.ok || !res.id) return res.error ?? "generic";
          const added = await addToPlaylist(res.id, user._id, queueRemoteIds);
          setPlRefresh((n) => n + 1);
          flash(t("pl.saved", { n: name, c: added.added ?? 0 }));
          return undefined;
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <MetadataDialog source={editId ? { kind: "online", id: editId, userid: user._id } : null} onClose={() => setEditId(null)} onSaved={onMetadataSaved} />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("card.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("card.deleteConfirm", { t: deleteTarget?.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("card.cancel")}</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}><Trash2 /> {t("card.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
