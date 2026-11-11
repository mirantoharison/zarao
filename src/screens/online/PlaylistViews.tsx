import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Compass, Library, ListMusic, ListPlus, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlayingBars } from "@/components/PlayingBars";
import { useI18n } from "@/i18n";
import { createPlaylist, deletePlaylist, getMeta, getPlaylist, listPlaylists, removeFromPlaylist, renamePlaylist, reorderPlaylist, type Playlist, type ServerMedia, type SessionUser } from "@/lib/api";
import { formatTime } from "@/lib/media";
import { mediaId, parseDuration } from "@/lib/online";
import { cn } from "@/lib/utils";
import { NamePlaylistDialog } from "@/screens/online/PlaylistDialogs";

/** Mosaïque 2×2 des premières pochettes ; les pochettes (lourdes) sont demandées une par une et mises en cache par getMeta. */
function Mosaic({ ids }: { ids: string[] }) {
  const [covers, setCovers] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(ids.map((id) => getMeta(id).then((m) => m?.jacket ?? ""))).then((list) => { if (!cancelled) setCovers(list); });
    return () => { cancelled = true; };
  }, [ids]);

  return (
    <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md bg-muted">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid place-items-center bg-muted-foreground/10">
          {covers[i] ? <img src={covers[i]} alt="" className="size-full object-cover" /> : i === 0 && ids.length === 0 ? <ListMusic className="size-6 text-muted-foreground/60" /> : null}
        </div>
      ))}
    </div>
  );
}

type ListProps = { user: SessionUser; onOpen: (id: string) => void; refreshToken: number };

/** Liste des playlists de l'utilisateur, avec création. */
export function PlaylistList({ user, onOpen, refreshToken }: ListProps) {
  const { t } = useI18n();
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { setLists((await listPlaylists(user._id)).list); setError(false); } catch { setLists([]); setError(true); }
  }, [user._id]);
  useEffect(() => { void load(); }, [load, refreshToken]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("pl.title")}</h2>
        <Button size="sm" onClick={() => setCreating(true)}><Plus /> {t("pl.new")}</Button>
      </div>

      {error && <p className="text-sm text-destructive">{t("on.serverDown")}</p>}
      {lists === null && <p className="py-6 text-sm text-muted-foreground">{t("on.loading")}</p>}
      {lists?.length === 0 && !error && (
        <EmptyState icon={Library} title={t("em.plTitle")} description={t("em.plBody")} actions={[{ label: t("pl.new"), icon: Plus, onClick: () => setCreating(true) }]} />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-3 gap-y-5">
        {lists?.map((l) => (
          <button key={l.id} onClick={() => onOpen(l.id)} className="rounded-lg border p-2 text-left transition-colors hover:bg-accent/50">
            <Mosaic ids={l.coverIds} />
            <h3 className="mt-2 truncate text-sm font-medium" title={l.name}>{l.name}</h3>
            <p className="text-xs text-muted-foreground">{t("pl.items", { n: l.count })}</p>
          </button>
        ))}
      </div>

      <NamePlaylistDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const res = await createPlaylist(user._id, name);
          if (!res.ok) return res.error ?? "generic";
          await load();
          return undefined;
        }}
      />
    </section>
  );
}

type DetailProps = {
  user: SessionUser;
  id: string;
  currentRemoteId?: string;
  playing: boolean;
  onBack: () => void;
  /** Retour au catalogue, proposé quand la playlist est vide. */
  onBrowse?: () => void;
  /** Remplace la file de lecture par ces médias et lance celui d'index `start`. */
  onPlayAll: (items: ServerMedia[], start: number) => void;
  onEnqueueAll: (items: ServerMedia[]) => void;
  /** Avertit le parent qu'une playlist a changé (nom, contenu, suppression) : recharge la liste. */
  onChanged: () => void;
  refreshToken: number;
};

/** Contenu d'une playlist : lecture, réordonnancement, retrait, renommage, suppression. */
export function PlaylistDetail({ user, id, currentRemoteId, playing, onBack, onBrowse, onPlayAll, onEnqueueAll, onChanged, refreshToken }: DetailProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [items, setItems] = useState<ServerMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null); setError(null);
    getPlaylist(id, user._id)
      .then((d) => {
        if (cancelled) return;
        if (!d.ok || !d.playlist) { setError(t(d.error === "forbidden" ? "pl.err.forbidden" : "pl.err.notfound")); setItems([]); return; }
        setName(d.playlist.name); setItems(d.items ?? []);
      })
      .catch(() => { if (!cancelled) { setError(t("on.serverDown")); setItems([]); } });
    return () => { cancelled = true; };
  }, [id, user._id, refreshToken, t]);

  /** Réordonne localement tout de suite (réactivité) puis synchronise ; en cas d'échec, on recharge l'ordre du serveur. */
  async function move(index: number, delta: -1 | 1) {
    if (!items) return;
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      const res = await reorderPlaylist(id, user._id, next.map(mediaId));
      if (!res.ok) throw new Error();
    } catch {
      setError(t("pl.err.generic"));
      const d = await getPlaylist(id, user._id).catch(() => null);
      if (d?.items) setItems(d.items);
    }
  }

  async function remove(m: ServerMedia) {
    setItems((list) => (list ? list.filter((x) => mediaId(x) !== mediaId(m)) : list));
    await removeFromPlaylist(id, user._id, mediaId(m)).catch(() => undefined);
    onChanged();
  }

  const list = items ?? [];

  return (
    <section className="space-y-4">
      <Button size="sm" variant="ghost" className="-ml-2" onClick={onBack}><ArrowLeft /> {t("pl.back")}</Button>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold" title={name}>{name || "…"}</h2>
          {items && <p className="text-sm text-muted-foreground">{t("pl.items", { n: list.length })} · {formatTime(list.reduce((s, m) => s + parseDuration(m.duration), 0))}</p>}
        </div>
        <Button size="sm" disabled={list.length === 0} onClick={() => onPlayAll(list, 0)}><Play /> {t("pl.playAll")}</Button>
        <Button size="sm" variant="secondary" disabled={list.length === 0} onClick={() => onEnqueueAll(list)}><ListPlus /> {t("pl.enqueueAll")}</Button>
        <Button size="icon" variant="ghost" onClick={() => setRenaming(true)} title={t("pl.rename")}><Pencil /></Button>
        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} title={t("card.delete")}><Trash2 /></Button>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {items === null && <p className="py-6 text-sm text-muted-foreground">{t("on.loading")}</p>}
      {items && list.length === 0 && !error && (
        <EmptyState icon={ListMusic} title={t("em.plOneTitle")} description={t("em.plOneBody")} actions={onBrowse ? [{ label: t("em.queueBrowse"), icon: Compass, onClick: onBrowse }] : undefined} />
      )}

      {list.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>{t("col.artist")}</TableHead>
              <TableHead>{t("col.title")}</TableHead>
              <TableHead className="w-24 text-right">{t("col.total")}</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((m, i) => {
              const isCurrent = currentRemoteId === mediaId(m);
              return (
                <TableRow key={mediaId(m)} className={cn("cursor-default [&>td]:py-1", isCurrent && "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]")} onDoubleClick={() => onPlayAll(list, i)}>
                  <TableCell className="text-center text-xs tabular-nums text-muted-foreground">{isCurrent ? <PlayingBars playing={playing} /> : i + 1}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{m.artist || "—"}</TableCell>
                  <TableCell className={cn("max-w-0 truncate", isCurrent && "font-medium")} title={m.title}>{m.title}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTime(parseDuration(m.duration))}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => onPlayAll(list, i)} title={t("card.play")}><Play /></Button>
                      <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => void move(i, -1)} title={t("pl.moveUp")}><ChevronUp /></Button>
                      <Button size="icon" variant="ghost" className="size-7" disabled={i === list.length - 1} onClick={() => void move(i, 1)} title={t("pl.moveDown")}><ChevronDown /></Button>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => void remove(m)} title={t("pl.removeItem")}><X /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <NamePlaylistDialog
        open={renaming}
        mode="rename"
        initialName={name}
        onClose={() => setRenaming(false)}
        onSubmit={async (newName) => {
          const res = await renamePlaylist(id, user._id, newName);
          if (!res.ok) return res.error ?? "generic";
          setName(newName);
          onChanged();
          return undefined;
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pl.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("pl.deleteConfirm", { n: name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>{t("card.cancel")}</Button>
            <Button variant="destructive" onClick={async () => { setConfirmDelete(false); await deletePlaylist(id, user._id).catch(() => undefined); onChanged(); onBack(); }}><Trash2 /> {t("card.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

