import type { MediaItem } from "@/lib/media";
import { getResumeProgress, useResumeVersion } from "@/lib/resume";
import { cn } from "@/lib/utils";

/**
 * Liseré d'avancement d'une vidéo entamée (position mémorisée / durée), à poser en bas d'un élément `relative` (ligne, carte, miniature).
 * Rien n'est affiché sans position mémorisée ou sans durée connue. Se redessine quand une position est mémorisée ou effacée.
 */
export function ResumeBar({ item, className }: { item: MediaItem; className?: string }) {
  useResumeVersion();
  const progress = getResumeProgress(item);
  if (progress === null) return null;
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 block h-[0.2rem] bg-primary/25", className)}>
      <span className="block h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
    </span>
  );
}
