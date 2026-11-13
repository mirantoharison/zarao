import { useEffect, useState } from "react";
import { Library, ListPlus, ListRestart, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";
import { deletePlaylist, readPlaylists, savePlaylistNamed, type SavedPlaylist } from "@/lib/playlists";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void };

/**
 * Mes playlists : enregistrer la liste actuelle sous un nom, puis la recharger (remplacer) ou l'ajouter plus tard.
 * Même gabarit que la fenêtre des métadonnées et des Paramètres : en-tête et saisie fixes, liste qui défile dessous.
 * IMPORTANT : hauteur DÉFINIE (h-, pas max-h-) sinon le viewport Radix ne contraint rien et rien ne défile.
 */
export function PlaylistsDialog({ p, open, onClose }: Props) {
  const { t, lang } = useI18n();
  const [lists, setLists] = useState<SavedPlaylist[]>([]);
  const [name, setName] = useState("");
  // Relue à chaque ouverture : une autre fenêtre ou session a pu la modifier.
  useEffect(() => { if (open) { setLists(readPlaylists()); setName(""); } }, [open]);

  const trimmed = name.trim();
  const replaces = lists.some((l) => l.name.toLowerCase() === trimmed.toLowerCase());
  const save = () => { if (trimmed && p.items.length > 0) { setLists(savePlaylistNamed(trimmed, p.items.map((i) => i.path))); setName(""); } };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent bare onOpenAutoFocus={(e) => e.preventDefault()} className="h-[min(80vh,600px)] sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><Library className="size-5 text-primary" /> {t("mypl.title")}</DialogTitle>
          <DialogDescription>{t("mypl.desc")}</DialogDescription>
        </DialogHeader>

        {/* Saisie fixe : toujours visible, la liste défile dessous */}
        <div className="shrink-0 space-y-1.5 border-b px-6 py-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("mypl.namePh")} aria-label={t("mypl.namePh")} />
            <Button type="submit" disabled={!trimmed || p.items.length === 0}><Save /> {replaces ? t("mypl.replace") : t("mypl.save")}</Button>
          </form>
          {p.items.length === 0 && <p className="text-xs text-muted-foreground">{t("mypl.emptyCurrent")}</p>}
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            {/* `[&>div]:block!` : Radix enveloppe le contenu dans un div `display:table` qui déborde en largeur. */}
            <ScrollArea className="size-full" viewportProps={{ className: "[&>div]:block!" }}>
              <div className="p-6">
                {lists.length === 0 ? <p className="text-sm text-muted-foreground">{t("mypl.none")}</p> : (
                  <ul className="space-y-2">
                    {lists.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 rounded-xl border bg-card/60 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={l.name}>{l.name}</p>
                          <p className="text-xs text-muted-foreground">{t("mypl.count", { n: l.paths.length })} · {new Date(l.updatedAt).toLocaleDateString(lang)}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" title={t("mypl.load")} aria-label={t("mypl.load")} onClick={() => { p.clear(); p.addPaths(l.paths); onClose(); }}><ListRestart /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" title={t("mypl.append")} aria-label={t("mypl.append")} onClick={() => { p.addPaths(l.paths); onClose(); }}><ListPlus /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" title={t("mypl.delete")} aria-label={t("mypl.delete")} onClick={() => setLists(deletePlaylist(l.id))}><Trash2 /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
