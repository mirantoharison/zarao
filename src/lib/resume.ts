import { useSyncExternalStore } from "react";
import type { MediaItem } from "@/lib/media";
import { getAudioSettings } from "@/lib/settings";

/**
 * Reprise de lecture des vidéos : la position est mémorisée (localStorage) une fois la vidéo lue plus de `resumeMinSeconds()`,
 * pour proposer de reprendre à la prochaine lecture. Audio non concerné : un morceau se relance sans gêne.
 * Activation et seuil : réglages Audio (Paramètres), lus à chaque appel.
 */
export const resumeMinSeconds = () => getAudioSettings().resumeMinSeconds;
export const resumeEnabled = () => getAudioSettings().resumeEnabled;
/** Une vidéo arrêtée à moins de N secondes de la fin est considérée comme terminée (générique de fin) : rien à reprendre. */
export const RESUME_END_MARGIN = 20;
const KEY = "zarao.resume";
/** Nombre maximal de vidéos mémorisées (les plus anciennes partent d'abord) : évite que le stockage grossisse sans fin. */
const MAX_ENTRIES = 200;

type Entry = { t: number; at: number };
type Store = Record<string, Entry>;

/**
 * Clé stable d'une vidéo : le chemin du fichier (local) ou l'identifiant serveur (en ligne).
 * IMPORTANT : jamais `item.id`, qui est tiré au hasard à chaque ajout dans la liste.
 */
const keyOf = (item: MediaItem) => `${item.source}:${item.remoteId ?? item.path}`;

// Copie en mémoire : la liste interroge chaque ligne à chaque rendu, on ne relit pas (ni ne re-parse) le stockage à chaque fois.
let cache: Store | null = null;
let version = 0;
const listeners = new Set<() => void>();

function read(): Store {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    cache = raw && typeof raw === "object" ? (raw as Store) : {};
  } catch { cache = {}; }
  return cache;
}

function write(store: Store): void {
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - MAX_ENTRIES)) delete store[k];
  }
  cache = store;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota / stockage indisponible : non bloquant */ }
  version += 1;
  listeners.forEach((l) => l());
}

/** Se réabonner aux changements : les listes affichent la progression et doivent se redessiner quand une position est mémorisée ou effacée. */
export const useResumeVersion = (): number => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version);

/** Vrai si `time` vaut la peine d'être mémorisé pour une vidéo de `duration` secondes (0 = durée inconnue). */
export const isResumable = (time: number, duration: number) =>
  time >= resumeMinSeconds() && (duration <= 0 || time < duration - RESUME_END_MARGIN);

/** Position mémorisée de la vidéo (secondes), ou null si rien de reprenable (ou reprise désactivée). */
export function getResume(item: MediaItem): number | null {
  if (item.kind !== "video" || !resumeEnabled()) return null;
  const entry = read()[keyOf(item)];
  return entry && isResumable(entry.t, item.duration) ? entry.t : null;
}

/** Avancement de la vidéo, entre 0 et 1, pour la barre de la liste ; null si aucune position mémorisée ou durée inconnue. */
export function getResumeProgress(item: MediaItem): number | null {
  const t = getResume(item);
  return t !== null && item.duration > 0 ? Math.min(1, t / item.duration) : null;
}

/**
 * Mémorise la position d'une vidéo ; en toute fin de film l'entrée est effacée.
 * IMPORTANT : avant le seuil on ne touche à rien (sans effacer) : au démarrage d'une vidéo, la position repasse par 0
 * alors qu'une reprise est peut-être encore proposée.
 */
export function saveResume(item: MediaItem, time: number, duration: number): void {
  if (item.kind !== "video" || !resumeEnabled() || time < resumeMinSeconds()) return;
  if (!isResumable(time, duration)) return clearResume(item);
  const store = { ...read() };
  store[keyOf(item)] = { t: Math.floor(time), at: Date.now() };
  write(store);
  if (item.source === "online") onlineChange?.();
}

/**
 * Efface la position. En ligne, on garde une « pierre tombale » (t = 0, date du jour) au lieu de supprimer : sinon la fusion avec les
 * positions des autres appareils (la plus récente l'emporte) ferait revenir la reprise qu'on vient d'effacer.
 */
export function clearResume(item: MediaItem): void {
  const current = read();
  const key = keyOf(item);
  if (!(key in current)) return;
  const store = { ...current };
  if (item.source === "online") store[key] = { t: 0, at: Date.now() }; else delete store[key];
  write(store);
  if (item.source === "online") onlineChange?.();
}

// ---- Synchronisation avec le compte (vidéos en ligne seulement, cf. lib/resumeSync.ts) ----
let onlineChange: (() => void) | null = null;
/** Appelé à chaque position en ligne mémorisée ou effacée (le module de synchro s'en sert pour envoyer au serveur, en différé). */
export const setOnlineResumeListener = (fn: (() => void) | null) => { onlineChange = fn; };
/** Entrées en ligne (pierres tombales comprises) à envoyer au serveur. */
export const onlineResumeEntries = (): Store => Object.fromEntries(Object.entries(read()).filter(([k]) => k.startsWith("online:")));
/** Fusionne les entrées du serveur : la plus récente de chaque vidéo l'emporte. N'avertit pas `onlineChange` (pas de renvoi en boucle). */
export function mergeOnlineResume(remote: Store): void {
  const store = { ...read() };
  let changed = false;
  for (const [key, e] of Object.entries(remote)) {
    if (!key.startsWith("online:") || !e || !Number.isFinite(e.t) || !Number.isFinite(e.at)) continue;
    if (!store[key] || store[key].at < e.at) { store[key] = { t: e.t, at: e.at }; changed = true; }
  }
  if (changed) write(store);
}
