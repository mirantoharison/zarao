import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Download, Film, Info, ListMusic, ListPlus, MoreVertical, Music, Pencil, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarTrigger } from "@/components/ui/menubar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import { getMeta, type ServerMedia, type ServerMediaMeta } from "@/lib/api";
import { formatSize, formatTime } from "@/lib/media";
import { mediaId, parseDuration } from "@/lib/online";
import { cn } from "@/lib/utils";

/** Présentations de la liste des médias en ligne : cartes, liste riche, étagères horizontales. */
export type MediaView = "cards" | "rows" | "shelves";

export type CardActions = {
  onPlay: (m: ServerMedia) => void;
  onQueue: (m: ServerMedia) => void;
  onDetails: (m: ServerMedia) => void;
  onDownload: (m: ServerMedia) => void;
  /** Absent pour les médias qui ne sont pas à l'utilisateur. */
  onEdit?: (m: ServerMedia) => void;
  onAddToPlaylist?: (m: ServerMedia) => void;
  /** Absent pour les médias qui ne sont pas à l'utilisateur. */
  onDelete?: (m: ServerMedia) => void;
};

type ItemProps = CardActions & { media: ServerMedia; active: boolean };

/**
 * Métadonnées d'un média, demandées seulement quand l'élément approche de l'écran.
 * IMPORTANT : la pochette est lourde ; sans ce chargement paresseux, une longue liste la téléchargerait en entier d'un coup.
 */
function useLazyMeta(ref: RefObject<HTMLElement | null>, id: string): ServerMediaMeta | null {
  const [meta, setMeta] = useState<ServerMediaMeta | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void getMeta(id).then((m) => { if (!cancelled) setMeta(m); });
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [id, ref]);
  return meta;
}

/** Menu « plus d'actions » commun aux cartes et aux lignes. */
function MoreMenu({ media, onQueue, onDetails, onDownload, onEdit, onAddToPlaylist, onDelete, triggerClass }: Omit<CardActions, "onPlay"> & { media: ServerMedia; triggerClass?: string }) {
  const { t } = useI18n();
  return (
    <Menubar className="h-auto border-0 bg-transparent p-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger className={cn("rounded-full p-1", triggerClass)} aria-label={t("card.more")}><MoreVertical className="size-4" /></MenubarTrigger>
        <MenubarContent align="end">
          <MenubarItem onClick={() => onQueue(media)}><ListPlus /> {t("card.queue")}</MenubarItem>
          {onAddToPlaylist && <MenubarItem onClick={() => onAddToPlaylist(media)}><ListMusic /> {t("pl.addTo")}</MenubarItem>}
          <MenubarItem onClick={() => onDetails(media)}><Info /> {t("card.details")}</MenubarItem>
          <MenubarItem onClick={() => onDownload(media)}><Download /> {t("card.download")}</MenubarItem>
          {onEdit && <MenubarItem onClick={() => onEdit(media)}><Pencil /> {t("card.edit")}</MenubarItem>}
          {onDelete && (<><MenubarSeparator /><MenubarItem className="text-destructive" onClick={() => onDelete(media)}><Trash2 /> {t("card.delete")}</MenubarItem></>)}
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

/** Pochette ou, à défaut, l'icône du type de média. */
function Jacket({ meta, className, iconClass }: { meta: ServerMediaMeta | null; className?: string; iconClass?: string }) {
  return (
    <div className={cn("overflow-hidden bg-muted", className)}>
      {meta?.jacket ? <img src={meta.jacket} alt="" className="size-full object-cover" /> : (
        <div className="grid size-full place-items-center">{meta?.isVideo ? <Film className={cn("text-muted-foreground", iconClass)} /> : <Music className={cn("text-muted-foreground", iconClass)} />}</div>
      )}
    </div>
  );
}

/**
 * Carte : pochette pleine sans cadre, durée et type en pastilles, texte dessous.
 * Lecture et menu n'apparaissent qu'au survol (ou au focus clavier) pour garder la grille calme.
 */
export function MediaCardOnline({ media, active, onPlay, ...actions }: ItemProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const meta = useLazyMeta(ref, mediaId(media));
  return (
    // Carte « tuile » : fond qui apparaît au survol, pochette qui zoome légèrement, bouton lecture rond en bas à droite.
    <div ref={ref} className="group relative min-w-0 rounded-2xl p-2 transition-colors hover:bg-accent/50 focus-within:bg-accent/50" onDoubleClick={() => onPlay(media)}>
      <div className={cn("relative aspect-square overflow-hidden rounded-xl bg-muted shadow-md transition-shadow group-hover:shadow-xl", active && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
        <Jacket meta={meta} className="size-full transition-transform duration-500 group-hover:scale-105" iconClass="size-12" />
        {/* Voile dégradé : n'assombrit que le bas, là où se trouvent la durée et le bouton lecture. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-70 transition-opacity group-hover:opacity-100" />
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[0.7rem] tabular-nums text-white backdrop-blur-sm">
          {meta?.isVideo ? <Film className="size-3" /> : <Music className="size-3" />}{formatTime(parseDuration(media.duration))}
        </span>
        <Button size="icon" className="absolute bottom-2 right-2 size-10 translate-y-2 rounded-full opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 [&_svg]:size-5" onClick={() => onPlay(media)} title={t("card.play")}><Play className="fill-current" /></Button>
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <MoreMenu media={media} {...actions} triggerClass="bg-black/45 text-white backdrop-blur-sm hover:bg-black/65" />
        </div>
      </div>
      <h3 className={cn("mt-2.5 truncate text-sm font-semibold", active && "text-primary")} title={media.title}>{media.title}</h3>
      <p className="truncate text-xs text-muted-foreground">{media.artist || "---"}</p>
    </div>
  );
}

/** Ligne de la liste riche : miniature, titre, artiste et taille, durée, et actions directes (pas de menu à ouvrir pour les courantes). */
export function MediaRowOnline({ media, active, onPlay, index, ...actions }: ItemProps & { index?: number }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const meta = useLazyMeta(ref, mediaId(media));
  return (
    <div ref={ref} className={cn("group flex items-center gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-accent/60", active && "bg-primary/10")} onDoubleClick={() => onPlay(media)}>
      {index !== undefined && <span className={cn("w-6 shrink-0 text-center text-sm tabular-nums", active ? "font-semibold text-primary" : "text-muted-foreground")}>{index}</span>}
      <button type="button" aria-label={t("card.play")} onClick={() => onPlay(media)} className="relative size-12 shrink-0 overflow-hidden rounded-lg shadow-sm">
        <Jacket meta={meta} className="size-full" iconClass="size-5" />
        <span className={cn("absolute inset-0 grid place-items-center bg-black/45 text-white transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}><Play className="size-4" /></span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-semibold", active && "text-primary")} title={media.title}>{media.title}</p>
        <p className="truncate text-xs text-muted-foreground">{media.artist || "---"} · {formatSize(media.size ?? 0)}</p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatTime(parseDuration(media.duration))}</span>
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button size="icon" variant="ghost" className="size-8" onClick={() => onPlay(media)} title={t("card.play")}><Play /></Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => (actions.onAddToPlaylist ?? actions.onQueue)(media)} title={actions.onAddToPlaylist ? t("pl.addTo") : t("card.queue")}>{actions.onAddToPlaylist ? <ListMusic /> : <ListPlus />}</Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => actions.onDownload(media)} title={t("card.download")}><Download /></Button>
        <MoreMenu media={media} {...actions} />
      </div>
    </div>
  );
}

/** Pochette du coverflow : charge sa méta à la demande et remonte l'URL de la pochette au bandeau (fond flouté) sans la redemander. */
function CoverFlowCard({ media, offset, onSelect, onPlay, onJacket }: { media: ServerMedia; offset: number; onSelect: () => void; onPlay: () => void; onJacket: (id: string, url: string) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const id = mediaId(media);
  const meta = useLazyMeta(ref, id);
  useEffect(() => { if (meta?.jacket) onJacket(id, meta.jacket); }, [meta, id, onJacket]);
  const abs = Math.abs(offset);
  const visible = abs <= 2;
  return (
    <div ref={ref} className="absolute left-1/2 top-1/2 size-40 transition-all duration-500 ease-out sm:size-44"
      style={{
        transform: `translate(-50%, -50%) translateX(${offset * 70}px) rotateY(${-Math.sign(offset) * Math.min(abs, 1) * 38}deg) scale(${1 - abs * 0.14})`,
        zIndex: 10 - abs, opacity: visible ? 1 - abs * 0.25 : 0, pointerEvents: visible ? "auto" : "none",
      }}>
      <button type="button" tabIndex={visible ? 0 : -1} onClick={offset === 0 ? onPlay : onSelect} aria-label={offset === 0 ? t("card.play") : media.title}
        className="group/cf relative block size-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10">
        <Jacket meta={meta} className="size-full" iconClass="size-14" />
        {offset === 0 && <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition-all group-hover/cf:bg-black/35 group-hover/cf:opacity-100"><Play className="size-10 fill-current" /></span>}
      </button>
    </div>
  );
}

const HERO_INTERVAL = 6000;

/**
 * Bandeau « à la une » coupé en deux : à gauche le média courant, à droite un coverflow des dernières nouveautés.
 * Défilement manuel (flèches, clic sur une pochette, points) ET automatique ; l'automatique s'arrête au survol/focus
 * et si l'utilisateur préfère moins d'animations.
 */
export function HomeHero({ items, onPlay, onQueue, onDetails, onRefresh }: { items: ServerMedia[]; onRefresh?: () => void } & Pick<CardActions, "onPlay" | "onQueue" | "onDetails">) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [jackets, setJackets] = useState<Record<string, string>>({});
  const n = items.length;
  const current = items[Math.min(index, n - 1)];

  const onJacket = useCallback((id: string, url: string) => setJackets((j) => (j[id] === url ? j : { ...j, [id]: url })), []);
  const go = useCallback((dir: 1 | -1) => setIndex((i) => (i + dir + n) % n), [n]);

  useEffect(() => {
    if (n < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => go(1), HERO_INTERVAL);
    return () => clearInterval(timer);
  }, [n, paused, go, index]);

  if (!current) return null;
  const bg = jackets[mediaId(current)];
  const arrow = "absolute top-1/2 z-20 size-9 -translate-y-1/2 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60";

  return (
    // IMPORTANT : `isolate` crée un contexte d'empilement propre au bandeau ; sans lui, les z-10/z-20 internes (coverflow, flèches, actualiser) passent au-dessus de la barre de recherche collante quand on défile.
    <section className="relative isolate overflow-hidden rounded-2xl bg-muted/40" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {/* IMPORTANT : image décorative floutée, hors accessibilité ; le voile garde le texte lisible quelle que soit la pochette. */}
      {bg && <img src={bg} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-35 blur-3xl transition-opacity duration-700" />}
      <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/40 to-transparent" />
      <div className="relative grid items-center gap-4 p-6 sm:p-8 md:grid-cols-2">
        <div className="min-w-0 space-y-3 text-center md:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary"><Sparkles className="size-3.5" /> {t("home.featured")}</span>
          <h2 className="line-clamp-2 text-3xl font-bold tracking-tight" title={current.title}>{current.title}</h2>
          <p className="truncate text-muted-foreground">{[current.artist, formatTime(parseDuration(current.duration))].filter(Boolean).join(" · ")}</p>
          <div className="flex flex-wrap justify-center gap-2 md:justify-start">
            <Button className="rounded-full" onClick={() => onPlay(current)}><Play className="fill-current" /> {t("card.play")}</Button>
            <Button variant="secondary" className="rounded-full" onClick={() => onQueue(current)}><ListPlus /> {t("card.queue")}</Button>
            <Button variant="ghost" className="rounded-full" onClick={() => onDetails(current)}><Info /> {t("card.details")}</Button>
          </div>
        </div>

        <div className="relative mx-auto h-56 w-full max-w-md [perspective:900px]">
          {items.map((m, i) => {
            const d = (((i - index) % n) + n) % n;
            return <CoverFlowCard key={mediaId(m)} media={m} offset={d > n / 2 ? d - n : d} onSelect={() => setIndex(i)} onPlay={() => onPlay(m)} onJacket={onJacket} />;
          })}
          {n > 1 && (
            <>
              <Button size="icon" variant="ghost" className={cn(arrow, "left-0")} onClick={() => go(-1)} aria-label="←"><ChevronLeft /></Button>
              <Button size="icon" variant="ghost" className={cn(arrow, "right-0")} onClick={() => go(1)} aria-label="→"><ChevronRight /></Button>
              <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center gap-1.5">
                {items.map((m, i) => <button key={mediaId(m)} type="button" onClick={() => setIndex(i)} aria-label={m.title} aria-current={i === index} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-1.5 bg-foreground/30 hover:bg-foreground/50")} />)}
              </div>
            </>
          )}
        </div>
      </div>
      {onRefresh && <Button size="icon" variant="ghost" className="absolute right-3 top-3 z-20 size-8 rounded-full" onClick={onRefresh} title={t("on.refresh")} aria-label={t("on.refresh")}><RefreshCw /></Button>}
    </section>
  );
}

/** Rangée horizontale de grandes pochettes avec flèches (visibles au survol de la rangée). */
export function MediaCarousel({ items, currentRemoteId, refreshToken = 0, ...actions }: CardActions & { items: ServerMedia[]; currentRemoteId?: string; refreshToken?: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => viewport.current?.scrollBy({ left: dir * viewport.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = "absolute top-[38%] z-10 size-9 -translate-y-1/2 rounded-full opacity-0 shadow-lg transition-opacity group-hover/car:opacity-100 focus-visible:opacity-100";
  return (
    <div className="group/car relative">
      {/* IMPORTANT : gouttières latérales (px-12) réservées aux flèches, pour qu'elles ne recouvrent ni la première ni la dernière carte. */}
      <ScrollArea className="mx-12 w-auto" viewportRef={viewport}>
        <div className="flex w-max gap-3 pb-4">
          {items.map((m) => <div key={`${mediaId(m)}:${refreshToken}`} className="w-44 shrink-0"><MediaCardOnline media={m} active={currentRemoteId === mediaId(m)} {...actions} /></div>)}
        </div>
      </ScrollArea>
      <Button size="icon" variant="secondary" className={cn(arrow, "left-0")} onClick={() => scroll(-1)} aria-label="←"><ChevronLeft /></Button>
      <Button size="icon" variant="secondary" className={cn(arrow, "right-0")} onClick={() => scroll(1)} aria-label="→"><ChevronRight /></Button>
    </div>
  );
}

type GridProps = CardActions & { items: ServerMedia[]; currentRemoteId?: string; className?: string; refreshToken?: number; view?: MediaView; /** Numérote les lignes (vue liste). */ numbered?: boolean };

/** Liste de médias dans la présentation choisie. `refreshToken` force le rechargement des pochettes après une édition. */
export function MediaGrid({ items, currentRemoteId, className, refreshToken = 0, view = "cards", numbered = false, ...actions }: GridProps) {
  const key = (m: ServerMedia) => `${mediaId(m)}:${refreshToken}`;
  if (view === "rows") {
    return <div className={cn("space-y-0.5", className)}>{items.map((m, i) => <MediaRowOnline key={key(m)} media={m} index={numbered ? i + 1 : undefined} active={currentRemoteId === mediaId(m)} {...actions} />)}</div>;
  }
  if (view === "shelves") {
    // Étagère : une seule rangée qui défile horizontalement ; la hauteur est celle des cartes, pas du conteneur.
    return (
      <ScrollArea className={cn("w-full", className)}>
        <div className="flex w-max gap-4 pb-4">
          {items.map((m) => <div key={key(m)} className="w-40 shrink-0"><MediaCardOnline media={m} active={currentRemoteId === mediaId(m)} {...actions} /></div>)}
        </div>
      </ScrollArea>
    );
  }
  return (
    <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6", className)}>
      {items.map((m) => <MediaCardOnline key={key(m)} media={m} active={currentRemoteId === mediaId(m)} {...actions} />)}
    </div>
  );
}
