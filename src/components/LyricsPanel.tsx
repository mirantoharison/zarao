import { useEffect, useMemo, useRef } from "react";
import { MicVocal, Pencil, X } from "lucide-react";
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
  onClose?: () => void;
  /** "dark" : sur fond sombre translucide (plein écran) ; "panel" : thème de l'app. */
  variant?: "panel" | "dark";
  className?: string;
};

/** Pause du défilement automatique après une action manuelle de l'utilisateur (molette, glissement). */
const MANUAL_SCROLL_PAUSE_MS = 3500;

/** Paroles : défilement synchronisé avec la musique si elles sont horodatées (LRC), texte lisible sinon. */
export function LyricsPanel({ lyrics, loading, hasTrack, time, onSeek, onEdit, onClose, variant = "panel", className }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastManual = useRef(0);
  const dark = variant === "dark";
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
      <div className={cn("flex h-11 shrink-0 items-center gap-2 border-b px-3", dark && "border-white/10")}>
        <MicVocal className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="flex-1 truncate text-sm font-medium">{t("lyr.title")}</h3>
        {lyrics && <span className={cn("rounded border px-1.5 text-[0.7rem]", dark ? "border-white/20 text-white/70" : "text-muted-foreground")}>{lyrics.synced ? t("lyr.synced") : t("lyr.plain")}</span>}
        {onEdit && hasTrack && <Button size="icon" variant="ghost" className={cn("size-7", dark && "text-white hover:bg-white/15 hover:text-white")} onClick={onEdit} title={lyrics ? t("lyr.edit") : t("lyr.add")}><Pencil /></Button>}
        {onClose && <Button size="icon" variant="ghost" className={cn("size-7", dark && "text-white hover:bg-white/15 hover:text-white")} onClick={onClose} title={t("search.close")}><X /></Button>}
      </div>

      {/* IMPORTANT : hauteur imposée par un conteneur absolu ; sans ça le ScrollArea prend la hauteur de son contenu et ne défile jamais. */}
      <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0">
      <ScrollArea className="size-full" viewportRef={scrollRef} viewportProps={{ onWheel: markManual, onTouchMove: markManual, onPointerDown: markManual }}>
        <div className="px-4 py-5">
        {loading && <p className="text-sm text-muted-foreground">{t("on.loading")}</p>}

        {!loading && !lyrics && (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
            <MicVocal className={cn("size-10", dark ? "text-white/30" : "text-muted-foreground/50")} />
            <p className={cn("text-sm", dark ? "text-white/60" : "text-muted-foreground")}>{hasTrack ? t("lyr.none") : t("lyr.noTrack")}</p>
            {onEdit && hasTrack && <Button size="sm" variant={dark ? "secondary" : "outline"} onClick={onEdit}>{t("lyr.add")}</Button>}
          </div>
        )}

        {lyrics && lyrics.synced && (
          <ol className="space-y-3 text-center">
            {lyrics.lines.map((line, i) => {
              const isActive = i === active;
              const seekable = onSeek && line.time !== null;
              return (
                <li
                  key={i}
                  data-line={i}
                  title={seekable ? t("lyr.clickSeek") : undefined}
                  onClick={seekable ? () => onSeek(line.time as number) : undefined}
                  className={cn(
                    "whitespace-pre-wrap text-base transition-all duration-300",
                    seekable && "cursor-pointer hover:opacity-100",
                    isActive ? "scale-105 font-semibold opacity-100" : i < active ? "opacity-40" : "opacity-60",
                    !line.text && "min-h-4",
                  )}
                >
                  {line.text || " "}
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
