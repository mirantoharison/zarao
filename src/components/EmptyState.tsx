import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EmptyAction = { label: string; onClick: () => void; icon?: LucideIcon; variant?: "default" | "outline" | "secondary" };

type Props = {
  icon: LucideIcon;
  title: string;
  /** Une phrase qui explique pourquoi c'est vide et ce que l'utilisateur peut faire. */
  description?: string;
  /** Pistes courtes affichées en liste (ex. conseils de recherche). */
  tips?: string[];
  /** La première action est mise en avant ; les suivantes sont secondaires. */
  actions?: EmptyAction[];
  /** Variante compacte pour les petits panneaux (commentaires, boîtes de dialogue). */
  compact?: boolean;
  className?: string;
};

/** État vide : icône, titre, explication et actions — remplace les simples lignes de texte grisées. */
export function EmptyState({ icon: Icon, title, description, tips, actions, compact, className }: Props) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center rounded-xl border border-dashed text-center", compact ? "gap-2 px-4 py-5" : "gap-3 px-6 py-12", className)}
    >
      <div className={cn("grid place-items-center rounded-full bg-muted text-muted-foreground", compact ? "size-10" : "size-16")}>
        <Icon className={compact ? "size-5" : "size-8"} aria-hidden />
      </div>
      <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</h3>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {tips && tips.length > 0 && (
        <ul className="max-w-md space-y-1 text-left text-sm text-muted-foreground">
          {tips.map((tip) => <li key={tip} className="flex gap-2"><span aria-hidden>•</span><span>{tip}</span></li>)}
        </ul>
      )}
      {actions && actions.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {actions.map(({ label, onClick, icon: ActionIcon, variant }, i) => (
            <Button key={label} size={compact ? "sm" : "default"} variant={variant ?? (i === 0 ? "default" : "outline")} onClick={onClick}>
              {ActionIcon && <ActionIcon />} {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
