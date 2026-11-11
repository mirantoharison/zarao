import { useEffect, useRef, type RefObject } from "react";
import { loadPcm, spectrumAt } from "@/lib/spectrum";

type Props = {
  /** Élément <video> qui joue (audio ou vidéo). */
  mediaRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  /** Change à chaque piste : force la reconnexion du flux audio capturé. */
  trackId?: string | null;
  /** Chemin disque de la piste : source du spectre (décodage par l'app, sans CORS). */
  path?: string | null;
  /** Rayon intérieur (px CSS) : celui du bouton entouré, plus une marge. */
  innerRadius?: number;
  /** Taille du canvas en px CSS (carré). */
  size?: number;
};

const BAR_COUNT = 56;
const MAX_BAR = 18;

// Un seul AudioContext pour toute l'app : le navigateur plafonne leur nombre.
let sharedCtx: AudioContext | null = null;
const getCtx = () => (sharedCtx ??= new AudioContext());

/**
 * Spectrogramme circulaire aux couleurs de l'arc-en-ciel, dessiné autour du bouton lecture.
 *
 * IMPORTANT : on lit le son via `captureStream()` et NON via `createMediaElementSource()`.
 * Ce dernier réachemine tout l'audio de l'élément ; si le média est servi sans en-tête CORS
 * (cas possible du protocole asset de Tauri), la sortie deviendrait silencieuse. Avec
 * captureStream l'élément continue de jouer normalement : au pire, l'anneau reste plat.
 */
export function RainbowRing({ mediaRef, playing, trackId, path, innerRadius: innerRadiusProp, size = 112 }: Props) {
  // Le bouton (size-14 = 3,5 rem) suit l'échelle globale du root : on en dérive le rayon plutôt que de le figer en px.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const innerRadius = innerRadiusProp ?? 1.75 * rem + 4;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmRef = useRef<Float32Array | null>(null);
  const rawRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

  // Décode la piste courante pour le spectre (asynchrone ; l'anneau reste plat tant que ce n'est pas prêt).
  useEffect(() => {
    let cancelled = false;
    pcmRef.current = null;
    if (path) void loadPcm(path).then((pcm) => { if (!cancelled) pcmRef.current = pcm; });
    return () => { cancelled = true; };
  }, [path]);

  // (Re)branche l'analyseur sur le flux de la piste courante.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;

    const connect = () => {
      try {
        const capture = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
        if (!capture) return;
        const stream = capture.call(el);
        if (stream.getAudioTracks().length === 0) return;
        const ctx = getCtx();
        sourceRef.current?.disconnect();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser); // volontairement pas relié à ctx.destination
        sourceRef.current = source;
        analyserRef.current = analyser;
      } catch {
        analyserRef.current = null; // flux indisponible : anneau plat
      }
    };

    // Les pistes du flux n'existent qu'une fois la lecture démarrée.
    el.addEventListener("playing", connect);
    if (!el.paused) connect();
    return () => {
      el.removeEventListener("playing", connect);
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      analyserRef.current = null;
    };
  }, [mediaRef, trackId]);

  useEffect(() => {
    if (playing && sharedCtx?.state === "suspended") void sharedCtx.resume();
  }, [playing]);

  // Boucle de dessin.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const levels = levelsRef.current;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;
    const c = size / 2;

    const frame = () => {
      const analyser = analyserRef.current;
      if (analyser && (!bins || bins.length !== analyser.frequencyBinCount)) bins = new Uint8Array(analyser.frequencyBinCount);

      g.clearRect(0, 0, size, size);
      let energy = 0;
      const pcm = pcmRef.current;
      const el = mediaRef.current;
      const raw = rawRef.current;
      if (playing && pcm && el) spectrumAt(pcm, el.currentTime + Number(el.dataset.offset || 0), raw);
      for (let i = 0; i < BAR_COUNT; i++) {
        let target = 0;
        if (playing && pcm && el) {
          target = raw[i];
        } else if (playing && analyser && bins) {
          if (i === 0) analyser.getByteFrequencyData(bins);
          // Répartition exponentielle : plus de barres pour les graves, où se trouve l'essentiel de l'énergie.
          const from = Math.floor(Math.pow(i / BAR_COUNT, 1.8) * bins.length * 0.75);
          const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / BAR_COUNT, 1.8) * bins.length * 0.75));
          let sum = 0;
          for (let b = from; b < to; b++) sum += bins[b];
          target = sum / (to - from) / 255;
        }
        // Montée rapide, descente lente : un rendu plus lisible qu'un affichage brut.
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.5 : 0.12);
        energy += levels[i];

        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2; // départ en haut, sens horaire
        // Aucune longueur minimale : au repos ou en pause (niveaux retombés à ~0), rien ne doit être dessiné.
        if (levels[i] < 0.02) continue;
        const len = 1.5 + levels[i] * MAX_BAR;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        g.strokeStyle = `hsl(${(i / BAR_COUNT) * 360}, 90%, ${55 + levels[i] * 15}%)`;
        g.lineWidth = 2.6;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(c + cos * innerRadius, c + sin * innerRadius);
        g.lineTo(c + cos * (innerRadius + len), c + sin * (innerRadius + len));
        g.stroke();
      }

      // On cesse de redessiner quand tout est retombé et que rien ne joue.
      if (reduceMotion || (!playing && energy < 0.01)) { raf = 0; return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [playing, size, innerRadius, mediaRef]);

  return <canvas ref={canvasRef} aria-hidden style={{ width: size, height: size }} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />;
}
