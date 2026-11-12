import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, FileAudio, FileText, FileVideo, ImagePlus, ListMusic, Loader2, Plus, UploadCloud, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, type TKey } from "@/i18n";
import { uploadMedia } from "@/lib/api";
import { audioExt, formatSize, formatTime, videoExt } from "@/lib/media";
import { readFileTags } from "@/lib/tags";
import { cn } from "@/lib/utils";

type Props = { userid: string; onUploaded: () => void };

/** Confirmation d'enregistrement : pastille de succès, référence copiable et deux actions claires (au lieu d'une phrase soulignée). */
function DoneCard({ id, onList, onAnother }: { id: string; onList: () => void; onAnother: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* presse-papiers indisponible : la référence reste affichée et sélectionnable */ }
  }
  return (
    <div role="status" className="flex flex-col gap-4 rounded-xl bg-emerald-500/10 p-4 sm:flex-row sm:items-center">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"><Check className="size-6" /></span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-emerald-300">{t("up.doneTitle")}</p>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("up.reference")}</span>
          <code className="min-w-0 select-all truncate rounded-md bg-background/40 px-1.5 py-0.5 font-mono text-foreground">{id}</code>
          <button type="button" onClick={() => void copy()} className="grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-background/40 hover:text-foreground" title={t("player.copy")} aria-label={t("player.copy")}>
            {copied ? <Check className="size-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" className="rounded-full" onClick={onList}><ListMusic /> {t("up.seeList")}</Button>
        <Button type="button" variant="outline" className="rounded-full" onClick={onAnother}><Plus /> {t("up.another")}</Button>
      </div>
    </div>
  );
}
type Status = { kind: "idle" } | { kind: "uploading"; percent: number } | { kind: "done"; id: string } | { kind: "error"; message: string };
type Fields = Record<"artist" | "title" | "genre" | "date" | "album" | "composer" | "disc" | "track" | "copyright" | "publisher", string>;

const EMPTY_FIELDS: Fields = { artist: "", title: "", genre: "", date: "", album: "", composer: "", disc: "", track: "", copyright: "", publisher: "" };

/** Petite zone de dépôt cliquable (glisser-déposer ou parcourir), utilisée pour la pochette et les paroles. */
function DropBox({ id, accept, icon: Icon, title, hint, disabled, onFile, className }: {
  id: string; accept: string; icon: typeof UploadCloud; title: string; hint?: string; disabled?: boolean; onFile: (f: File) => void; className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !disabled) onFile(f); }}
      className={cn("flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-7 text-center transition-colors hover:bg-accent/40", over && "border-primary bg-accent/60", disabled && "pointer-events-none opacity-50", className)}
    >
      <Icon className="size-7 text-muted-foreground" />
      <span className="text-sm font-medium">{title}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <input id={id} type="file" accept={accept} className="sr-only" disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

/** Détecte les horodatages LRC ([mm:ss.xx]) et garde un court aperçu pour rassurer l'utilisateur sur le fichier choisi. */
async function inspectLyrics(file: File): Promise<{ synced: boolean; lines: number; preview: string[] }> {
  const text = (await file.slice(0, 256 * 1024).text()).replace(/^﻿/, "");
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  const stamp = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g;
  const synced = rows.some((l) => /^\s*\[\d{1,2}:\d{2}/.test(l));
  const clean = rows.map((l) => l.replace(stamp, "").trim()).filter((l) => l && !/^\[[a-z]+:.*\]$/i.test(l));
  return { synced, lines: clean.length, preview: clean.slice(0, 4) };
}

/**
 * Téléversement en trois étapes : 1) zone de dépôt du fichier, 2) informations préremplies avec les tags du fichier,
 * 3) pochette et paroles (facultatives) puis envoi (équivalent de music-add.hbs). Obligatoires : fichier, chanteur, titre, genre, année.
 */
export function UploadForm({ userid, onUploaded }: Props) {
  const { t } = useI18n();
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [duration, setDuration] = useState(0);
  const [tagsFound, setTagsFound] = useState(false);
  const [jacket, setJacket] = useState<File | null>(null);
  const [jacketUrl, setJacketUrl] = useState("");
  const [jacketFromFile, setJacketFromFile] = useState(false);
  const [lyrics, setLyrics] = useState<File | null>(null);
  const [lyricsInfo, setLyricsInfo] = useState<{ synced: boolean; lines: number; preview: string[] } | null>(null);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [stage, setStage] = useState<"info" | "extras">("info");

  const busy = status.kind === "uploading";
  const extensions = [...audioExt(), ...videoExt()];
  const accept = extensions.map((e) => `.${e}`).join(",");
  const isVideo = file ? videoExt().includes(file.name.split(".").pop()?.toLowerCase() ?? "") : false;
  const step = !file ? 1 : stage === "info" ? 2 : 3;

  useEffect(() => {
    if (!lyrics) { setLyricsInfo(null); return; }
    let cancelled = false;
    void inspectLyrics(lyrics).then((i) => { if (!cancelled) setLyricsInfo(i); }).catch(() => { if (!cancelled) setLyricsInfo({ synced: false, lines: 0, preview: [] }); });
    return () => { cancelled = true; };
  }, [lyrics]);

  function pickLyrics(f: File) {
    if (!/\.(lrc|txt)$/i.test(f.name)) { setLyricsError(t("up.lyricsBadType")); return; }
    setLyricsError(null);
    setLyrics(f);
  }

  function pickJacket(f: File) {
    if (!f.type.startsWith("image/")) return;
    setJacket(f);
    setJacketFromFile(false);
  }

  // Aperçu de la pochette ; l'URL objet est libérée dès qu'elle change pour ne pas fuir en mémoire.
  useEffect(() => {
    if (!jacket) { setJacketUrl(""); return; }
    const url = URL.createObjectURL(jacket);
    setJacketUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [jacket]);

  /** Valide l'extension, lit les tags puis passe à l'étape 2 avec les champs préremplis. */
  async function pick(picked: File | undefined) {
    if (!picked) return;
    const ext = picked.name.split(".").pop()?.toLowerCase() ?? "";
    if (!extensions.includes(ext)) { setDropError(t("up.badType")); return; }
    setDropError(null);
    setAnalyzing(true);
    const read = await readFileTags(picked);
    setAnalyzing(false);
    // IMPORTANT : sans titre dans les tags, le nom du fichier (sans extension) évite un champ obligatoire vide.
    const fallbackTitle = picked.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
    setFields({
      ...EMPTY_FIELDS,
      artist: read.tags.artist, title: read.tags.title || fallbackTitle, genre: read.tags.genre, date: read.tags.date,
      album: read.tags.album, composer: read.tags.composer, disc: read.tags.disc, track: read.tags.track,
      copyright: read.tags.copyright, publisher: read.tags.publisher,
    });
    setDuration(read.duration);
    setTagsFound(read.found);
    setJacket(read.jacket);
    setJacketFromFile(Boolean(read.jacket));
    setLyrics(null);
    setStage("info");
    setStatus({ kind: "idle" });
    setFile(picked);
  }

  function reset() {
    abortRef.current?.abort();
    setFile(null); setFields(EMPTY_FIELDS); setJacket(null); setLyrics(null); setDuration(0); setStatus({ kind: "idle" }); setDropError(null); setStage("info"); setLyricsError(null);
  }

  const onDrop = (e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files[0]); };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = (k: keyof Fields) => fields[k].trim();
    if (!file || !text("artist") || !text("title") || !text("genre") || !text("date")) {
      setStatus({ kind: "error", message: t("up.required") });
      setStage("info");
      return;
    }
    // Étape 2 : on valide les champs puis on passe à la pochette et aux paroles ; l'envoi n'a lieu qu'à l'étape 3.
    if (stage === "info") { setStatus({ kind: "idle" }); setStage("extras"); return; }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: "uploading", percent: 0 });
    try {
      const res = await uploadMedia({
        userid, media: file, artist: text("artist"), title: text("title"), genre: text("genre"), date: text("date"),
        album: text("album"), disc: text("disc"), track: text("track"), composer: text("composer"), copyright: text("copyright"), publisher: text("publisher"),
        jacket, lyrics,
      }, (loaded, total) => setStatus({ kind: "uploading", percent: Math.round((loaded / total) * 100) }), ctrl.signal);
      if (res.notsupported || !res.id) setStatus({ kind: "error", message: res.message || t("up.unsupported") });
      else setStatus({ kind: "done", id: res.id });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).name === "AbortError" ? t("up.canceled") : t("up.error") });
    } finally {
      abortRef.current = null;
    }
  }

  const stepper = (
    <ol className="flex items-center gap-3 text-sm">
      {([["up.step1", 1], ["up.step2", 2], ["up.step3", 3]] as [TKey, number][]).map(([label, n], i) => {
        const done = step > n || (n === 3 && status.kind === "done");
        return (
          <li key={n} className="flex items-center gap-3">
            {i > 0 && <span className={cn("h-px w-10", step >= n ? "bg-primary" : "bg-border")} />}
            <span className={cn("flex items-center gap-2", step >= n ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("grid size-6 place-items-center rounded-full border text-xs font-semibold", step >= n && "border-primary bg-primary text-primary-foreground")}>
                {done ? <Check className="size-3.5" /> : n}
              </span>
              {t(label)}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const header = (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">{t("up.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{step === 1 ? t("up.step1Desc") : step === 2 ? t("up.desc") : t("up.step3Desc")}</p>
      </div>
      {stepper}
    </div>
  );

  // ---- Étape 1 : zone de dépôt ----
  if (!file) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
        {header}
        <label
          htmlFor="up-media"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center transition-colors hover:bg-accent/40",
            dragging && "border-primary bg-accent/60",
            dropError && "border-destructive/60",
          )}
        >
          <div className="grid size-16 place-items-center rounded-full bg-muted text-muted-foreground">
            {analyzing ? <Loader2 className="size-8 animate-spin" /> : <UploadCloud className="size-8" />}
          </div>
          <p className="text-base font-semibold">{analyzing ? t("up.analyzing") : dragging ? t("up.dropActive") : t("up.dropTitle")}</p>
          {!analyzing && (
            <>
              <p className="text-sm text-muted-foreground">{t("up.dropOr")}</p>
              <span className="inline-flex h-9 items-center rounded-md border bg-background px-4 text-sm font-medium shadow-xs">{t("up.dropBrowse")}</span>
              <p className="max-w-md text-xs text-muted-foreground">{t("up.formats", { f: extensions.join(", ") })}</p>
            </>
          )}
          <input id="up-media" type="file" accept={accept} className="sr-only" disabled={analyzing} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {dropError && <p className="text-sm text-destructive" role="alert">{dropError}</p>}
      </div>
    );
  }

  // ---- Étape 2 : informations préremplies ----
  const field = (name: keyof Fields, label: TKey, extra?: { placeholder?: string }) => (
    <div className="space-y-1.5">
      <Label htmlFor={`up-${name}`}>{t(label)}</Label>
      <Input id={`up-${name}`} name={name} value={fields[name]} disabled={busy} onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))} {...extra} />
    </div>
  );
  const FileIcon = isVideo ? FileVideo : FileAudio;

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl space-y-5 p-6">
      {header}

      {/* Fichier choisi */}
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><FileIcon className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatSize(file.size)}{duration > 0 && ` · ${formatTime(duration)}`}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reset}>{t("up.change")}</Button>
      </div>

      {stage === "info" ? (
        <>
          <p className={cn("text-sm", tagsFound ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{tagsFound ? t("up.tagsFound") : t("up.noTags")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("artist", "up.artist")}
            {field("title", "up.mediaTitle")}
            {field("genre", "up.genre")}
            {field("date", "up.year", { placeholder: "2024" })}
            {field("album", "up.album")}
            {field("composer", "up.composer")}
            {field("disc", "up.disc")}
            {field("track", "up.track")}
            {field("copyright", "up.copyright")}
            {field("publisher", "up.publisher")}
          </div>
        </>
      ) : (
        <div className="grid gap-6 sm:grid-cols-[14rem_1fr]">
          {/* Pochette : celle du fichier si elle existe, remplaçable par glisser-déposer */}
          <div className="space-y-2">
            <Label>{t("up.jacket")}</Label>
            {jacketUrl ? (
              <div className="group relative aspect-square overflow-hidden rounded-xl border bg-muted">
                <img src={jacketUrl} alt="" className="size-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-2 text-xs text-white">
                  <span className="truncate">{jacketFromFile ? t("up.coverFromFile") : jacket?.name}</span>
                  <button type="button" disabled={busy} className="inline-flex shrink-0 items-center gap-0.5 rounded bg-white/20 px-1.5 py-0.5 hover:bg-white/30" onClick={() => { setJacket(null); setJacketFromFile(false); }}><X className="size-3" />{t("up.coverRemove")}</button>
                </div>
              </div>
            ) : (
              <DropBox id="up-jacket" accept="image/*" icon={ImagePlus} title={t("up.dropCover")} hint={t("up.coverHint")} disabled={busy} onFile={pickJacket} className="aspect-square justify-center" />
            )}
            {jacketUrl && (
              <label htmlFor="up-jacket-replace" className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
                {t("up.replace")}
                <input id="up-jacket-replace" type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickJacket(f); e.target.value = ""; }} />
              </label>
            )}
          </div>

          {/* Paroles : zone de dépôt, puis carte avec type détecté (LRC synchronisé ou texte) et aperçu */}
          <div className="space-y-2">
            <Label>{t("up.lyrics")}</Label>
            {!lyrics ? (
              <DropBox id="up-lyrics" accept=".lrc,.txt,text/plain" icon={FileText} title={t("up.dropLyrics")} hint={t("lyr.hint")} disabled={busy} onFile={pickLyrics} className="h-56 justify-center" />
            ) : (
              <div className="flex min-h-56 flex-col overflow-hidden rounded-xl border">
                <div className="flex items-center gap-3 border-b bg-muted/40 p-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><FileText className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={lyrics.name}>{lyrics.name}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      {lyricsInfo && (
                        <span className={cn("rounded-full px-2 py-0.5 font-medium", lyricsInfo.synced ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                          {lyricsInfo.synced ? t("up.lyricsSynced") : t("up.lyricsPlain")}
                        </span>
                      )}
                      <span>{formatSize(lyrics.size)}{lyricsInfo && ` · ${t("up.lines", { n: lyricsInfo.lines })}`}</span>
                    </p>
                  </div>
                  <Button type="button" size="icon" variant="ghost" className="size-8" disabled={busy} title={t("up.lyricsRemove")} onClick={() => setLyrics(null)}><X /></Button>
                </div>
                {lyricsInfo && lyricsInfo.preview.length > 0 && (
                  <div className="flex-1 space-y-1 p-3 text-sm">
                    {lyricsInfo.preview.map((l, i) => <p key={i} className={cn("truncate", i === 0 ? "text-foreground" : "text-muted-foreground")}>{l}</p>)}
                    {lyricsInfo.lines > lyricsInfo.preview.length && <p className="text-muted-foreground">…</p>}
                  </div>
                )}
                {lyricsInfo && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{lyricsInfo.synced ? t("up.lyricsSyncedHint") : t("up.lyricsPlainHint")}</p>}
              </div>
            )}
            {lyricsError && <p className="text-sm text-destructive" role="alert">{lyricsError}</p>}
          </div>
        </div>
      )}

      {status.kind === "uploading" && (
        <div className="space-y-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${status.percent}%` }} /></div>
          <p className="text-sm text-muted-foreground">{t("up.uploading", { p: status.percent })}</p>
        </div>
      )}
      {status.kind === "error" && <p className="text-sm text-destructive" role="alert">{status.message}</p>}
      {status.kind === "done" && <DoneCard id={status.id} onList={onUploaded} onAnother={reset} />}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => (stage === "extras" ? setStage("info") : reset())}><ArrowLeft /> {t("up.back")}</Button>
        {stage === "info"
          ? <Button type="submit"><ArrowRight /> {t("up.next")}</Button>
          : <Button type="submit" disabled={busy || status.kind === "done"}><Upload /> {t("up.submit")}</Button>}
        {busy && <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>{t("up.cancel")}</Button>}
      </div>
    </form>
  );
}
