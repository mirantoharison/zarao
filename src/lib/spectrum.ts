/**
 * Analyse spectrale hors élément média.
 *
 * IMPORTANT : le son est décodé par l'app (octets lus via le plugin fs) au lieu d'être capturé
 * depuis le <video>. Le protocole asset de Tauri est cross-origin : capturer ou router l'audio de
 * l'élément y est silencieux ou bloqué. Ici, aucune dépendance au CORS.
 */
import { readFile, stat } from "@tauri-apps/plugin-fs";
import { getAudioSettings } from "@/lib/settings";

/** Fréquence d'échantillonnage du décodage : mono 16 kHz suffit (spectre jusqu'à 8 kHz) et divise la mémoire par ~6. */
export const ANALYSIS_RATE = 16000;
/** Au-delà, on n'analyse pas : lire et décoder un fichier énorme pour un effet visuel coûterait trop cher. */
const MAX_FILE_BYTES = 120 * 1024 * 1024;

const cache = new Map<string, Float32Array | null>();

/** Décode des octets audio en PCM mono 16 kHz. Retourne null si le format n'est pas décodable. */
export async function decodeMono(bytes: ArrayBuffer): Promise<Float32Array | null> {
  try {
    // decodeAudioData rééchantillonne vers la fréquence du contexte ; la longueur (1) est sans effet ici.
    const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
    const buffer = await ctx.decodeAudioData(bytes);
    return buffer.getChannelData(0);
  } catch (err) {
    console.warn("[zarao] décodage audio impossible :", err);
    return null;
  }
}

/**
 * PCM déjà en cache pour ce chemin, sans rien charger : undefined = jamais chargé, null = chargé mais indisponible.
 * Sert à réafficher le spectre tout de suite quand un composant est remonté (réentrée en plein écran).
 */
export function peekPcm(path: string): Float32Array | null | undefined {
  return cache.get(path);
}

/** Charge (et met en cache) le PCM d'un fichier local. null = indisponible → l'anneau reste plat. */
export async function loadPcm(path: string): Promise<Float32Array | null> {
  if (cache.has(path)) return cache.get(path)!;
  let pcm: Float32Array | null = null;
  try {
    // Média en ligne : le serveur local autorise CORS (cors()), un simple fetch suffit.
    if (/^https?:/i.test(path)) {
      const res = await fetch(path);
      const buf = await res.arrayBuffer();
      if (buf.byteLength <= MAX_FILE_BYTES) pcm = await decodeMono(buf);
    } else {
      // IMPORTANT : la taille se vérifie AVANT de lire. `readFile` charge tout le fichier en mémoire côté Rust : sur une vidéo de plusieurs Go,
      // l'allocation échoue et fait planter toute l'application (code 0xe0000008), sans passer par ce try/catch.
      if ((await stat(path)).size > MAX_FILE_BYTES) { cache.set(path, null); return null; }
      const bytes = await readFile(path);
      if (bytes.byteLength <= MAX_FILE_BYTES) pcm = await decodeMono(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    }
  } catch (err) {
    console.warn("[zarao] lecture du fichier impossible pour le spectre :", path, err);
    pcm = null;
  }
  // On ne garde que quelques pistes en cache : un PCM de plusieurs dizaines de Mo n'est pas gratuit.
  if (cache.size >= 3) cache.delete(cache.keys().next().value as string);
  cache.set(path, pcm);
  return pcm;
}

// --- FFT radix-2 (itérative) ---
// IMPORTANT : la taille vient des Paramètres (Audio). Les tables sont reconstruites seulement quand elle change, jamais à chaque image.
let FFT_SIZE = 0;
let HANN = new Float32Array(0);
let re = new Float32Array(0);
let im = new Float32Array(0);

function ensureTables(): void {
  const size = getAudioSettings().fftSize;
  if (size === FFT_SIZE) return;
  FFT_SIZE = size;
  HANN = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  re = new Float32Array(size);
  im = new Float32Array(size);
}

/** Lissage d'une barre : montée (`attack`) et descente (`release`) réglables, appliquées une fois par image. */
export function smoothLevel(level: number, target: number): number {
  const { attack, release } = getAudioSettings();
  return level + (target - level) * (target > level ? attack : release);
}

function fft(): void {
  const n = FFT_SIZE;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Remplit `out` (longueur = nombre de barres) avec l'énergie normalisée (0–1) du spectre à l'instant `time`.
 * Les barres suivent une répartition exponentielle : plus de résolution dans les graves.
 */
export function spectrumAt(pcm: Float32Array, time: number, out: Float32Array): void {
  ensureTables();
  const start = Math.floor(time * ANALYSIS_RATE) - FFT_SIZE / 2;
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = start + i;
    re[i] = (idx >= 0 && idx < pcm.length ? pcm[idx] : 0) * HANN[i];
    im[i] = 0;
  }
  fft();
  const half = FFT_SIZE / 2;
  const usable = half * 0.9;
  const bars = out.length;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(Math.pow(b / bars, 1.7) * usable);
    const to = Math.max(from + 1, Math.floor(Math.pow((b + 1) / bars, 1.7) * usable));
    let peak = 0;
    for (let k = from; k < to; k++) peak = Math.max(peak, Math.hypot(re[k], im[k]));
    // Échelle en dB ramenée sur 0–1 : un affichage linéaire écraserait tout sauf les graves.
    const db = 20 * Math.log10(peak / FFT_SIZE + 1e-9);
    out[b] = Math.min(1, Math.max(0, (db + 70) / 55));
  }
}
