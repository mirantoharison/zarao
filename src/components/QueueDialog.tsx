import { FileAudio, FileVideo, ListEnd, Play, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void };

/**
 * File d'attente : « À suivre » (pistes jouées avant la suite de la liste, dans l'ordre où elles ont été ajoutées)
 * et « Historique » (pistes jouées récemment, y compris lors des sessions précédentes).
 * Même gabarit que la fenêtre des métadonnées : en-tête et onglets fixes, contenu qui défile, bouton « Vider » fixe en bas.
 * IMPORTANT : hauteur DÉFINIE (h-, pas max-h-) sinon le viewport Radix ne contraint rien et rien ne défile.
 */
export function QueueDialog({ p, open, onClose }: Props) {
  const { t, lang } = useI18n();
  const queued = p.queue.map((id) => p.items.find((i) => i.id === id)).filter((i) => i !== undefined);

  /** Zone de contenu d'un onglet : liste qui défile, puis pied fixe (si `footer`). */
  const pane = (body: React.ReactNode, footer?: React.ReactNode) => (
    <>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          {/* `[&>div]:block!` : Radix enveloppe le contenu dans un div `display:table` qui déborde en largeur. */}
          <ScrollArea className="size-full" viewportProps={{ className: "[&>div]:block!" }}><div className="p-6">{body}</div></ScrollArea>
        </div>
      </div>
      {footer && <div className="flex shrink-0 justify-end border-t px-6 py-3">{footer}</div>}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent bare onOpenAutoFocus={(e) => e.preventDefault()} className="h-[min(80vh,600px)] sm:max-w-xl">
        <DialogHeader className="shrink-0 px-6 pt-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><ListEnd className="size-5 text-primary" /> {t("q.title")}</DialogTitle>
          <DialogDescription>{t("q.desc")}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="next" className="min-h-0 flex-1">
          <TabsList className="shrink-0 border-b px-4">
            <TabsTrigger value="next">{t("q.tabNext")} {queued.length > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{queued.length}</span>}</TabsTrigger>
            <TabsTrigger value="history">{t("q.tabHistory")}</TabsTrigger>
          </TabsList>

          <TabsContent value="next" className="flex flex-col">
            {queued.length === 0 ? pane(<p className="text-sm text-muted-foreground">{t("q.emptyNext")}</p>) : pane(
              <ol className="space-y-1.5">
                {queued.map((item, n) => (
                  <li key={item.id} className="flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-2">
                    <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">{n + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.title}>{item.title}</p>
                      {item.artist && <p className="truncate text-xs text-muted-foreground">{item.artist}</p>}
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("q.remove")} title={t("q.remove")} onClick={() => p.dequeue(item.id)}><X /></Button>
                  </li>
                ))}
              </ol>,
              <Button variant="outline" size="sm" onClick={p.clearQueue}><Trash2 /> {t("q.clear")}</Button>,
            )}
          </TabsContent>

          <TabsContent value="history" className="flex flex-col">
            {p.history.length === 0 ? pane(<p className="text-sm text-muted-foreground">{t("q.emptyHistory")}</p>) : pane(
              <ul className="space-y-1.5">
                {p.history.map((h) => {
                  const inList = p.items.find((i) => i.path === h.path);
                  const Icon = h.kind === "video" ? FileVideo : FileAudio;
                  return (
                    <li key={h.path} className="flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={h.path}>{h.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{[h.artist, new Date(h.at).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" })].filter(Boolean).join(" · ")}</p>
                      </div>
                      {/* Dans la liste : on le rejoue ; sinon (session précédente, média retiré) on le remet d'abord dans la liste. */}
                      {inList
                        ? <Button type="button" variant="ghost" size="icon-sm" aria-label={t("q.replay")} title={t("q.replay")} onClick={() => p.play(inList.id)}><Play /></Button>
                        : h.source === "local" && <Button type="button" variant="ghost" size="icon-sm" aria-label={t("q.addBack")} title={t("q.addBack")} onClick={() => p.addPaths([h.path])}><Plus /></Button>}
                    </li>
                  );
                })}
              </ul>,
              <Button variant="outline" size="sm" onClick={p.clearHistory}><Trash2 /> {t("q.clear")}</Button>,
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
