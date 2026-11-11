import { useMemo, useState } from "react";
import { MessageSquare, ThumbsDown, ThumbsUp, MicVocal, Copy, FastForward, FolderSearch, Gauge, Heart, Keyboard, Maximize, Moon, Music, Pause, PictureInPicture2, Play, Repeat, Repeat1, Rewind, Shuffle, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from "lucide-react";
import { RainbowRing } from "@/components/RainbowRing";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { usePlayer } from "@/hooks/usePlayer";
import type { Reaction, Social } from "@/lib/api";
import { useI18n } from "@/i18n";
import { formatSize, formatTime, spectrumSourceOf } from "@/lib/media";
import { cn } from "@/lib/utils";

/** Pas des boutons reculer/avancer (10 s comme l'ancienne version). */
export const SEEK_STEP = 10;

type Props = {
  p: ReturnType<typeof usePlayer>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  /** Absent en mode en ligne : un média distant n'a pas de dossier à afficher. */
  onReveal?: () => void;
  onCopy: () => void;
  onShowShortcuts: () => void;
  /** Ouvre le plein écran avec visualiseur (audio). Les vidéos passent par le plein écran natif. */
  onOpenVisualizer: () => void;
  lyricsOpen: boolean;
  /** Mode en ligne seulement : j'aime / je n'aime pas du média en cours et accès aux commentaires. */
  social?: { data: Social | null; onReact: (kind: Reaction) => void; onOpenComments: () => void };
  onToggleLyrics: () => void;
};

/**
 * Barre de lecture partagée entre le lecteur local et la bibliothèque en ligne :
 * infos de la piste, boutons de contrôle, progression, boucle A–B, minuterie, vitesse, volume.
 */
export function PlayerBar({ p, isFavorite, onToggleFavorite, onReveal, onCopy, onShowShortcuts, onOpenVisualizer, lyricsOpen, onToggleLyrics, social }: Props) {
  const { t } = useI18n();
  const [showRemaining, setShowRemaining] = useState(false);
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;
  const isVideo = p.current?.kind === "video";
  const currentIndex = p.items.findIndex((i) => i.id === p.current?.id);
  // "À suivre" ne prédit pas le mode aléatoire : on l'indique plutôt qu'afficher une valeur fausse.
  const upNext = p.shuffle ? null : (currentIndex >= 0 ? p.items[currentIndex + 1] : p.items[0]) ?? (p.repeat === "all" ? p.items[0] : undefined);
  // Durée restante de la playlist : fin de la piste courante + toutes les suivantes.
  const remaining = useMemo(() => {
    if (currentIndex < 0) return 0;
    return Math.max(0, p.duration - p.time) + p.items.slice(currentIndex + 1).reduce((s, i) => s + i.duration, 0);
  }, [p.items, currentIndex, p.duration, p.time]);
  const fullscreen = () => void p.mediaRef.current?.requestFullscreen?.();
  // Spectre : chemin disque en local, URL du média en ligne (cf. spectrum.ts).
  const spectrumSource = spectrumSourceOf(p.current);

  return (
    <footer className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 border-t px-8 pb-6 pt-1">
      {/* Gauche : lecture en cours */}
      <div className="flex min-w-0 items-center gap-3">
        {p.current?.jacket ? <img src={p.current.jacket} alt="" className="size-32 shrink-0 rounded-md object-cover" /> : <div className="grid size-32 shrink-0 place-items-center rounded-md bg-muted"><Music className="size-12 text-muted-foreground" /></div>}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={p.current?.title}>{p.current?.title ?? t("player.none")}</p>
          <p className="truncate text-xs text-muted-foreground">{p.current?.artist || (p.current ? t("player.unknownArtist") : "")}</p>
          {p.current && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.7rem] text-muted-foreground">
              <span className="rounded border px-1 uppercase">{p.current.ext}</span>
              <span className="rounded border px-1">{formatSize(p.current.size)}</span>
              {p.current.year && <span className="rounded border px-1">{p.current.year}</span>}
              <span className="rounded border px-1">{t("player.track", { n: currentIndex + 1, t: p.items.length })}</span>
            </div>
          )}
          {p.current && (
            <div className="mt-1 flex items-center gap-0.5">
              <Button size="icon" variant="ghost" className="size-7" onClick={onToggleFavorite} title={isFavorite ? t("fav.remove") : t("fav.add")}><Heart className={cn(isFavorite && "fill-current text-rose-400")} /></Button>
              {onReveal && <Button size="icon" variant="ghost" className="size-7" onClick={onReveal} title={t("player.reveal")}><FolderSearch /></Button>}
              <Button size="icon" variant="ghost" className="size-7" onClick={onCopy} title={t("player.copy")}><Copy /></Button>
              {social && (
                <>
                  <span className="mx-1 h-4 w-px bg-border" />
                  <Button size="sm" variant={social.data?.mine === "like" ? "secondary" : "ghost"} className="h-7 gap-1 px-1.5 text-xs" disabled={!social.data} onClick={() => social.onReact("like")} title={t("soc.like")} aria-pressed={social.data?.mine === "like"}>
                    <ThumbsUp className={cn(social.data?.mine === "like" && "fill-current")} /> {social.data?.like ?? 0}
                  </Button>
                  <Button size="sm" variant={social.data?.mine === "dislike" ? "secondary" : "ghost"} className="h-7 gap-1 px-1.5 text-xs" disabled={!social.data} onClick={() => social.onReact("dislike")} title={t("soc.dislike")} aria-pressed={social.data?.mine === "dislike"}>
                    <ThumbsDown className={cn(social.data?.mine === "dislike" && "fill-current")} /> {social.data?.dislike ?? 0}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs" onClick={social.onOpenComments} title={t("soc.openComments")}>
                    <MessageSquare /> {social.data?.comments ?? 0}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Centre : boutons puis progression */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1 py-9">
          <Button size="icon" className="size-11 [&_svg]:size-5" variant={p.shuffle ? "secondary" : "ghost"} onClick={p.toggleShuffle} title={t("ctl.shuffle")}><Shuffle /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={p.previous} title={t("ctl.previous")}><SkipBack /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={() => p.seek(Math.max(0, p.time - SEEK_STEP))} disabled={!p.current} title={t("ctl.rewind", { s: SEEK_STEP })}><Rewind /></Button>
          <div className="relative mx-7 grid place-items-center">
            <RainbowRing mediaRef={p.mediaRef} playing={p.playing} trackId={p.current?.id} path={spectrumSource} />
            <Button size="icon" className="relative z-10 size-14 rounded-full bg-white text-black hover:bg-white/90 [&_svg]:size-6" onClick={p.togglePlay} title={p.playing ? t("ctl.pause") : t("ctl.play")}>{p.playing ? <Pause /> : <Play />}</Button>
          </div>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={() => p.seek(Math.min(p.duration || 0, p.time + SEEK_STEP))} disabled={!p.current} title={t("ctl.forward", { s: SEEK_STEP })}><FastForward /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={() => p.next()} title={t("ctl.next")}><SkipForward /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={p.stop} title={t("ctl.stop")}><Square /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant={p.repeat === "off" ? "ghost" : "secondary"} onClick={p.cycleRepeat} title={t("ctl.repeat")}><RepeatIcon /></Button>
        </div>
        <div className="flex w-full items-center gap-2">
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{p.time > 0 ? formatTime(p.time) : "0:00"}</span>
          <Slider className="flex-1" min={0} max={p.duration || 1} step={0.1} value={[Math.min(p.time, p.duration || 1)]} disabled={!p.current} onValueChange={([v]) => p.seek(v)} />
          <button className="w-12 text-left text-xs tabular-nums text-muted-foreground hover:text-foreground" title={t("ctl.remainingToggle")} onClick={() => setShowRemaining((r) => !r)}>{showRemaining ? `-${formatTime(Math.max(0, p.duration - p.time))}` : formatTime(p.duration)}</button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Button size="sm" variant={p.loop.a !== null ? "secondary" : "ghost"} className="h-7 px-2" disabled={!p.current} onClick={p.setLoopA} title={t("ctl.loopA")}>A{p.loop.a !== null && ` ${formatTime(p.loop.a)}`}</Button>
          <Button size="sm" variant={p.loop.b !== null ? "secondary" : "ghost"} className="h-7 px-2" disabled={!p.current || p.loop.a === null} onClick={p.setLoopB} title={t("ctl.loopB")}>B{p.loop.b !== null && ` ${formatTime(p.loop.b)}`}</Button>
          {(p.loop.a !== null || p.loop.b !== null) && <Button size="icon" variant="ghost" className="size-7" onClick={p.clearLoop} title={t("ctl.loopClear")}><X /></Button>}
          <span className="mx-1 h-4 w-px bg-border" />
          <Button size="sm" variant={p.sleepMode === "off" ? "ghost" : "secondary"} className="h-7 px-2" onClick={p.cycleSleep} title={t("ctl.sleepTitle")}>
            <Moon /> {p.sleepMode === "off" ? t("ctl.sleep") : p.sleepMode === "track" ? t("ctl.sleepTrack") : formatTime(p.sleepLeft)}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={!isVideo} onClick={p.pictureInPicture} title={t("ctl.pip")}><PictureInPicture2 /> PiP</Button>
        </div>
      </div>

      {/* Droite : à suivre, vitesse, volume et plein écran */}
      <div className="flex min-w-0 flex-col items-end gap-1.5">
        <p className="max-w-full truncate text-xs text-muted-foreground" title={upNext?.title}>
          {upNext ? <>{t("ctl.upNext")}<span className="text-foreground">{upNext.title}</span></> : p.shuffle ? t("ctl.shufflePlay") : t("ctl.endOfList")}
          {p.current && <span> · {t("ctl.left", { d: formatTime(remaining) })}</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={p.rate === 1 ? "ghost" : "secondary"} className="h-9 min-w-12 px-2 tabular-nums" onClick={p.cycleRate} title={t("ctl.speed")}><Gauge /> {p.rate}×</Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={p.toggleMute} title={t("ctl.mute")}>{p.muted || p.volume === 0 ? <VolumeX /> : <Volume2 />}</Button>
          <Slider className="w-28" min={0} max={1} step={0.01} value={[p.muted ? 0 : p.volume]} onValueChange={([v]) => p.setVolume(v)} />
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{Math.round((p.muted ? 0 : p.volume) * 100)}%</span>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" disabled={!p.current} onClick={() => (isVideo ? fullscreen() : onOpenVisualizer())} title={t("fs.open")}><Maximize /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant={lyricsOpen ? "secondary" : "ghost"} onClick={onToggleLyrics} title={t("lyr.toggle")}><MicVocal /></Button>
          <Button size="icon" className="size-11 [&_svg]:size-5" variant="ghost" onClick={onShowShortcuts} title={t("ctl.shortcuts")}><Keyboard /></Button>
        </div>
      </div>
    </footer>
  );
}
