import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Eye, MessageSquare, Music, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

/** Courbes simples (écoutes et minutes par semaine) en SVG : pas de bibliothèque de graphiques pour deux séries. */
function WeeklyChart({ weekly }: { weekly: WeeklyStat[] }) {
  const { t } = useI18n();
  const data = useMemo(() => fillWeeks(weekly), [weekly]);
  const W = 560, H = 140, PAD = { l: 8, r: 8, t: 10, b: 22 };
  const n = data.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  // Chaque série est normalisée sur son propre maximum : écoutes et minutes n'ont pas la même échelle.
  const series = [
    { key: "views", label: t("soc.chartViews"), color: "#1886db", values: data.map((d) => d.views) },
    { key: "minutes", label: t("soc.chartTime"), color: "#ffc400", values: data.map((d) => Math.round(d.seconds / 60)) },
  ];
  const y = (v: number, max: number) => PAD.t + (1 - (max ? v / max : 0)) * (H - PAD.t - PAD.b);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("soc.chartTitle")}</span>
        {series.map((s) => <span key={s.key} className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: s.color }} />{s.label} (max {Math.max(...s.values)})</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("soc.chartTitle")}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.2} />
        {series.map((s, si) => {
          const max = Math.max(...s.values);
          const pts = s.values.map((v, i) => `${x(i)},${y(v, max)}`);
          // Une seule semaine : une courbe n'a pas de sens, on trace une barre par série.
          if (n === 1) {
            const top = y(s.values[0], max);
            return <rect key={s.key} x={x(0) + (si === 0 ? -28 : 8)} y={top} width={20} height={H - PAD.b - top} rx={2} fill={s.color} fillOpacity={0.85}><title>{`${s.label}: ${s.values[0]}`}</title></rect>;
          }
          return (
            <g key={s.key}>
              {n > 1 && <polygon points={`${x(0)},${H - PAD.b} ${pts.join(" ")} ${x(n - 1)},${H - PAD.b}`} fill={s.color} fillOpacity={0.18} />}
              <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={1.5} />
              {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v, max)} r={2.5} fill={s.color}><title>{`${t("soc.week", { w: data[i].week })} — ${s.label}: ${v}`}</title></circle>)}
            </g>
          );
        })}
        {data.map((d, i) => (n <= 8 || i % Math.ceil(n / 8) === 0) && (
          <text key={d.week} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>{d.week.split("-")[1]}</text>
        ))}
      </svg>
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

  const rows: [string, string][] = meta ? [
    [t("detail.artist"), meta.artist || "—"], [t("detail.mediaTitle"), meta.title || "—"], [t("detail.genre"), meta.genre || "—"],
    [t("detail.year"), meta.date || "—"], [t("detail.album"), meta.album || "—"],
    [t("detail.saved"), meta.savedate ? new Date(meta.savedate).toLocaleString(lang) : "—"],
    [t("detail.duration"), meta.durationFloat ? formatTime(meta.durationFloat) : meta.duration || "—"],
    [t("detail.size"), formatSize(meta.size ?? 0)], [t("detail.format"), (meta.ext ?? "").toUpperCase() || "—"],
  ] : [];

  const counter = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground" title={label}>{icon}<span className="tabular-nums text-foreground">{value}</span></div>
  );
  const reactionButton = (kind: Reaction, Icon: typeof ThumbsUp, count: number) => (
    <Button size="sm" variant={social?.mine === kind ? "secondary" : "ghost"} disabled={!social} onClick={() => void react(kind)} title={t(kind === "like" ? "soc.like" : "soc.dislike")} aria-pressed={social?.mine === kind}>
      <Icon className={cn(social?.mine === kind && "fill-current")} /> <span className="tabular-nums">{count}</span>
    </Button>
  );

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent scrollable className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("detail.title")}</DialogTitle>
          <DialogDescription>{meta?.title ?? t("on.loading")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-4">
          {meta?.jacket ? <img src={meta.jacket} alt="" className="size-36 shrink-0 rounded-md object-cover" /> : <div className="grid size-36 shrink-0 place-items-center rounded-md bg-muted"><Music className="size-10 text-muted-foreground" /></div>}
          <dl className="grid flex-1 grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></div>))}
          </dl>
        </div>

        {/* Réactions et compteurs */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-2">
          <div className="flex gap-1">
            {reactionButton("like", ThumbsUp, social?.like ?? 0)}
            {reactionButton("dislike", ThumbsDown, social?.dislike ?? 0)}
          </div>
          {counter(<Eye className="size-4" />, t("soc.views"), String(social?.views ?? 0))}
          {counter(<Clock className="size-4" />, t("soc.time"), formatTime(social?.streamSeconds ?? 0) === "--:--" ? "0:00" : formatTime(social?.streamSeconds ?? 0))}
          {counter(<MessageSquare className="size-4" />, t("soc.comments"), String(total))}
        </div>

        {weekly && (weekly.length > 0 ? <WeeklyChart weekly={weekly} /> : <p className="text-sm text-muted-foreground">{t("soc.noStats")}</p>)}

        {/* Commentaires */}
        <section className="space-y-3">
          <h3 className="font-medium">{t("cmt.title")} <span className="text-sm font-normal text-muted-foreground">({total})</span></h3>
          <div className="space-y-2">
            <Textarea rows={3} maxLength={MAX_COMMENT} value={draft} placeholder={t("cmt.placeholder")} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex items-center justify-between gap-2">
              <span className={cn("text-xs tabular-nums", draft.trim().length > 0 && draft.trim().length < MIN_COMMENT ? "text-destructive" : "text-muted-foreground")}>{t("cmt.count", { n: draft.length })}</span>
              <Button size="sm" disabled={posting || !draft.trim()} onClick={() => void submit()}>{posting ? t("cmt.posting") : t("cmt.post")}</Button>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>

          {comments.length === 0 && <EmptyState compact icon={MessageSquare} title={t("em.cmtTitle")} description={t("em.cmtBody")} />}
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3">
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
      </DialogContent>
    </Dialog>
  );
}
