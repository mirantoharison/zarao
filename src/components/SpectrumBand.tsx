import { useEffect, useRef, type RefObject } from "react";
import { getCtx } from "@/components/RainbowRing";
import { loadPcm, smoothLevel, spectrumAt } from "@/lib/spectrum";
import { ringBarColor, useVisualizerTheme } from "@/lib/visualizerTheme";
import { cn } from "@/lib/utils";

type Props = {
  /** Élément <video> qui joue (audio ou vidéo) : sa position donne l'instant à analyser. */
  mediaRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  /** Chemin disque (local) ou URL (en ligne) de la piste : source du spectre (cf. spectrumSourceOf). null = pas d'analyse possible. */
  path: string | null;
  className?: string;
};

/** Largeur d'une barre et espace entre deux barres (px CSS) : le nombre de barres s'adapte à la largeur disponible. */
const BAR_W = 3;
const GAP = 2;
const MAX_BARS = 64;

/**
 * Bande spectrale : barres verticales symétriques par rapport à l'axe central, aux couleurs du visualiseur choisi.
 * Même analyse (décodage de la piste puis FFT à la position de lecture) que l'anneau autour du bouton lecture.
 * Sans analyse possible (flux converti, décodage refusé) la bande reste au repos : un petit trait central, sans fausse animation.
 * Le dessin s'arrête dès que tout est retombé et que rien ne joue.
 */
export function SpectrumBand({ mediaRef, playing, path, className }: Props) {
  const [theme] = useVisualizerTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcmRef = useRef<Float32Array | null>(null);
  const levelsRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  const rawRef = useRef<Float32Array>(new Float32Array(MAX_BARS));
  /** Relance la boucle de dessin quand quelque chose change alors qu'elle est arrêtée (lecture, nouvelle piste, redimensionnement). */
  const kickRef = useRef<() => void>(() => undefined);

  // Décodage de la piste (asynchrone) ; la bande reste au repos tant qu'il n'est pas terminé.
  useEffect(() => {
    let cancelled = false;
    pcmRef.current = null;
    if (path) void loadPcm(path).then((pcm) => { if (!cancelled) { pcmRef.current = pcm; kickRef.current(); } });
    return () => { cancelled = true; };
  }, [path]);

  // Analyse EN DIRECT (repli pour les gros fichiers, que `loadPcm` refuse de lire en entier) : un analyseur branché sur le son en cours,
  // via `captureStream` (l'élément continue de jouer normalement). Jamais le fichier entier en mémoire.
  const analyserRef = useRef<AnalyserNode | null>(null);
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    let source: MediaStreamAudioSourceNode | null = null;
    const connect = () => {
      try {
        const capture = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
        if (!capture) return;
        const stream = capture.call(el);
        if (stream.getAudioTracks().length === 0) return;
        const analyser = getCtx().createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        source?.disconnect();
        source = getCtx().createMediaStreamSource(stream);
        source.connect(analyser); // volontairement pas relié à la sortie
        analyserRef.current = analyser;
        kickRef.current();
      } catch { analyserRef.current = null; }
    };
    el.addEventListener("playing", connect);
    if (!el.paused) connect();
    return () => { el.removeEventListener("playing", connect); source?.disconnect(); analyserRef.current = null; };
  }, [mediaRef, path]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0, height = 0, dpr = 1, count = 0, raf = 0;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      count = Math.max(1, Math.min(MAX_BARS, Math.floor((width + GAP) / (BAR_W + GAP))));
      kick();
    };

    const frame = () => {
      raf = 0;
      g.clearRect(0, 0, width, height);
      const levels = levelsRef.current, raw = rawRef.current;
      const pcm = pcmRef.current, el = mediaRef.current;
      const analyser = analyserRef.current;
      const analysing = playing && ((pcm !== null && el !== null) || analyser !== null);
      if (playing && pcm !== null && el !== null) spectrumAt(pcm, el.currentTime + Number(el.dataset.offset || 0), raw.subarray(0, count));
      else if (playing && analyser) {
        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        // Même répartition exponentielle que l'anneau : plus de barres pour les graves.
        for (let i = 0; i < count; i++) {
          const from = Math.floor(Math.pow(i / count, 1.8) * bins.length * 0.75);
          const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / count, 1.8) * bins.length * 0.75));
          let sum = 0;
          for (let b = from; b < to; b++) sum += bins[b];
          raw[i] = sum / (to - from) / 255;
        }
      }
      const span = count * (BAR_W + GAP) - GAP;
      const x0 = (width - span) / 2;
      const mid = height / 2;
      let energy = 0;
      for (let i = 0; i < count; i++) {
        levels[i] = smoothLevel(levels[i], analysing ? raw[i] : 0);
        energy += levels[i];
        // Demi-hauteur de la barre : un trait minimal toujours visible, pour que la bande ne disparaisse pas au repos.
        const half = Math.max(1, levels[i] * (mid - 1));
        g.fillStyle = levels[i] < 0.02 ? "rgba(150, 160, 170, 0.35)" : ringBarColor(themeRef.current, i / count, levels[i]);
        g.beginPath();
        g.roundRect(x0 + i * (BAR_W + GAP), mid - half, BAR_W, half * 2, BAR_W / 2);
        g.fill();
      }
      if (reduceMotion || (!playing && energy < 0.01)) return;
      raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    kickRef.current = kick;

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    return () => { observer.disconnect(); if (raf) cancelAnimationFrame(raf); kickRef.current = () => undefined; };
  }, [playing, mediaRef]);

  return (
    <div ref={wrapRef} className={cn("min-w-0", className)} aria-hidden>
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}
