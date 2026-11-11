import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import type { Mode } from "@/screens/ModeSelect";

const SPLASH_DURATION_MS = 1800;

/** Écran de transition affiché entre le choix du mode et l'interface cible. */
export function Splash({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const { t } = useI18n();

  // IMPORTANT : ref pour que le minuteur ne soit pas relancé à chaque re-render du parent (onDone change d'identité).
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => doneRef.current(), SPLASH_DURATION_MS);
    return () => clearTimeout(id); // évite une navigation fantôme si l'écran est démonté avant la fin.
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6" role="status" aria-live="polite">
      <img src="/zarao-logo.png" alt="" className="size-24 animate-in fade-in zoom-in-75 duration-700" />
      <div className="text-center animate-in fade-in slide-in-from-bottom-2 duration-700">
        <h1 className="text-4xl font-bold tracking-tight">Zarao</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("splash.tagline")}</p>
      </div>
      <div className="w-56 space-y-2">
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="splash-progress h-full rounded-full bg-foreground" style={{ ["--splash-duration" as string]: `${SPLASH_DURATION_MS}ms` }} />
        </div>
        <p className="text-center text-xs text-muted-foreground">{mode === "local" ? t("splash.local") : t("splash.online")}</p>
      </div>
    </div>
  );
}
