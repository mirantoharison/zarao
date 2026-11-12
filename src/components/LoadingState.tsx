import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Ce qui est en cours de chargement, formulé précisément (ex. « Chargement des nouveautés… »). */
  title: string;
  /** Une phrase qui rassure ou explique l'attente. */
  description?: string;
  /** Variante compacte pour les petits panneaux et boîtes de dialogue. */
  compact?: boolean;
  className?: string;
};

/**
 * État de chargement : loader animé + texte contextuel. Pendant du `EmptyState`, même gabarit,
 * pour que le passage chargement -> contenu (ou -> vide) ne fasse pas sauter la mise en page.
 * IMPORTANT : `role="status"` + `aria-live` pour que les lecteurs d'écran annoncent le chargement.
 */
export function LoadingState({ title, description, compact, className }: Props) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center text-center", compact ? "gap-2 px-4 py-5" : "gap-3 px-6 py-12", className)}>
      <div className={cn("relative grid place-items-center rounded-full bg-muted text-muted-foreground", compact ? "size-10" : "size-16")}>
        <Loader2 className={cn("animate-spin", compact ? "size-5" : "size-8")} aria-hidden />
      </div>
      <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</h3>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
