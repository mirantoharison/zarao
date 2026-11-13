import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CircleAlert, FolderSearch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void };

/**
 * Médias sautés parce qu'illisibles : la raison de chaque échec, et de quoi les retirer de la liste en un clic
 * (ou les retrouver sur le disque). La liste se vide d'elle-même quand un média est retiré ou finit par jouer.
 * Même gabarit que la fenêtre des métadonnées : en-tête fixe, liste qui défile, boutons fixes en bas.
 * IMPORTANT : hauteur DÉFINIE (h-, pas max-h-) sinon le viewport Radix ne contraint rien et rien ne défile.
 */
export function UnplayableDialog({ p, open, onClose }: Props) {
  const { t } = useI18n();
  const rows = p.unplayable.map((u) => ({ ...u, item: p.items.find((i) => i.id === u.id) })).filter((r) => r.item);
  // Plus rien à montrer : la fenêtre se referme au lieu de rester vide.
  const isOpen = open && rows.length > 0;
  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent bare onOpenAutoFocus={(e) => e.preventDefault()} className="h-[min(80vh,600px)] sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><CircleAlert className="size-5 text-destructive" /> {t("unp.title")}</DialogTitle>
          <DialogDescription>{t("unp.desc")}</DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            {/* `[&>div]:block!` : Radix enveloppe le contenu dans un div `display:table` qui déborde en largeur. */}
            <ScrollArea className="size-full" viewportProps={{ className: "[&>div]:block!" }}>
              <ul className="space-y-2 p-6">
                {rows.map(({ id, reason, item }) => item && (
                  <li key={id} className="flex items-start gap-3 rounded-xl border bg-card/60 p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium" title={item.name}>{item.title}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground" title={item.path}>{item.path}</p>
                      <p className="text-xs leading-relaxed text-destructive">{t(`unp.r.${reason}`)}</p>
                    </div>
                    {item.source === "local" && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("player.reveal")} title={t("player.reveal")} onClick={() => void revealItemInDir(item.path).catch(() => undefined)}><FolderSearch /></Button>
                    )}
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("unp.remove")} title={t("unp.remove")} onClick={() => p.removeItems([id])}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
          <Button variant="outline" onClick={onClose}>{t("unp.close")}</Button>
          <Button variant="destructive" onClick={() => p.removeItems(rows.map((r) => r.id))}><Trash2 /> {t("unp.removeAll")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
