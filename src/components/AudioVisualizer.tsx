import { useEffect, useRef, useState, type RefObject } from "react";
import { ANALYSIS_RATE, loadPcm, spectrumAt } from "@/lib/spectrum";

export type AudioVisualizerTheme = "zarao" | "classic" | "rainbow";

type Props = {
  mediaRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  /** Chemin disque (local) ou URL (en ligne) de la piste : source du spectre, cf. loadPcm. */
  source: string | null;
  /** Pochette (data URL ou URL) : affichée au centre, en disque qui tourne doucement. */
  jacket?: string;
  theme: AudioVisualizerTheme;
  className?: string;
  /** Signale si l'analyse audio est disponible (décodage possible / fichier pas trop volumineux). */
  onAnalysis?: (available: boolean) => void;
};

type Mote = { x: number; y: number; vx: number; vy: number; r: number; life: number; hue: number };

/** Nombre total de barres autour de la pochette (un seul tour de spectre). */
const BAR_COUNT = 260;
const BASS_BARS = 10;
const MAX_MOTES = 70;
const MAX_DPR = 1.5;
/** Taille de la pochette pré-redimensionnée : évite de redessiner une image de 1000 px+ à chaque image. */
const COVER_CACHE_PX = 512;
/** Teinte de base du thème « classique » (bleu de l'app). */
const CLASSIC_HUE = 212;
/** Teinte « Zarao » : l'orange du casque du logo ; les barres glissent de l'ambre vers l'orangé selon leur position. */
const ZARAO_HUE = 34;

/**
 * Visualiseur plein écran moderne (canvas 2D, sans bibliothèque) :
 * couronne de barres capsules (spectre sur 360°) avec crêtes qui retombent, halo qui respire sur les basses,
 * onde fine intérieure, pochette en disque et poussière lumineuse. Même contrat que l'ancien `Visualizer`.
 *
 * IMPORTANT : tout est dérivé d'une seule valeur de basses lissée (montée rapide, descente lente) ;
 * des valeurs brutes feraient clignoter le halo à chaque image.
 */
export function AudioVisualizer({ mediaRef, playing, source, jacket, theme, className, onAnalysis }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcmRef = useRef<Float32Array | null>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);
  const motesRef = useRef<Mote[]>([]);
  const levelsRef = useRef(new Float32Array(BAR_COUNT));
  const peaksRef = useRef(new Float32Array(BAR_COUNT));
  const rawRef = useRef(new Float32Array(BAR_COUNT));
  const bassRef = useRef(0);
  const angleRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  // Redessin forcé : pochette, spectre ou taille qui arrivent pendant la pause doivent apparaître.
  const [tick, forceDraw] = useState(0);

  useEffect(() => {
    let cancelled = false;
    pcmRef.current = null;
    motesRef.current = [];
    levelsRef.current.fill(0);
    peaksRef.current.fill(0);
    if (!source) { onAnalysis?.(false); return; }
    void loadPcm(source).then((pcm) => {
      if (cancelled) return;
      pcmRef.current = pcm;
      onAnalysis?.(pcm !== null);
      forceDraw((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [source, onAnalysis]);

  useEffect(() => {
    imageRef.current = null;
    // Sans pochette, le logo Zarao sert de pochette par défaut (posé sur fond sombre, avec une marge pour rester dans le disque).
    const isLogo = !jacket;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const g = c.getContext("2d");
      if (isLogo) {
        c.width = c.height = COVER_CACHE_PX;
        if (g) {
          g.fillStyle = "#1b1b1b";
          g.fillRect(0, 0, c.width, c.height);
          const pad = c.width * 0.1;
          g.drawImage(img, pad, pad, c.width - pad * 2, c.height - pad * 2);
        }
      } else {
        // Recadrage carré centré + réduction faits une seule fois ; la boucle ne dessine plus que ce petit canvas.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        c.width = c.height = Math.min(COVER_CACHE_PX, side);
        g?.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, c.width, c.height);
      }
      imageRef.current = c;
      forceDraw((n) => n + 1);
    };
    img.src = jacket || "/zarao-logo.png";
  }, [jacket]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      // IMPORTANT : DPR plafonné à 1,5 — un plein écran 4K à DPR 2-3 multiplie le coût de remplissage par 4 à 9 pour un gain invisible.
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      sizeRef.current = { w, h, dpr };
      forceDraw((n) => n + 1);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rainbow = theme === "rainbow";
    const zarao = theme === "zarao";
    /** Couleur d'une barre : arc-en-ciel (`shift` = teinte en degrés, déjà calculée selon la position sur le cercle), ou nuances de bleu selon l'intensité. */
    const tone = (t: number, level: number, shift: number) =>
      rainbow ? `hsl(${shift % 360} 90% ${55 + level * 15}%)`
        : zarao ? `hsl(${ZARAO_HUE - 8 + t * 20} 95% ${50 + level * 28}%)`
        : `hsl(${CLASSIC_HUE - 12 + t * 24} 95% ${58 + level * 28}%)`;
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const { w, h, dpr } = sizeRef.current;
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      const el = mediaRef.current;
      const pcm = pcmRef.current;
      // dataset.offset : instant de départ d'un flux relancé après un déplacement (cf. usePlayer.seekTo).
      const time = (el?.currentTime ?? 0) + Number(el?.dataset.offset || 0);
      const live = playing && !!pcm;

      // --- Données : spectre lissé (attaque rapide, relâchement lent) et crêtes qui retombent ---
      const levels = levelsRef.current, peaks = peaksRef.current, raw = rawRef.current;
      if (live) spectrumAt(pcm, time, raw); else raw.fill(0);
      let bass = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        levels[i] += (raw[i] - levels[i]) * (raw[i] > levels[i] ? 0.5 : 0.12);
        peaks[i] = Math.max(levels[i], peaks[i] - 0.012 * dt);
        if (i < BASS_BARS) bass += levels[i];
      }
      bass /= BASS_BARS;
      bassRef.current += (bass - bassRef.current) * (bass > bassRef.current ? 0.3 : 0.07);
      const amp = bassRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);

      const base = Math.min(w, h);
      const R = base * 0.2; // rayon de la pochette
      const ringR = R * 1.22; // rayon intérieur de la couronne
      const maxBar = base * 0.17;

      // --- Halo qui respire ---
      const glowR = ringR + maxBar * (0.6 + amp);
      const glow = ctx.createRadialGradient(0, 0, ringR * 0.8, 0, 0, glowR * 1.5);
      const glowHue = rainbow ? (now / 30) % 360 : zarao ? ZARAO_HUE : CLASSIC_HUE;
      glow.addColorStop(0, `hsl(${glowHue} 95% 60% / ${0.12 + amp * 0.3})`);
      glow.addColorStop(1, `hsl(${glowHue} 95% 60% / 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, glowR * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // --- Couronne de barres capsules : le spectre complet fait UN tour, sans symétrie. ---
      // Départ en bas (grave), sens horaire, l'aigu revient finir juste avant le départ.
      // IMPORTANT : aucun shadowBlur ni mode "lighter" (coûteux × 260 barres) ; le halo est simulé par un trait plus large et translucide.
      ctx.lineCap = "round";
      const step = (Math.PI * 2) / BAR_COUNT;
      const barW = Math.max(1.5, ((ringR * Math.PI * 2) / BAR_COUNT) * 0.62);
      for (let pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? barW * 2.4 : barW;
        ctx.globalAlpha = pass === 0 ? 0.16 : 1;
        for (let i = 0; i < BAR_COUNT; i++) {
          if (pass === 0 && levels[i] < 0.12) continue; // pas de halo sur les barres quasi muettes
          const a = Math.PI / 2 + (i + 0.5) * step; // part du bas (π/2 en repère canvas)
          const len = 3 + levels[i] * maxBar;
          const cos = Math.cos(a), sin = Math.sin(a);
          // La teinte suit l'index : l'arc-en-ciel fait un seul tour, et défile doucement avec le temps.
          ctx.strokeStyle = tone(i / BAR_COUNT, levels[i], (i / BAR_COUNT) * 360 + now / 40);
          ctx.beginPath();
          ctx.moveTo(cos * ringR, sin * ringR);
          ctx.lineTo(cos * (ringR + len), sin * (ringR + len));
          ctx.stroke();
          // Crête : petit point qui retombe lentement derrière la barre.
          if (pass === 1 && peaks[i] > 0.04) {
            ctx.globalAlpha = 0.7;
            const pr = ringR + 8 + peaks[i] * maxBar;
            ctx.beginPath();
            ctx.moveTo(cos * pr, sin * pr);
            ctx.lineTo(cos * (pr + 0.1), sin * (pr + 0.1));
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      ctx.globalAlpha = 1;

      // --- Onde fine intérieure : forme d'onde réelle autour de la pochette ---
      const start = Math.floor(time * ANALYSIS_RATE);
      const WAVE = 96;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rainbow ? `hsl(${(now / 20) % 360} 90% 70% / 0.85)` : zarao ? `hsl(${ZARAO_HUE + 2} 100% 78% / 0.85)` : `hsl(${CLASSIC_HUE} 95% 82% / 0.85)`;
      ctx.beginPath();
      for (let i = 0; i <= WAVE; i++) {
        const idx = start + Math.floor((i / WAVE) * 511);
        const s = live && idx >= 0 && idx < pcm.length ? Math.max(-1, Math.min(1, pcm[idx] * 3)) : 0;
        const a = (i / WAVE) * Math.PI * 2;
        const r = R * 1.08 + s * R * 0.1;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      // --- Poussière lumineuse : dérive lente, un peu accélérée par les basses ---
      const motes = motesRef.current;
      if (live && !reduceMotion && motes.length < MAX_MOTES && Math.random() < 0.35 + amp) {
        const a = Math.random() * Math.PI * 2;
        const r0 = ringR + maxBar * 0.4 + Math.random() * maxBar;
        const v = 0.15 + Math.random() * 0.35;
        motes.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.8 + Math.random() * 2, life: 1, hue: (a * 180) / Math.PI });
      }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        if (playing) {
          m.x += m.vx * (1 + amp * 2) * dt;
          m.y += m.vy * (1 + amp * 2) * dt;
          m.life -= 0.006 * dt;
        }
        if (m.life <= 0) { motes.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, m.life) * 0.8;
        ctx.fillStyle = rainbow ? `hsl(${(m.hue + now / 25) % 360} 90% 70%)` : zarao ? `hsl(${ZARAO_HUE} 95% 72%)` : `hsl(${CLASSIC_HUE} 90% 80%)`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // --- Pochette : disque qui pulse légèrement et tourne doucement ---
      if (playing && !reduceMotion) angleRef.current = (angleRef.current + 0.12 * dt) % 360;
      const coverR = R * (1 + amp * 0.04);
      ctx.save();
      // Pas de shadowBlur ici : un flou recalculé à chaque image est l'un des gestes les plus coûteux du canvas.
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(0, 0, coverR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, coverR, 0, Math.PI * 2);
      ctx.clip();
      const img = imageRef.current;
      ctx.save();
      if (img) {
        ctx.rotate((angleRef.current * Math.PI) / 180);
        ctx.drawImage(img, -coverR, -coverR, coverR * 2, coverR * 2);
      } else {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, coverR);
        g.addColorStop(0, "#3a3a3a");
        g.addColorStop(1, "#1a1a1a");
        ctx.fillStyle = g;
        ctx.fillRect(-coverR, -coverR, coverR * 2, coverR * 2);
      }
      ctx.restore(); // fin de la rotation : le reflet ci-dessous reste fixe
      const sheen = ctx.createLinearGradient(-coverR, -coverR, coverR, coverR);
      sheen.addColorStop(0, "rgba(255,255,255,0.14)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = sheen;
      ctx.fillRect(-coverR, -coverR, coverR * 2, coverR * 2);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, coverR, 0, Math.PI * 2);
      ctx.stroke();

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
