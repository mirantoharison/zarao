import { useState, type ReactNode } from "react";
import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * "info" explique à quoi sert un écran ; "warning" dit ce qu'une action engage (suppression, perte de données).
 * IMPORTANT : l'ambre est réservé à l'avertissement — peindre une simple explication en ambre suggérerait un problème là où il n'y a rien à craindre.
 */
const TONES = {
  info: { card: "bg-sky-500/[0.07]", badge: "bg-sky-500/15 text-sky-700 dark:text-sky-400", Icon: Info },
  warning: { card: "bg-amber-500/10", badge: "bg-amber-500/20 text-amber-700 dark:text-amber-400", Icon: TriangleAlert },
} as const;

/** Transforme les `<b>…</b>` d'un texte traduit en `<strong>` (les traductions restent du texte simple, sans HTML injecté). */
export function boldMarkup(text: string): ReactNode[] {
  return text.split(/<b>(.*?)<\/b>/g).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

const storageKey = (id: string) => `zarao.note.${id}`;

/**
 * Note de page : carte teintée avec pastille d'icône. Les notes "info" sont repliables (l'état est mémorisé par `id`) :
 * un long paragraphe d'aide ne doit pas pousser le contenu hors de l'écran à chaque visite. Les avertissements restent toujours visibles.
 */
export function InfoNote({ children, label, tone = "info", className, id }: { children: ReactNode; label?: string; tone?: keyof typeof TONES; className?: string; id?: string }) {
  const { t } = useI18n();
  const { card, badge, Icon } = TONES[tone];
  const collapsible = tone === "info";
  const [open, setOpen] = useState(() => {
    if (!collapsible || !id) return true;
    try { return localStorage.getItem(storageKey(id)) !== "closed"; } catch { return true; }
  });

  function toggle() {
    const next = !open;
    setOpen(next);
    if (id) try { localStorage.setItem(storageKey(id), next ? "open" : "closed"); } catch { /* stockage indisponible : l'état reste simplement local */ }
  }

  const text = (
    <p className="text-sm leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">{children}</p>
  );
  const icon = <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-full", badge)}><Icon className="size-4" /></span>;

  return (
    <section aria-label={label} className={cn("rounded-xl px-4 py-3", card, className)}>
      {collapsible ? (
        <>
          <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
            {icon}
            <span className="flex-1 text-sm font-medium">{t("note.about")}</span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
          {open && <div className="pt-2 pl-11">{text}</div>}
        </>
      ) : (
        <div className="flex items-start gap-3">{icon}<div className="pt-1">{text}</div></div>
      )}
    </section>
  );
}
