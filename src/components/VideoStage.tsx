import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { FullscreenChrome } from "@/components/FullscreenChrome";
import type { usePlayer } from "@/hooks/usePlayer";
import type { Lyrics } from "@/lib/lyrics";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** Identifiant du conteneur : le plein écran porte sur lui (et non sur la balise vidéo) pour que les contrôles restent visibles. */
export const VIDEO_STAGE_ID = "zarao-video-stage";

/** Bascule le plein écran du lecteur vidéo ; sans effet si le composant n'est pas affiché. */
export function toggleVideoFullscreen(): void {
  const el = document.getElementById(VIDEO_STAGE_ID);
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void el.requestFullscreen?.().catch(() => undefined);
}

/** Délai sans mouvement avant de masquer les contrôles, tant que la vidéo joue. */
const HIDE_AFTER_MS = 2500;

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cur = p.current;

  const wake = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // Pas de masquage en pause : l'utilisateur doit toujours voir comment reprendre.
  const shown = controlsVisible || !p.playing;

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

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
      className={cn("group relative select-none overflow-hidden bg-black text-white", visible ? "flex-1" : "hidden")}
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
      {buffering && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="size-12 animate-spin text-white/80" /></div>}
      {!p.playing && !buffering && cur && (
        <button type="button" aria-label={t("ctl.play")} onClick={p.togglePlay} className="absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 backdrop-blur-xl transition-transform hover:scale-105">
          <Play className="size-9" />
        </button>
      )}

      {/* IMPORTANT : en fenêtre, les contrôles sont ceux de la barre du bas (PlayerBar), liés au même lecteur.
          En plein écran, on pose le même habillage que pour l'audio (titre, rail, volets, barre en verre). */}
      {isFullscreen && <FullscreenChrome p={p} lyrics={lyrics} onExit={toggleVideoFullscreen} onBackgroundClick={p.togglePlay} />}
    </div>
  );
}
