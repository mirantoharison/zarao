import { Download, Search, Settings2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SearchHit } from "./fieldMeta";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSection } from "./sections";

type Props = {
  page: SettingsSection;
  onSelect: (s: SettingsSection) => void;
  /** Pages contenant des modifications non enregistrées : une pastille les signale. */
  dirtySections: ReadonlySet<SettingsSection>;
  query: string; onQuery: (q: string) => void;
  hits: SearchHit[]; onPick: (hit: SearchHit) => void;
  /** null tant que le chargement n'est pas terminé. */
  serverUp: boolean | null;
  onExport: () => void; onImport: () => void;
};

/**
 * Barre latérale des Paramètres : recherche, pages regroupées par thème, état du serveur local.
 * Sous la largeur « md » elle devient une bande horizontale défilante (les titres de groupe disparaissent).
 * IMPORTANT : `relative z-20` pour que la liste des résultats de recherche passe par-dessus la zone de contenu.
 */
export function SettingsNav({ page, onSelect, dirtySections, query, onQuery, hits, onPick, serverUp, onExport, onImport }: Props) {
  const { t } = useI18n();
  return (
    <aside className="relative z-20 flex shrink-0 flex-col gap-3 border-b bg-muted/20 p-3 md:w-60 md:gap-4 md:border-r md:border-b-0 md:p-4">
      <div className="hidden items-center gap-2 px-1 md:flex">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/12 text-primary"><Settings2 className="size-4" /></span>
        <span className="text-sm font-semibold">{t("set.title")}</span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id="setting-search" type="search" value={query} className="h-8 pl-8 text-sm" placeholder={t("set.searchPlaceholder")} aria-label={t("set.search")}
          onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) onPick(hits[0]); }} />
        {query.trim() !== "" && (
          <ul className="absolute top-full left-0 z-30 mt-1 max-h-64 w-72 max-w-[80vw] space-y-0.5 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
            {hits.length === 0
              ? <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("set.searchNone")}</li>
              : hits.map((hit) => (
                <li key={hit.label}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => onPick(hit)}>
                    <span className="truncate">{t(hit.label)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t(SETTINGS_SECTIONS.find((x) => x.id === hit.section)?.label ?? "set.title")}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      <nav aria-label={t("set.title")} className="flex gap-1 overflow-x-auto md:flex-1 md:flex-col md:gap-4 md:overflow-visible">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label} className="flex gap-1 md:flex-col">
            <p className="hidden px-2.5 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase md:block">{t(group.label)}</p>
            {group.sections.map((id) => {
              const s = SETTINGS_SECTIONS.find((x) => x.id === id);
              if (!s) return null;
              const active = id === page;
              const dirty = dirtySections.has(id);
              return (
                <button key={id} type="button" aria-current={active ? "page" : undefined} onClick={() => onSelect(id)}
                  className={cn("group flex shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:w-full",
                    active ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-md transition-colors", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground")}>
                    <s.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(s.label)}</span>
                  {dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" title={t("set.dirtyIn")} aria-label={t("set.dirtyIn")} />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sauvegarde des réglages dans un fichier : l'import remplit seulement le formulaire, « Enregistrer » applique. */}
      <div className="hidden gap-1.5 md:flex">
        <Button type="button" variant="outline" size="xs" className="flex-1" onClick={onExport}><Download /> {t("set.exportBtn")}</Button>
        <Button type="button" variant="outline" size="xs" className="flex-1" onClick={onImport}><Upload /> {t("set.importBtn")}</Button>
      </div>

      {serverUp !== null && (
        <p className="hidden items-center gap-2 px-1 text-xs text-muted-foreground md:flex" role="status">
          <span className={cn("size-2 shrink-0 rounded-full", serverUp ? "bg-emerald-500" : "bg-destructive")} aria-hidden />
          {t(serverUp ? "set.srvUp" : "set.srvOff")}
        </p>
      )}
    </aside>
  );
}
