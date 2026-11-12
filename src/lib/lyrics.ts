import { open as openFile, readTextFile } from "@tauri-apps/plugin-fs";
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

// ---------- Paroles locales : tag du fichier, mémoire de l'application, ancien fichier voisin ----------

const STORE_KEY = "zarao.lyrics.v1";
/** Nombre maximal d'entrées gardées dans la mémoire de l'application (les plus anciennes sont oubliées). */
const STORE_MAX = 300;

/** chemin du média -> texte ; "" = paroles effacées volontairement (pas de récupération automatique, ancien .lrc ignoré). */
function readStore(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function writeStore(store: Record<string, string>): void {
  const keys = Object.keys(store);
  for (const k of keys.slice(0, Math.max(0, keys.length - STORE_MAX))) delete store[k];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota atteint : non bloquant */ }
}

/** Entrée mémorisée pour ce média : undefined = aucune décision enregistrée. */
export function storedLyrics(path: string): string | undefined { return readStore()[path]; }

/** Mémorise (texte, ou "" pour « effacé ») ; `undefined` oublie l'entrée. Rien n'est écrit sur le disque. */
export function setStoredLyrics(path: string, text: string | undefined): void {
  const store = readStore();
  delete store[path]; // remis en fin d'objet : l'ordre d'insertion sert à oublier les plus anciennes
  if (text !== undefined) store[path] = text;
  writeStore(store);
}

/**
 * Paroles d'un fichier local, par ordre de priorité :
 *  1. le tag intégré au fichier (source de vérité, c'est là que l'application enregistre) ;
 *  2. la mémoire de l'application (paroles récupérées en ligne, ou formats sans tag de paroles) ;
 *  3. un ancien fichier voisin `<nom>.lrc` puis `<nom>.txt`, lu seulement (jamais écrit ni supprimé).
 * Une entrée mémorisée vide (« effacé ») masque l'ancien fichier voisin.
 */
export async function loadLocalLyricsText(path: string): Promise<string | null> {
  const embedded = await readEmbedded(path);
  if (embedded) return embedded;
  const stored = storedLyrics(path);
  if (stored !== undefined) return stored || null;
  for (const ext of SIDECAR_EXT) {
    const text = await readIfAny(`${baseOf(path)}.${ext}`);
    if (text) return text;
  }
  return null;
}

/**
 * Enregistre les paroles dans la mémoire de l'application (repli : format sans tag de paroles, ou paroles récupérées en ligne
 * qu'on ne veut pas écrire dans le fichier sans que l'utilisateur l'ait demandé).
 * IMPORTANT : aucun fichier de paroles n'est écrit sur le disque.
 */
export async function saveLocalLyricsText(path: string, text: string): Promise<void> {
  setStoredLyrics(path, text);
}

/** Une décision existe-t-elle déjà pour ce média (paroles mémorisées, même vides, ou ancien fichier voisin) ? Évite de relancer la récupération automatique après un effacement. */
export async function hasLyricsSidecar(path: string): Promise<boolean> {
  if (storedLyrics(path) !== undefined) return true;
  for (const ext of SIDECAR_EXT) {
    try { await readTextFile(`${baseOf(path)}.${ext}`); return true; } catch { /* absent */ }
  }
  return false;
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

// ---------- Récupération en ligne (LRCLIB) ----------

const LRCLIB_URL = "https://lrclib.net/api/search";
/** Tolérance sur la durée (s) : les versions d'un même titre (single, album, remaster) diffèrent de quelques secondes. */
const DURATION_TOLERANCE = 4;
type LrclibHit = { trackName?: string; artistName?: string; duration?: number; instrumental?: boolean; plainLyrics?: string | null; syncedLyrics?: string | null };
/** Recherches sans résultat, pour ne pas réinterroger le service à chaque changement de piste. */
const misses = new Set<string>();

async function searchLrclib(params: Record<string, string>): Promise<LrclibHit[]> {
  const res = await fetch(`${LRCLIB_URL}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return (await res.json()) as LrclibHit[];
}

/**
 * Cherche les paroles d'un titre sur LRCLIB (gratuit, sans clé). Renvoie du LRC synchronisé si disponible, sinon du texte brut.
 * `duration` (s, 0 = inconnue) départage les versions d'un même titre. null = introuvable ou service injoignable.
 * IMPORTANT : un échec réseau n'est pas mémorisé (le service peut revenir) ; seule une réponse vide l'est.
 */
export async function fetchOnlineLyrics(artist: string, title: string, duration = 0): Promise<string | null> {
  const key = `${artist}\0${title}`.toLowerCase();
  if (!artist.trim() || !title.trim() || misses.has(key)) return null;
  try {
    let hits = await searchLrclib({ artist_name: artist, track_name: title });
    if (hits.length === 0) hits = await searchLrclib({ q: `${artist} ${title}` });
    const usable = hits.filter((h) => !h.instrumental && (h.syncedLyrics?.trim() || h.plainLyrics?.trim()));
    if (usable.length === 0) { misses.add(key); return null; }
    // Meilleur candidat : paroles synchronisées d'abord, puis durée la plus proche (si connue).
    const gap = (h: LrclibHit) => (duration > 0 && h.duration ? Math.abs(h.duration - duration) : 0);
    const close = duration > 0 ? usable.filter((h) => gap(h) <= DURATION_TOLERANCE) : usable;
    const pool = close.length ? close : usable;
    pool.sort((a, b) => Number(Boolean(b.syncedLyrics?.trim())) - Number(Boolean(a.syncedLyrics?.trim())) || gap(a) - gap(b));
    return (pool[0].syncedLyrics?.trim() ? pool[0].syncedLyrics : pool[0].plainLyrics) ?? null;
  } catch (err) {
    console.warn("[zarao] paroles en ligne indisponibles :", err);
    return null;
  }
}

