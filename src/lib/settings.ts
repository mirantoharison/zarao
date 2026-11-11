/**
 * Réglages côté interface : extensions de fichiers prises en compte.
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
