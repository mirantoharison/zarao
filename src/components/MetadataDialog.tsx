import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Building2, Eraser, Loader2, Save, Upload, X, CalendarClock, CalendarDays, CalendarPlus, ChevronDown, Clock, Copyright, Cpu, Disc3, FileAudio, Folder, HardDrive, ImagePlus, Image as ImageIcon, Search, MicVocal, Music, PenLine, Tag, Timer, Trash2, Type, User, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { useI18n, type TKey } from "@/i18n";
import { getMeta, updateOnlineMeta, writeLocalTags } from "@/lib/api";
import { formatSize, formatTime } from "@/lib/media";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchOnlineLyrics, loadLocalLyricsText, setStoredLyrics } from "@/lib/lyrics";
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
  /** Appelé une fois l'écriture terminée (réussie ou non) si `beforeSave` a été appelé ; `newPath` = nouveau chemin après un renommage. */
  afterSave?: (newPath?: string) => void;
};

const MAX_JACKET = 5 * 1024 * 1024;
const JACKET_TYPES = ["image/png", "image/jpeg", "image/webp"];
const TEXT_FIELDS = ["title", "artist", "album", "album_artist", "composer", "genre", "publisher", "copyright"] as const;

const fmtDate = (d: Date | null, lang: string) => (d ? d.toLocaleString(lang) : "—");

/**
 * Édition des métadonnées d'un média : fichier local (tags écrits dans le fichier via FFmpeg)
 * ou média en ligne (tags enregistrés dans la base). Équivalent de metadata-window.hbs / music-change.hbs.
 */
export function MetadataDialog({ source, onClose, onSaved, beforeSave, afterSave }: Props) {
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
  const [searchingLyrics, setSearchingLyrics] = useState(false);
  const [lyricsNotFound, setLyricsNotFound] = useState(false);
  /** undefined = conserver la pochette actuelle, null = la retirer, chaîne = la remplacer. */
  const [jacket, setJacket] = useState<string | null | undefined>(undefined);
  const [id3v1, setId3v1] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Enregistrement réussi : le dialogue reste ouvert, on le signale (masqué dès la prochaine modification). */
  const [saved, setSaved] = useState(false);
  /** Incrémenté après un enregistrement : recharge les valeurs depuis la source, qui deviennent la nouvelle référence. */
  const [reloadKey, setReloadKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const isLocal = source?.kind === "local";
  const isVideo = source?.kind === "local" && source.isVideo;
  const open = source !== null;
  /** Clé stable de la cible : le parent peut recréer l'objet `source` à chaque rendu sans relancer le chargement. */
  const sourceKey = source ? (source.kind === "local" ? `local:${source.path}` : `online:${source.id}`) : null;

  // Le message « enregistré » ne doit pas survivre à la fermeture du dialogue.
  useEffect(() => { if (!open) setSaved(false); }, [open]);

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
  }, [sourceKey, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const current: TagValues = useMemo(() => ({ ...tags, track: joinPair(...track), disc: joinPair(...disc) }), [tags, track, disc]);
  const dirty = useMemo(
    () => JSON.stringify(current) !== JSON.stringify(initial) || jacket !== undefined || (isLocal && name.trim() !== initialName) || lyrics !== initialLyrics,
    [current, initial, jacket, isLocal, name, initialName, lyrics, initialLyrics],
  );
  const shownJacket = jacket === undefined ? originalJacket : jacket ?? "";

  /** Importe un fichier .lrc/.txt dans la zone de paroles (lu comme texte UTF-8). */
  /** Cherche les paroles sur LRCLIB d'après les tags en cours d'édition ; remplit le champ (rien n'est enregistré avant « Enregistrer »). */
  async function searchLyrics() {
    setSearchingLyrics(true); setLyricsNotFound(false);
    const found = await fetchOnlineLyrics(tags.artist, tags.title, info?.duration ?? 0);
    setSearchingLyrics(false);
    if (found) setLyrics(found.slice(0, MAX_LYRICS)); else setLyricsNotFound(true);
  }

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
    setSaved(false);
    setSaving(true);
    let released = false;
    let resumePath: string | undefined;
    try {
      const payload: Record<string, string> = { ...current };

      if (source.kind === "local") {
        // IMPORTANT : le fichier est réécrit (FFmpeg, copie sans réencodage) si ses tags, sa pochette, son nom ou ses paroles changent.
        // Les paroles sont intégrées au fichier ; seuls les cas impossibles (format sans tag de paroles, texte trop long) retombent sur un .lrc voisin.
        const lyricsChanged = lyrics !== initialLyrics;
        const renamed = name.trim() !== initialName;
        // Après un renommage, on réécrit aussi les paroles dans le fichier : elles voyagent ainsi avec lui (plus de fichier voisin à recopier).
        const sendLyrics = lyricsChanged || (renamed && lyrics.trim() !== "");
        const fileChanged = JSON.stringify(current) !== JSON.stringify(initial) || jacket !== undefined || renamed || lyricsChanged;
        let lyricsInFile = false;
        let finalPath = source.path;
        if (fileChanged) {
          beforeSave?.();
          released = true;
          // Petit délai : laisse la webview relâcher le fichier avant que le serveur ne le remplace.
          await new Promise((r) => setTimeout(r, 150));
          const send = (withLyrics: boolean) => writeLocalTags({ path: source.path, tags: payload, jacket: isVideo ? undefined : jacket, id3v1, newName: name.trim() !== initialName ? name.trim() : undefined, lyrics: withLyrics && sendLyrics ? lyrics : undefined });
          let res = await send(true);
          // Repli : format sans tag de paroles ou texte trop long -> on réécrit sans les paroles, qui iront dans un .lrc voisin.
          if (!res.saved && (res.error === "lyricsFormat" || res.error === "lyricsTooLong")) res = await send(false);
          else if (res.saved) lyricsInFile = sendLyrics;
          if (!res.saved) return setError(t(`meta.err.${res.error ?? "write"}` as TKey));
          finalPath = res.path ?? source.path;
          resumePath = finalPath;
        }
        // Paroles : aucune écriture de fichier voisin. Dans le fichier si possible (le tag fait foi) ; sinon (format sans tag de paroles,
        // texte trop long) dans la mémoire de l'application. Une entrée vide mémorise « effacé » pour qu'un ancien .lrc ne réapparaisse pas.
        if (sendLyrics) {
          if (finalPath !== source.path) setStoredLyrics(source.path, undefined);
          if (!lyricsInFile) setStoredLyrics(finalPath, lyrics);
          else setStoredLyrics(finalPath, lyrics.trim() ? undefined : "");
        }
        onSaved({ tags: current, jacket: shownJacket, lyrics, path: finalPath, name: finalPath.split(/[\\/]/).pop() });
      } else {
        const res = await updateOnlineMeta({ id: source.id, userid: source.userid, tags: payload, jacket, lyrics: lyrics !== initialLyrics ? lyrics : undefined });
        if (!res.updated) return setError(t(`meta.err.${res.error ?? "notfound"}` as TKey));
        onSaved({ tags: current, jacket: shownJacket, lyrics });
      }
      // Le dialogue reste ouvert : on recharge l'état enregistré (nouvelle référence pour « modifié ») et on l'indique.
      setSaved(true);
      setReloadKey((k) => k + 1);
    } catch {
      setError(t("on.serverDown"));
    } finally {
      // La lecture reprend même si l'écriture a échoué (le fichier d'origine est alors intact).
      if (released) afterSave?.(resumePath);
      setSaving(false);
    }
  }

  // IMPORTANT : `cn` ici n'est pas tailwind-merge ; les suffixes `!` forcent le style « rempli » sur les défauts de <Input>.
  const FIELD = "bg-muted/40! border-transparent! shadow-none! hover:bg-muted/70! focus-visible:bg-background! focus-visible:border-ring!";

  /** Champ « rempli » : icône à gauche, libellé discret au-dessus. */
  const field = (Icon: LucideIcon, label: string, id: string, value: string, onChange: (v: string) => void, wide = false) => (
    <div key={id} className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={value} disabled={loading} className={`pl-9 ${FIELD}`} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );

  const TEXT_ICONS: Record<(typeof TEXT_FIELDS)[number], LucideIcon> = {
    title: Type, artist: User, album: Disc3, album_artist: Users, composer: PenLine, genre: Tag, publisher: Building2, copyright: Copyright,
  };
  const text = (key: (typeof TEXT_FIELDS)[number]) => field(TEXT_ICONS[key], t(`meta.f.${key}` as TKey), `meta-${key}`, tags[key], (v) => setTags((s) => ({ ...s, [key]: v })));

  /** Numéro + total : deux champs compacts séparés par « / ». */
  const pairField = (label: TKey, id: string, value: [string, string], set: (v: [string, string]) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{t(label)}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" min={0} value={value[0]} disabled={loading} className={`text-center ${FIELD}`} onChange={(e) => set([e.target.value, value[1]])} />
        <span className="text-muted-foreground">/</span>
        <Input type="number" min={0} aria-label={`${t(label)} — total`} value={value[1]} disabled={loading} className={`text-center ${FIELD}`} onChange={(e) => set([value[0], e.target.value])} />
      </div>
    </div>
  );

  const infoRows: [LucideIcon, string, string, boolean?][] = info ? [
    [Folder, t("meta.path"), info.path, true], [CalendarPlus, t("meta.created"), fmtDate(info.created, lang)], [CalendarClock, t("meta.modified"), fmtDate(info.modified, lang)], [Clock, t("meta.accessed"), fmtDate(info.accessed, lang)],
    [HardDrive, t("meta.size"), formatSize(info.size)], [FileAudio, t("meta.format"), info.format || "—"], [Timer, t("meta.duration"), info.duration ? formatTime(info.duration) : "—"], [Cpu, t("meta.encoder"), info.encoder || "—"],
  ] : [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      {/* IMPORTANT : en-tête et pied fixes, seul le corps défile (ScrollArea) — les boutons restent toujours visibles. */}
      {/* IMPORTANT : hauteur DÉFINIE (h-, pas max-h-) sinon le viewport Radix (height:100%) ne contraint rien et rien ne défile. */}
      <DialogContent bare className="h-[min(90vh,820px)] sm:max-w-[min(64rem,calc(100vw-3rem))]! lg:max-w-[min(1400px,calc(100vw-3rem))]! 2xl:max-w-[min(1700px,calc(100vw-3rem))]!">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>{t("meta.title")}</DialogTitle>
          <DialogDescription>{isLocal ? t("meta.localHint") : t("meta.onlineHint")}</DialogDescription>
        </DialogHeader>

        {loadError && <p className="p-6 text-sm text-destructive" role="alert">{t("meta.loadFail")}</p>}

        {!loadError && (
          <Tabs defaultValue="cover" className="min-h-0 flex-1">
            <TabsList className="shrink-0 border-b px-4">
              <TabsTrigger value="cover"><ImageIcon /> {t("meta.tab.cover")}</TabsTrigger>
              <TabsTrigger value="tags"><Tag /> {t("meta.tab.tags")}</TabsTrigger>
              <TabsTrigger value="lyrics"><MicVocal /> {t("lyr.field")}{lyrics.trim() && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}</TabsTrigger>
            </TabsList>

            {/* `[&>div]:block!` : Radix enveloppe le contenu dans un div `display:table` qui déborde en largeur. */}
            <TabsContent value="cover" className="flex flex-col">
              <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: "[&>div]:block!" }}>
                <div className="space-y-5 p-6 [&>*]:min-w-0">
                  {/* En-tête : pochette (actions DANS le conteneur) + résumé du média */}
                  <section className="flex flex-col items-center gap-5 rounded-xl bg-gradient-to-br from-muted/60 to-muted/20 p-5 sm:flex-row">
                    <input ref={fileInput} type="file" accept={JACKET_TYPES.join(",")} className="sr-only" onChange={(e) => { pickJacket(e.target.files?.[0]); e.target.value = ""; }} />
                    <div className="group relative grid size-40 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted shadow-md">
                      {shownJacket ? <img src={shownJacket} alt="" className="size-full object-cover" /> : <Music className="size-12 text-muted-foreground" />}
                      {!isVideo && (
                        <>
                          {/* Toute la pochette est cliquable : libellé centré, peut passer à la ligne (plus de débordement). */}
                          <button type="button" disabled={loading} onClick={() => fileInput.current?.click()}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 p-3 text-center text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none">
                            <ImagePlus className="size-6" />
                            <span>{t("meta.coverChoose")}</span>
                          </button>
                          {shownJacket && (
                            <button type="button" disabled={loading} aria-label={t("meta.coverRemove")} title={t("meta.coverRemove")} onClick={() => setJacket(null)}
                              className="absolute top-1.5 right-1.5 z-10 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 focus-visible:opacity-100">
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                      <h3 className="truncate text-2xl font-semibold" title={tags.title || name}>{tags.title || name || "—"}</h3>
                      <p className="truncate text-muted-foreground">{[tags.artist, tags.album].filter(Boolean).join(" · ") || "—"}</p>
                      <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
                        {tags.date && <Badge variant="secondary"><CalendarDays /> {tags.date}</Badge>}
                        {tags.genre && <Badge variant="secondary"><Tag /> {tags.genre}</Badge>}
                        {info?.format && <Badge variant="secondary"><FileAudio /> {info.format}</Badge>}
                        {info?.duration ? <Badge variant="secondary"><Timer /> {formatTime(info.duration)}</Badge> : null}
                        {info && <Badge variant="secondary"><HardDrive /> {formatSize(info.size)}</Badge>}
                      </div>
                      {isVideo && <p className="text-xs text-muted-foreground">{t("meta.coverVideo")}</p>}
                    </div>
                  </section>

                  {/* Infos fichier : tuiles en grille, repliables */}
                  {info && (
                    <details open className="group rounded-xl border p-4 text-sm">
                      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">
                        {t("meta.general")}
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                        {infoRows.map(([Icon, k, v, wide]) => (
                          <div key={k} className={`flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 ${wide ? "sm:col-span-2" : ""}`}>
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <dt className="text-xs text-muted-foreground">{k}</dt>
                              <dd className="truncate" title={v}>{v}</dd>
                            </div>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="tags" className="flex flex-col">
              <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: "[&>div]:block!" }}>
                <div className="space-y-5 p-6 [&>*]:min-w-0">
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                    {isLocal && field(FileAudio, t("meta.file"), "meta-name", name, setName, true)}
                    {text("title")}{text("artist")}{text("album")}{text("album_artist")}
                    {text("composer")}{text("genre")}
                    {field(CalendarDays, t("meta.f.date"), "meta-date", tags.date, (v) => setTags((s) => ({ ...s, date: v })))}
                    {text("publisher")}{text("copyright")}
                    {pairField("meta.f.track", "meta-track", track, setTrack)}
                    {pairField("meta.f.disc", "meta-disc", disc, setDisc)}
                  </div>

                  {isLocal && /\.mp3$/i.test(source.path) && (
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={id3v1} onCheckedChange={(v) => setId3v1(v === true)} /> {t("meta.id3v1")}</label>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Paroles : le champ prend toute la hauteur et défile seul — plus de double barre de défilement. */}
            <TabsContent value="lyrics" className="flex flex-col gap-2 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="meta-lyrics" className="text-sm font-semibold">{t("lyr.field")}</Label>
                <div className="flex gap-1">
                  <input ref={lyricsFile} type="file" accept=".lrc,.txt,text/plain" className="sr-only" onChange={(e) => { importLyrics(e.target.files?.[0]); e.target.value = ""; }} />
                  {!lyrics.trim() && (
                    <Button type="button" size="sm" disabled={loading || searchingLyrics || !tags.artist.trim() || !tags.title.trim()} title={!tags.artist.trim() || !tags.title.trim() ? t("lyr.needTags") : undefined} onClick={() => void searchLyrics()}>
                      {searchingLyrics ? <Loader2 className="animate-spin" /> : <Search />} {searchingLyrics ? t("lyr.loading") : t("lyr.search")}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => lyricsFile.current?.click()}><Upload /> {t("lyr.import")}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={loading || !lyrics} onClick={() => setLyrics("")}><Eraser /> {t("lyr.clear")}</Button>
                </div>
              </div>
              {/* IMPORTANT : le champ s'agrandit avec son texte (field-sizing-content, sans défilement propre) et c'est le ScrollArea qui défile,
                  avec la même barre que partout dans l'app. La hauteur minimale évite un champ minuscule quand il y a peu de texte. */}
              <ScrollArea className="min-h-0 flex-1 rounded-md border" viewportProps={{ className: "[&>div]:block!" }}>
                <Textarea id="meta-lyrics" value={lyrics} disabled={loading} maxLength={MAX_LYRICS} className={`min-h-[calc(min(90vh,820px)-18rem)] resize-none overflow-hidden rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0 ${FIELD}`} placeholder="[00:12.50] ..." onChange={(e) => setLyrics(e.target.value)} />
              </ScrollArea>
              {lyricsNotFound && <p className="text-xs text-destructive" role="status">{t("lyr.notFound")}</p>}
              <p className="text-xs text-muted-foreground">{t("lyr.hint")}{isLocal && ` ${t("lyr.localHint")}`}</p>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="shrink-0 items-center border-t bg-muted/30 px-6 py-3">
          {error && <p className="mr-auto text-sm text-destructive" role="alert">{error}</p>}
          {saved && !dirty && !error && <p className="mr-auto flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400" role="status"><Check className="size-4" /> {t("meta.saved")}</p>}
          <Button variant="outline" disabled={saving} onClick={onClose}><X /> {dirty ? t("set.cancel") : t("detail.close")}</Button>
          <Button disabled={saving || loading || loadError || !dirty} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : <Save />} {saving ? t("meta.saving") : t("set.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
