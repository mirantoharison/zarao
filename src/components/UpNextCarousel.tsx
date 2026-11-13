import { useEffect, useMemo, useRef } from "react";
import { ListEnd } from "lucide-react";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";
import type { MediaItem } from "@/lib/media";
import { cn } from "@/lib/utils";

type Props = { p: ReturnType<typeof usePlayer>; className?: string };

/** Nombre maximal de pistes montrées après celles de la file : un carrousel, pas la liste entière. */
const MAX_AFTER_QUEUE = 20;

/**
 * Petit carrousel des pistes suivantes : d'abord la file « à suivre » (marquée), puis la suite de la liste dans son ordre.
 * Un clic joue la piste ; la molette fait défiler à l'horizontale. Revient au début à chaque changement de piste.
 * En mode aléatoire la suite n'est pas connue : seule la file est montrée (sinon on afficherait un ordre faux).
 */
export function UpNextCarousel({ p, className }: Props) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const currentId = p.current?.id;

  const upcoming = useMemo(() => {
    const list = p.items;
    const queued = p.queue.map((id) => list.find((i) => i.id === id)).filter((i): i is MediaItem => i !== undefined);
    const queuedIds = new Set(queued.map((i) => i.id));
    let rest: MediaItem[] = [];
    if (!p.shuffle) {
      const idx = list.findIndex((i) => i.id === currentId);
      const after = idx >= 0 ? list.slice(idx + 1) : list;
      // « Répéter la liste » : après la dernière piste on repart du début.
      rest = p.repeat === "all" && idx >= 0 ? [...after, ...list.slice(0, idx)] : after;
    }
    return [
      ...queued.map((item) => ({ item, queued: true })),
      ...rest.filter((i) => !queuedIds.has(i.id)).slice(0, MAX_AFTER_QUEUE).map((item) => ({ item, queued: false })),
    ];
  }, [p.items, p.queue, p.shuffle, p.repeat, currentId]);

  // Nouvelle piste : le carrousel repart de la première piste suivante.
  useEffect(() => { trackRef.current?.scrollTo({ left: 0 }); }, [currentId]);

  if (upcoming.length === 0) {
    return <p className={cn("truncate text-xs text-muted-foreground", className)}>{p.shuffle ? t("ctl.shufflePlay") : p.current ? t("ctl.endOfList") : ""}</p>;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="shrink-0 text-[0.65rem] tracking-wider text-muted-foreground/80 uppercase">{t("q.tabNext")}</span>
      <div ref={trackRef} onWheel={(e) => { if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}
        className="flex min-w-0 flex-1 snap-x snap-proximity gap-1.5 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]">
        {upcoming.map(({ item, queued }) => (
          <button key={item.id} type="button" onClick={() => p.play(item.id)} title={`${item.title}${item.artist ? ` — ${item.artist}` : ""}`}
            className={cn("group flex w-36 shrink-0 snap-start items-center gap-1.5 rounded-lg bg-foreground/10 py-1 pr-2 pl-1 text-left transition-colors outline-none hover:bg-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50", queued && "ring-1 ring-primary/50")}>
            <span className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-muted bg-cover bg-center" style={item.jacket ? { backgroundImage: `url(${item.jacket})` } : undefined}>
              {!item.jacket && <img src="/zarao-logo.png" alt="" draggable={false} className="size-4/5 object-contain opacity-80" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.7rem] leading-tight font-medium text-foreground">{item.title}</span>
              <span className="flex items-center gap-1 truncate text-[0.62rem] leading-tight text-muted-foreground">
                {queued && <ListEnd className="size-2.5 shrink-0 text-primary" />}
                <span className="truncate">{item.artist || "—"}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
