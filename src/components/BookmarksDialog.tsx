import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark as BookmarkIcon, BookmarkPlus, CalendarPlus, Check, ChevronLeft, ChevronRight, ClipboardCopy, Clock, Crosshair, Download, Info, Keyboard, Library, Pencil, Search, Timer, Trash2, Trophy, Upload, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/EmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";
import { addBookmark, bookmarkColor, clearBookmarks, removeBookmark, updateBookmark, useAllBookmarks, type Bookmark } from "@/lib/bookmarks";
import { loadBookmarksFile, saveBookmarksFile } from "@/lib/bookmarksFile";
import { formatTime } from "@/lib/media";
import { cn } from "@/lib/utils";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void };
type SortMode = "time" | "recent" | "name";

/** « 8:30 », « 1:02:10 » ou « 90 » (secondes) → secondes ; null si le format n'est pas reconnu. */
export function parseBookmarkTime(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return null;
  const parts = s.split(":").map(Number);
  // Les minutes et les secondes d'une saisie à deux-points ne dépassent pas 59 (« 8:75 » est une faute de frappe, pas 9:15).
  if (parts.length > 1 && parts.slice(1).some((n) => n > 59)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Sans accents ni majuscules : la recherche « elan » retrouve « Élan ». */
const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const byTime = (a: Bookmark, b: Bookmark) => a.t - b.t;
/** Position de lecture : « 0:00 » au départ (formatTime(0) donne « --:-- », réservé à une durée inconnue), comme la barre du lecteur. */
const clock = (sec: number) => (sec > 0 ? formatTime(sec) : "0:00");
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Signets : deux vues. « Ce média » : frise de la piste, ajout à l'instant présent ou saisi, passage en cours, navigation précédent / suivant,
 * tri, renommage avec note, copie en chapitres. « Tous les médias » : chiffres clés, tous les signets regroupés par fichier (un clic ouvre le
 * média au bon moment), export et import. La recherche filtre les deux vues.
 */
export function BookmarksDialog({ p, open, onClose }: Props) {
  const { t } = useI18n();
  const path = p.current?.path ?? null;
  const all = useAllBookmarks();
  const list = useMemo(() => (path ? [...(all[path] ?? [])].sort(byTime) : []), [all, path]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("time");
  const [name, setName] = useState("");
  // Instant du futur signet : suit la lecture tant que l'utilisateur n'y a pas touché ; saisi à la main, il reste figé.
  const [timeText, setTimeText] = useState("");
  const [timeTouched, setTimeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [editing, setEditing] = useState<{ path: string; id: string; name: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // Remise à zéro à chaque ouverture et à chaque changement de piste : le dialogue reste ouvert pendant la lecture.
  useEffect(() => { if (open) { setName(""); setTimeTouched(false); setError(null); setEditing(null); } }, [open, path]);
  useEffect(() => { if (open) { setQuery(""); setNotice(null); } }, [open]);
  useEffect(() => { if (open && !timeTouched) setTimeText(clock(p.time)); }, [open, timeTouched, p.time]);

  const duration = p.duration;
  const q = fold(query.trim());
  const matches = (b: Bookmark) => !q || fold(b.name).includes(q) || fold(b.note ?? "").includes(q);
  const shown = useMemo(() => {
    const rows = list.filter(matches);
    if (sort === "recent") return rows.sort((a, b) => b.at - a.at);
    if (sort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return rows;
  }, [list, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Passage en cours : le dernier signet déjà dépassé par la lecture. */
  const active = useMemo(() => [...list].reverse().find((b) => b.t <= p.time + 0.05) ?? null, [list, p.time]);
  const prevBookmark = [...list].reverse().find((b) => b.t < p.time - 1);
  const nextBookmark = list.find((b) => b.t > p.time + 0.5);

  /** Médias ayant des signets, le plus récemment marqué d'abord, avec leur élément de la liste de lecture s'il y est encore. */
  const groups = useMemo(() => Object.entries(all)
    .map(([mediaPath, marks]) => ({ mediaPath, marks: [...marks].sort(byTime), item: p.items.find((i) => i.path === mediaPath) ?? null, last: Math.max(...marks.map((b) => b.at)) }))
    .sort((a, b) => b.last - a.last), [all, p.items]);
  const totalCount = groups.reduce((n, g) => n + g.marks.length, 0);
  const mediaTitle = (g: (typeof groups)[number]) => (g.item ? `${g.item.artist ? `${g.item.artist} — ` : ""}${g.item.title}` : baseName(g.mediaPath));
  const topGroup = groups.reduce<(typeof groups)[number] | null>((best, g) => (!best || g.marks.length > best.marks.length ? g : best), null);
  const lastMark = groups.flatMap((g) => g.marks.map((b) => ({ b, g }))).reduce<{ b: Bookmark; g: (typeof groups)[number] } | null>((best, x) => (!best || x.b.at > best.b.at ? x : best), null);

  const add = () => {
    if (!path) return;
    // Instant non touché : on garde la position exacte (au dixième) plutôt que le texte arrondi à la seconde.
    const at = timeTouched ? parseBookmarkTime(timeText) : p.time;
    if (at === null) { setError(t("bm.errTime")); return; }
    if (duration > 0 && at > duration) { setError(t("bm.errRange", { d: formatTime(duration) })); return; }
    addBookmark(path, at, name.trim() || t("bm.defaultName", { t: formatTime(at) }));
    setName("");
    setError(null);
  };
  const commitEdit = () => {
    if (editing) updateBookmark(editing.path, editing.id, editing.name, editing.note);
    setEditing(null);
  };
  /** Clic sur la frise : on y va, proportionnellement à la position du clic. */
  const seekOnTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    p.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  };
  /** Format des chapitres YouTube : une ligne « 8:30 Nom » par signet (la liste complète, pas seulement le résultat de la recherche). */
  const copyChapters = () => {
    if (list.length === 0) return;
    void navigator.clipboard?.writeText(list.map((b) => `${formatTime(b.t)} ${b.name}`).join("\n"));
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };
  const doExport = async () => {
    try { if (await saveBookmarksFile()) setNotice({ text: t("bm.exported"), isError: false }); }
    catch { setNotice({ text: t("msg.saveFail"), isError: true }); }
  };
  const doImport = async () => {
    try {
      const n = await loadBookmarksFile();
      if (n !== null) setNotice({ text: n > 0 ? t("bm.imported", { n }) : t("bm.importNone"), isError: false });
    } catch (e) { setNotice({ text: e instanceof Error ? e.message : t("msg.error"), isError: true }); }
  };

  /** Mode édition d'une ligne : nom et note. Entrée valide, Échap annule. */
  const editFields = (b: Bookmark, mediaPath: string) => (
    <>
      <BookmarkIcon className="size-4 shrink-0 fill-current" strokeWidth={1.5} style={{ color: bookmarkColor(b) }} />
      <span className="w-14 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{formatTime(b.t)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
        <Input autoFocus className="h-7" value={editing?.name ?? ""} maxLength={80} aria-label={t("bm.rename")} onChange={(e) => setEditing((s) => (s ? { ...s, name: e.target.value } : s))}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); else if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
        <Input className="h-7" value={editing?.note ?? ""} maxLength={300} placeholder={t("bm.notePh")} aria-label={t("bm.notePh")} onChange={(e) => setEditing((s) => (s ? { ...s, note: e.target.value } : s))}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); else if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
      </div>
      <Button type="button" variant="ghost" size="icon-xs" title={t("bm.renameOk")} aria-label={t("bm.renameOk")} onClick={commitEdit}><Check /></Button>
      <Button type="button" variant="ghost" size="icon-xs" title={t("bm.delete")} aria-label={t("bm.delete")} onClick={() => { removeBookmark(mediaPath, b.id); setEditing(null); }}><Trash2 /></Button>
    </>
  );

  /** Ligne de signet (même tuile `bg-muted/40` que les infos de la fenêtre des métadonnées) ; l'action de clic dépend de la vue. */
  const row = (b: Bookmark, mediaPath: string, o: { index?: number; active?: boolean; meta?: string; inert?: boolean; jumpTitle: string; onJump: () => void }) => (
    <li key={b.id} className={cn("bookmark-row-in flex items-center gap-2 rounded-lg bg-muted/40 py-0.5 pr-1 pl-3", o.active && "bg-primary/10 ring-1 ring-primary/40")} style={{ animationDelay: `${Math.min(o.index ?? 0, 10) * 40}ms` }} title={o.active ? t("bm.current") : undefined}>
      {editing?.id === b.id ? editFields(b, mediaPath) : (
        <>
          <button type="button" disabled={o.inert} className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left disabled:cursor-default disabled:opacity-60" onClick={o.onJump} title={o.jumpTitle}>
            <BookmarkIcon className="size-4 shrink-0 fill-current" strokeWidth={1.5} style={{ color: bookmarkColor(b) }} />
            <span className="w-14 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{formatTime(b.t)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{b.name}</span>
              {b.note && <span className="block truncate text-xs italic text-muted-foreground">{b.note}</span>}
            </span>
          </button>
          {o.meta && <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">{o.meta}</span>}
          <Button type="button" variant="ghost" size="icon-xs" title={t("bm.editNote")} aria-label={t("bm.editNote")} onClick={() => setEditing({ path: mediaPath, id: b.id, name: b.name, note: b.note ?? "" })}><Pencil /></Button>
          <Button type="button" variant="ghost" size="icon-xs" title={t("bm.delete")} aria-label={t("bm.delete")} onClick={() => removeBookmark(mediaPath, b.id)}><Trash2 /></Button>
        </>
      )}
    </li>
  );

  /** Champ de recherche, partagé par les deux onglets de liste (même saisie dans les deux). */
  const searchBox = (
    <div className="relative min-w-48 max-w-sm flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="h-8 pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("bm.search")} aria-label={t("bm.search")} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* IMPORTANT : même gabarit que MetadataDialog : en-tête et pied fixes, onglets, et chaque onglet défile en entier (ScrollArea). */}
      {/* Hauteur DÉFINIE (h-, pas max-h-) sinon le viewport Radix ne contraint rien et rien ne défile. */}
      <DialogContent bare onOpenAutoFocus={(e) => e.preventDefault()} className="h-[min(90vh,820px)] sm:max-w-[min(64rem,calc(100vw-3rem))]! lg:max-w-[min(1400px,calc(100vw-3rem))]! 2xl:max-w-[min(1700px,calc(100vw-3rem))]!">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><BookmarkIcon className="size-5 text-primary" /> {t("bm.title")}</DialogTitle>
          <DialogDescription>{t("bm.subtitle")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="media" className="min-h-0 flex-1">
          <TabsList className="shrink-0 border-b px-4">
            <TabsTrigger value="media"><BookmarkIcon /> {t("bm.tabMedia")} <Badge variant="secondary">{list.length}</Badge></TabsTrigger>
            <TabsTrigger value="all"><Library /> {t("bm.tabAll")} <Badge variant="secondary">{totalCount}</Badge></TabsTrigger>
            <TabsTrigger value="about"><Info /> {t("bm.tabAbout")}</TabsTrigger>
          </TabsList>

          {/* ───── Ce média : bandeau (titre, badges, frise, navigation), ajout, liste ───── */}
          <TabsContent value="media" className="flex flex-col">
            {/* `[&>div]:block!` : Radix enveloppe le contenu dans un div `display:table` qui déborde en largeur. */}
            <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: "[&>div]:block!" }}>
              <div className="space-y-5 p-6 [&>*]:min-w-0">
                <section className="space-y-4 rounded-xl bg-gradient-to-br from-muted/60 to-muted/20 p-5">
                  <div className="space-y-1">
                    <h3 className="truncate text-2xl font-semibold" title={p.current?.title}>{p.current?.title ?? t("bm.noMedia")}</h3>
                    {p.current?.artist && <p className="truncate text-muted-foreground">{p.current.artist}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary"><BookmarkIcon /> {t("bm.heroCount", { n: list.length })}</Badge>
                    {duration > 0 && <Badge variant="secondary"><Timer /> {formatTime(duration)}</Badge>}
                    {active && <Badge variant="secondary"><Clock /> {formatTime(active.t)}</Badge>}
                  </div>
                  {path && (
                    <>
                      <div className="relative h-9 cursor-pointer" onClick={seekOnTimeline} title={t("bm.timelineHint")}>
                        <div className="absolute inset-x-0 bottom-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary/60" style={{ width: `${duration > 0 ? Math.min(100, (p.time / duration) * 100) : 0}%` }} />
                        </div>
                        {duration > 0 && list.filter((b) => b.t <= duration).map((b, i) => (
                          <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); p.seek(b.t); }} title={`${b.name} · ${formatTime(b.t)}`} aria-label={`${b.name} · ${formatTime(b.t)}`}
                            className="bookmark-drop absolute bottom-3 -translate-x-1/2 transition-transform hover:-translate-y-0.5 hover:scale-125" style={{ left: `${(b.t / duration) * 100}%`, color: bookmarkColor(b), animationDelay: `${Math.min(i, 12) * 60}ms` }}>
                            <BookmarkIcon className="size-5 fill-current drop-shadow-sm" strokeWidth={1.5} />
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-between text-xs tabular-nums text-muted-foreground"><span>0:00</span><span className="font-medium text-foreground">{clock(p.time)}</span><span>{formatTime(duration)}</span></div>
                      <p className="text-sm">
                        {list.length === 0 ? t("bm.heroNone") : (
                          <>
                            {active ? t("bm.nowIn", { name: active.name, d: formatTime(Math.max(0, p.time - active.t)) }) : t("bm.nowStart")}{" "}
                            <span className="text-muted-foreground">{nextBookmark ? t("bm.nextIn", { name: nextBookmark.name, d: formatTime(nextBookmark.t - p.time) }) : t("bm.noNext")}</span>
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {/* Action principale : un signet à l'instant présent, en un clic (le formulaire plus bas sert au nom et à l'instant libre). */}
                        <Button type="button" size="sm" onClick={() => addBookmark(path, p.time, t("bm.defaultName", { t: clock(p.time) }))}><BookmarkPlus /> {t("bm.addHere", { t: clock(p.time) })}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={!prevBookmark} onClick={() => prevBookmark && p.seek(prevBookmark.t)}><ChevronLeft /> {t("bm.prev")}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={!nextBookmark} onClick={() => nextBookmark && p.seek(nextBookmark.t)}>{t("bm.next")} <ChevronRight /></Button>
                      </div>
                    </>
                  )}
                </section>

                <section className="rounded-xl border p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><BookmarkPlus className="size-4 text-primary" /> {t("bm.addSection")}</h3>
                  <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
                    <div className="min-w-56 flex-1 space-y-1.5">
                      <Label htmlFor="bm-name">{t("bm.nameLabel")}</Label>
                      <Input id="bm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("bm.namePh")} disabled={!path} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bm-time">{t("bm.timeLabel")}</Label>
                      <div className="flex gap-1">
                        <Input id="bm-time" className="w-32 tabular-nums" value={timeText} inputMode="numeric" placeholder="8:30" disabled={!path} aria-invalid={error !== null}
                          onChange={(e) => { setTimeText(e.target.value); setTimeTouched(true); setError(null); }} />
                        <Button type="button" variant="outline" size="icon" disabled={!path || !timeTouched} title={t("bm.now")} aria-label={t("bm.now")} onClick={() => { setTimeTouched(false); setError(null); }}><Crosshair /></Button>
                      </div>
                    </div>
                    <Button type="submit" disabled={!path}><BookmarkPlus /> {t("bm.addBtn")}</Button>
                    {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
                  </form>
                </section>

                <section className="rounded-xl border p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="mr-auto text-sm font-semibold">{t("bm.listTitle")}</h3>
                    {searchBox}
                    <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                      <SelectTrigger size="sm" className="w-44" aria-label={t("bm.sortLabel")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="time">{t("bm.sortTime")}</SelectItem>
                        <SelectItem value="recent">{t("bm.sortRecent")}</SelectItem>
                        <SelectItem value="name">{t("bm.sortName")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" size="sm" variant="outline" disabled={list.length === 0} onClick={copyChapters}>{copied ? <Check /> : <ClipboardCopy />} {copied ? t("bm.copied") : t("bm.copyChapters")}</Button>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={list.length === 0 || !path} onClick={() => path && clearBookmarks(path)}><Trash2 /> {t("bm.clear")}</Button>
                  </div>
                  {list.length === 0 ? <EmptyState compact icon={BookmarkIcon} title={t("bm.none")} description={t("bm.noneBody")} />
                    : shown.length === 0 ? <EmptyState compact icon={Search} title={t("bm.noMatch")} />
                    : (
                      <ul className="space-y-1.5">
                        {shown.map((b, i) => {
                          const n = list.indexOf(b);
                          const pct = duration > 0 ? `${Math.round((b.t / duration) * 100)} % · ` : "";
                          return row(b, path ?? "", { index: i, active: b.id === active?.id, meta: `${pct}${n === 0 ? t("bm.fromStart") : t("bm.delta", { d: formatTime(b.t - list[n - 1].t) })}`, jumpTitle: t("bm.go"), onJump: () => p.seek(b.t) });
                        })}
                      </ul>
                    )}
                </section>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ───── Tous les médias : chiffres clés en tuiles, recherche / export / import, signets regroupés par fichier ───── */}
          <TabsContent value="all" className="flex flex-col">
            <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: "[&>div]:block!" }}>
              <div className="space-y-5 p-6 [&>*]:min-w-0">
                {totalCount > 0 && (
                  <section className="rounded-xl bg-gradient-to-br from-muted/60 to-muted/20 p-5">
                    <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {([
                        [BookmarkIcon, t("bm.statTotal"), String(totalCount), ""],
                        [Library, t("bm.statMedia"), String(groups.length), ""],
                        ...(topGroup ? [[Trophy, t("bm.statTop"), mediaTitle(topGroup), t("bm.statTopCount", { n: topGroup.marks.length })]] : []),
                        ...(lastMark ? [[CalendarPlus, t("bm.statLast"), lastMark.b.name, mediaTitle(lastMark.g)]] : []),
                      ] as [LucideIcon, string, string, string][]).map(([Icon, label, value, hint]) => (
                        <div key={label} className="flex items-center gap-3 rounded-lg bg-background/60 px-3 py-2">
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <dt className="text-xs text-muted-foreground">{label}</dt>
                            <dd className="truncate text-sm font-semibold" title={value}>{value}</dd>
                            {hint && <dd className="truncate text-xs text-muted-foreground" title={hint}>{hint}</dd>}
                          </div>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}

                <section className="rounded-xl border p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="mr-auto text-sm font-semibold">{t("bm.tabAll")}</h3>
                    {searchBox}
                    <Button type="button" size="sm" variant="outline" title={t("bm.importTitle")} onClick={doImport}><Upload /> {t("bm.import")}</Button>
                    <Button type="button" size="sm" variant="outline" title={t("bm.exportTitle")} disabled={totalCount === 0} onClick={doExport}><Download /> {t("bm.export")}</Button>
                  </div>
                  {groups.length === 0 ? <EmptyState compact icon={Library} title={t("bm.allNone")} description={t("bm.allNoneBody")} /> : (
                    <div className="space-y-4">
                      {groups.map((g) => {
                        const rows = g.marks.filter(matches);
                        if (rows.length === 0) return null;
                        return (
                          <div key={g.mediaPath}>
                            <div className="mb-1.5 flex items-baseline gap-2">
                              <h4 className="min-w-0 truncate text-sm font-semibold" title={g.mediaPath}>{mediaTitle(g)}</h4>
                              <span className="shrink-0 text-xs text-muted-foreground">{g.item && g.item.duration > 0 ? t("bm.summary", { n: g.marks.length, d: formatTime(g.item.duration) }) : t("bm.heroCount", { n: g.marks.length })}</span>
                              {!g.item && <Badge variant="secondary">{t("bm.notInList")}</Badge>}
                            </div>
                            <ul className="space-y-1.5">
                              {/* Dans la liste de lecture : on lance ce média à l'instant du signet. Sinon la ligne est inerte (le fichier n'est plus chargé). */}
                              {rows.map((b, i) => row(b, g.mediaPath, { index: i, inert: !g.item, jumpTitle: g.item ? t("bm.playAt", { t: formatTime(b.t) }) : t("bm.notInList"), onJump: () => { if (g.item) { p.playAt(g.item.id, b.t); onClose(); } } }))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ───── À propos : à quoi servent les signets, comment s'en servir, raccourcis ───── */}
          <TabsContent value="about" className="flex flex-col">
            <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: "[&>div]:block!" }}>
              <div className="space-y-5 p-6 [&>*]:min-w-0">
                <section className="space-y-3 rounded-xl bg-gradient-to-br from-muted/60 to-muted/20 p-5">
                  <h3 className="text-lg font-semibold">{t("bm.aboutTitle")}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("bm.intro")}</p>
                </section>
                <section className="rounded-xl border p-4">
                  <ol className="space-y-2.5 text-sm leading-relaxed">
                    {(["bm.how1", "bm.how2", "bm.how3", "bm.how4"] as const).map((key, i) => (
                      <li key={key} className="flex gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                        <span>{t(key)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
                <section className="rounded-xl border p-4">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Keyboard className="size-4 text-primary" /> {t("bm.shortcuts")}</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(["bm.sc1", "bm.sc2", "bm.sc3"] as const).map((key) => <li key={key}>{t(key)}</li>)}
                  </ul>
                </section>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 items-center border-t bg-muted/30 px-6 py-3">
          {notice
            ? <p role="status" className={cn("mr-auto text-sm", notice.isError ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{notice.text}</p>
            : <p className="mr-auto hidden min-w-0 truncate text-xs text-muted-foreground md:block" title={t("bm.tips")}>{t("bm.tips")}</p>}
          <Button variant="outline" onClick={onClose}><X /> {t("detail.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
