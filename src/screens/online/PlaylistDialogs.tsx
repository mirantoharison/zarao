import { LoadingState } from "@/components/LoadingState";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState, type FormEvent } from "react";
import { ListMusic, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, type TKey } from "@/i18n";
import { addToPlaylist, createPlaylist, listPlaylists, type Playlist } from "@/lib/api";

/** Code d'erreur du serveur → clé de traduction (repli : message générique). */
export const playlistErrorKey = (code?: string): TKey => (({ name: "pl.err.name", limit: "pl.err.limit", forbidden: "pl.err.forbidden", notfound: "pl.err.notfound" }) as Record<string, TKey>)[code ?? ""] ?? "pl.err.generic";

type NameProps = {
  open: boolean;
  mode: "create" | "rename";
  initialName?: string;
  onClose: () => void;
  /** Reçoit le nom saisi ; retourne un code d'erreur du serveur pour l'afficher, ou undefined si tout s'est bien passé. */
  onSubmit: (name: string) => Promise<string | undefined>;
};

/** Saisie du nom d'une playlist (création ou renommage). */
export function NamePlaylistDialog({ open, mode, initialName = "", onClose, onSubmit }: NameProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Repart du nom proposé à chaque ouverture.
  useEffect(() => { if (open) { setName(initialName); setError(null); setBusy(false); } }, [open, initialName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t("pl.err.name"));
    setBusy(true);
    setError(null);
    try {
      const code = await onSubmit(name.trim());
      if (code) setError(t(playlistErrorKey(code)));
      else onClose();
    } catch {
      setError(t("on.serverDown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t(mode === "create" ? "pl.createTitle" : "pl.renameTitle")}</DialogTitle>
            <DialogDescription>{t("pl.name")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pl-name" className="sr-only">{t("pl.name")}</Label>
            <Input id="pl-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("card.cancel")}</Button>
            <Button type="submit" disabled={busy}>{t(mode === "create" ? "pl.create" : "pl.rename")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type AddProps = {
  /** Médias à ajouter ; null = fenêtre fermée. */
  mediaIds: string[] | null;
  userid: string;
  onClose: () => void;
  /** Message de retour (« Ajouté à … ») que le parent affiche. */
  onDone: (message: string) => void;
};

/** Choix de la playlist où ajouter des médias, avec création à la volée. */
export function AddToPlaylistDialog({ mediaIds, userid, onClose, onDone }: AddProps) {
  const { t } = useI18n();
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const open = mediaIds !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLists(null); setError(null);
    listPlaylists(userid).then((d) => { if (!cancelled) setLists(d.list); }).catch(() => { if (!cancelled) { setLists([]); setError(t("on.serverDown")); } });
    return () => { cancelled = true; };
  }, [open, userid, t]);

  async function addTo(list: { id: string; name: string }) {
    if (!mediaIds) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addToPlaylist(list.id, userid, mediaIds);
      if (!res.ok) return setError(t(playlistErrorKey(res.error)));
      onDone(res.added ? t("pl.added", { n: list.name }) : t("pl.alreadyIn", { n: list.name }));
      onClose();
    } catch {
      setError(t("on.serverDown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open && !creating} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pl.addToTitle")}</DialogTitle>
            <DialogDescription>{t("pl.pick")}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-72"><div className="space-y-1 pr-3">
            {lists === null && <LoadingState compact title={t("ld.playlists")} />}
            {lists?.length === 0 && !error && <p className="py-4 text-sm text-muted-foreground">{t("pl.empty")}</p>}
            {lists?.map((l) => (
              <button key={l.id} disabled={busy} onClick={() => void addTo(l)} className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-accent disabled:opacity-50">
                <ListMusic className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{t("pl.items", { n: l.count })}</span>
              </button>
            ))}
          </div></ScrollArea>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onClose}>{t("card.cancel")}</Button>
            <Button disabled={busy} onClick={() => setCreating(true)}><Plus /> {t("pl.new")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NamePlaylistDialog
        open={open && creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const res = await createPlaylist(userid, name);
          if (!res.ok || !res.id) return res.error ?? "generic";
          await addTo({ id: res.id, name });
          return undefined;
        }}
      />
    </>
  );
}
