import { useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, Clock, MicVocal, Pencil, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { activeLine, structureLyrics, type Lyrics } from "@/lib/lyrics";
import { cn } from "@/lib/utils";

type Props = {
  lyrics: Lyrics | null;
  loading: boolean;
  /** Une piste est-elle chargée ? Sans piste, on invite à lancer une lecture plutôt qu'à "ajouter des paroles". */
  hasTrack: boolean;
  /** Position de lecture (secondes) pour la mise en évidence de la ligne active. */
  time: number;
  /** Clic sur une ligne synchronisée : aller à cet instant. */
  onSeek?: (seconds: number) => void;
  onEdit?: () => void;
  /** Recherche manuelle des paroles en ligne (LRCLIB) ; renvoie false si rien n'a été trouvé. */
  onSearchOnline?: () => Promise<boolean>;
  /** Origine des paroles à afficher (récupérées en ligne à l'instant). */
  source?: "lrclib" | null;
  onClose?: () => void;
  /** "dark" : sur fond sombre translucide (plein écran) ; "panel" : thème de l'app. */
  variant?: "panel" | "dark";
  className?: string;
  /** Hauteur (px) imposée à la barre de titre, pour l'aligner sur une barre voisine mesurée ; 44 px par défaut. */
  headerHeight?: number;
};

/** Écart (s) à partir duquel une ligne chantée est suivie d'un interlude (points). */
const INTERLUDE_AFTER_TEXT = 8;
/** Une ligne vide (pause voulue par l'auteur du LRC) devient un interlude dès cet écart (s). */
const INTERLUDE_AFTER_BLANK = 3;
/** Durée (s) supposée d'une ligne chantée : l'interlude ne démarre qu'après, sinon les points apparaîtraient pendant le chant. */
const SUNG_LINE_SECONDS = 4;
/** Largeurs (%) des fausses lignes du chargement : irrégulières pour imiter du texte, plus marquées au centre. */
const SKELETON_WIDTHS = [55, 72, 85, 64, 48];
/** Fondu haut/bas : les lignes en bordure disparaissent au lieu d'être coupées net. */
const FADE_MASK = "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)";

/** Trois points qui se remplissent jusqu'à la reprise du chant ; atténués tant que l'interlude n'est pas en cours. */
function Interlude({ progress, live }: { progress: number; live: boolean }) {
  return (
    <div className={cn("flex items-center justify-center gap-1.5 py-1.5 transition-opacity duration-300", live ? "opacity-100" : "opacity-25")} aria-hidden>
      {[0, 1, 2].map((k) => (
        <span key={k} className={cn("size-1.5 rounded-full bg-current transition-all duration-500", live && progress > k / 3 ? "scale-125 opacity-100" : "scale-100 opacity-30")} />
      ))}
    </div>
  );
}

/** Pause du défilement automatique après une action manuelle de l'utilisateur (molette, glissement). */
const MANUAL_SCROLL_PAUSE_MS = 3500;

/** Paroles : défilement synchronisé avec la musique si elles sont horodatées (LRC), texte lisible sinon. */
export function LyricsPanel({ lyrics, loading, hasTrack, time, onSeek, onEdit, onSearchOnline, source, onClose, variant = "panel", className, headerHeight }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastManual = useRef(0);
  const dark = variant === "dark";
  const [notFound, setNotFound] = useState(false);
  // Une nouvelle piste efface le constat « introuvable » de la précédente.
  useEffect(() => setNotFound(false), [hasTrack, lyrics]);
  const active = lyrics ? activeLine(lyrics, time) : -1;
  // Texte non synchronisé : structuré en sections (couplet, refrain…) plutôt qu'affiché tel quel avec sa syntaxe markdown.
  const sections = useMemo(() => (lyrics && !lyrics.synced ? structureLyrics(lyrics.lines) : []), [lyrics]);

  // La ligne active reste centrée, sauf si l'utilisateur est en train de lire ailleurs.
  useEffect(() => {
    if (active < 0 || Date.now() - lastManual.current < MANUAL_SCROLL_PAUSE_MS) return;
    scrollRef.current?.querySelector(`[data-line="${active}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  const markManual = () => { lastManual.current = Date.now(); };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div style={headerHeight ? { height: headerHeight } : undefined} className={cn("flex shrink-0 items-center gap-2 border-b px-3", !headerHeight && "h-11", dark && "border-white/10")}>
        <MicVocal className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="flex-1 truncate text-sm font-medium">{t("lyr.title")}</h3>
        {lyrics && source && <span className={cn("text-[0.7rem]", dark ? "text-white/50" : "text-muted-foreground")} title={t("lyr.source", { s: "LRCLIB" })}>LRCLIB</span>}
        {lyrics && (lyrics.synced ? <Clock className="size-4 shrink-0 text-muted-foreground" aria-label={t("lyr.synced")} /> : <AlignLeft className="size-4 shrink-0 text-muted-foreground" aria-label={t("lyr.plain")} />)}
        {onEdit && hasTrack && <Button size="icon" variant="ghost" className={cn("size-7", dark && "text-white hover:bg-white/15 hover:text-white")} onClick={onEdit} title={lyrics ? t("lyr.edit") : t("lyr.add")}><Pencil /></Button>}
        {onClose && <Button size="icon" variant="ghost" className={cn("size-7", dark && "text-white hover:bg-white/15 hover:text-white")} onClick={onClose} title={t("search.close")}><X /></Button>}
      </div>

      {/* IMPORTANT : hauteur imposée par un conteneur absolu ; sans ça le ScrollArea prend la hauteur de son contenu et ne défile jamais. */}
      <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0" style={lyrics?.synced ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK } : undefined}>
      <ScrollArea className="size-full" viewportRef={scrollRef} viewportProps={{ onWheel: markManual, onTouchMove: markManual, onPointerDown: markManual }}>
        <div className={cn("px-4", lyrics?.synced ? "py-16" : "py-4")}>
        {loading && (
          <div className="flex min-h-64 flex-col items-center justify-center gap-6" role="status" aria-live="polite">
            <MicVocal className={cn("size-8 animate-pulse", dark ? "text-white/40" : "text-muted-foreground/60")} />
            {/* Fausses lignes de paroles : laissent deviner la mise en page finale plutôt qu'un simple texte. */}
            <div className="flex w-full flex-col items-center gap-3" aria-hidden>
              {SKELETON_WIDTHS.map((w, i) => (
                <span key={i} className={cn("h-3 animate-pulse rounded-full", dark ? "bg-white/15" : "bg-muted-foreground/15")} style={{ width: `${w}%`, animationDelay: `${i * 150}ms`, opacity: 1 - Math.abs(i - 2) * 0.22 }} />
              ))}
            </div>
            <p className={cn("text-xs", dark ? "text-white/50" : "text-muted-foreground")}>{t("lyr.loading")}</p>
          </div>
        )}

        {!loading && !lyrics && (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
            <MicVocal className={cn("size-10", dark ? "text-white/30" : "text-muted-foreground/50")} />
            <p className={cn("text-sm", dark ? "text-white/60" : "text-muted-foreground")}>{hasTrack ? t("lyr.none") : t("lyr.noTrack")}</p>
            {notFound && <p className={cn("text-xs", dark ? "text-white/50" : "text-muted-foreground")}>{t("lyr.notFound")}</p>}
            <div className="flex flex-wrap justify-center gap-2">
              {onSearchOnline && hasTrack && <Button size="sm" variant={dark ? "secondary" : "default"} onClick={() => void onSearchOnline().then((ok) => setNotFound(!ok))}><Search /> {t("lyr.search")}</Button>}
              {onEdit && hasTrack && <Button size="sm" variant={dark ? "secondary" : "outline"} onClick={onEdit}>{t("lyr.add")}</Button>}
            </div>
          </div>
        )}

        {lyrics && lyrics.synced && (
          <ol className="space-y-0.5 text-center">
            {lyrics.lines.map((line, i) => {
              const isActive = i === active;
              const seekable = onSeek && line.time !== null;
              // Distance à la ligne chantée : l'opacité décroît avec elle (avant le premier horodatage, tout est « à venir »).
              const dist = Math.abs(active < 0 ? i + 1 : i - active);
              // Interlude : écart avec la ligne suivante assez long pour être une vraie pause musicale.
              const nextTime = lyrics.lines[i + 1]?.time ?? null;
              const blank = !line.text;
              const start = (line.time ?? 0) + (blank ? 0 : SUNG_LINE_SECONDS);
              const gap = nextTime === null || line.time === null ? 0 : nextTime - line.time;
              const hasInterlude = gap >= (blank ? INTERLUDE_AFTER_BLANK : INTERLUDE_AFTER_TEXT);
              const live = isActive && nextTime !== null && time >= start;
              const progress = live && nextTime !== null ? Math.min(1, Math.max(0, (time - start) / Math.max(0.1, nextTime - start))) : 0;
              return (
                <li
                  key={i}
                  data-line={i}
                  title={seekable && !blank ? t("lyr.clickSeek") : undefined}
                  onClick={seekable ? () => onSeek(line.time as number) : undefined}
                  className={cn(
                    "whitespace-pre-wrap py-0.5 leading-snug transition-all duration-300",
                    seekable && "cursor-pointer hover:opacity-100 hover:blur-none",
                    isActive ? "text-[1.15rem] font-semibold opacity-100" : "text-[0.9rem]",
                    !isActive && (dist === 1 ? "opacity-60" : dist === 2 ? "opacity-40" : "opacity-25"),
                    !isActive && dist >= 3 && "blur-[0.5px]",
                    blank && !hasInterlude && "min-h-2",
                  )}
                >
                  {blank ? (hasInterlude ? <Interlude progress={progress} live={live} /> : " ") : line.text}
                  {!blank && hasInterlude && <Interlude progress={progress} live={live} />}
                </li>
              );
            })}
          </ol>
        )}

        {lyrics && !lyrics.synced && (
          <div className="space-y-7">
            {sections.map((sec, si) => (
              <section key={si} className="space-y-2.5">
                {sec.title && (
                  <div className="flex items-center gap-3">
                    <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium uppercase tracking-wider", dark ? "border-white/20 text-white/70" : "bg-muted text-muted-foreground")}>{sec.title}</span>
                    <span className={cn("h-px flex-1", dark ? "bg-white/15" : "bg-border")} />
                  </div>
                )}
                <div className={cn("space-y-1 border-l-2 pl-4", dark ? "border-white/20" : "border-border")}>
                  {sec.blocks.map((b, bi) =>
                    b.kind === "gap" ? <div key={bi} className="h-3" /> :
                    b.kind === "note" ? <p key={bi} className={cn("text-xs italic", dark ? "text-white/50" : "text-muted-foreground")}>{b.text}</p> :
                    <p key={bi} className="text-[0.9rem] leading-relaxed">{b.text}</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        </div>
      </ScrollArea>
      </div>
      </div>
    </div>
  );
}
