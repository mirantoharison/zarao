import { useEffect, useRef, useState } from "react";
import { AudioLines, Lightbulb, MicVocal, SlidersVertical, Waves } from "lucide-react";
import { useI18n, type TKey } from "@/i18n";
import type { Mode } from "@/screens/ModeSelect";

/** Assez long pour lire une astuce ; la barre de progression suit cette durée. */
const SPLASH_DURATION_MS = 2800;

const SHARED_TIPS: TKey[] = ["splash.tip.fullscreen", "splash.tip.zoom", "splash.tip.eq", "splash.tip.lyrics", "splash.tip.palette"];
const TIPS: Record<Mode, TKey[]> = {
  local: [...SHARED_TIPS, "splash.tip.drop", "splash.tip.shortcuts"],
  online: [...SHARED_TIPS, "splash.tip.playlist", "splash.tip.layout"],
};

const FEATURES = [
  { icon: AudioLines, label: "splash.f.audio" },
  { icon: SlidersVertical, label: "splash.f.eq" },
  { icon: MicVocal, label: "splash.f.lyrics" },
  { icon: Waves, label: "splash.f.visual" },
] as const;

/** Délai d'apparition échelonné : chaque bloc entre un peu après le précédent. */
const stagger = (ms: number) => ({ animationDelay: `${ms}ms`, animationFillMode: "backwards" as const });

/** Écran de transition affiché entre le choix du mode et l'interface cible : identité, fonctionnalités et une astuce. */
export function Splash({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const { t } = useI18n();
  // Une astuce au hasard par lancement, choisie une seule fois (pas à chaque rendu, sinon elle changerait en cours d'affichage).
  const [tip] = useState<TKey>(() => { const list = TIPS[mode]; return list[Math.floor(Math.random() * list.length)]; });

  // IMPORTANT : ref pour que le minuteur ne soit pas relancé à chaque re-render du parent (onDone change d'identité).
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => doneRef.current(), SPLASH_DURATION_MS);
    return () => clearTimeout(id); // évite une navigation fantôme si l'écran est démonté avant la fin.
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 p-6" role="status" aria-live="polite">
      <img src="/zarao-logo.png" alt="" className="size-24 animate-in fade-in zoom-in-75 duration-700" />
      <div className="animate-in fade-in slide-in-from-bottom-2 text-center duration-700" style={stagger(100)}>
        <h1 className="text-4xl font-bold tracking-tight">Zarao</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("splash.tagline")}</p>
      </div>

      {/* Ce que fait l'application, en un coup d'œil */}
      <ul className="flex max-w-xl flex-wrap justify-center gap-2" aria-label="Zarao">
        {FEATURES.map(({ icon: Icon, label }, i) => (
          <li key={label} className="flex animate-in items-center gap-1.5 rounded-full border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground fade-in slide-in-from-bottom-2 duration-500" style={stagger(300 + i * 120)}>
            <Icon className="size-3.5 text-primary" /> {t(label)}
          </li>
        ))}
      </ul>

      {/* Astuce du lancement */}
      <div className="animate-in fade-in slide-in-from-bottom-2 w-full max-w-md rounded-xl border bg-card/60 p-4 backdrop-blur-sm duration-500" style={stagger(800)}>
        <p className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-primary"><Lightbulb className="size-3.5" /> {t("splash.tipLabel")}</p>
        <p className="text-sm leading-relaxed">{t(tip)}</p>
      </div>

      <div className="w-56 space-y-2">
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="splash-progress h-full rounded-full bg-primary" style={{ ["--splash-duration" as string]: `${SPLASH_DURATION_MS}ms` }} />
        </div>
        <p className="text-center text-xs text-muted-foreground">{mode === "local" ? t("splash.local") : t("splash.online")}</p>
      </div>

      <p className="text-xs text-muted-foreground/70">Zarao © 2026</p>
    </div>
  );
}
