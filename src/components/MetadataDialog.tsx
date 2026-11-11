import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Music, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, type TKey } from "@/i18n";
import { getMeta, updateOnlineMeta, writeLocalTags } from "@/lib/api";
import { formatSize, formatTime } from "@/lib/media";
import { Textarea } from "@/components/ui/textarea";
import { loadLocalLyricsText, saveLocalLyricsText } from "@/lib/lyrics";
import { EMPTY_TAGS, joinPair, readLocalTags, splitPair, type FileInfo, type TagValues } from "@/lib/tags";

export type MetadataSource = { kind: "local"; path: string; isVideo: boolean } | { kind: "online"; id: string; userid: string };

/** Ce que le parent doit répercuter dans sa liste après un enregistrement réussi. */
export type MetadataSaved = { tags: TagValues; jacket: string; lyrics: string; path?: string; name?: string };

const MAX_LYRICS = 200_000;

type Props = {
  source: MetadataSource | null;
  onClose: () => void;
  onSaved: (saved: MetadataSaved) => void;
  /** Appelé avant l'écriture d'un fichier local : le parent libère le fichier s'il est en cours de lecture. */
  beforeSave?: () => void;
};

const MAX_JACKET = 5 * 1024 * 1024;
const JACKET_TYPES = ["image/png", "image/jpeg", "image/webp"];
const TEXT_FIELDS = ["title", "artist", "album", "album_artist", "composer", "genre", "publisher", "copyright"] as const;

const fmtDate = (d: Date | null, lang: string) => (d ? d.toLocaleString(lang) : "—");

/**
 * Édition des métadonnées d'un média : fichier local (tags écrits dans le fichier via FFmpeg)
 * ou média en ligne (tags enregistrés dans la base). Équivalent de metadata-window.hbs / music-change.hbs.
 */
export function MetadataDialog({ source, onClose, onSaved, beforeSave }: Props) {
  const { t, lang } = useI18n();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [initial, setInitial] = useState<TagValues>(EMPTY_TAGS);
  const [tags, setTags] = useState<TagValues>(EMPTY_TAGS);
  const [track, setTrack] = useState<[string, string]>(["", ""]);
  const [disc, setDisc] = useState<[string, string]>(["", ""]);
  const [name, setName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [originalJacket, setOriginalJacket] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [initialLyrics, setInitialLyrics] = useState("");
  const lyricsFile = useRef<HTMLInputElement>(null);
  /** undefined = conserver la pochette actuelle, null = la retirer, chaîne = la remplacer. */
  const [jacket, setJacket] = useState<string | null | undefined>(undefined);
  const [id3v1, setId3v1] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const isLocal = source?.kind === "local";
  const isVideo = source?.kind === "local" && source.isVideo;
  const open = source !== null;

  // Chargement à chaque ouverture : on repart d'un état propre après une annulation.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setLoading(true); setLoadError(false); setError(null); setJacket(undefined); setInfo(null);

    const apply = (values: TagValues, cover: string, fileInfo: FileInfo | null, lyricsText: string) => {
      if (cancelled) return;
      setLyrics(lyricsText); setInitialLyrics(lyricsText);
      setInitial(values); setTags(values);
      setTrack(splitPair(values.track)); setDisc(splitPair(values.disc));
      setOriginalJacket(cover); setInfo(fileInfo);
      setName(fileInfo?.name ?? ""); setInitialName(fileInfo?.name ?? "");
    };

    (async () => {
      try {
        if (source.kind === "local") {
          const r = await readLocalTags(source.path);
          apply(r.tags, r.jacket, r.info, (await loadLocalLyricsText(source.path)) ?? "");
        } else {
          const m = await getMeta(source.id);
          if (!m) throw new Error("notfound");
          apply({
            title: m.title ?? "", artist: m.artist ?? "", album: m.album ?? "", album_artist: m.album_artist ?? "", composer: m.composer ?? "",
            genre: m.genre ?? "", date: m.date ?? m.year ?? "", track: m.track ?? "", disc: m.disc ?? "", publisher: m.publisher ?? "", copyright: m.copyright ?? "",
          }, m.jacket ?? "", null, m.lyrics ?? "");
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  const current: TagValues = useMemo(() => ({ ...tags, track: joinPair(...track), disc: joinPair(...disc) }), [tags, track, disc]);
  const dirty = useMemo(
    () => JSON.stringify(current) !== JSON.stringify(initial) || jacket !== undefined || (isLocal && name.trim() !== initialName) || lyrics !== initialLyrics,
    [current, initial, jacket, isLocal, name, initialName, lyrics, initialLyrics],
  );
  const shownJacket = jacket === undefined ? originalJacket : jacket ?? "";

  /** Importe un fichier .lrc/.txt dans la zone de paroles (lu comme texte UTF-8). */
  function importLyrics(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_LYRICS) return setError(t("lyr.tooBig"));
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setLyrics(String(reader.result).replace(/^\uFEFF/, ""));
    reader.readAsText(file);
  }

  function pickJacket(file: File | undefined) {
    if (!file) return;
    if (!JACKET_TYPES.includes(file.type)) return setError(t("meta.coverType"));
    if (file.size > MAX_JACKET) return setError(t("meta.coverTooBig"));
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setJacket(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!source) return;
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, string> = { ...current };

      if (source.kind === "local") {
        // IMPORTANT : le fichier audio n'est réécrit (FFmpeg) que si ses tags, sa pochette ou son nom changent.
        // Modifier seulement les paroles n'écrit qu'un petit fichier voisin : aucun risque pour la musique.
        const fileChanged = JSON.stringify(current) !== JSON.stringify(initial) || jacket !== undefined || name.trim() !== initialName;
        let finalPath = source.path;
        if (fileChanged) {
          beforeSave?.();
          // Petit délai : laisse la webview relâcher le fichier avant que le serveur ne le remplace.
          await new Promise((r) => setTimeout(r, 150));
          const res = await writeLocalTags({ path: source.path, tags: payload, jacket: isVideo ? undefined : jacket, id3v1, newName: name.trim() !== initialName ? name.trim() : undefined });
          if (!res.saved) return setError(t(`meta.err.${res.error ?? "write"}` as TKey));
          finalPath = res.path ?? source.path;
        }
        // Paroles : écrites à côté du fichier ; après un renommage, on les recopie sous le nouveau nom pour qu'elles suivent.
        if (lyrics !== initialLyrics || (finalPath !== source.path && lyrics.trim())) {
          try { await saveLocalLyricsText(finalPath, lyrics); } catch { return setError(t("lyr.saveFail")); }
        }
        onSaved({ tags: current, jacket: shownJacket, lyrics, path: finalPath, name: finalPath.split(/[\\/]/).pop() });
      } else {
        const res = await updateOnlineMeta({ id: source.id, userid: source.userid, tags: payload, jacket, lyrics: lyrics !== initialLyrics ? lyrics : undefined });
        if (!res.updated) return setError(t(`meta.err.${res.error ?? "notfound"}` as TKey));
        onSaved({ tags: current, jacket: shownJacket, lyrics });
      }
      onClose();
    } catch {
      setError(t("on.serverDown"));
    } finally {
      setSaving(false);
    }
  }

  const text = (key: (typeof TEXT_FIELDS)[number]) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={`meta-${key}`}>{t(`meta.f.${key}` as TKey)}</Label>
      <Input id={`meta-${key}`} value={tags[key]} disabled={loading} onChange={(e) => setTags((v) => ({ ...v, [key]: e.target.value }))} />
    </div>
  );

  const pairField = (label: TKey, id: string, value: [string, string], set: (v: [string, string]) => void) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{t(label)}</Label>
      <div className="flex items-center gap-1.5">
        <Input id={id} type="number" min={0} value={value[0]} disabled={loading} onChange={(e) => set([e.target.value, value[1]])} />
        <span className="text-muted-foreground">/</span>
        <Input type="number" min={0} aria-label={`${t(label)} — total`} value={value[1]} disabled={loading} onChange={(e) => set([value[0], e.target.value])} />
      </div>
    </div>
  );

  const infoRows: [string, string][] = info ? [
    [t("meta.path"), info.path], [t("meta.created"), fmtDate(info.created, lang)], [t("meta.modified"), fmtDate(info.modified, lang)], [t("meta.accessed"), fmtDate(info.accessed, lang)],
    [t("meta.size"), formatSize(info.size)], [t("meta.format"), info.format || "—"], [t("meta.duration"), info.duration ? formatTime(info.duration) : "—"], [t("meta.encoder"), info.encoder || "—"],
  ] : [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent scrollable className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("meta.title")}</DialogTitle>
          <DialogDescription>{isLocal ? t("meta.localHint") : t("meta.onlineHint")}</DialogDescription>
        </DialogHeader>

        {loadError && <p className="text-sm text-destructive" role="alert">{t("meta.loadFail")}</p>}

        {!loadError && (
          <div className="space-y-5">
            <div className="flex gap-4">
              <div className="w-40 shrink-0 space-y-2">
                <Label>{t("meta.cover")}</Label>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted">
                  {shownJacket ? <img src={shownJacket} alt="" className="size-full object-cover" /> : <Music className="size-10 text-muted-foreground" />}
                </div>
                {isVideo ? <p className="text-xs text-muted-foreground">{t("meta.coverVideo")}</p> : (
                  <div className="flex flex-col gap-1.5">
                    <input ref={fileInput} type="file" accept={JACKET_TYPES.join(",")} className="sr-only" onChange={(e) => { pickJacket(e.target.files?.[0]); e.target.value = ""; }} />
                    <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => fileInput.current?.click()}><ImagePlus /> {t("meta.coverChoose")}</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={loading || !shownJacket} onClick={() => setJacket(null)}><Trash2 /> {t("meta.coverRemove")}</Button>
                  </div>
                )}
              </div>

              <div className="grid flex-1 content-start gap-x-3 gap-y-3 sm:grid-cols-2">
                {isLocal && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="meta-name">{t("meta.file")}</Label>
                    <Input id="meta-name" value={name} disabled={loading} onChange={(e) => setName(e.target.value)} />
                  </div>
                )}
                {text("title")}{text("artist")}{text("album")}{text("album_artist")}{text("composer")}{text("genre")}
                <div className="space-y-1">
                  <Label htmlFor="meta-date">{t("meta.f.date")}</Label>
                  <Input id="meta-date" value={tags.date} disabled={loading} onChange={(e) => setTags((v) => ({ ...v, date: e.target.value }))} />
                </div>
                {text("publisher")}{text("copyright")}
                {pairField("meta.f.track", "meta-track", track, setTrack)}
                {pairField("meta.f.disc", "meta-disc", disc, setDisc)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="meta-lyrics">{t("lyr.field")}</Label>
                <div className="flex gap-1">
                  <input ref={lyricsFile} type="file" accept=".lrc,.txt,text/plain" className="sr-only" onChange={(e) => { importLyrics(e.target.files?.[0]); e.target.value = ""; }} />
                  <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => lyricsFile.current?.click()}>{t("lyr.import")}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={loading || !lyrics} onClick={() => setLyrics("")}>{t("lyr.clear")}</Button>
                </div>
              </div>
              <Textarea id="meta-lyrics" rows={7} value={lyrics} disabled={loading} maxLength={MAX_LYRICS} className="font-mono text-sm" placeholder="[00:12.50] ..." onChange={(e) => setLyrics(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("lyr.hint")}{isLocal && ` ${t("lyr.localHint")}`}</p>
            </div>

            {info && (
              <details className="rounded-md border px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">{t("meta.general")}</summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {infoRows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="truncate" title={v}>{v}</dd></div>))}
                </dl>
              </details>
            )}

            {isLocal && /\.mp3$/i.test(source.path) && (
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={id3v1} onCheckedChange={(v) => setId3v1(v === true)} /> {t("meta.id3v1")}</label>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t("set.cancel")}</Button>
          <Button disabled={saving || loading || loadError || !dirty} onClick={() => void save()}>{saving ? t("meta.saving") : t("set.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
