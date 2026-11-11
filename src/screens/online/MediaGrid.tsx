import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, Film, Info, ListMusic, ListPlus, MoreVertical, Music, Pencil, Play, Trash2 } from "lucide-react";
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
    <div ref={ref} className="group relative min-w-0" onDoubleClick={() => onPlay(media)}>
      <div className={cn("relative aspect-square overflow-hidden rounded-xl bg-muted shadow-sm transition-shadow group-hover:shadow-lg", active && "ring-2 ring-primary")}>
        <Jacket meta={meta} className="size-full" iconClass="size-12" />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.7rem] tabular-nums text-white">{formatTime(parseDuration(media.duration))}</span>
        {meta && <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.7rem] text-white">{meta.isVideo ? "Video" : "Audio"}</span>}
        <div className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all focus-within:bg-black/30 focus-within:opacity-100 group-hover:bg-black/30 group-hover:opacity-100">
          <Button size="icon" className="size-12 rounded-full bg-white text-black hover:bg-white/90 [&_svg]:size-6" onClick={() => onPlay(media)} title={t("card.play")}><Play /></Button>
        </div>
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <MoreMenu media={media} {...actions} triggerClass="bg-background/80" />
        </div>
      </div>
      <h3 className="mt-2 truncate text-sm font-medium" title={media.title}>{media.title}</h3>
      <p className="truncate text-xs text-muted-foreground">{media.artist || "---"}</p>
    </div>
  );
}

/** Ligne de la liste riche : miniature, titre, artiste et taille, durée, et actions directes (pas de menu à ouvrir pour les courantes). */
export function MediaRowOnline({ media, active, onPlay, ...actions }: ItemProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const meta = useLazyMeta(ref, mediaId(media));
  return (
    <div ref={ref} className={cn("group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/60", active && "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]")} onDoubleClick={() => onPlay(media)}>
      <button type="button" aria-label={t("card.play")} onClick={() => onPlay(media)} className="relative size-11 shrink-0 overflow-hidden rounded-md">
        <Jacket meta={meta} className="size-full" iconClass="size-5" />
        <span className={cn("absolute inset-0 grid place-items-center bg-black/45 text-white transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}><Play className="size-4" /></span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={media.title}>{media.title}</p>
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

type GridProps = CardActions & { items: ServerMedia[]; currentRemoteId?: string; className?: string; refreshToken?: number; view?: MediaView };

/** Liste de médias dans la présentation choisie. `refreshToken` force le rechargement des pochettes après une édition. */
export function MediaGrid({ items, currentRemoteId, className, refreshToken = 0, view = "cards", ...actions }: GridProps) {
  const key = (m: ServerMedia) => `${mediaId(m)}:${refreshToken}`;
  if (view === "rows") {
    return <div className={cn("space-y-0.5", className)}>{items.map((m) => <MediaRowOnline key={key(m)} media={m} active={currentRemoteId === mediaId(m)} {...actions} />)}</div>;
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
