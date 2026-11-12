import { useEffect, useState } from "react";
import { paletteTone } from "@/lib/palette";
import type { AudioVisualizerTheme } from "@/components/AudioVisualizer";

export type VisualizerTheme = AudioVisualizerTheme;

const THEME_KEY = "zarao.visualizer.theme.v2";
/** Événement interne : le stockage ne notifie pas la fenêtre qui écrit, il faut donc prévenir les autres composants à la main. */
const THEME_EVENT = "zarao:visualizer-theme";

export const THEMES: VisualizerTheme[] = ["zarao", "classic", "rainbow"];
/** Teintes de base (HSL) : orange du logo et bleu historique. */
export const ZARAO_HUE = 34; // teinte historique ; la valeur affichée vient de paletteTone()
export const CLASSIC_HUE = 212;

/** Thème par défaut : « zarao ». Une valeur mémorisée inconnue (ancienne version) y retombe aussi. */
export function readVisualizerTheme(): VisualizerTheme {
  try { const v = localStorage.getItem(THEME_KEY) as VisualizerTheme; return THEMES.includes(v) ? v : "zarao"; } catch { return "zarao"; }
}

function writeVisualizerTheme(theme: VisualizerTheme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* non bloquant */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Thème du visualiseur, partagé entre le plein écran et l'anneau autour du bouton lecture :
 * un changement dans l'un se reflète tout de suite dans l'autre.
 */
export function useVisualizerTheme(): [VisualizerTheme, () => void] {
  const [theme, setTheme] = useState<VisualizerTheme>(readVisualizerTheme);
  useEffect(() => {
    const sync = () => setTheme(readVisualizerTheme());
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(THEME_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const cycle = () => writeVisualizerTheme(THEMES[(THEMES.indexOf(readVisualizerTheme()) + 1) % THEMES.length]);
  return [theme, cycle];
}

/** Couleur d'une barre de l'anneau : `t` (0–1) = position sur le cercle, `level` (0–1) = intensité. */
export function ringBarColor(theme: VisualizerTheme, t: number, level: number): string {
  if (theme === "zarao") { const z = paletteTone(); return `hsl(${z.hue - 8 + t * 20}, ${95 * z.sat}%, ${50 + level * 28}%)`; }
  if (theme === "classic") return `hsl(${CLASSIC_HUE - 12 + t * 24}, 95%, ${58 + level * 28}%)`;
  return `hsl(${t * 360}, 90%, ${55 + level * 15}%)`;
}
