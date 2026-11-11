import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, FastForward, Gauge, Info, ListMusic, MicVocal, Minimize, Moon, Music, Pause, Palette, PanelRight, Play, Repeat, Repeat1, Rewind, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { SEEK_STEP } from "@/components/PlayerBar";
import { LyricsPanel } from "@/components/LyricsPanel";
import { PlayingBars } from "@/components/PlayingBars";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { AudioVisualizer as Visualizer, type AudioVisualizerTheme as VisualizerTheme } from "@/components/AudioVisualizer";
import type { usePlayer } from "@/hooks/usePlayer";
import { activeLine, type Lyrics } from "@/lib/lyrics";
import { useI18n } from "@/i18n";
import { formatSize, formatTime, spectrumSourceOf } from "@/lib/media";
import { cn } from "@/lib/utils";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void; lyrics: Lyrics | null };

const THEME_KEY = "zarao.visualizer.theme.v2";
/** Délai sans mouvement de souris avant de masquer les contrôles (comme l'ancien plein écran). */
const HIDE_AFTER_MS = 3000;

const THEMES: VisualizerTheme[] = ["zarao", "classic", "rainbow"];
/** Thème par défaut : « zarao ». Une valeur mémorisée inconnue (ancienne version) y retombe aussi. */
function readTheme(): VisualizerTheme {
  try { const v = localStorage.getItem(THEME_KEY) as VisualizerTheme; return THEMES.includes(v) ? v : "zarao"; } catch { return "zarao"; }
}

/**
 * Plein écran audio avec visualiseur (équivalent de l'ancien mode "fullscreen" : titre, visualiseur,
 * barre de contrôles qui se masque, liste de lecture en volet). Les vidéos gardent le plein écran natif.
 */
export function FullscreenPlayer({ p, open, onClose, lyrics }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [controlsVisible, setControlsVisible] = useState(true);
  // Volet de droite exclusif : file de lecture ou détails du morceau.
  const [panel, setPanel] = useState<"queue" | "info" | null>(null);
  // Paroles : fermées par défaut, ouvertes au besoin depuis le rail latéral.
  const [showLyrics, setShowLyrics] = useState(false);
  // Mode épuré : masque tous les volets pour ne garder que le visualiseur.
  const [calm, setCalm] = useState(false);
  const [theme, setTheme] = useState<VisualizerTheme>(readTheme);
  const [analysis, setAnalysis] = useState(true);

  // IMPORTANT : ref lue par le minuteur (créé une fois) ; un état dans sa fermeture serait périmé.
  // Un volet ouvert (paroles, file, détails) est en cours de lecture/consultation : on ne masque pas les contrôles.
  const panelsOpenRef = useRef(false);
  panelsOpenRef.current = !calm && (showLyrics || panel !== null);

  const wake = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (!panelsOpenRef.current) setControlsVisible(false); }, HIDE_AFTER_MS);
  }, []);

  // À la fermeture du dernier volet, le compte à rebours repart ; à l'ouverture, les contrôles sont rappelés.
  const panelsOpen = !calm && (showLyrics || panel !== null);
  useEffect(() => { if (open) wake(); }, [panelsOpen, open, wake]);

  // Ouverture : plein écran du navigateur sur la couche (fermée avec Échap, ce qui déclenche fullscreenchange).
  useEffect(() => {
    if (!open) return;
    wake();
    const root = rootRef.current;
    // IMPORTANT : si le plein écran est refusé (webview, absence de geste utilisateur), la couche reste simplement affichée par-dessus l'app.
    void root?.requestFullscreen?.().catch(() => undefined);
    const onFs = () => { if (!document.fullscreenElement) closeRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(hideTimer.current);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [open, wake]);

  if (!open) return null;

  const cur = p.current;
  const active = lyrics ? activeLine(lyrics, p.time) : -1;
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;
  const source = spectrumSourceOf(cur);
  const toggleTheme = () => setTheme((v) => { const n = THEMES[(THEMES.indexOf(v) + 1) % THEMES.length]; try { localStorage.setItem(THEME_KEY, n); } catch { /* non bloquant */ } return n; });
  const icon = "size-11 [&_svg]:size-5 text-white hover:bg-white/15 hover:text-white";
  const fade = cn("transition-opacity duration-500", controlsVisible ? "opacity-100" : "pointer-events-none opacity-0");

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70] select-none overflow-hidden bg-neutral-950 text-white"
      style={{ cursor: controlsVisible ? "default" : "none" }}
      onMouseMove={wake}
      onClick={wake}
    >
      {/* Fond : la pochette floutée et assombrie, pour une ambiance cohérente avec le morceau */}
      {/* Sans pochette, le logo flouté donne l'ambiance orange de Zarao au fond. */}
      <img src={cur?.jacket ?? "/zarao-logo.png"} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/20 to-black/70" />

      <Visualizer className="absolute inset-0" mediaRef={p.mediaRef} playing={p.playing} source={source} jacket={cur?.jacket} theme={theme} onAnalysis={setAnalysis} />

      {/* Barre du haut : titre, thème, liste, sortie */}
      <header className={cn("absolute inset-x-0 top-0 flex items-start gap-4 p-5", fade)}>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-semibold drop-shadow">{cur?.title ?? t("player.none")}</h2>
          <p className="truncate text-base text-white/70">{cur?.artist || (cur ? t("player.unknownArtist") : "")}</p>
          {!analysis && cur && <p className="mt-1 text-sm text-amber-300/90">{t("fs.noAnalysis")}</p>}
        </div>
        <Button size="icon" variant="ghost" className={icon} onClick={onClose} title={t("fs.exit")}><Minimize /></Button>
      </header>

      {/* Paroles synchronisées : trois lignes (précédente, en cours, suivante), façon karaoké */}
      {showLyrics && lyrics?.synced && (
        <div className="pointer-events-none absolute inset-x-0 bottom-36 space-y-1 px-10 text-center drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          {[active - 1, active, active + 1].map((i, k) => {
            const text = i >= 0 && i < lyrics.lines.length ? lyrics.lines[i].text : "";
            return <p key={`${i}-${k}`} className={cn("min-h-8 truncate transition-all duration-300", k === 1 ? "text-3xl font-semibold" : "text-xl text-white/50")}>{text || "\u00A0"}</p>;
          })}
        </div>
      )}

      {/* Paroles en texte brut : volet à gauche */}
      {/* IMPORTANT : toujours monté (pas de rendu conditionnel) pour que la sortie s'anime aussi, pas seulement l'entrée. */}
      <div className={cn("absolute bottom-36 left-24 top-24 flex w-[30rem] flex-col overflow-hidden rounded-xl bg-white/10 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 ease-out", showLyrics && !calm && controlsVisible && (!lyrics || !lyrics.synced) ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-8 opacity-0")} aria-hidden={!showLyrics}>
        <LyricsPanel className="min-h-0 flex-1" lyrics={lyrics} loading={false} hasTrack={Boolean(cur)} time={p.time} onClose={() => setShowLyrics(false)} />
      </div>

      {/* Volet de liste de lecture */}
      {/* IMPORTANT : la position est portée par un div ordinaire ; le ScrollArea (size-full) ne reçoit aucune classe de position à fusionner. */}
      <div className={cn("absolute bottom-36 right-5 top-24 w-[26rem] overflow-hidden rounded-xl bg-white/10 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300", panel === "queue" && !calm && controlsVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0")}>
        <ScrollArea className="size-full" viewportProps={{ className: "[&>div]:!block" }}>
        <div className="p-2">
        {p.items.length === 0 && <p className="p-3 text-sm text-white/60">{t("empty.title")}</p>}
        {p.items.map((i, n) => (
          <button key={i.id} className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/10", p.current?.id === i.id && "bg-white/15")} onClick={() => p.play(i.id)}>
            <span className="grid w-6 shrink-0 place-items-center text-xs tabular-nums text-white/60">{p.current?.id === i.id ? <PlayingBars playing={p.playing} /> : n + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate" title={i.title}>{i.title}</span><span className="block truncate text-xs text-white/60" title={i.artist}>{i.artist || "—"}</span></span>
            <span className="shrink-0 text-xs tabular-nums text-white/60">{formatTime(i.duration)}</span>
          </button>
        ))}
        </div>
        </ScrollArea>
      </div>

      {/* Détails du morceau : volet de droite, exclusif avec la file de lecture */}
      <div className={cn("absolute bottom-36 right-5 top-24 w-[26rem] overflow-hidden rounded-xl bg-white/10 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300", panel === "info" && !calm && controlsVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0")}>
        <div className="flex items-center gap-2 border-b px-3 py-2"><Info className="size-4 text-muted-foreground" /><h3 className="text-sm font-medium">{t("fs.info")}</h3></div>
        {cur ? (
          <ScrollArea className="h-[calc(100%-2.75rem)]">
            <dl className="space-y-3 p-4 text-sm">
              {([
                [t("col.title"), cur.title],
                [t("col.artist"), cur.artist || t("player.unknownArtist")],
                [t("fs.year"), cur.year || "—"],
                [t("fs.format"), `${cur.ext.toUpperCase()} · ${t(cur.kind === "video" ? "dlg.video" : "dlg.audio")}`],
                [t("col.total"), formatTime(cur.duration)],
                [t("col.size"), cur.size ? formatSize(cur.size) : "—"],
                [t("fs.source"), t(cur.source === "local" ? "fs.srcLocal" : "fs.srcOnline")],
                [t("fs.file"), cur.name],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>
              ))}
            </dl>
          </ScrollArea>
        ) : <p className="p-4 text-sm text-muted-foreground">{t("player.none")}</p>}
      </div>

      {/* Rail latéral : accès rapide aux volets et réglages */}
      <nav className={cn("absolute left-5 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-white/10 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl backdrop-saturate-150 p-1.5", fade)} aria-label={t("fs.info")}>
        {[
          { key: "lyrics", Icon: MicVocal, label: t("lyr.toggle"), active: showLyrics, onClick: () => { setShowLyrics((v) => !v); setCalm(false); } },
          { key: "queue", Icon: ListMusic, label: t("fs.queue"), active: panel === "queue", onClick: () => { setPanel((v) => (v === "queue" ? null : "queue")); setCalm(false); } },
          { key: "info", Icon: Info, label: t("fs.info"), active: panel === "info", onClick: () => { setPanel((v) => (v === "info" ? null : "info")); setCalm(false); } },
        ].map((b) => (
          <Button key={b.key} size="icon" variant={b.active ? "secondary" : "ghost"} className="size-10 rounded-full [&_svg]:size-5" onClick={b.onClick} title={b.label} aria-pressed={b.active}><b.Icon /></Button>
        ))}
        <span className="my-1 h-px w-6 bg-border" />
        <Button size="icon" variant="ghost" className="size-10 rounded-full [&_svg]:size-5" onClick={toggleTheme} title={`${t("fs.theme")} : ${t(theme === "zarao" ? "fs.themeZarao" : theme === "classic" ? "fs.themeClassic" : "fs.themeRainbow")}`}><Palette /></Button>
        <Button variant={p.rate === 1 ? "ghost" : "secondary"} className="size-10 flex-col gap-0 rounded-full p-0 text-[0.65rem] tabular-nums [&_svg]:size-4" onClick={p.cycleRate} title={t("ctl.speed")}><Gauge />{p.rate}×</Button>
        <Button size="icon" variant={p.sleepMode === "off" ? "ghost" : "secondary"} className="size-10 rounded-full [&_svg]:size-5" onClick={p.cycleSleep} title={`${t("ctl.sleepTitle")}${p.sleepMode === "off" ? "" : ` — ${p.sleepMode === "track" ? t("ctl.sleepTrack") : formatTime(p.sleepLeft)}`}`}><Moon /></Button>
        <span className="my-1 h-px w-6 bg-border" />
        <Button size="icon" variant={calm ? "secondary" : "ghost"} className="size-10 rounded-full [&_svg]:size-5" onClick={() => setCalm((v) => !v)} title={t("fs.calm")} aria-pressed={calm}>{calm ? <PanelRight /> : <EyeOff />}</Button>
      </nav>

      {/* Barre du bas : progression + boutons + volume */}
      <footer className={cn("absolute inset-x-0 bottom-0 space-y-2 p-5", fade)}>
        <div className="flex items-center gap-3">
          <span className="w-12 text-right text-sm tabular-nums text-white/80">{p.time > 0 ? formatTime(p.time) : "0:00"}</span>
          <Slider className="flex-1" min={0} max={p.duration || 1} step={0.1} value={[Math.min(p.time, p.duration || 1)]} disabled={!cur} onValueChange={([v]) => p.seek(v)} />
          <span className="w-12 text-sm tabular-nums text-white/80">{formatTime(p.duration)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="w-48" />
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className={cn(icon, p.shuffle && "bg-white/20")} onClick={p.toggleShuffle} title={t("ctl.shuffle")}><Shuffle /></Button>
            <Button size="icon" variant="ghost" className={icon} onClick={p.previous} title={t("ctl.previous")}><SkipBack /></Button>
            <Button size="icon" variant="ghost" className={icon} disabled={!cur} onClick={() => p.seek(Math.max(0, p.time - SEEK_STEP))} title={t("ctl.rewind", { s: SEEK_STEP })}><Rewind /></Button>
            <Button size="icon" className="mx-2 size-14 rounded-full bg-white text-black hover:bg-white/90 [&_svg]:size-6" onClick={p.togglePlay} title={p.playing ? t("ctl.pause") : t("ctl.play")}>{p.playing ? <Pause /> : <Play />}</Button>
            <Button size="icon" variant="ghost" className={icon} disabled={!cur} onClick={() => p.seek(Math.min(p.duration || 0, p.time + SEEK_STEP))} title={t("ctl.forward", { s: SEEK_STEP })}><FastForward /></Button>
            <Button size="icon" variant="ghost" className={icon} onClick={() => p.next()} title={t("ctl.next")}><SkipForward /></Button>
            <Button size="icon" variant="ghost" className={cn(icon, p.repeat !== "off" && "bg-white/20")} onClick={p.cycleRepeat} title={t("ctl.repeat")}><RepeatIcon /></Button>
          </div>
          <div className="flex w-48 items-center justify-end gap-2">
            <Button size="icon" variant="ghost" className={icon} onClick={p.toggleMute} title={t("ctl.mute")}>{p.muted || p.volume === 0 ? <VolumeX /> : <Volume2 />}</Button>
            <Slider className="w-28" min={0} max={1} step={0.01} value={[p.muted ? 0 : p.volume]} onValueChange={([v]) => p.setVolume(v)} />
          </div>
        </div>
      </footer>

      {!cur && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Music className="size-16 text-white/20" /></div>}
    </div>
  );
}
