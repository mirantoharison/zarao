import { useEffect, useRef, useState, type RefObject } from "react";
import { paletteTone } from "@/lib/palette";
import { ANALYSIS_RATE, loadPcm, peekPcm, smoothLevel, spectrumAt } from "@/lib/spectrum";

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
// Teinte/saturation du thème « zarao » : suivent la palette de l'app, rafraîchies à chaque image (cf. paletteTone).
let ZARAO_HUE = 34;
let ZARAO_SAT = 1;

/**
 * État du visualiseur conservé hors du composant.
 * IMPORTANT : le plein écran est démonté à la sortie ; sans ça, chaque entrée repartait de zéro (spectre à plat, particules
 * disparues, disque ramené à l'angle 0, pochette qui réapparaît après coup). Ici, tout est repris là où on l'avait laissé.
 */
const persisted = {
  source: undefined as string | null | undefined,
  levels: new Float32Array(BAR_COUNT),
  peaks: new Float32Array(BAR_COUNT),
  motes: [] as Mote[],
  bass: 0, beat: 0, bassAvg: 0, angle: 0,
};
/** Pochettes déjà préparées (recadrées et réduites), par URL ; "logo" pour la pochette par défaut. */
const coverCache = new Map<string, HTMLCanvasElement>();
const coverKey = (jacket?: string) => jacket || "logo";

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
  // Pochette et spectre : repris du cache s'ils existent déjà, pour un affichage immédiat à la réouverture.
  const imageRef = useRef<HTMLCanvasElement | null>(coverCache.get(coverKey(jacket)) ?? null);
  const motesRef = useRef<Mote[]>(persisted.motes);
  const levelsRef = useRef(persisted.levels);
  const peaksRef = useRef(persisted.peaks);
  const rawRef = useRef(new Float32Array(BAR_COUNT));
  const bassRef = useRef(persisted.bass);
  const beatRef = useRef(persisted.beat); // impulsion "heartbeat" : saute à 1 sur une attaque de basses, retombe vite
  const bassAvgRef = useRef(persisted.bassAvg); // moyenne lente des basses, sert de seuil de détection
  const angleRef = useRef(persisted.angle);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  // Redessin forcé : pochette, spectre ou taille qui arrivent pendant la pause doivent apparaître.
  const [tick, forceDraw] = useState(0);

  // À la sortie : on range les valeurs lissées pour la prochaine entrée.
  useEffect(() => () => {
    persisted.bass = bassRef.current; persisted.beat = beatRef.current; persisted.bassAvg = bassAvgRef.current; persisted.angle = angleRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Réinitialisation seulement si le morceau a changé : une simple réouverture du plein écran garde le spectre et les particules.
    if (persisted.source !== source) {
      persisted.source = source;
      motesRef.current.length = 0;
      levelsRef.current.fill(0);
      peaksRef.current.fill(0);
      bassRef.current = 0; beatRef.current = 0; bassAvgRef.current = 0;
    }
    const cached = source ? peekPcm(source) : undefined;
    pcmRef.current = cached ?? null;
    if (!source) { onAnalysis?.(false); return; }
    if (cached !== undefined) onAnalysis?.(cached !== null); // déjà décodé : pas d'attente
    void loadPcm(source).then((pcm) => {
      if (cancelled) return;
      pcmRef.current = pcm;
      onAnalysis?.(pcm !== null);
      forceDraw((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [source, onAnalysis]);

  useEffect(() => {
    const key = coverKey(jacket);
    const hit = coverCache.get(key);
    if (hit) { imageRef.current = hit; forceDraw((n) => n + 1); return; }
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
      if (coverCache.size >= 8) coverCache.delete(coverCache.keys().next().value as string);
      coverCache.set(key, c);
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
        : zarao ? `hsl(${ZARAO_HUE - 8 + t * 20} ${95 * ZARAO_SAT}% ${50 + level * 28}%)`
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
      { const z = paletteTone(); ZARAO_HUE = z.hue; ZARAO_SAT = z.sat; }
      const levels = levelsRef.current, peaks = peaksRef.current, raw = rawRef.current;
      if (live) spectrumAt(pcm, time, raw); else raw.fill(0);
      let bass = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        levels[i] = smoothLevel(levels[i], raw[i]);
        peaks[i] = Math.max(levels[i], peaks[i] - 0.012 * dt);
        if (i < BASS_BARS) bass += levels[i];
      }
      bass /= BASS_BARS;
      bassRef.current += (bass - bassRef.current) * (bass > bassRef.current ? 0.3 : 0.07);
      const amp = bassRef.current;
      // Détection de battement : les basses instantanées dépassent nettement leur moyenne lente (front montant).
      // IMPORTANT : seuil relatif + plancher absolu, sinon le bruit de fond déclenche des battements en continu.
      const prevAvg = bassAvgRef.current;
      bassAvgRef.current += (bass - prevAvg) * 0.04;
      if (live && bass > prevAvg * 1.25 + 0.04 && beatRef.current < 0.5) beatRef.current = 1;
      beatRef.current = live ? Math.max(0, beatRef.current - 0.06 * dt) : 0;
      const beat = beatRef.current;

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
      const glowSat = zarao ? 95 * ZARAO_SAT : 95;
      glow.addColorStop(0, `hsl(${glowHue} ${glowSat}% 60% / ${0.12 + amp * 0.3})`);
      glow.addColorStop(1, `hsl(${glowHue} ${glowSat}% 60% / 0)`);
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
      ctx.strokeStyle = rainbow ? `hsl(${(now / 20) % 360} 90% 70% / 0.85)` : zarao ? `hsl(${ZARAO_HUE + 2} ${100 * ZARAO_SAT}% 78% / 0.85)` : `hsl(${CLASSIC_HUE} 95% 82% / 0.85)`;
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

      // --- Poussière lumineuse : chaque bulle est rattachée au secteur de la couronne où elle se trouve ---
      // et réagit au niveau de CETTE barre (mêmes angles que les barres : départ en bas, sens horaire).
      // IMPORTANT : naissance pondérée par le spectre (les secteurs forts en émettent plus) ; le battement global
      // (basses) ne fait qu'ajouter une salve par-dessus.
      const motes = motesRef.current;
      if (live && !reduceMotion) {
        for (let n = 0; n < 10 && motes.length < MAX_MOTES; n++) {
          const k = Math.floor(Math.random() * BAR_COUNT);
          if (levels[k] < 0.08 || Math.random() > levels[k] * 0.9) continue;
          const a = Math.PI / 2 + (k + Math.random()) * step;
          const r0 = ringR + levels[k] * maxBar * (0.6 + Math.random() * 0.6);
          const v = 0.15 + Math.random() * 0.35;
          motes.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.8 + Math.random() * 2, life: 1, hue: (k / BAR_COUNT) * 360 });
        }
        if (beat > 0.9) {
          for (let n = 0; n < 8 && motes.length < MAX_MOTES; n++) {
            const a = Math.random() * Math.PI * 2;
            const r0 = ringR + maxBar * (0.4 + Math.random());
            const v = 0.2 + Math.random() * 0.4;
            motes.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.8 + Math.random() * 2, life: 1, hue: (a * 180) / Math.PI });
          }
        }
      }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        // Secteur courant de la bulle -> niveau de la barre correspondante.
        const ang = (Math.atan2(m.y, m.x) - Math.PI / 2 + Math.PI * 4) % (Math.PI * 2);
        const e = levels[Math.min(BAR_COUNT - 1, Math.floor(ang / step))];
        if (playing) {
          const push = 1 + e * 3 + amp + beat * 2;
          m.x += m.vx * push * dt;
          m.y += m.vy * push * dt;
          m.life -= 0.006 * dt;
        }
        if (m.life <= 0) { motes.splice(i, 1); continue; }
        // La bulle gonfle et s'illumine avec son secteur de spectre (plancher d'opacité : visible même lointaine).
        ctx.globalAlpha = Math.min(1, (Math.max(0, m.life) * 0.45 + 0.1) * (1 + e * 2.2 + beat));
        ctx.fillStyle = rainbow ? `hsl(${(m.hue + now / 25) % 360} 90% 70%)` : zarao ? `hsl(${ZARAO_HUE} ${95 * ZARAO_SAT}% 72%)` : `hsl(${CLASSIC_HUE} 90% 80%)`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * (1 + e * 1.8 + beat * 0.8), 0, Math.PI * 2);
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
