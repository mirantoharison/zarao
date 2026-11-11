import type { ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "info" explique à quoi sert un écran ; "warning" dit ce qu'une action engage (suppression, perte de données).
 * IMPORTANT : l'ambre est réservé à l'avertissement — peindre une simple explication en ambre suggérerait un problème là où il n'y a rien à craindre.
 */
const TONES = {
  info: { border: "border-sky-500/50", accent: "text-sky-500", Icon: Info },
  warning: { border: "border-amber-500/60", accent: "text-amber-500", Icon: TriangleAlert },
} as const;

/** Transforme les `<b>…</b>` d'un texte traduit en `<strong>` (les traductions restent du texte simple, sans HTML injecté). */
export function boldMarkup(text: string): ReactNode[] {
  return text.split(/<b>(.*?)<\/b>/g).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/**
 * Note de page (même rendu que dans le projet Nemo) : liseré coloré, icône et paragraphe.
 * `<strong>` marque les noms de boutons et les points importants ; poids et couleur sont appliqués ici, une fois.
 */
export function InfoNote({ children, label, tone = "info", className }: { children: ReactNode; label?: string; tone?: keyof typeof TONES; className?: string }) {
  const { border, accent, Icon } = TONES[tone];
  return (
    <section aria-label={label} className={cn("border-l-2 bg-muted/40 py-3 pl-4 pr-4", border, className)}>
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden="true" className={cn("mt-1 size-5 shrink-0", accent)} />
        <p className="text-sm leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">{children}</p>
      </div>
    </section>
  );
}
