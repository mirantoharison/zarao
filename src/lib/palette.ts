import { useEffect, useState } from "react";

/**
 * Palettes de l'interface. `swatch` = [fond, accent] pour l'aperçu dans les Paramètres ;
 * les vraies valeurs vivent dans index.css (html[data-palette="…"]).
 * IMPORTANT : « blanc » est le seul thème clair : il retire la classe `dark` de <html>, les autres la remettent.
 */
export const PALETTES = [
  { id: "orange", swatch: ["#3b342d", "#f5a742"] },
  { id: "bordeaux", swatch: ["#3a1224", "#ff5c93"] },
  { id: "violet", swatch: ["#26183f", "#b48cff"] },
  { id: "ocean", swatch: ["#12283a", "#4cc3f0"] },
  { id: "graphite", swatch: ["#3a3a3c", "#e4e4e7"] },
  { id: "noir", swatch: ["#0b0b0c", "#ffffff"] },
  { id: "blanc", swatch: ["#ffffff", "#18181b"] },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];
const DEFAULT_PALETTE: PaletteId = "ocean";
const KEY = "zarao.palette";
const EVENT = "zarao:palette";

export function readPalette(): PaletteId {
  try { const v = localStorage.getItem(KEY) as PaletteId; return PALETTES.some((p) => p.id === v) ? v : DEFAULT_PALETTE; } catch { return DEFAULT_PALETTE; }
}

function applyPalette(id: PaletteId): void {
  const root = document.documentElement;
  root.dataset.palette = id;
  root.classList.toggle("dark", id !== "blanc");
}

/** À appeler avant le premier rendu : évite un flash de l'ancienne palette au démarrage. */
export function initPalette(): void { applyPalette(readPalette()); }

function setPalette(id: PaletteId): void {
  try { localStorage.setItem(KEY, id); } catch { /* non bloquant */ }
  applyPalette(id);
  window.dispatchEvent(new Event(EVENT));
}

export function usePalette(): [PaletteId, (id: PaletteId) => void] {
  const [id, setId] = useState<PaletteId>(readPalette);
  useEffect(() => {
    const sync = () => setId(readPalette());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [id, setPalette];
}

/**
 * Teinte (HSL) et facteur de saturation que le thème « zarao » du visualiseur emprunte à la palette courante.
 * IMPORTANT : lu directement sur <html> (pas de hook) car le visualiseur le relit à chaque image du canvas ;
 * les palettes neutres (graphite, noir, blanc) ont une saturation nulle -> visualiseur gris/blanc.
 */
const TONES: Record<PaletteId, { hue: number; sat: number }> = {
  orange: { hue: 34, sat: 1 }, bordeaux: { hue: 345, sat: 1 }, violet: { hue: 275, sat: 1 }, ocean: { hue: 200, sat: 1 },
  graphite: { hue: 0, sat: 0 }, noir: { hue: 0, sat: 0 }, blanc: { hue: 0, sat: 0 },
};
export function paletteTone(): { hue: number; sat: number } {
  const id = document.documentElement.dataset.palette as PaletteId | undefined;
  return (id && TONES[id]) || TONES[DEFAULT_PALETTE];
}
