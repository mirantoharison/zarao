import { Bookmark as BookmarkIcon } from "lucide-react";
import { bookmarkColor, type Bookmark } from "@/lib/bookmarks";
import { formatTime } from "@/lib/media";
import { cn } from "@/lib/utils";

type Props = {
  list: Bookmark[];
  duration: number;
  onSeek: (sec: number) => void;
  /** Taille de l'icône (défaut : celle de la barre du lecteur). */
  iconClassName?: string;
};

/**
 * Marque-pages posés au-dessus d'une barre de progression Radix (barre du lecteur, plein écran), chacun à son instant ; un clic y mène.
 * À placer dans un conteneur `relative` qui entoure le Slider.
 * IMPORTANT : le curseur Radix (16 px) reste entièrement dans la barre : son centre va de 8 px à (largeur − 8 px), pas de 0 à la largeur,
 * d'où la correction de position. L'animation « bookmark-drop » est définie dans index.css.
 */
export function BookmarkMarkers({ list, duration, onSeek, iconClassName }: Props) {
  if (duration <= 0) return null;
  return (
    <>
      {list.filter((b) => b.t <= duration).map((b, i) => {
        const ratio = b.t / duration;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSeek(b.t)}
            title={`${b.name} · ${formatTime(b.t)}`}
            aria-label={`${b.name} · ${formatTime(b.t)}`}
            className="bookmark-drop absolute bottom-[calc(50%+9px)] z-10 -translate-x-1/2 cursor-pointer transition-transform hover:-translate-y-0.5 hover:scale-125"
            style={{ left: `calc(${ratio * 100}% + ${(0.5 - ratio) * 16}px)`, color: bookmarkColor(b), animationDelay: `${Math.min(i, 12) * 60}ms` }}
          >
            <BookmarkIcon className={cn("size-4 fill-current drop-shadow-sm", iconClassName)} strokeWidth={1.5} />
          </button>
        );
      })}
    </>
  );
}
