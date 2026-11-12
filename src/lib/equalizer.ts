import { useSyncExternalStore } from "react";

/**
 * Égaliseur 10 bandes (Web Audio) branché sur l'élément média unique du lecteur.
 *
 * IMPORTANT : `createMediaElementSource` détourne définitivement la sortie de l'élément vers le graphe Web Audio, et le son
 * devient MUET si le média est cross-origin sans CORS (cas du protocole asset de Tauri pour les fichiers locaux).
 * On n'« engage » donc l'égaliseur qu'à la première activation : le lecteur recharge alors la piste depuis le serveur local
 * (qui envoie les en-têtes CORS) avec `crossOrigin = "anonymous"`. Une fois engagé il le reste jusqu'au redémarrage
 * (impossible de déconnecter la source) ; « désactivé » = gains remis à 0 dB, ce qui est inaudible.
 */
const STORAGE_KEY = "zarao.equalizer";
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_GAIN_LIMIT = 12; // dB
const EQ_Q = 1.1;
export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  pop: [-1, 1, 3, 4, 3, 1, -1, -1, 1, 2],
  jazz: [3, 2, 1, 2, -2, -2, 0, 1, 2, 3],
  vocal: [-3, -2, -1, 1, 4, 5, 4, 2, 0, -1],
};

export const EQ_CUSTOM_MAX = 12;
export const EQ_CUSTOM_NAME_MAX = 24;
const CUSTOM_KEY = "zarao.equalizer.custom";

/** Préréglage de l'utilisateur : gains + clé d'icône (cf. lib/preset-icons). */
export type CustomPreset = { gains: number[]; icon: string };
/** `custom` : préréglages de l'utilisateur (nom → préréglage), mémorisés dans le localStorage. */
export type EqSnapshot = { enabled: boolean; gains: number[]; engaged: boolean; custom: Record<string, CustomPreset>; /** Transposition en demi-tons (0 = aucune). Volontairement NON mémorisée : elle revient à 0 au prochain lancement. */ pitch: number };

const clampGain = (g: unknown) => Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, Number(g) || 0));

function loadCustom(): Record<string, CustomPreset> {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, CustomPreset> = {};
    // Données lues du disque : on ne garde que des tableaux de la bonne longueur, bornés.
    for (const [name, value] of Object.entries(raw)) {
      // Ancien format : tableau de gains seul (sans icône).
      const obj = Array.isArray(value) ? null : (value as { gains?: unknown; icon?: unknown } | null);
      const gains = Array.isArray(value) ? value : obj?.gains;
      const icon = typeof obj?.icon === "string" ? obj.icon : "";
      if (Array.isArray(gains) && gains.length === EQ_FREQUENCIES.length) out[name.slice(0, EQ_CUSTOM_NAME_MAX)] = { gains: gains.map(clampGain), icon };
    }
    return out;
  } catch {
    return {};
  }
}

function load(): Pick<EqSnapshot, "enabled" | "gains"> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { enabled?: boolean; gains?: number[] } | null;
    const gains = Array.isArray(raw?.gains) && raw.gains.length === EQ_FREQUENCIES.length ? raw.gains.map(clampGain) : EQ_PRESETS.flat;
    return { enabled: Boolean(raw?.enabled), gains };
  } catch {
    return { enabled: false, gains: EQ_PRESETS.flat };
  }
}

let snapshot: EqSnapshot = { ...load(), engaged: false, custom: loadCustom(), pitch: 0 };
const listeners = new Set<() => void>();

function commit(next: Partial<EqSnapshot>) {
  snapshot = { ...snapshot, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: snapshot.enabled, gains: snapshot.gains }));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(snapshot.custom));
  } catch { /* quota/privé : non bloquant */ }
  applyGains();
  applyPitch();
  listeners.forEach((l) => l());
}

// --- Graphe audio (créé à la demande) ---
let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function build(): AudioContext {
  const c = new AudioContext();
  filters = EQ_FREQUENCIES.map((freq, i) => {
    const f = c.createBiquadFilter();
    // Étagères aux extrémités : les bandes extrêmes agissent sur tout le spectre qui les dépasse.
    f.type = i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
    f.frequency.value = freq;
    f.Q.value = EQ_Q;
    return f;
  });
  filters.forEach((f, i) => f.connect(filters[i + 1] ?? c.destination));
  // Point d'entrée unique : les sources s'y branchent, et le transpositeur vient s'intercaler après coup.
  pre = c.createGain();
  pre.connect(filters[0]);
  ctx = c;
  return c;
}

function applyGains() {
  if (!ctx) return;
  filters.forEach((f, i) => f.gain.setTargetAtTime(snapshot.enabled ? snapshot.gains[i] : 0, ctx!.currentTime, 0.02));
}

/** Branche l'élément sur la chaîne de filtres (idempotent). À appeler APRÈS `crossOrigin` et avant de fixer `src`. */
export function attachEqualizer(el: HTMLMediaElement): void {
  const c = ctx ?? build();
  if (!sources.has(el)) {
    const source = c.createMediaElementSource(el);
    source.connect(pre!);
    sources.set(el, source);
    // Un contexte créé hors geste utilisateur démarre suspendu : on le réveille à chaque lecture.
    el.addEventListener("play", () => void c.resume());
  }
  void c.resume();
  applyGains();
  applyPitch();
  snapshot = { ...snapshot, engaged: true };
  listeners.forEach((l) => l());
}


/**
 * Transposition en direct (sans changer la vitesse) : deux têtes de lecture glissent dans un tampon circulaire, décalées d'une
 * demi-fenêtre et fondues par sin²/cos² (somme = 1). Qualité correcte jusqu'à environ ±5 demi-tons ; au-delà, un léger effet de
 * modulation devient audible — limite de la méthode, pas un bogue. IMPORTANT : le code est une chaîne chargée via un Blob,
 * car un AudioWorklet s'exécute dans son propre contexte et ne peut pas importer le code du bundle.
 */
const PITCH_WORKLET = `
class ZaraoPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }]; }
  constructor() {
    super();
    this.W = 2048;
    this.size = 8192;
    this.bufs = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0; this.phase = 0; this.wet = 0;
  }
  read(buf, pos) {
    const m = this.size - 1, i0 = Math.floor(pos), f = pos - i0;
    return buf[i0 & m] * (1 - f) + buf[(i0 + 1) & m] * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;
    while (this.bufs.length < output.length) this.bufs.push(new Float32Array(this.size));
    const ratio = params.ratio[0];
    const target = Math.abs(ratio - 1) < 1e-4 ? 0 : 1;
    const frames = output[0].length, W = this.W, m = this.size - 1, step = (1 - ratio) / W;
    for (let i = 0; i < frames; i++) {
      this.wet += (target - this.wet) * 0.002;
      const p1 = this.phase, p2 = (this.phase + 0.5) % 1;
      const g1 = Math.sin(Math.PI * p1) ** 2, g2 = 1 - g1;
      const pos1 = this.w - 2 - p1 * W, pos2 = this.w - 2 - p2 * W;
      for (let c = 0; c < output.length; c++) {
        const dry = input[Math.min(c, input.length - 1)][i], buf = this.bufs[c];
        buf[this.w & m] = dry;
        const wetSample = this.read(buf, pos1) * g1 + this.read(buf, pos2) * g2;
        output[c][i] = dry * (1 - this.wet) + wetSample * this.wet;
      }
      this.w = (this.w + 1) & m;
      this.phase += step;
      if (this.phase < 0) this.phase += 1; else if (this.phase >= 1) this.phase -= 1;
    }
    return true;
  }
}
registerProcessor("zarao-pitch", ZaraoPitch);
`;

let pre: GainNode | null = null;
let pitchNode: AudioWorkletNode | null = null;
let pitchLoading = false;
let pitchFailed = false;

/** Insère le transpositeur entre la source et les filtres (une seule fois, au premier réglage non nul). */
async function loadPitch(): Promise<void> {
  if (!ctx || !pre) return;
  const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, "zarao-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
    pre.disconnect();
    pre.connect(node);
    node.connect(filters[0]);
    pitchNode = node;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function applyPitch() {
  if (!ctx) return;
  if (!pitchNode) {
    if (snapshot.pitch !== 0 && !pitchLoading && !pitchFailed) {
      pitchLoading = true;
      loadPitch()
        .catch((err) => { pitchFailed = true; console.warn("[zarao] transposition indisponible :", err); })
        .finally(() => { pitchLoading = false; if (pitchNode) applyPitch(); });
    }
    return;
  }
  pitchNode.parameters.get("ratio")?.setTargetAtTime(2 ** (snapshot.pitch / 12), ctx.currentTime, 0.03);
}

/**
 * Courbe de réponse (dB) de la chaîne de filtres pour `gains`, sur `points` positions réparties sur toute la largeur de l'affichage.
 * Les 10 bandes étant espacées d'une octave, la position x (0–1) d'une bande i est (i + 0.5) / 10 : la courbe s'aligne sur les curseurs.
 * Calcul direct (formules RBJ du « Audio EQ Cookbook », celles de Web Audio) : fonctionne même avant que le graphe audio n'existe.
 */
export function responseDb(gains: number[], points = 96): number[] {
  const fs = 48000;
  const last = EQ_FREQUENCIES.length - 1;
  const out: number[] = [];
  for (let k = 0; k < points; k++) {
    const x = k / (points - 1);
    const freq = EQ_FREQUENCIES[0] * 2 ** (x * EQ_FREQUENCIES.length - 0.5);
    const w = (2 * Math.PI * freq) / fs;
    const cw = Math.cos(w), sw = Math.sin(w);
    let db = 0;
    EQ_FREQUENCIES.forEach((f0, i) => {
      const g = gains[i];
      if (!g) return;
      const A = 10 ** (g / 40);
      const w0 = (2 * Math.PI * f0) / fs;
      const c0 = Math.cos(w0), s0 = Math.sin(w0);
      let b: [number, number, number], a: [number, number, number];
      if (i === 0 || i === last) {
        const alpha = (s0 / 2) * Math.SQRT2; // pente S = 1
        const t = 2 * Math.sqrt(A) * alpha;
        if (i === 0) {
          b = [A * ((A + 1) - (A - 1) * c0 + t), 2 * A * ((A - 1) - (A + 1) * c0), A * ((A + 1) - (A - 1) * c0 - t)];
          a = [(A + 1) + (A - 1) * c0 + t, -2 * ((A - 1) + (A + 1) * c0), (A + 1) + (A - 1) * c0 - t];
        } else {
          b = [A * ((A + 1) + (A - 1) * c0 + t), -2 * A * ((A - 1) + (A + 1) * c0), A * ((A + 1) + (A - 1) * c0 - t)];
          a = [(A + 1) - (A - 1) * c0 + t, 2 * ((A - 1) - (A + 1) * c0), (A + 1) - (A - 1) * c0 - t];
        }
      } else {
        const alpha = s0 / (2 * EQ_Q);
        b = [1 + alpha * A, -2 * c0, 1 - alpha * A];
        a = [1 + alpha / A, -2 * c0, 1 - alpha / A];
      }
      // |H(e^jw)|² = |b0 + b1 e^-jw + b2 e^-2jw|² / |a0 + a1 e^-jw + a2 e^-2jw|²
      const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      const nr = b[0] + b[1] * cw + b[2] * c2, ni = -(b[1] * sw + b[2] * s2);
      const dr = a[0] + a[1] * cw + a[2] * c2, di = -(a[1] * sw + a[2] * s2);
      db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
    });
    out.push(db);
  }
  return out;
}

export const getEqualizer = () => snapshot;
export const EQ_PITCH_LIMIT = 12;
/** Faut-il router l'audio dans Web Audio ? Oui dès que l'égaliseur est actif OU qu'une transposition est demandée. */
export const wantsEqualizerGraph = (s: Pick<EqSnapshot, "enabled" | "pitch"> = snapshot) => s.enabled || s.pitch !== 0;
export const setEqualizerPitch = (semitones: number) => commit({ pitch: Math.max(-EQ_PITCH_LIMIT, Math.min(EQ_PITCH_LIMIT, Math.round(semitones * 2) / 2)) });
export const setEqualizerEnabled = (enabled: boolean) => commit({ enabled });
export const setEqualizerBand = (index: number, gain: number) => commit({ gains: snapshot.gains.map((g, i) => (i === index ? Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, gain)) : g)) });
export const setEqualizerPreset = (name: string) => EQ_PRESETS[name] && commit({ gains: [...EQ_PRESETS[name]] });
export const applyCustomPreset = (name: string) => snapshot.custom[name] && commit({ gains: [...snapshot.custom[name].gains] });

/** Enregistre les réglages actuels sous `name` avec son icône (écrase un préréglage du même nom). Retourne false si le nom est vide ou la limite atteinte. */
export function saveCustomPreset(name: string, icon: string): boolean {
  const clean = name.trim().slice(0, EQ_CUSTOM_NAME_MAX);
  if (!clean || (!(clean in snapshot.custom) && Object.keys(snapshot.custom).length >= EQ_CUSTOM_MAX)) return false;
  commit({ custom: { ...snapshot.custom, [clean]: { gains: [...snapshot.gains], icon } } });
  return true;
}

export function deleteCustomPreset(name: string): void {
  const { [name]: _removed, ...rest } = snapshot.custom;
  commit({ custom: rest });
}

export function useEqualizer(): EqSnapshot {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getEqualizer);
}
