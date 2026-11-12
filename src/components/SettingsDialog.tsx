import { useCallback, useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Files, Film, FolderOpen, Palette, RefreshCw, Search, Wand2, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n, type TKey } from "@/i18n";
import { detectBinaries, getCapabilities, getSettings, saveSettings, testBinary, type FfmpegCapabilities } from "@/lib/api";
import { PALETTES, usePalette } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { getExtensions, parseExtensionList, setExtensions } from "@/lib/settings";

type Kind = "ffmpeg";
type Check = { status: "idle" } | { status: "testing" } | { status: "ok"; version: string } | { status: "error"; message: string };

const SIZES = ["1080", "720", "480", "360", "240"];
const ASPECTS = ["16:9", "4:3", "1:1"];
const AUTO = "auto";
const CUSTOM = "custom";

/** Valeur enregistrée → choix du menu ("" = automatique, valeur hors liste = personnalisée). */
const toChoice = (value: string, presets: string[]) => (value === "" ? AUTO : presets.includes(value) ? value : CUSTOM);

type Section = "appearance" | "ffmpeg" | "transcode" | "files";
const SECTIONS: { id: Section; icon: LucideIcon; label: TKey }[] = [
  { id: "appearance", icon: Palette, label: "set.sec.appearance" },
  { id: "ffmpeg", icon: Film, label: "set.sec.ffmpeg" },
  { id: "transcode", icon: RefreshCw, label: "set.sec.transcode" },
  { id: "files", icon: Files, label: "set.sec.files" },
];

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Paramètres (équivalent de parameter-window.hbs) : chemin FFmpeg, transcodage, extensions (ffprobe n'est plus nécessaire : durée et codecs sont lus par le serveur).
 * Les chemins et le transcodage sont enregistrés par le serveur (qui les utilise) ; les extensions sont locales à l'interface.
 * Non repris de l'ancienne version : méthode de compression et clé de cryptage des mots de passe enregistrés
 * (liés à l'ancien stockage nedb/Electron, sans équivalent ici).
 */
export function SettingsDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n();
  const [palette, setPalette] = usePalette();
  const [loaded, setLoaded] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [paths, setPaths] = useState<Record<Kind, string>>({ ffmpeg: "" });
  const [checks, setChecks] = useState<Record<Kind, Check>>({ ffmpeg: { status: "idle" } });
  const [dataDir, setDataDir] = useState("");
  const [caps, setCaps] = useState<FfmpegCapabilities | null>(null);
  const [sizeChoice, setSizeChoice] = useState(AUTO);
  const [sizeCustom, setSizeCustom] = useState("");
  const [aspectChoice, setAspectChoice] = useState(AUTO);
  const [aspectCustom, setAspectCustom] = useState("");
  const [audioText, setAudioText] = useState("");
  const [videoText, setVideoText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<Section>("appearance");
  // Instantané des réglages à l'ouverture : sert à afficher « Modifications non enregistrées ».
  // IMPORTANT : la palette n'en fait pas partie, elle s'applique et se mémorise tout de suite, sans passer par « Enregistrer ».
  const snapshot = JSON.stringify([paths.ffmpeg, sizeChoice, sizeCustom, aspectChoice, aspectCustom, audioText, videoText]);
  const [initial, setInitial] = useState<string | null>(null);
  const dirty = initial !== null && snapshot !== initial;

  const errorText = useCallback((code: string | undefined, kind?: Kind) => {
    const key = `set.err.${code}` as TKey;
    return t(key, { n: kind ?? "ffmpeg" });
  }, [t]);

  // Rechargé à chaque ouverture : le serveur peut avoir été modifié ailleurs, et on repart d'un état propre après une annulation.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoaded(false);
    const ext = getExtensions();
    setAudioText(ext.audio.join("; "));
    setVideoText(ext.video.join("; "));
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        setServerDown(false);
        setPaths({ ffmpeg: s.ffmpeg });
        setChecks({ ffmpeg: { status: "idle" } });
        setDataDir(s.dataDir);
        setSizeChoice(toChoice(s.videoSize, SIZES));
        setSizeCustom(SIZES.includes(s.videoSize) ? "" : s.videoSize);
        setAspectChoice(toChoice(s.videoAspect, ASPECTS));
        setAspectCustom(ASPECTS.includes(s.videoAspect) ? "" : s.videoAspect);
      })
      .catch(() => { if (!cancelled) setServerDown(true); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [open]);

  // Instantané pris une fois le chargement terminé (tous les champs ont alors leur valeur du serveur).
  useEffect(() => { if (!open) setInitial(null); else if (loaded) setInitial(snapshot); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, loaded]);

  const refreshCaps = useCallback(() => { getCapabilities().then(setCaps).catch(() => setCaps(null)); }, []);
  // Les capacités sont celles du ffmpeg ENREGISTRÉ côté serveur : on les relit à l'ouverture et après un test réussi.
  useEffect(() => { if (open && loaded && !serverDown) refreshCaps(); }, [open, loaded, serverDown, refreshCaps]);

  async function runTest(kind: Kind) {
    setChecks((c) => ({ ...c, [kind]: { status: "testing" } }));
    try {
      const r = await testBinary(paths[kind]);
      setChecks((c) => ({ ...c, [kind]: r.ok ? { status: "ok", version: r.version ?? "" } : { status: "error", message: errorText(r.error, kind) } }));
      if (r.ok) refreshCaps();
    } catch {
      setChecks((c) => ({ ...c, [kind]: { status: "error", message: t("on.serverDown") } }));
    }
  }

  async function browse(kind: Kind) {
    try {
      const picked = await openFileDialog({ multiple: false, title: t("set.ffmpeg") });
      if (typeof picked === "string") setPaths((p) => ({ ...p, [kind]: picked }));
    } catch { /* hors Tauri (navigateur de dev) : pas de boîte de dialogue, la saisie manuelle reste possible */ }
  }

  async function detect() {
    setError(null);
    try {
      const found = await detectBinaries();
      if (!found.ffmpeg) return setError(t("set.noneFound"));
      setPaths({ ffmpeg: found.ffmpeg });
    } catch {
      setError(t("on.serverDown"));
    }
  }

  async function save() {
    setError(null);
    const audio = parseExtensionList(audioText);
    const video = parseExtensionList(videoText);
    if (audio.length + video.length === 0) return setError(t("set.err.extEmpty"));
    setSaving(true);
    try {
      if (!serverDown) {
        const res = await saveSettings({
          ffmpeg: paths.ffmpeg.trim(),
          videoSize: sizeChoice === AUTO ? "" : sizeChoice === CUSTOM ? sizeCustom.trim() : sizeChoice,
          videoAspect: aspectChoice === AUTO ? "" : aspectChoice === CUSTOM ? aspectCustom.trim() : aspectChoice,
        });
        if (!res.saved) {
          const kind: Kind | undefined = res.field === "ffmpeg" ? res.field : undefined;
          setError(`${res.field === "ffmpeg" ? "FFmpeg" : t(res.field === "videoSize" ? "set.size" : "set.aspect")} : ${errorText(res.error, kind)}`);
          return;
        }
      }
      setExtensions(audio, video);
      onOpenChange(false);
    } catch {
      setError(t("on.serverDown"));
    } finally {
      setSaving(false);
    }
  }

  const binaryRow = (kind: Kind) => {
    const check = checks[kind];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`set-${kind}`}>{t("set.ffmpeg")}</Label>
        {/* Deux lignes : chemin + Parcourir, puis Tester + Détecter */}
        <div className="flex gap-2">
          <Input id={`set-${kind}`} className="min-w-0 flex-1" value={paths[kind]} disabled={serverDown} placeholder={kind} onChange={(e) => { setPaths((p) => ({ ...p, [kind]: e.target.value })); setChecks((c) => ({ ...c, [kind]: { status: "idle" } })); }} />
          <Button type="button" variant="outline" disabled={serverDown} onClick={() => void browse(kind)}><Search /> {t("set.browse")}</Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={serverDown || check.status === "testing"} onClick={() => void runTest(kind)}>{t("set.test")}</Button>
          <Button type="button" variant="outline" disabled={serverDown} onClick={() => void detect()} title={t("set.detect")}><Wand2 /> {t("set.detect")}</Button>
        </div>
        <p className="flex min-h-5 min-w-0 items-center gap-1.5 text-sm" role="status">
          {check.status === "testing" && <span className="text-muted-foreground">{t("set.testing")}</span>}
          {check.status === "ok" && <><CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" /><span className="truncate text-emerald-700 dark:text-emerald-400">{t("set.ok", { v: check.version })}</span></>}
          {check.status === "error" && <><XCircle className="size-4 text-destructive" /><span className="text-destructive">{check.message}</span></>}
        </p>
      </div>
    );
  };

  const choiceRow = (label: TKey, presets: string[], choice: string, setChoice: (v: string) => void, custom: string, setCustom: (v: string) => void, placeholder: TKey, suffix = "") => (
    <div className="space-y-1.5">
      <Label>{t(label)}</Label>
      <div className="flex gap-2">
        <Select value={choice} onValueChange={setChoice} disabled={serverDown}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>{t("set.auto")}</SelectItem>
            {presets.map((p) => <SelectItem key={p} value={p}>{p}{suffix}</SelectItem>)}
            <SelectItem value={CUSTOM}>{t("set.custom")}</SelectItem>
          </SelectContent>
        </Select>
        {choice === CUSTOM && <Input value={custom} placeholder={t(placeholder)} onChange={(e) => setCustom(e.target.value)} className="flex-1" />}
      </div>
    </div>
  );

  const heading = (title: string, hint?: string, badge?: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {badge}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent bare className="h-[min(38rem,88vh)] sm:max-w-3xl">
        <DialogDescription className="sr-only">{t("set.desc")}</DialogDescription>
        <div className="flex min-h-0 flex-1">
          {/* Navigation par sections : une page à la fois, plus besoin de faire défiler un long formulaire */}
          <nav className="w-48 shrink-0 space-y-1 border-r p-3" aria-label={t("set.title")}>
            <DialogTitle className="px-2 pb-2 pt-1">{t("set.title")}</DialogTitle>
            {SECTIONS.map(({ id, icon: Icon, label }) => (
              <Button
                key={id}
                type="button"
                variant="ghost"
                aria-current={section === id ? "page" : undefined}
                // IMPORTANT : suffixe ! car le Button ne fusionne pas les classes qui se contredisent.
                className={cn("w-full justify-start gap-2 px-3 text-sm text-muted-foreground", section === id && "bg-primary/15! text-foreground! shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-primary/20! [&_svg]:text-primary")}
                onClick={() => setSection(id)}
              ><Icon /> {t(label)}</Button>
            ))}
          </nav>

          <div className="relative min-w-0 flex-1">
            <div className="absolute inset-0">
              <ScrollArea className="size-full">
                <div className="space-y-5 p-6">
                  {serverDown && loaded && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("on.serverDown")}</p>}

                  {section === "appearance" && (
                    <section className="space-y-4">
                      {heading(t("pal.title"), t("pal.hint"))}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {PALETTES.map(({ id, swatch }) => (
                          <button key={id} type="button" aria-pressed={palette === id} onClick={() => setPalette(id)}
                            className={cn("flex items-center gap-3 rounded-xl border px-3 py-3 text-sm transition-colors hover:bg-accent", palette === id && "border-primary/60 bg-primary/10")}>
                            <span className="relative size-8 shrink-0 overflow-hidden rounded-full border" style={{ background: swatch[0] }}>
                              <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: swatch[1] }} />
                            </span>
                            {t(`pal.${id}`)}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {section === "ffmpeg" && (
                    <section className="space-y-4">
                      {heading(t("set.sec.ffmpeg"), t("set.ffHint"), caps && (
                        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", caps.ffmpeg ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
                          {t(caps.ffmpeg ? "set.detected" : "set.notDetected")}
                        </span>
                      ))}
                      {binaryRow("ffmpeg")}
                      {caps && (
                        <div className="space-y-1 rounded-xl border p-3 text-sm">
                          <p className="font-medium">{t("set.caps")}</p>
                          {!caps.ffmpeg && <p className="text-amber-700 dark:text-amber-400">{t("set.capsNoFfmpeg")}</p>}
                          {caps.ffmpeg && !caps.aac && <p className="text-amber-700 dark:text-amber-400">{t("set.capsNoAac")}</p>}
                          {caps.ffmpeg && (caps.h264Encoders.length > 0
                            ? <p className="text-emerald-700 dark:text-emerald-400">{t("set.capsH264", { list: caps.h264Encoders.join(", ") })}</p>
                            : <p className="text-amber-700 dark:text-amber-400">{t("set.capsNoH264")}</p>)}
                          {caps.unusable.length > 0 && <p className="text-muted-foreground">{t("set.capsUnusable", { list: caps.unusable.join(", ") })}</p>}
                        </div>
                      )}
                    </section>
                  )}

                  {section === "transcode" && (
                    <section className="space-y-4">
                      {heading(t("set.transcode"), t("set.transcodeHint"))}
                      {choiceRow("set.size", SIZES, sizeChoice, setSizeChoice, sizeCustom, setSizeCustom, "set.customSizePh", "p")}
                      {choiceRow("set.aspect", ASPECTS, aspectChoice, setAspectChoice, aspectCustom, setAspectCustom, "set.customAspectPh")}
                    </section>
                  )}

                  {section === "files" && (
                    <section className="space-y-4">
                      {heading(t("set.extensions"), t("set.extHint"))}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5"><Label htmlFor="set-ext-audio">{t("set.extAudio")}</Label><Input id="set-ext-audio" value={audioText} onChange={(e) => setAudioText(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label htmlFor="set-ext-video">{t("set.extVideo")}</Label><Input id="set-ext-video" value={videoText} onChange={(e) => setVideoText(e.target.value)} /></div>
                      </div>
                      {dataDir && (
                        <div className="space-y-1.5 pt-2">
                          <Label>{t("set.dataDir")}</Label>
                          <div className="flex gap-2">
                            <Input value={dataDir} readOnly className="flex-1 text-muted-foreground" />
                            <Button type="button" variant="outline" onClick={() => void revealItemInDir(dataDir).catch(() => undefined)}><FolderOpen /> {t("set.openFolder")}</Button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        {/* Pied fixe : toujours visible, avec l'état des modifications */}
        <div className="flex items-center gap-3 border-t px-4 py-3">
          <p className={cn("min-w-0 flex-1 truncate text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : "status"}>
            {error ?? (dirty ? t("set.dirty") : "")}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("set.cancel")}</Button>
          <Button disabled={saving || !loaded} onClick={() => void save()}>{saving ? t("set.saving") : t("set.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
