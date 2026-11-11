import { useEffect, useRef, useState, type RefObject } from "react";
import { ANALYSIS_RATE, loadPcm, spectrumAt } from "@/lib/spectrum";

export type VisualizerTheme = "classic" | "rainbow";

type Props = {
  mediaRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  /** Chemin disque (local) ou URL (en ligne) de la piste : source du spectre, cf. loadPcm. */
  source: string | null;
  /** Pochette (data URL ou URL) : tourne au centre comme un disque. */
  jacket?: string;
  theme: VisualizerTheme;
  className?: string;
  /** Signale si l'analyse audio est disponible (le décodage peut échouer ou être refusé pour un fichier énorme). */
  onAnalysis?: (available: boolean) => void;
};

type Particle = { x: number; y: number; vx: number; vy: number; size: number; hue: number; color: string };

const WAVE_POINTS = 181;
const BARS = 24;
const MAX_PARTICLES = 450;
/** Palette de l'ancien visualiseur (bleus). */
const CLASSIC_COLORS = ["rgb(30,144,255)", "rgb(0,100,200)", "rgb(169,199,229)"];
const BASS_BARS = 6;

/**
 * Visualiseur plein écran (reprise du rendu p5 d'origine, en canvas 2D) :
 * onde circulaire symétrique autour d'une pochette qui tourne, particules projetées depuis le cercle
 * (plus vite sur les basses). Les données viennent de l'analyse déjà utilisée par l'anneau du bouton lecture.
 */
export function Visualizer({ mediaRef, playing, source, jacket, theme, className, onAnalysis }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcmRef = useRef<Float32Array | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const angleRef = useRef(0);
  const ampRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  // Compteur de redessin : une pochette, un spectre ou une taille qui arrivent pendant la pause doivent être affichés.
  const [tick, forceDraw] = useState(0);

  // Décodage de la piste (asynchrone) pour l'onde et le spectre.
  useEffect(() => {
    let cancelled = false;
    pcmRef.current = null;
    particlesRef.current = [];
    if (!source) { onAnalysis?.(false); return; }
    void loadPcm(source).then((pcm) => {
      if (cancelled) return;
      pcmRef.current = pcm;
      onAnalysis?.(pcm !== null);
      forceDraw((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [source, onAnalysis]);

  // Pochette : chargée une fois par piste.
  useEffect(() => {
    imageRef.current = null;
    if (!jacket) return;
    const img = new Image();
    img.onload = () => { imageRef.current = img; forceDraw((n) => n + 1); };
    img.src = jacket;
  }, [jacket]);

  // Taille du canvas, nette sur écrans haute densité.
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr)); canvas.height = Math.max(1, Math.floor(h * dpr));
      sizeRef.current = { w, h, dpr };
      forceDraw((n) => n + 1);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Boucle de dessin : tourne en lecture, s'arrête (image figée) en pause.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const levels = new Float32Array(BARS);
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const { w, h, dpr } = sizeRef.current;
      const dt = Math.min(2.5, (now - last) / 16.67); // 1 = une image à 60 Hz ; plafonné après une mise en veille
      last = now;
      const el = mediaRef.current;
      const pcm = pcmRef.current;
      // dataset.offset : instant de départ d'un flux non direct relancé après un déplacement (cf. usePlayer.seekTo).
      const time = (el?.currentTime ?? 0) + Number(el?.dataset.offset || 0);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);

      // Énergie des basses (équivalent de getEnergy(10, 250)), lissée : montée rapide, descente lente.
      let bass = 0;
      if (playing && pcm) {
        spectrumAt(pcm, time, levels);
        for (let i = 0; i < BASS_BARS; i++) bass += levels[i];
        bass /= BASS_BARS;
      }
      ampRef.current += (bass - ampRef.current) * (bass > ampRef.current ? 0.35 : 0.08);
      const amp = ampRef.current;

      const R = Math.min(w, h) * 0.2;
      const coverR = R * 0.78;

      // --- Onde circulaire : fenêtre de 512 échantillons autour de la position courante, dessinée des deux côtés ---
      const start = Math.floor(time * ANALYSIS_RATE);
      ctx.lineWidth = Math.max(2, R * 0.03);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowBlur = 12 + amp * 18;
      for (const side of [-1, 1]) {
        if (theme === "rainbow") {
          // Un segment par degré : la teinte suit l'angle, l'onde reste continue.
          let px = 0, py = 0;
          for (let i = 0; i < WAVE_POINTS; i++) {
            const idx = start + Math.floor((i / (WAVE_POINTS - 1)) * 511);
            const s = playing && pcm && idx >= 0 && idx < pcm.length ? Math.max(-1, Math.min(1, pcm[idx] * 3)) : 0;
            const r = R + s * R * 0.32;
            const rad = (i * Math.PI) / 180;
            const x = r * Math.sin(rad) * side, y = r * Math.cos(rad);
            if (i > 0) {
              const hue = (i * 2 + (side === 1 ? 0 : 180) + now / 25) % 360;
              ctx.strokeStyle = ctx.shadowColor = `hsl(${hue} 95% 60%)`;
              ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
            }
            px = x; py = y;
          }
        } else {
          ctx.strokeStyle = "#fff"; ctx.shadowColor = "rgba(30,144,255,0.9)";
          ctx.beginPath();
          for (let i = 0; i < WAVE_POINTS; i++) {
            const idx = start + Math.floor((i / (WAVE_POINTS - 1)) * 511);
            const s = playing && pcm && idx >= 0 && idx < pcm.length ? Math.max(-1, Math.min(1, pcm[idx] * 3)) : 0;
            const r = R + s * R * 0.32;
            const rad = (i * Math.PI) / 180;
            const x = r * Math.sin(rad) * side, y = r * Math.cos(rad);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;

      // --- Particules : naissent sur le cercle et partent vers l'extérieur, plus vite sur un pic de basses ---
      const particles = particlesRef.current;
      if (playing && pcm && !reduceMotion) {
        const spawn = amp > 0.55 ? 2 : 1;
        for (let n = 0; n < spawn && particles.length < MAX_PARTICLES; n++) {
          const a = Math.random() * Math.PI * 2;
          const ux = Math.cos(a), uy = Math.sin(a);
          const v = 0.5 + Math.random() * 0.6;
          particles.push({
            x: ux * R * 1.08, y: uy * R * 1.08, vx: ux * v, vy: uy * v, size: 1 + Math.random() * 3,
            hue: (a * 180) / Math.PI, color: CLASSIC_COLORS[Math.floor(Math.random() * CLASSIC_COLORS.length)],
          });
        }
      }
      const burst = amp > 0.75 ? 3 : 1;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (playing) {
          p.vx *= 1 + 0.012 * dt; p.vy *= 1 + 0.012 * dt;
          p.x += p.vx * burst * dt * 2; p.y += p.vy * burst * dt * 2;
        }
        if (Math.abs(p.x) > w / 2 + 12 || Math.abs(p.y) > h / 2 + 12) { particles.splice(i, 1); continue; }
        ctx.fillStyle = theme === "rainbow" ? `hsl(${(p.hue + now / 20) % 360} 90% 62%)` : p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + amp * 0.8), 0, Math.PI * 2); ctx.fill();
      }

      // --- Pochette en disque, qui tourne en lecture ---
      if (playing && !reduceMotion) angleRef.current = (angleRef.current + 0.2 * dt) % 360;
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, coverR, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      if (imageRef.current) {
        ctx.rotate((angleRef.current * Math.PI) / 180);
        // "cover" carré : on recadre au centre pour ne pas déformer la pochette.
        const img = imageRef.current;
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, -coverR, -coverR, coverR * 2, coverR * 2);
      } else {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, coverR);
        g.addColorStop(0, "#3a3a3a"); g.addColorStop(1, "#1c1c1c");
        ctx.fillStyle = g; ctx.fillRect(-coverR, -coverR, coverR * 2, coverR * 2);
      }
      ctx.restore();
      // Trou central et liseré, comme sur un vinyle.
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(0, 0, coverR * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, coverR * 0.17, 0, Math.PI * 2); ctx.stroke();

      if (playing && !reduceMotion) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, theme, mediaRef, tick]);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="size-full" aria-hidden />
    </div>
  );
}
