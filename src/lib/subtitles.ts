import { readDir, readFile } from "@tauri-apps/plugin-fs";

/**
 * Sous-titres « à côté » du fichier vidéo (film.srt, film.fr.srt, film.vtt…), lus et affichés par l'application elle-même.
 * IMPORTANT : on n'utilise pas <track> : l'affichage suit la position réelle (`p.time`, décalage des flux convertis compris),
 * alors qu'un flux relancé par le serveur à l'instant T repartirait de 0 et décalerait les cues.
 */
export type Cue = { start: number; end: number; text: string };
export type SubtitleTrack = { id: string; label: string; cues: Cue[] };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function parseTime(raw: string): number | null {
  const m = raw.trim().match(TIME);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** SRT et WebVTT (même structure : blocs séparés par une ligne vide, « début --> fin » puis le texte). Balises HTML et codes ASS retirés. */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/^﻿/, "").replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const start = parseTime(a);
    const end = parseTime(b ?? "");
    if (start === null || end === null) continue;
    const body = lines.slice(at + 1).join("\n").replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Cue affichée à l'instant `time` (secondes), ou null. */
export const cueAt = (cues: Cue[], time: number): Cue | null => cues.find((c) => time >= c.start && time < c.end) ?? null;

/** Les sous-titres sont souvent en Latin-1 : UTF-8 d'abord, repli sur Windows-1252 si le fichier n'est pas de l'UTF-8 valide. */
function decode(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); }
}

const SUB_EXT = /\.(srt|vtt)$/i;

/** Sous-titres trouvés à côté d'une vidéo locale : même nom de base, avec ou sans code de langue (film.srt, film.fr.srt). */
export async function loadSidecarSubtitles(videoPath: string): Promise<SubtitleTrack[]> {
  const dir = videoPath.replace(/[\\/][^\\/]*$/, "");
  const base = (videoPath.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
  let names: string[] = [];
  try { names = (await readDir(dir)).filter((e) => e.isFile && SUB_EXT.test(e.name)).map((e) => e.name); } catch { return []; }
  const tracks: SubtitleTrack[] = [];
  for (const name of names.sort()) {
    const stem = name.replace(SUB_EXT, "");
    const lower = stem.toLowerCase();
    if (lower !== base && !lower.startsWith(`${base}.`)) continue;
    try {
      const cues = parseSubtitles(decode(await readFile(`${dir}/${name}`)));
      if (cues.length > 0) tracks.push({ id: name, label: stem.length > base.length ? stem.slice(base.length + 1).toUpperCase() : "—", cues });
    } catch { /* fichier illisible : on l'ignore */ }
  }
  return tracks;
}
