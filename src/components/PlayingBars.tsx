import { cn } from "@/lib/utils";

// Durées et décalages différents par barre : des cycles identiques donneraient un mouvement mécanique.
const BARS = [
  { duration: "0.9s", delay: "-0.2s" },
  { duration: "0.7s", delay: "-0.5s" },
  { duration: "1.1s", delay: "-0.1s" },
  { duration: "0.8s", delay: "-0.6s" },
  { duration: "1s", delay: "-0.35s" },
];

/**
 * Indicateur "piste en cours" : 5 barres animées, figées (basses) en pause.
 * IMPORTANT : animation CSS décorative — elle ne suit pas le son (le vrai spectre est dans RainbowRing).
 */
export function PlayingBars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cn("mx-auto flex h-3.5 w-4 items-end justify-between", className)} role="img" aria-label={playing ? "En lecture" : "En pause"}>
      {BARS.map((b, i) => (
        <span
          key={i}
          className="eq-bar w-[2px] rounded-full bg-foreground"
          style={{ animationDuration: b.duration, animationDelay: b.delay, animationPlayState: playing ? "running" : "paused" }}
        />
      ))}
    </span>
  );
}
