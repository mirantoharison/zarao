import { useState } from "react";
import { Loader2, Maximize2, Moon, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";
import { SpectrumBand } from "@/components/SpectrumBand";
import { UpNextCarousel } from "@/components/UpNextCarousel";
import { formatTime, spectrumSourceOf } from "@/lib/media";
import { cn } from "@/lib/utils";

type Props = { p: ReturnType<typeof usePlayer>; onExit: () => void };

/** Bouton d'option actif (aléatoire, répétition) : même teinte que la barre de lecture principale. */
const ACTIVE = "bg-primary/20 text-primary ring-1 ring-primary/50 hover:bg-primary/25 hover:text-primary";

/**
 * Mini-lecteur : l'essentiel d'un coup d'œil dans une petite fenêtre toujours au premier plan.
 *  - en haut : pochette, titre, artiste · année, rang dans la liste ;
 *  - au milieu : aléatoire, précédent / lecture / suivant, répétition, et le volume ;
 *  - en bas : progression (durée totale ou temps restant au clic), puis la piste « à suivre », la vitesse et la minuterie si actives.
 * IMPORTANT : posé PAR-DESSUS l'interface normale, qui reste montée dessous. L'élément média du lecteur ne doit jamais être démonté
 * (cf. VideoStage) : le retirer couperait la lecture. `data-tauri-drag-region` : on déplace la fenêtre en saisissant l'en-tête.
 */
export function MiniPlayer({ p, onExit }: Props) {
  const { t } = useI18n();
  const [showRemaining, setShowRemaining] = useState(false);
  const cur = p.current;
  const index = p.items.findIndex((i) => i.id === cur?.id);
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-background">
      {/* Fond « verre » : la pochette agrandie et floutée, voilée par la couleur du thème (même esprit que le fond ambiant et les menus).
          Sans pochette, un dégradé de la couleur d'accent. `scale` : le flou fait pâlir les bords, on les rogne. */}
      <div aria-hidden className="absolute inset-0 scale-125 bg-cover bg-center blur-2xl saturate-150 transition-[background-image] duration-500"
        style={cur?.jacket ? { backgroundImage: `url(${cur.jacket})` } : { backgroundImage: "linear-gradient(135deg, color-mix(in oklab, var(--primary) 45%, transparent), transparent 70%)" }} />
      <div aria-hidden className="absolute inset-0 bg-background/60 backdrop-blur-xl" />

      <div className="relative flex h-full flex-col justify-center gap-5 p-4">
      {/* En-tête : pochette et identité de la piste (zone de déplacement de la fenêtre) */}
      <div className="flex items-center gap-3" data-tauri-drag-region>
        {/* Pochette par défaut quand le média n'en a pas : le logo, comme sur la grande pochette du lecteur. */}
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted bg-cover bg-center shadow-md" style={cur?.jacket ? { backgroundImage: `url(${cur.jacket})` } : undefined} data-tauri-drag-region>
          {!cur?.jacket && <img src="/zarao-logo.png" alt="" draggable={false} className="size-4/5 object-contain opacity-80" />}
        </div>
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <p className="truncate text-sm font-semibold" title={cur?.title} data-tauri-drag-region>{cur?.title ?? t("mini.nothing")}</p>
          {cur && <p className="truncate text-xs text-muted-foreground" data-tauri-drag-region>{[cur.artist, cur.year].filter(Boolean).join(" · ") || t("player.unknownArtist")}</p>}
          {cur && index >= 0 && <p className="text-[0.7rem] tabular-nums text-muted-foreground/80" data-tauri-drag-region>{t("player.track", { n: index + 1, t: p.items.length })}</p>}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onExit} aria-label={t("mini.back")} title={t("mini.back")}><Maximize2 /></Button>
      </div>

      {/* Séparateur entre l'identité de la piste et les commandes : de bord à bord de la fenêtre (les marges négatives annulent le padding). */}
      <div aria-hidden className="-mx-4 h-px bg-foreground/15" />

      {/* Commandes et volume */}
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" className={cn(p.shuffle && ACTIVE)} onClick={p.toggleShuffle} aria-pressed={p.shuffle} title={t("ctl.shuffle")}><Shuffle /></Button>
        <Button size="icon" variant="ghost" onClick={p.previous} title={t("ctl.previous")}><SkipBack /></Button>
        <Button size="icon" className="size-10 rounded-full bg-foreground text-background hover:bg-foreground/90" onClick={p.togglePlay} title={p.playing ? t("ctl.pause") : t("ctl.play")} aria-busy={p.loading}>
          {p.loading && cur ? <Loader2 className="animate-spin" /> : p.playing ? <Pause /> : <Play />}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => p.next()} title={t("ctl.next")}><SkipForward /></Button>
        <Button size="icon-sm" variant="ghost" className={cn(p.repeat !== "off" && ACTIVE)} onClick={p.cycleRepeat} title={t("ctl.repeat")}><RepeatIcon /></Button>
        {/* Bande spectrale entre les commandes et le volume : prend toute la place restante */}
        <SpectrumBand className="mx-2 h-8 flex-1" mediaRef={p.mediaRef} playing={p.playing} path={spectrumSourceOf(cur ?? null)} />
        <div className="flex w-28 shrink-0 items-center gap-1.5">
          <Button size="icon-sm" variant="ghost" onClick={p.toggleMute} title={t("ctl.mute")} aria-pressed={p.muted}>{p.muted || p.volume === 0 ? <VolumeX /> : <Volume2 />}</Button>
          <Slider className="flex-1" min={0} max={1} step={0.01} value={[p.muted ? 0 : p.volume]} onValueChange={([v]) => p.setVolume(v)} aria-label={t("ctl.mute")} />
        </div>
      </div>

      {/* Progression : temps écoulé, barre, durée totale ou temps restant (clic) */}
      <div className="flex items-center gap-2">
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{formatTime(p.time)}</span>
        <Slider className="flex-1" min={0} max={p.duration || 1} step={0.1} value={[Math.min(p.time, p.duration || 1)]} disabled={!cur} onValueChange={([v]) => p.seek(v)} />
        <button type="button" className="w-11 text-left text-xs tabular-nums text-muted-foreground hover:text-foreground" title={t("ctl.remainingToggle")} onClick={() => setShowRemaining((r) => !r)}>
          {showRemaining ? `-${formatTime(Math.max(0, p.duration - p.time))}` : formatTime(p.duration)}
        </button>
      </div>

      {/* Pied : carrousel des pistes suivantes, et ce qui modifie la lecture (vitesse, minuterie) */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <UpNextCarousel p={p} className="min-w-0 flex-1" />
        {p.rate !== 1 && <span className="shrink-0 tabular-nums" title={t("ctl.speed")}>{p.rate}×</span>}
        {p.sleepLeft > 0 && <span className="flex shrink-0 items-center gap-1 tabular-nums" title={t("ctl.sleepTitle")}><Moon className="size-3" />{formatTime(p.sleepLeft)}</span>}
      </div>
      </div>
    </div>
  );
}
