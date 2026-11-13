import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, Play, RotateCcw, X } from "lucide-react";
import { FullscreenChrome } from "@/components/FullscreenChrome";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/media";
import { cueAt } from "@/lib/subtitles";
import type { usePlayer } from "@/hooks/usePlayer";
import type { Lyrics } from "@/lib/lyrics";
import { useI18n } from "@/i18n";
import { isVideoFullscreen, setVideoFullscreen, toggleVideoFullscreen, useVideoFullscreen } from "@/lib/fullscreen";
import { cn } from "@/lib/utils";

/** Identifiant du conteneur de la vidéo. */
export const VIDEO_STAGE_ID = "zarao-video-stage";

export { toggleVideoFullscreen };

/**
 * Bascule automatique de l'affichage plein écran quand le type du morceau change (audio <-> vidéo) :
 *  - visualiseur ouvert et le morceau suivant est une vidéo -> la couche vidéo prend la place ;
 *  - couche vidéo plein écran et le morceau suivant est de l'audio -> le visualiseur prend la place.
 * IMPORTANT : le document reste en plein écran pendant toute la bascule (cf. lib/fullscreen.ts) ; seule la couche change.
 */
export function useFullscreenKindSwitch(kind: "audio" | "video" | undefined, visualizerOpen: boolean, setVisualizerOpen: (open: boolean) => void): void {
  const previous = useRef(kind);
  useEffect(() => {
    const before = previous.current;
    previous.current = kind;
    if (!kind || before === kind) return;
    if (kind === "video" && visualizerOpen) {
      setVideoFullscreen(true);
      setVisualizerOpen(false);
    } else if (kind === "audio" && isVideoFullscreen()) {
      setVideoFullscreen(false, { keepDocument: true });
      setVisualizerOpen(true);
    }
    // visualizerOpen n'est volontairement pas une dépendance : seul un changement de type de morceau déclenche la bascule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
}

/** Délai sans mouvement avant de masquer les contrôles, tant que la vidéo joue. */
const HIDE_AFTER_MS = 2500;

/** Délai avant que la proposition de reprise se referme seule (la position reste mémorisée). */
const RESUME_TOAST_MS = 15_000;
/** Durée de l'animation de sortie du toast (doit correspondre à `duration-200` ci-dessous) : il reste monté jusque-là. */
const TOAST_EXIT_MS = 200;

/** Toast « Reprendre à 12:34 ? » : reprendre, recommencer, ou fermer (la lecture a déjà démarré du début en attendant). */
function ResumeToast({ time, leaving, onResume, onRestart, onClose }: { time: number; leaving: boolean; onResume: () => void; onRestart: () => void; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (leaving) return;
    const id = window.setTimeout(onClose, RESUME_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [onClose, leaving]);
  return (
    // Couleurs du thème (popover / primary), comme les menus : le toast suit la palette choisie. Le liseré du bas est le compte à rebours.
    // Entrée : fondu + glissement depuis le bas ; sortie (`leaving`) : l'inverse, plus court, et le toast n'est plus cliquable pendant ce temps.
    <div role="alertdialog" aria-label={t("resume.ask", { t: formatTime(time) })}
      className={cn("relative flex max-w-full items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-popover/85 pt-3 pr-2 pb-3.5 pl-3.5 text-sm text-popover-foreground shadow-2xl backdrop-blur-xl motion-reduce:animate-none",
        leaving ? "pointer-events-none animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-4 duration-200 fill-mode-forwards" : "pointer-events-auto animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-300")}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <History className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 truncate">{t("resume.ask", { t: formatTime(time) })}</span>
      <Button size="sm" onClick={onResume}><Play /> {t("resume.yes")}</Button>
      <Button size="sm" variant="secondary" onClick={onRestart}><RotateCcw /> {t("resume.no")}</Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("resume.close")} title={t("resume.close")} onClick={onClose}><X /></Button>
      <div aria-hidden className="toast-countdown-track absolute inset-x-0 bottom-0 h-[0.2rem]">
        <div className="toast-countdown h-full" style={{ "--toast-duration": `${RESUME_TOAST_MS}ms` } as React.CSSProperties} />
      </div>
    </div>
  );
}

type Props = { p: ReturnType<typeof usePlayer>; visible: boolean; lyrics?: Lyrics | null };

/**
 * Lecteur vidéo personnalisé : l'équivalent, pour la vidéo, de la scène et du plein écran audio.
 * Clic = lecture/pause, double-clic = plein écran, contrôles en verre qui se masquent à l'inactivité.
 *
 * IMPORTANT : l'élément <video> est celui du lecteur (`p.mediaRef`) et reste toujours monté, même masqué :
 * le démonter couperait la lecture et ferait perdre le volume entre un morceau et une vidéo.
 */
export function VideoStage({ p, visible, lyrics = null }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [buffering, setBuffering] = useState(false);
  // Plein écran = couche fixe par-dessus toute l'interface (le document, lui, est déjà en plein écran) ; jamais pour un morceau audio.
  const isFullscreen = useVideoFullscreen() && visible;
  const cur = p.current;

  // Proposition de reprise à afficher, et sa copie gardée le temps de l'animation de sortie : sans elle, le toast serait démonté
  // d'un coup dès que `resumeOffer` repasse à null (réponse, croix, délai écoulé, changement de piste).
  const offer = visible && cur && p.resumeOffer?.id === cur.id ? p.resumeOffer : null;
  const [toast, setToast] = useState<{ id: string; time: number } | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  useEffect(() => {
    if (offer) { setToast({ id: offer.id, time: offer.time }); setToastLeaving(false); return; }
    setToastLeaving(true);
    const id = window.setTimeout(() => setToast(null), TOAST_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [offer?.id, offer?.time]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtitleCues = p.subtitleIndex >= 0 ? p.subtitleTracks[p.subtitleIndex]?.cues : undefined;
  const subtitleCue = subtitleCues ? cueAt(subtitleCues, p.time) : null;

  const wake = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // Pas de masquage en pause : l'utilisateur doit toujours voir comment reprendre.
  const shown = controlsVisible || !p.playing;

  // Échap ferme la couche même si le navigateur a refusé le plein écran du document.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVideoFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Indicateur de mise en mémoire tampon, suivi sur l'élément partagé.
  useEffect(() => {
    const el = p.mediaRef.current;
    if (!el) return;
    const on = () => setBuffering(true);
    const off = () => setBuffering(false);
    el.addEventListener("waiting", on);
    for (const ev of ["playing", "canplay", "pause", "emptied"]) el.addEventListener(ev, off);
    return () => {
      el.removeEventListener("waiting", on);
      for (const ev of ["playing", "canplay", "pause", "emptied"]) el.removeEventListener(ev, off);
    };
  }, [p.mediaRef]);

  return (
    <div
      ref={rootRef}
      id={VIDEO_STAGE_ID}
      className={cn("group select-none overflow-hidden bg-black text-white", isFullscreen ? "fixed inset-0 z-[70]" : "relative", visible ? (isFullscreen ? "" : "flex-1") : "hidden")}
      style={{ cursor: shown ? "default" : "none" }}
      onMouseMove={wake}
      onClick={wake}
    >
      <video ref={p.mediaRef} className="size-full object-contain" onClick={p.togglePlay} onDoubleClick={toggleVideoFullscreen} />

      {/* Voile du haut : titre */}
      <div className={cn(isFullscreen && "hidden", "pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4 transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}>
        <h2 className="truncate text-lg font-semibold drop-shadow">{cur?.title}</h2>
        {cur?.artist && <p className="truncate text-sm text-white/70">{cur.artist}</p>}
      </div>

      {/* Centre : mise en mémoire tampon ou grand bouton lecture quand la vidéo est en pause */}
      {(buffering || p.loading) && cur && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="size-12 animate-spin text-white/80" /></div>}
      {!p.playing && !buffering && !p.loading && cur && (
        <button type="button" aria-label={t("ctl.play")} onClick={p.togglePlay} className="absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 backdrop-blur-xl transition-transform hover:scale-105">
          <Play className="size-9" />
        </button>
      )}

      {/* Reprise : la vidéo a déjà été regardée plus d'une minute. Posée sous les contrôles de la barre du bas, remontée en plein écran. */}
      {/* Sous-titres : la cue active à la position de lecture (décalage des flux convertis compris, cf. lib/subtitles.ts) */}
      {visible && subtitleCue && (
        <div className={cn("pointer-events-none absolute inset-x-0 z-10 flex justify-center px-6", isFullscreen ? "bottom-36" : "bottom-16")}>
          <p className="max-w-[85%] rounded-md bg-black/70 px-3 py-1 text-center text-xl leading-snug whitespace-pre-line text-white [text-shadow:0_1px_2px_black]">{subtitleCue.text}</p>
        </div>
      )}

      {toast && (
        <div className={cn("pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4", isFullscreen ? "bottom-28" : "bottom-5")}>
          <ResumeToast key={toast.id} time={toast.time} leaving={toastLeaving} onResume={p.acceptResume} onRestart={p.declineResume} onClose={p.closeResumeOffer} />
        </div>
      )}

      {/* IMPORTANT : en fenêtre, les contrôles sont ceux de la barre du bas (PlayerBar), liés au même lecteur.
          En plein écran, on pose le même habillage que pour l'audio (titre, rail, volets, barre en verre). */}
      {isFullscreen && <FullscreenChrome p={p} lyrics={lyrics} onExit={toggleVideoFullscreen} onBackgroundClick={p.togglePlay} />}
    </div>
  );
}
