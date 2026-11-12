import { useEffect, useState } from "react";

/** Niveaux de zoom (en %), 100 = la taille actuelle de l'interface. */
export const ZOOM_LEVELS = [70, 80, 90, 100, 110, 125, 150, 175];
const ZOOM_KEY = "zarao.zoom";
const ZOOM_EVENT = "zarao:zoom";
/** L'interface est dimensionnée en rem avec html à 65 % (cf. index.css) : le zoom ne fait que moduler ce pourcentage. */
const BASE_ROOT_PERCENT = 65;

function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_LEVELS.includes(v) ? v : 100;
  } catch { return 100; }
}

function applyZoom(level: number): void {
  document.documentElement.style.fontSize = `${(BASE_ROOT_PERCENT * level) / 100}%`;
}

function setZoom(level: number): void {
  try { localStorage.setItem(ZOOM_KEY, String(level)); } catch { /* non bloquant */ }
  applyZoom(level);
  window.dispatchEvent(new Event(ZOOM_EVENT));
}

/** Passe au niveau voisin (±1) ; sans effet aux extrémités. */
function step(delta: 1 | -1): void {
  const i = ZOOM_LEVELS.indexOf(readZoom());
  const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + delta))];
  setZoom(next);
}

/**
 * À appeler une fois au démarrage : applique le zoom mémorisé et installe les raccourcis globaux.
 * IMPORTANT : Ctrl +/− est déjà pris par le volume du lecteur ; le zoom utilise Ctrl + Alt + (=, −, 0).
 */
export function initZoom(): void {
  applyZoom(readZoom());
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.altKey) return;
    if (e.key === "=" || e.key === "+") { e.preventDefault(); step(1); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); step(-1); }
    else if (e.key === "0") { e.preventDefault(); setZoom(100); }
  });
}

/** Niveau de zoom courant et actions, synchronisés entre tous les composants qui l'utilisent. */
export function useZoom() {
  const [level, setLevel] = useState(readZoom);
  useEffect(() => {
    const sync = () => setLevel(readZoom());
    window.addEventListener(ZOOM_EVENT, sync);
    return () => window.removeEventListener(ZOOM_EVENT, sync);
  }, []);
  return {
    level,
    canZoomIn: level < ZOOM_LEVELS[ZOOM_LEVELS.length - 1],
    canZoomOut: level > ZOOM_LEVELS[0],
    zoomIn: () => step(1),
    zoomOut: () => step(-1),
    reset: () => setZoom(100),
  };
}
