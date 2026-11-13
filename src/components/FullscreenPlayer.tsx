import { useEffect, useRef, useState } from "react";
import { FullscreenChrome } from "@/components/FullscreenChrome";
import { AudioVisualizer as Visualizer } from "@/components/AudioVisualizer";
import { useVisualizerTheme } from "@/lib/visualizerTheme";
import { ensureDocumentFullscreen, isVideoFullscreen, leaveDocumentFullscreen } from "@/lib/fullscreen";
import type { usePlayer } from "@/hooks/usePlayer";
import type { Lyrics } from "@/lib/lyrics";
import { useI18n } from "@/i18n";
import { spectrumSourceOf } from "@/lib/media";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void; lyrics: Lyrics | null };

/**
 * Plein écran audio : fond (pochette floutée) + visualiseur, habillés par `FullscreenChrome`, le même que celui de la vidéo.
 */
export function FullscreenPlayer({ p, open, onClose, lyrics }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [theme, cycleTheme] = useVisualizerTheme();
  const [analysis, setAnalysis] = useState(true);

  // Ouverture : plein écran du navigateur sur la couche (fermée avec Échap, ce qui déclenche fullscreenchange).
  useEffect(() => {
    if (!open) return;
    // IMPORTANT : si le plein écran est refusé (webview, absence de geste utilisateur), la couche reste simplement affichée par-dessus l'app.
    ensureDocumentFullscreen();
    const onFs = () => { if (!document.fullscreenElement) closeRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
      // IMPORTANT : on ne quitte le plein écran que si la couche vidéo ne prend pas le relais (bascule audio -> vidéo).
      if (!isVideoFullscreen()) leaveDocumentFullscreen();
    };
  }, [open]);

  if (!open) return null;

  const cur = p.current;
  const toggleTheme = cycleTheme;

  return (
    <div ref={rootRef} className="fixed inset-0 z-[70] select-none overflow-hidden bg-neutral-950 text-white">
      {/* Fond : la pochette floutée et assombrie ; sans pochette, le logo flouté donne l'ambiance orange de Zarao. */}
      <img src={cur?.jacket ?? "/zarao-logo.png"} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/20 to-black/70" />
      <Visualizer className="absolute inset-0" mediaRef={p.mediaRef} playing={p.playing} source={spectrumSourceOf(cur)} jacket={cur?.jacket} theme={theme} onAnalysis={setAnalysis} />
      <FullscreenChrome
        p={p}
        lyrics={lyrics}
        onExit={onClose}
        analysisMissing={!analysis}
        theme={{ label: `${t("fs.theme")} : ${t(theme === "zarao" ? "fs.themeZarao" : theme === "classic" ? "fs.themeClassic" : "fs.themeRainbow")}`, onToggle: toggleTheme }}
      />
    </div>
  );
}
