import { open as openFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseBlob } from "music-metadata";

/** Une ligne de paroles ; `time` (secondes) vaut null pour un texte non synchronisé. */
export type LyricLine = { time: number | null; text: string };
export type Lyrics = { synced: boolean; lines: LyricLine[]; raw: string };

// [mm:ss], [mm:ss.xx], [mm:ss:xx] — un ou plusieurs horodatages en tête de ligne.
const STAMPS_RE = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/;
const STAMP_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const META_RE = /^\s*\[([a-z]{2,8}):([^\]]*)\]\s*$/i;
/** LRC "enhanced" : horodatages mot à mot <mm:ss.xx>, sans intérêt pour l'affichage ligne à ligne. */
const WORD_STAMP_RE = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;

/** "12" → 0.12 s ; "5" → 0.5 s ; "123" → 0.123 s (les fractions LRC sont des centièmes ou des millièmes). */
const fraction = (f: string | undefined) => (f ? Number(f) / 10 ** f.length : 0);

/**
 * Analyse un texte de paroles : LRC horodaté (→ défilement synchronisé) ou texte brut.
 * `[offset:±ms]` est appliqué : un offset positif fait apparaître les paroles plus tôt.
 */
export function parseLyrics(raw: string): Lyrics {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const timed: LyricLine[] = [];
  let offset = 0;

  for (const line of text.split("\n")) {
    const meta = META_RE.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === "offset") offset = (Number(meta[2]) || 0) / 1000;
      continue; // [ar:], [ti:], [al:]… : métadonnées du fichier, pas des paroles
    }
    const m = STAMPS_RE.exec(line);
    if (m) {
      const lyric = m[2].replace(WORD_STAMP_RE, "").trim();
      for (const s of m[1].matchAll(STAMP_RE)) {
        timed.push({ time: Math.max(0, Number(s[1]) * 60 + Number(s[2]) + fraction(s[3]) - offset), text: lyric });
      }
    }
  }

  // Synchronisé dès qu'au moins deux lignes sont horodatées ; sinon c'est du texte brut (les crochets restent du texte).
  if (timed.length >= 2) {
    timed.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    return { synced: true, lines: timed, raw };
  }
  const lines = text.split("\n").map((l) => ({ time: null, text: l.trimEnd() }));
  // Supprime les blancs de tête/queue, garde les sauts de paragraphe internes.
  while (lines.length && !lines[0].text) lines.shift();
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return { synced: false, lines, raw };
}

/** Index de la ligne active à l'instant `time` (-1 avant la première ligne). Recherche dichotomique : appelée à chaque image. */
export function activeLine(lyrics: Lyrics, time: number): number {
  if (!lyrics.synced) return -1;
  const t = time + 0.1; // petite avance : l'œil lit avant d'entendre
  let lo = 0, hi = lyrics.lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lyrics.lines[mid].time ?? 0) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// ---------- Fichiers locaux ----------

const baseOf = (path: string) => path.replace(/\.[^./\\]+$/, "");
const SIDECAR_EXT = ["lrc", "txt"];
const EMBEDDED_READ_BYTES = 8 * 1024 * 1024;

/** Lit un fichier texte s'il existe et n'est pas vide ; null sinon (absent, illisible ou vide). */
async function readIfAny(path: string): Promise<string | null> {
  try {
    const text = await readTextFile(path);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** Paroles intégrées au fichier (tag USLT/SYLT, etc.), lues dans le premier Mo comme les autres tags. */
async function readEmbedded(path: string): Promise<string | null> {
  try {
    const handle = await openFile(path, { read: true });
    let blob: Blob;
    try {
      const buf = new Uint8Array(EMBEDDED_READ_BYTES);
      const n = (await handle.read(buf)) ?? 0;
      blob = new Blob([buf.slice(0, n)]);
    } finally {
      await handle.close();
    }
    const meta = await parseBlob(blob, { duration: false, skipPostHeaders: true });
    const tag = meta.common.lyrics?.[0];
    if (!tag) return null;
    // Paroles synchronisées intégrées (horodatage en ms) : reconstruites en LRC pour profiter du défilement.
    if (tag.syncText?.length && tag.timeStampFormat === 2) {
      return tag.syncText.map((l) => {
        const ms = l.timestamp ?? 0;
        const mm = String(Math.floor(ms / 60000)).padStart(2, "0");
        const ss = ((ms % 60000) / 1000).toFixed(2).padStart(5, "0");
        return `[${mm}:${ss}] ${l.text}`;
      }).join("\n");
    }
    return tag.text?.trim() ? tag.text : null;
  } catch {
    return null;
  }
}

/**
 * Paroles d'un fichier local : fichier voisin `<nom>.lrc` (prioritaire, synchronisé), puis `<nom>.txt`,
 * puis paroles intégrées au fichier audio.
 */
export async function loadLocalLyricsText(path: string): Promise<string | null> {
  for (const ext of SIDECAR_EXT) {
    const text = await readIfAny(`${baseOf(path)}.${ext}`);
    if (text) return text;
  }
  return readEmbedded(path);
}

/**
 * Enregistre les paroles à côté du fichier : `.lrc` si elles sont horodatées, `.txt` sinon.
 * IMPORTANT : on n'écrit jamais dans le fichier audio (aucune réécriture ni risque pour la musique), et on ne supprime rien :
 * pour effacer des paroles, on écrit un fichier vide (ignoré à la lecture) plutôt que d'ouvrir une permission de suppression.
 */
export async function saveLocalLyricsText(path: string, text: string): Promise<void> {
  const synced = parseLyrics(text).synced;
  const ext = synced ? "lrc" : "txt";
  await writeTextFile(`${baseOf(path)}.${ext}`, text);
  // L'autre extension, si elle existait avec du contenu, masquerait la nouvelle version : on la vide.
  const other = SIDECAR_EXT.find((e) => e !== ext)!;
  if (await readIfAny(`${baseOf(path)}.${other}`)) await writeTextFile(`${baseOf(path)}.${other}`, "");
}

// ---------- Mise en forme des paroles non synchronisées ----------

export type LyricsBlock = { kind: "line" | "note"; text: string } | { kind: "gap" };
export type LyricsSection = { title: string | null; blocks: LyricsBlock[] };

const stripMarks = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1$2").trim();

/**
 * Structure un texte brut au format « markdown léger » (courant dans les paroles générées) :
 * `## Couplet` → titre de section, `---` → séparation, `> ` → préfixe ignoré, `*(…)*` ou `(…)` → indication scénique, ligne vide → pause.
 * IMPORTANT : on n'altère jamais le texte d'une vraie parole, on retire seulement la syntaxe de mise en forme.
 */
export function structureLyrics(lines: LyricLine[]): LyricsSection[] {
  const sections: LyricsSection[] = [];
  let current: LyricsSection = { title: null, blocks: [] };
  const flush = () => {
    while (current.blocks.length && current.blocks[current.blocks.length - 1].kind === "gap") current.blocks.pop();
    if (current.blocks.length || current.title) sections.push(current);
  };
  for (const { text } of lines) {
    const t = text.replace(/^\s*(?:>\s*)+/, "").trim();
    const heading = /^#{1,6}\s*(.+?)\s*#*$/.exec(t);
    if (heading) { flush(); current = { title: stripMarks(heading[1]), blocks: [] }; continue; }
    if (/^([-*_])\1{2,}$/.test(t)) { flush(); current = { title: null, blocks: [] }; continue; }
    if (!t) { if (current.blocks.length && current.blocks[current.blocks.length - 1].kind !== "gap") current.blocks.push({ kind: "gap" }); continue; }
    const note = /^\*\(?(.+?)\)?\*$/.exec(t) ?? /^\((.+)\)$/.exec(t);
    current.blocks.push(note ? { kind: "note", text: stripMarks(note[1]) } : { kind: "line", text: stripMarks(t) });
  }
  flush();
  return sections;
}
