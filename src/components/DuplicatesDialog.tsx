import { useEffect, useMemo, useState } from "react";
import { Copy as CopyIcon, CopyCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";
import { formatSize, formatTime, type MediaItem } from "@/lib/media";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void };

/** Deux fichiers dont les durées diffèrent de moins de ceci (s) sont jugés identiques : un ré-encodage ou des tags différents décalent un peu. */
const DURATION_TOLERANCE = 2;

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Groupes de doublons : même titre ET même artiste (sans tenir compte des accents ni des majuscules) et durées proches.
 * IMPORTANT : le titre seul ne suffit pas (« Intro » existe sur mille albums) ; sans titre exploitable on se rabat sur le nom du fichier.
 * Le premier élément de chaque groupe est celui qu'on conserve (le plus haut dans la liste).
 */
export function findDuplicates(items: MediaItem[]): MediaItem[][] {
  const byKey = new Map<string, MediaItem[]>();
  for (const i of items) {
    const key = `${fold(i.artist ?? "")}|${fold(i.title && i.title !== "—" ? i.title : i.name)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  const groups: MediaItem[][] = [];
  for (const same of byKey.values()) {
    if (same.length < 2) continue;
    // Regroupement par durées voisines, dans l'ordre de la liste : chaque groupe est comparé à son premier élément.
    const clusters: MediaItem[][] = [];
    for (const i of same) {
      const home = clusters.find((c) => Math.abs(c[0].duration - i.duration) <= DURATION_TOLERANCE);
      if (home) home.push(i); else clusters.push([i]);
    }
    groups.push(...clusters.filter((c) => c.length > 1));
  }
  return groups;
}

/** Cherche les fichiers en double de la liste de lecture et propose de retirer les copies (le fichier sur le disque n'est jamais touché). */
export function DuplicatesDialog({ p, open, onClose }: Props) {
  const { t } = useI18n();
  const groups = useMemo(() => (open ? findDuplicates(p.items) : []), [open, p.items]);
  // Par défaut, tout sauf le premier de chaque groupe est coché.
  const [drop, setDrop] = useState<Set<string>>(new Set());
  useEffect(() => { setDrop(new Set(groups.flatMap((g) => g.slice(1).map((i) => i.id)))); }, [groups]);

  const toggle = (id: string) => setDrop((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent bare onOpenAutoFocus={(e) => e.preventDefault()} className="h-[min(80vh,600px)] sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><CopyCheck className="size-5 text-primary" /> {t("dup.title")}</DialogTitle>
          <DialogDescription>{t("dup.desc")}</DialogDescription>
        </DialogHeader>

        {/* Même gabarit que PlaylistsDialog : conteneur absolu + ScrollArea de l'app (pas la barre native du système). */}
        <div className="relative min-h-0 flex-1"><div className="absolute inset-0">
        <ScrollArea className="size-full" viewportProps={{ className: "[&>div]:block!" }}>
        <div className="space-y-3 px-6 py-4">
          {groups.length === 0 ? (
            <EmptyState compact icon={CopyIcon} title={t("dup.none")} description={t("dup.noneBody")} />
          ) : groups.map((g) => (
            <div key={g[0].id} className="rounded-xl border bg-card/60 p-3">
              <p className="mb-2 truncate text-sm font-medium">{g[0].artist ? `${g[0].artist} — ` : ""}{g[0].title}</p>
              <ul className="space-y-1">
                {g.map((i, n) => (
                  <li key={i.id} className="flex items-center gap-3 text-sm">
                    {n === 0
                      ? <span className="w-4 shrink-0" />
                      : <Checkbox checked={drop.has(i.id)} onCheckedChange={() => toggle(i.id)} aria-label={t("dup.remove1")} />}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={i.path}>{i.path}</span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatTime(i.duration)} · {formatSize(i.size)}</span>
                    {n === 0 && <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t("dup.keep")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        </ScrollArea>
        </div></div>

        {groups.length > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3">
            <p className="text-xs text-muted-foreground">{t("dup.note")}</p>
            <Button variant="destructive" disabled={drop.size === 0} onClick={() => { p.removeItems([...drop]); onClose(); }}><Trash2 /> {t("dup.removeN", { n: drop.size })}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
