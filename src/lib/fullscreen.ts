import { useSyncExternalStore } from "react";

/**
 * Plein écran de TOUT le document, partagé par l'affichage audio (visualiseur) et l'affichage vidéo.
 *
 * IMPORTANT : on ne met jamais un élément précis en plein écran. L'API navigateur refuse une nouvelle demande sans geste de
 * l'utilisateur, et en changer ou en sortir au milieu d'une bascule audio <-> vidéo faisait quitter le plein écran avec une
 * erreur. Le document reste en plein écran du début à la fin ; seule la couche affichée par-dessus (visualiseur ou vidéo,
 * toutes deux `fixed inset-0`) change.
 */

let videoFullscreen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** La couche vidéo est-elle affichée en plein écran ? */
export const isVideoFullscreen = () => videoFullscreen;
export const useVideoFullscreen = () => useSyncExternalStore(subscribe, () => videoFullscreen);

/** Met le document en plein écran s'il ne l'est pas déjà (sans effet sinon : aucune nouvelle demande, donc aucun refus). */
export function ensureDocumentFullscreen(): void {
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

export function leaveDocumentFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

/**
 * Affiche ou retire la couche vidéo plein écran.
 * `keepDocument` : ne pas quitter le plein écran du document (bascule vers le visualiseur audio, qui prend le relais).
 */
export function setVideoFullscreen(on: boolean, opts: { keepDocument?: boolean } = {}): void {
  if (videoFullscreen === on) return;
  videoFullscreen = on;
  emit();
  if (on) ensureDocumentFullscreen();
  else if (!opts.keepDocument) leaveDocumentFullscreen();
}

export const toggleVideoFullscreen = () => setVideoFullscreen(!videoFullscreen);

// Sortie par Échap ou par le navigateur : la couche vidéo suit.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && videoFullscreen) { videoFullscreen = false; emit(); }
});
