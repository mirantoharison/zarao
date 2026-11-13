import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, RotateCcw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import type { FieldReset } from "./fieldMeta";

/*
 * Vocabulaire visuel des Paramètres : une page = des GROUPES (`Group`), un groupe = une carte de LIGNES (`Row`).
 * Chaque ligne a le libellé et son aide à gauche, le contrôle à droite (à la manière des réglages système) : les contrôles
 * s'alignent sur une même colonne, quelle que soit leur largeur, ce qui rend la page lisible d'un coup d'œil.
 * IMPORTANT : `data-setting-label` (texte affiché) permet à la recherche de retrouver et mettre en évidence la ligne visée.
 */

/** Petit bouton « Rétablir » : visible seulement quand la valeur du champ n'est plus celle par défaut. */
function ResetButton({ reset }: { reset?: FieldReset }) {
  const { t } = useI18n();
  if (!reset?.modified) return null;
  return (
    <button type="button" onClick={reset.onReset} title={t("set.resetTitle")}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-normal text-primary transition-colors hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      <RotateCcw className="size-3" /> {t("set.reset")}
    </button>
  );
}

type RowProps = {
  label: string; hint?: ReactNode; htmlFor?: string; reset?: FieldReset;
  /** Contrôle sous le texte, sur toute la largeur (champs longs : chemins, commandes, listes). */
  stacked?: boolean;
  /** Largeur du contrôle à droite (`sm:w-60` par défaut) ; `sm:w-auto` pour un contrôle qui se dimensionne seul. */
  controlClassName?: string;
  children: ReactNode;
};

/** Une ligne de réglage : libellé + aide à gauche, contrôle à droite (ou dessous avec `stacked`). */
export function Row({ label, hint, htmlFor, reset, stacked, controlClassName, children }: RowProps) {
  return (
    <div data-setting-label={label} className={cn("flex gap-x-6 gap-y-2.5 px-4 py-3.5 transition-colors hover:bg-accent/25", stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between")}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-h-5 items-center gap-2">
          <Label htmlFor={htmlFor} className="leading-snug">{label}</Label>
          <ResetButton reset={reset} />
        </div>
        {hint && <p className="max-w-[62ch] text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className={cn("min-w-0", stacked ? "w-full" : "sm:w-60 sm:shrink-0", controlClassName)}>{children}</div>
    </div>
  );
}

/** Valeur numérique saisie en texte : un champ vide reste vide (= défaut côté serveur), la validation se fait à l'enregistrement. */
export function NumberField({ id, label, hint, value, onChange, placeholder, disabled, min, max, reset }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; min?: number; max?: number; reset?: FieldReset;
}) {
  return (
    <Row label={label} hint={hint} htmlFor={id} reset={reset} controlClassName="sm:w-36">
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} className="text-right tabular-nums" value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

/** `icon` : affichée devant le libellé, dans la liste ET dans le champ fermé (le contenu de l'option est repris par le déclencheur). */
export type Option = { value: string; label: string; icon?: LucideIcon };

/** Contenu d'une option de liste : icône facultative + libellé. */
export function OptionLabel({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return <>{Icon && <Icon />}<span className="truncate">{children}</span></>;
}

export function SelectField({ label, hint, value, onChange, options, disabled, reset, controlClassName }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; options: Option[]; disabled?: boolean; reset?: FieldReset; controlClassName?: string;
}) {
  return (
    <Row label={label} hint={hint} reset={reset} controlClassName={controlClassName}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}><OptionLabel icon={o.icon}>{o.label}</OptionLabel></SelectItem>)}
        </SelectContent>
      </Select>
    </Row>
  );
}

/** Choix court (2 ou 3 options brèves) : plus direct qu'une liste déroulante. */
export function Segmented({ value, onChange, options, disabled, label }: { value: string; onChange: (v: string) => void; options: Option[]; disabled?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full rounded-lg bg-muted p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" disabled={disabled} aria-pressed={active} onClick={() => onChange(o.value)}
            className={cn("min-w-0 truncate rounded-md px-3 py-1.5 text-xs font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedField({ label, hint, value, onChange, options, disabled, reset }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; options: Option[]; disabled?: boolean; reset?: FieldReset;
}) {
  return (
    <Row label={label} hint={hint} reset={reset} controlClassName="sm:w-auto">
      <Segmented label={label} value={value} onChange={onChange} options={options} disabled={disabled} />
    </Row>
  );
}

/** Réglage activé / désactivé : le libellé de la ligne bascule aussi l'interrupteur (htmlFor). */
export function SwitchField({ id, label, hint, checked, onChange, disabled, reset }: {
  id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; reset?: FieldReset;
}) {
  return (
    <Row label={label} hint={hint} htmlFor={id} reset={reset} controlClassName="sm:w-auto">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Row>
  );
}

export function SliderField({ label, hint, value, onChange, min, max, step, format }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string;
}) {
  return (
    <Row label={label} hint={hint} controlClassName="sm:w-64">
      <div className="flex items-center gap-3">
        <Slider className="min-w-0 flex-1" min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label} />
        <span className="min-w-12 rounded-md bg-muted px-1.5 py-0.5 text-center text-xs tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
      </div>
    </Row>
  );
}

/** Ligne sans réglage : contenu libre dans le même gabarit que les autres (liste, message, bouton d'ajout). */
export function Plain({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3.5", className)}>{children}</div>;
}

/**
 * Groupe de réglages voisins : titre discret au-dessus, puis une carte de lignes séparées par des filets.
 * Les groupes d'une page s'empilent en une seule colonne.
 */
export function Group({ title, hint, badge, children }: { title: string; hint?: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section data-setting-label={title} className="min-w-0 space-y-2.5 rounded-xl">
      <header className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
          {hint && <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-muted-foreground/80">{hint}</p>}
        </div>
        {badge}
      </header>
      <div className="divide-y overflow-hidden rounded-xl border bg-card/60 shadow-xs">{children}</div>
    </section>
  );
}

const NOTICE_TONES = {
  info: { box: "border-border bg-muted/40 text-muted-foreground", icon: Info },
  warn: { box: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: CircleAlert },
  error: { box: "border-destructive/40 bg-destructive/10 text-destructive", icon: CircleAlert },
  ok: { box: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CircleCheck },
} satisfies Record<string, { box: string; icon: LucideIcon }>;

/** Bandeau d'information, d'avertissement ou d'erreur, au format d'une ligne. */
export function Notice({ tone = "info", children, className }: { tone?: keyof typeof NOTICE_TONES; children: ReactNode; className?: string }) {
  const { box, icon: Icon } = NOTICE_TONES[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm leading-snug", box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
