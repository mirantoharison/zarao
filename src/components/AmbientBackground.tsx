import { cn } from "@/lib/utils";

/**
 * Fond ambiant derrière l'interface : trois taches floues aux couleurs de Zarao qui dérivent pendant la lecture
 * et se figent (en s'estompant) en pause.
 * IMPORTANT : à placer en premier enfant d'un conteneur `isolate` ; `-z-10` reste alors dans ce contexte d'empilement
 * et passe derrière le contenu sans disparaître sous le fond de la page.
 */
export function AmbientBackground({ playing }: { playing: boolean }) {
  const blob = "ambient-blob absolute rounded-full blur-3xl will-change-transform";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" data-playing={playing}>
      <div className={cn(blob, "-left-[10vw] -top-[15vh] size-[45vw]", playing ? "opacity-25" : "opacity-10")} style={{ background: "var(--primary)", animation: "ambient-drift-a 26s infinite" }} />
      <div className={cn(blob, "-bottom-[20vh] right-[-8vw] size-[40vw]", playing ? "opacity-20" : "opacity-8")} style={{ background: "oklch(0.55 0.12 40)", animation: "ambient-drift-b 32s infinite" }} />
      <div className={cn(blob, "left-[35vw] top-[40vh] size-[30vw]", playing ? "opacity-15" : "opacity-5")} style={{ background: "oklch(0.7 0.11 90)", animation: "ambient-drift-c 38s infinite" }} />
    </div>
  );
}
