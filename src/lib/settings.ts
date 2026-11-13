import { useSyncExternalStore } from "react";

/**
 * Réglages côté interface : extensions de fichiers prises en compte, audio du visualiseur/de la sortie, scan des dossiers.
 * (Le chemin ffmpeg et le transcodage vivent côté serveur, cf. /settings.)
 */
const KEY = "zarao.extensions";

export const DEFAULT_AUDIO_EXT = ["mp3", "mp2", "wav", "ogg", "flac", "m4a", "aac"];
export const DEFAULT_VIDEO_EXT = ["mp4", "webm", "mpg", "mkv", "avi", "ts", "mov"];

const EXT_RE = /^[a-z0-9]{1,6}$/;

/** "mp3; .MP4 , wav" → ["mp3", "mp4", "wav"] : insensible à la casse, point et séparateurs tolérés, doublons et valeurs invalides écartés. */
export function parseExtensionList(text: string): string[] {
  const out = text.split(/[;,\s]+/).map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter((e) => EXT_RE.test(e));
  return [...new Set(out)];
}

export function getExtensions(): { audio: string[]; video: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { audio?: string[]; video?: string[] };
      const audio = (parsed.audio ?? []).filter((e) => EXT_RE.test(e));
      const video = (parsed.video ?? []).filter((e) => EXT_RE.test(e));
      if (audio.length + video.length > 0) return { audio, video };
    }
  } catch { /* JSON invalide ou stockage indisponible : valeurs par défaut */ }
  return { audio: DEFAULT_AUDIO_EXT, video: DEFAULT_VIDEO_EXT };
}

export function setExtensions(audio: string[], video: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify({ audio, video })); } catch { /* non bloquant */ }
}

// ---------------------------------------------------------------------------------------------------------------------
// Réglages audio (visualiseur, sortie) et de scan de la bibliothèque : locaux à l'interface, comme les extensions.
// IMPORTANT : une copie en mémoire est tenue à jour. Le visualiseur lit ces valeurs à chaque image (60 Hz) : relire et
// décoder le localStorage à chaque fois serait du gaspillage.
// ---------------------------------------------------------------------------------------------------------------------
const AUDIO_KEY = "zarao.audio";
const SCAN_KEY = "zarao.scan";

export const FFT_SIZES = [256, 512, 1024, 2048] as const;
export const LATENCY_HINTS = ["interactive", "balanced", "playback"] as const;
export const REPLAY_GAIN_MODES = ["off", "track", "album"] as const;

export type AudioSettings = {
  /** Taille de la FFT du spectre (puissance de 2) : plus grande = plus fin dans les graves, mais plus coûteux. */
  fftSize: number;
  /** Coefficient de montée du spectre par image (0,1–1) : 1 = instantané. */
  attack: number;
  /** Coefficient de descente par image (0,03–0,5) : plus petit = retombée plus lente. */
  release: number;
  /** Compromis latence / consommation de l'AudioContext (pris en compte à sa création, donc au prochain lancement). */
  latencyHint: (typeof LATENCY_HINTS)[number];
  /** Identifiant du périphérique de sortie ("" = celui du système). */
  sinkId: string;
  /**
   * ReplayGain : égalise le volume des morceaux d'après les tags du fichier (« track » = par morceau, « album » = par album).
   * IMPORTANT : sans égaliseur actif le volume de l'élément ne peut qu'être ABAISSÉ (plafond à 1) ; les gains positifs ne
   * s'appliquent que quand l'audio passe par Web Audio (égaliseur ou transposition), où le limiteur peut les contenir.
   */
  replayGain: (typeof REPLAY_GAIN_MODES)[number];
  /** Durée (s) du fondu en fin et en début de piste audio ; 0 = aucun. Un fondu de sortie PUIS d'entrée, pas un recouvrement. */
  fadeSeconds: number;
  /** Précharge le morceau suivant pendant la lecture (audio lu en direct) pour réduire la coupure entre deux pistes. */
  preloadNext: boolean;
  /** Limiteur en fin de chaîne : évite l'écrêtage quand l'égaliseur ajoute du gain. */
  limiter: boolean;
  /** Reprise des vidéos : mémoriser la position et proposer de reprendre (cf. lib/resume.ts). */
  resumeEnabled: boolean;
  /** Une vidéo n'est mémorisée qu'une fois lue au moins ce nombre de secondes (10–600). */
  resumeMinSeconds: number;
};
export const DEFAULT_AUDIO: AudioSettings = { fftSize: 512, attack: 0.5, release: 0.12, latencyHint: "interactive", sinkId: "", replayGain: "off", fadeSeconds: 0, preloadNext: false, limiter: false, resumeEnabled: true, resumeMinSeconds: 60 };

export type ScanSettings = {
  recursive: boolean;
  /** Niveaux de sous-dossiers parcourus quand `recursive` est vrai. */
  maxDepth: number;
  /** Prendre en compte les dossiers et fichiers cachés (nom commençant par un point). */
  hidden: boolean;
  /** Motifs d'exclusion sur le NOM (jokers * et ?), insensibles à la casse. */
  exclude: string[];
  /** Dossiers relus périodiquement : les nouveaux fichiers sont ajoutés à la liste de lecture du lecteur local. */
  watchFolders: string[];
  /** Secondes entre deux relectures (5–600). */
  watchInterval: number;
};
export const DEFAULT_SCAN: ScanSettings = { recursive: false, maxDepth: 3, hidden: false, exclude: [], watchFolders: [], watchInterval: 30 };
export const SCAN_MAX_DEPTH = 10;

const clamp = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function readJson<T extends object>(key: string): Partial<T> {
  try { return (JSON.parse(localStorage.getItem(key) ?? "{}") ?? {}) as Partial<T>; } catch { return {}; }
}

/** Valide chaque champ : le localStorage peut contenir n'importe quoi (ancienne version, édition manuelle). */
export function normalizeAudio(raw: Partial<AudioSettings>): AudioSettings {
  return {
    fftSize: (FFT_SIZES as readonly number[]).includes(Number(raw.fftSize)) ? Number(raw.fftSize) : DEFAULT_AUDIO.fftSize,
    attack: clamp(raw.attack, 0.1, 1, DEFAULT_AUDIO.attack),
    release: clamp(raw.release, 0.03, 0.5, DEFAULT_AUDIO.release),
    latencyHint: (LATENCY_HINTS as readonly string[]).includes(String(raw.latencyHint)) ? (raw.latencyHint as AudioSettings["latencyHint"]) : DEFAULT_AUDIO.latencyHint,
    sinkId: typeof raw.sinkId === "string" ? raw.sinkId.slice(0, 300) : "",
    replayGain: (REPLAY_GAIN_MODES as readonly string[]).includes(String(raw.replayGain)) ? (raw.replayGain as AudioSettings["replayGain"]) : "off",
    fadeSeconds: Math.round(clamp(raw.fadeSeconds, 0, 12, 0)),
    preloadNext: Boolean(raw.preloadNext),
    limiter: Boolean(raw.limiter),
    // Absent d'un ancien enregistrement = activé (comportement par défaut) : on ne désactive pas la reprise sans que l'utilisateur l'ait demandé.
    resumeEnabled: raw.resumeEnabled === undefined ? DEFAULT_AUDIO.resumeEnabled : Boolean(raw.resumeEnabled),
    resumeMinSeconds: Math.round(clamp(raw.resumeMinSeconds, 10, 600, DEFAULT_AUDIO.resumeMinSeconds)),
  };
}

export function normalizeScan(raw: Partial<ScanSettings>): ScanSettings {
  return {
    recursive: Boolean(raw.recursive),
    maxDepth: Math.round(clamp(raw.maxDepth, 1, SCAN_MAX_DEPTH, DEFAULT_SCAN.maxDepth)),
    hidden: Boolean(raw.hidden),
    exclude: Array.isArray(raw.exclude) ? raw.exclude.filter((e): e is string => typeof e === "string" && e.trim() !== "").map((e) => e.trim().slice(0, 80)).slice(0, 50) : [],
    watchFolders: Array.isArray(raw.watchFolders) ? [...new Set(raw.watchFolders.filter((e): e is string => typeof e === "string" && e.trim() !== ""))].slice(0, 20) : [],
    watchInterval: Math.round(clamp(raw.watchInterval, 5, 600, DEFAULT_SCAN.watchInterval)),
  };
}

let audioState = normalizeAudio(readJson<AudioSettings>(AUDIO_KEY));
let scanState = normalizeScan(readJson<ScanSettings>(SCAN_KEY));
const audioListeners = new Set<() => void>();
const scanListeners = new Set<() => void>();

export const getAudioSettings = () => audioState;
export const getScanSettings = () => scanState;

export function setAudioSettings(next: AudioSettings): void {
  audioState = normalizeAudio(next);
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(audioState)); } catch { /* non bloquant */ }
  audioListeners.forEach((l) => l());
}

export function setScanSettings(next: ScanSettings): void {
  scanState = normalizeScan(next);
  try { localStorage.setItem(SCAN_KEY, JSON.stringify(scanState)); } catch { /* non bloquant */ }
  scanListeners.forEach((l) => l());
}

/** Abonnement hors React (équaliseur, lecteur…). Retourne la fonction de désabonnement. */
export function subscribeAudioSettings(listener: () => void): () => void {
  audioListeners.add(listener);
  return () => { audioListeners.delete(listener); };
}

export function subscribeScanSettings(listener: () => void): () => void {
  scanListeners.add(listener);
  return () => { scanListeners.delete(listener); };
}
export const useScanSettings = (): ScanSettings => useSyncExternalStore(subscribeScanSettings, getScanSettings);

export const useAudioSettings = (): AudioSettings => useSyncExternalStore(subscribeAudioSettings, getAudioSettings);

/** "*.tmp; Sample*" → ["*.tmp", "Sample*"] : même séparateurs que les extensions. */
export const parsePatternList = (text: string): string[] => [...new Set(text.split(/[;\n]+/).map((e) => e.trim()).filter(Boolean))];

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

/** Motif à jokers (* et ?) → expression régulière ancrée, insensible à la casse. */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_SPECIAL, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** Vrai si `name` correspond à l'un des motifs (jokers * et ?, insensible à la casse). */
export const matchesAnyPattern = (name: string, patterns: string[]): boolean => patterns.some((p) => patternToRegex(p).test(name));
