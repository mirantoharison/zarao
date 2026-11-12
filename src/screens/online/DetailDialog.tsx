import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CalendarDays, Clock, Eye, FileAudio, HardDrive, Loader2, MessageSquare, Music, Send, Tag, ThumbsDown, ThumbsUp, Timer, Trash2, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import {
  avatarUrl, deleteComment, getComments, getMeta, getSocial, getStats, postComment, reactToMedia,
  type CommentItem, type Reaction, type ServerMediaMeta, type SessionUser, type Social, type WeeklyStat,
} from "@/lib/api";
import { formatSize, formatTime } from "@/lib/media";
import { cn } from "@/lib/utils";

type Props = { id: string | null; user: SessionUser; onClose: () => void };

const MAX_COMMENT = 510;
const MIN_COMMENT = 10;
const PAGE = 10;

/** "2026-45" → rang absolu, pour repérer les semaines sans écoute et les remplir à zéro (comme l'ancien graphique). */
const weekRank = (w: string) => { const [y, n] = w.split("-").map(Number); return y * 53 + n; };

function fillWeeks(weekly: WeeklyStat[]): WeeklyStat[] {
  if (weekly.length === 0) return [];
  const byRank = new Map(weekly.map((w) => [weekRank(w.week), w]));
  const first = weekRank(weekly[0].week), last = weekRank(weekly[weekly.length - 1].week);
  const out: WeeklyStat[] = [];
  for (let r = first; r <= last; r++) {
    const hit = byRank.get(r);
    const year = Math.floor((r - 1) / 53), n = r - year * 53;
    out.push(hit ?? { week: `${year}-${String(n).padStart(2, "0")}`, views: 0, seconds: 0 });
  }
  return out;
}

type ChartSeries = { key: string; label: string; color: string; values: number[] };

const num = (v: number) => String(+v.toFixed(1));

/**
 * Courbes d'évolution par semaine en SVG (pas de bibliothèque de graphiques) : plusieurs indicateurs activables,
 * survol avec infobulle commune. Le tracé occupe la hauteur disponible (bornée par max-h) grâce à un ResizeObserver.
 */
function WeeklyChart({ weekly }: { weekly: WeeklyStat[] }) {
  const { t } = useI18n();
  const data = useMemo(() => fillWeeks(weekly), [weekly]);
  const [active, setActive] = useState<string[]>(["views", "minutes"]);
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 560, h: 200 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, Math.round(e.contentRect.width)), h: Math.max(120, Math.round(e.contentRect.height)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = useMemo<ChartSeries[]>(() => {
    const views = data.map((d) => d.views);
    const minutes = data.map((d) => +(d.seconds / 60).toFixed(1));
    const cum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);
    return [
      { key: "views", label: t("soc.chartViews"), color: "#1886db", values: views },
      { key: "minutes", label: t("soc.chartTime"), color: "#ffc400", values: minutes },
      { key: "cumViews", label: t("soc.chartCum"), color: "#22c55e", values: cum(views) },
      { key: "cumMinutes", label: t("soc.chartCumTime"), color: "#a78bfa", values: cum(minutes).map((v) => +v.toFixed(1)) },
      { key: "avg", label: t("soc.chartAvg"), color: "#f472b6", values: data.map((d) => (d.views ? +(d.seconds / 60 / d.views).toFixed(1) : 0)) },
    ];
  }, [data, t]);

  const toggle = (key: string) => setActive((a) => (a.includes(key) ? a.filter((k) => k !== key) : [...a, key]));
  const shown = series.filter((s) => active.includes(s.key));

  const { w: W, h: H } = size;
  const PAD = { l: 12, r: 12, t: 12, b: 24 };
  const n = data.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number, max: number) => PAD.t + (1 - (max ? v / max : 0)) * (H - PAD.t - PAD.b);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-2 text-sm font-semibold">{t("soc.chartTitle")}</span>
        {series.map((s) => {
          const on = active.includes(s.key);
          return (
            <button key={s.key} type="button" aria-pressed={on} onClick={() => toggle(s.key)}
              className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors", on ? "bg-muted text-foreground" : "text-muted-foreground opacity-60 hover:opacity-100")}>
              <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
              {s.label} <span className="text-muted-foreground">(max {num(Math.max(...s.values))})</span>
            </button>
          );
        })}
      </div>

      {/* IMPORTANT : le SVG est en absolute pour ne pas influer sur la hauteur mesurée (sinon boucle de redimensionnement). */}
      <div ref={boxRef} className="relative min-h-48 max-h-96 flex-1">
        <svg width={W} height={H} className="absolute inset-0 overflow-visible" role="img" aria-label={t("soc.chartTitle")} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            {shown.map((s) => (
              <linearGradient key={s.key} id={`wk-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.3} /><stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2, 3].map((g) => { const gy = PAD.t + (g / 3) * (H - PAD.t - PAD.b); return <line key={g} x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="currentColor" strokeOpacity={g === 3 ? 0.25 : 0.08} strokeDasharray={g === 3 ? undefined : "3 4"} />; })}
          {shown.map((s) => {
            const max = Math.max(...s.values);
            const pts = s.values.map((v, i) => `${x(i)},${y(v, max)}`);
            if (n === 1) return <g key={s.key}><line x1={x(0)} x2={x(0)} y1={H - PAD.b} y2={y(s.values[0], max)} stroke={s.color} strokeWidth={3} strokeLinecap="round" /><circle cx={x(0)} cy={y(s.values[0], max)} r={4} fill={s.color} /></g>;
            return (
              <g key={s.key}>
                <polygon points={`${x(0)},${H - PAD.b} ${pts.join(" ")} ${x(n - 1)},${H - PAD.b}`} fill={`url(#wk-${s.key})`} />
                <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {n <= 24 && s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v, max)} r={hover === i ? 4.5 : 2.5} fill={s.color} />)}
              </g>
            );
          })}
          {hover !== null && n > 1 && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.3} />}
          {data.map((d, i) => (n <= 8 || i % Math.ceil(n / 8) === 0) && (
            <text key={d.week} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.6}>{d.week.split("-")[1]}</text>
          ))}
        </svg>
        {hover !== null && shown.length > 0 && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: Math.min(Math.max(x(hover), 80), W - 80), transform: "translateX(-50%)" }}>
            <p className="mb-1 font-medium">{t("soc.week", { w: data[hover].week })}</p>
            {shown.map((s) => <p key={s.key} className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: s.color }} />{s.label}</span><span className="tabular-nums">{num(s.values[hover])}</span></p>)}
          </div>
        )}
        {shown.length === 0 && <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">—</p>}
      </div>
    </div>
  );
}

/** Fiche d'un média : informations, j'aime / je n'aime pas, écoutes, activité par semaine et commentaires. */
export function DetailDialog({ id, user, onClose }: Props) {
  const { t, lang } = useI18n();
  const [meta, setMeta] = useState<ServerMediaMeta | null>(null);
  const [social, setSocial] = useState<Social | null>(null);
  const [weekly, setWeekly] = useState<WeeklyStat[] | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMeta(null); setSocial(null); setWeekly(null); setComments([]); setTotal(0); setDraft(""); setError(null);
    if (!id) return;
    let cancelled = false;
    void getMeta(id).then((m) => { if (!cancelled) setMeta(m); });
    getSocial(id, user._id).then((s) => { if (!cancelled && s.ok) setSocial(s); }).catch(() => undefined);
    getStats(id).then((s) => { if (!cancelled && s.ok) setWeekly(s.weekly); }).catch(() => { if (!cancelled) setWeekly([]); });
    getComments(id, 0, PAGE).then((c) => { if (!cancelled && c.ok) { setComments(c.list); setTotal(c.total); } }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [id, user._id]);

  const react = useCallback(async (kind: Reaction) => {
    if (!id || !social) return;
    const res = await reactToMedia(id, user._id, social.mine === kind ? null : kind).catch(() => null);
    if (res?.ok) setSocial(res);
  }, [id, user._id, social]);

  async function submit() {
    if (!id) return;
    const text = draft.trim();
    if (text.length < MIN_COMMENT) return setError(t("cmt.short"));
    if (text.length > MAX_COMMENT) return setError(t("cmt.long"));
    setPosting(true);
    setError(null);
    try {
      const res = await postComment(id, user._id, text);
      if (!res.ok || !res.comment) return setError(t(res.error === "long" ? "cmt.long" : res.error === "short" ? "cmt.short" : "cmt.failed"));
      setComments((c) => [res.comment as CommentItem, ...c]);
      setTotal((n) => n + 1);
      setDraft("");
    } catch {
      setError(t("cmt.failed"));
    } finally {
      setPosting(false);
    }
  }

  async function loadMore() {
    if (!id) return;
    const c = await getComments(id, comments.length, PAGE).catch(() => null);
    if (c?.ok) { setComments((prev) => [...prev, ...c.list]); setTotal(c.total); }
  }

  async function remove(c: CommentItem) {
    if (!id) return;
    const res = await deleteComment(id, c.id, user._id).catch(() => null);
    if (res?.ok) { setComments((list) => list.filter((x) => x.id !== c.id)); setTotal((n) => Math.max(0, n - 1)); }
  }

  // Artiste / titre / album sont déjà dans l'en-tête : les tuiles ne gardent que le reste.
  const tiles: [LucideIcon, string, string][] = meta ? [
    [Tag, t("detail.genre"), meta.genre || "—"], [CalendarDays, t("detail.year"), meta.date || "—"],
    [Timer, t("detail.duration"), meta.durationFloat ? formatTime(meta.durationFloat) : meta.duration || "—"],
    [HardDrive, t("detail.size"), formatSize(meta.size ?? 0)], [FileAudio, t("detail.format"), (meta.ext ?? "").toUpperCase() || "—"],
    [CalendarClock, t("detail.saved"), meta.savedate ? new Date(meta.savedate).toLocaleString(lang) : "—"],
  ] : [];

  const counter = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground" title={label}>{icon}<span className="tabular-nums text-foreground">{value}</span></div>
  );
  const reactionButton = (kind: Reaction, Icon: typeof ThumbsUp, count: number) => (
    // Pastille « pilule » : bleu pour j'aime, rouge pour je n'aime pas ; remplie quand la réaction est active.
    // IMPORTANT : `cn` ne fusionne pas les classes Tailwind, donc on choisit une seule famille de classes par état (pas de surcharge).
    <button type="button" disabled={!social} onClick={() => void react(kind)} title={t(kind === "like" ? "soc.like" : "soc.dislike")} aria-pressed={social?.mine === kind}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50",
        kind === "like"
          ? (social?.mine === kind ? "bg-sky-700/80 text-sky-50" : "bg-sky-700/15 text-sky-300/80 hover:bg-sky-700/30")
          : (social?.mine === kind ? "bg-rose-700/80 text-rose-50" : "bg-rose-700/15 text-rose-300/80 hover:bg-rose-700/30"),
      )}>
      <Icon className={cn("size-4", social?.mine === kind && "fill-current")} /> <span className="tabular-nums">{count}</span>
    </button>
  );

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      {/* IMPORTANT : même coquille que MetadataDialog — hauteur définie + ScrollArea, sinon rien ne défile ; `!` car `cn` ne fusionne pas. */}
      <DialogContent bare className="h-[min(90vh,820px)] sm:max-w-[min(64rem,calc(100vw-3rem))]! lg:max-w-[min(1100px,calc(100vw-3rem))]!">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>{t("detail.title")}</DialogTitle>
          <DialogDescription className="truncate">{meta?.title ?? t("ld.detail")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: "[&>div]:flex! [&>div]:min-h-full [&>div]:flex-col" }}>
          {/* Le conteneur interne de Radix devient une colonne de hauteur mini 100 % : la grille (flex-1) et ses cartes descendent jusqu'au bas du dialogue. */}
          <div className="flex flex-1 flex-col gap-5 p-6 [&>*]:min-w-0">
            {/* En-tête : pochette, titre, artiste, réactions et compteurs */}
            <section className="flex flex-col items-center gap-5 rounded-xl bg-gradient-to-br from-muted/60 to-muted/20 p-5 sm:flex-row">
              {meta?.jacket
                ? <img src={meta.jacket} alt="" className="size-36 shrink-0 rounded-xl object-cover shadow-md" />
                : <div className="grid size-36 shrink-0 place-items-center rounded-xl bg-muted shadow-md"><Music className="size-12 text-muted-foreground" /></div>}
              <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
                <div className="space-y-1">
                  <h3 className="line-clamp-2 text-2xl leading-tight font-semibold" title={meta?.title}>{meta?.title || "—"}</h3>
                  <p className="truncate text-muted-foreground">{[meta?.artist, meta?.album].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
                  <div className="flex gap-2.5">
                    {reactionButton("like", ThumbsUp, social?.like ?? 0)}
                    {reactionButton("dislike", ThumbsDown, social?.dislike ?? 0)}
                  </div>
                  {counter(<Eye className="size-4" />, t("soc.views"), String(social?.views ?? 0))}
                  {counter(<Clock className="size-4" />, t("soc.time"), formatTime(social?.streamSeconds ?? 0) === "--:--" ? "0:00" : formatTime(social?.streamSeconds ?? 0))}
                  {counter(<MessageSquare className="size-4" />, t("soc.comments"), String(total))}
                </div>
              </div>
            </section>

            <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              {/* Colonne gauche : infos + activité */}
              <div className="flex min-w-0 flex-col gap-5">
                <dl className="grid gap-2 sm:grid-cols-2">
                  {tiles.map(([Icon, k, v]) => (
                    <div key={k} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd className="truncate text-sm" title={v}>{v}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
                <section className="flex min-h-0 flex-1 flex-col rounded-xl border p-4">
                  {weekly && (weekly.length > 0 ? <WeeklyChart weekly={weekly} /> : <p className="text-sm text-muted-foreground">{t("soc.noStats")}</p>)}
                </section>
              </div>

              {/* Colonne droite : commentaires */}
              <section className="min-w-0 space-y-3 rounded-xl border p-4">
                <h3 className="font-medium">{t("cmt.title")} <span className="text-sm font-normal text-muted-foreground">({total})</span></h3>
                <div className="space-y-2">
                  <Textarea rows={3} maxLength={MAX_COMMENT} value={draft} placeholder={t("cmt.placeholder")} className="resize-none border-transparent! bg-muted/40! shadow-none! focus-visible:border-ring!" onChange={(e) => setDraft(e.target.value)} />
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-xs tabular-nums", draft.trim().length > 0 && draft.trim().length < MIN_COMMENT ? "text-destructive" : "text-muted-foreground")}>{t("cmt.count", { n: draft.length })}</span>
                    <Button size="sm" disabled={posting || !draft.trim()} onClick={() => void submit()}>{posting ? <Loader2 className="animate-spin" /> : <Send />} {posting ? t("cmt.posting") : t("cmt.post")}</Button>
                  </div>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                </div>

                {comments.length === 0 && <EmptyState compact icon={MessageSquare} title={t("em.cmtTitle")} description={t("em.cmtBody")} />}
                <ul className="space-y-3">
                  {comments.map((c) => (
                    <li key={c.id} className="flex gap-3 rounded-lg bg-muted/30 p-3">
                      {c.author.hasAvatar
                        ? <img src={avatarUrl(c.userid)} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                        : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">{c.author.username[0]?.toUpperCase()}</span>}
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-medium">{c.author.username}{c.userid === user._id && <span className="ml-1 font-normal text-muted-foreground">({t("cmt.you")})</span>}</span>
                          <span className="text-xs text-muted-foreground">{new Date(c.created).toLocaleString(lang)}</span>
                        </p>
                        <p className="whitespace-pre-wrap break-words text-sm">{c.text}</p>
                      </div>
                      {(c.userid === user._id || meta?.userid === user._id) && (
                        <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => void remove(c)} title={t("cmt.delete")}><Trash2 /></Button>
                      )}
                    </li>
                  ))}
                </ul>
                {comments.length < total && <Button variant="outline" size="sm" onClick={() => void loadMore()}>{t("cmt.more")}</Button>}
              </section>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
