import { useCallback, useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, FolderOpen, Search, Wand2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n, type TKey } from "@/i18n";
import { detectBinaries, getCapabilities, getSettings, saveSettings, testBinary, type FfmpegCapabilities } from "@/lib/api";
import { getExtensions, parseExtensionList, setExtensions } from "@/lib/settings";

type Kind = "ffmpeg";
type Check = { status: "idle" } | { status: "testing" } | { status: "ok"; version: string } | { status: "error"; message: string };

const SIZES = ["1080", "720", "480", "360", "240"];
const ASPECTS = ["16:9", "4:3", "1:1"];
const AUTO = "auto";
const CUSTOM = "custom";

/** Valeur enregistrée → choix du menu ("" = automatique, valeur hors liste = personnalisée). */
const toChoice = (value: string, presets: string[]) => (value === "" ? AUTO : presets.includes(value) ? value : CUSTOM);

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Paramètres (équivalent de parameter-window.hbs) : chemin FFmpeg, transcodage, extensions (ffprobe n'est plus nécessaire : durée et codecs sont lus par le serveur).
 * Les chemins et le transcodage sont enregistrés par le serveur (qui les utilise) ; les extensions sont locales à l'interface.
 * Non repris de l'ancienne version : méthode de compression et clé de cryptage des mots de passe enregistrés
 * (liés à l'ancien stockage nedb/Electron, sans équivalent ici).
 */
export function SettingsDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n();
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
        <div className="flex gap-2">
          <Input id={`set-${kind}`} value={paths[kind]} disabled={serverDown} placeholder={kind} onChange={(e) => { setPaths((p) => ({ ...p, [kind]: e.target.value })); setChecks((c) => ({ ...c, [kind]: { status: "idle" } })); }} />
          <Button type="button" variant="outline" disabled={serverDown} onClick={() => void browse(kind)}><Search /> {t("set.browse")}</Button>
          <Button type="button" variant="secondary" disabled={serverDown || check.status === "testing"} onClick={() => void runTest(kind)}>{t("set.test")}</Button>
        </div>
        <p className="flex min-h-5 min-w-0 items-center gap-1.5 text-sm" role="status">
          {check.status === "testing" && <span className="text-muted-foreground">{t("set.testing")}</span>}
          {check.status === "ok" && <><CheckCircle2 className="size-4 text-emerald-400" /><span className="truncate text-emerald-400">{t("set.ok", { v: check.version })}</span></>}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable className="max-h-[88vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("set.title")}</DialogTitle>
          <DialogDescription>{t("set.desc")}</DialogDescription>
        </DialogHeader>

        {serverDown && loaded && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("on.serverDown")}</p>}

        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t("set.ffHint")}</p>
              <Button type="button" variant="outline" size="sm" disabled={serverDown} onClick={() => void detect()}><Wand2 /> {t("set.detect")}</Button>
            </div>
            {binaryRow("ffmpeg")}
            {caps && (
              <div className="space-y-1 rounded-md border p-3 text-sm">
                <p className="font-medium">{t("set.caps")}</p>
                {!caps.ffmpeg && <p className="text-amber-400">{t("set.capsNoFfmpeg")}</p>}
                {caps.ffmpeg && !caps.aac && <p className="text-amber-400">{t("set.capsNoAac")}</p>}
                {caps.ffmpeg && (caps.h264Encoders.length > 0
                  ? <p className="text-emerald-400">{t("set.capsH264", { list: caps.h264Encoders.join(", ") })}</p>
                  : <p className="text-amber-400">{t("set.capsNoH264")}</p>)}
                {caps.unusable.length > 0 && <p className="text-muted-foreground">{t("set.capsUnusable", { list: caps.unusable.join(", ") })}</p>}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-medium">{t("set.transcode")}</h3>
              <p className="text-sm text-muted-foreground">{t("set.transcodeHint")}</p>
            </div>
            {choiceRow("set.size", SIZES, sizeChoice, setSizeChoice, sizeCustom, setSizeCustom, "set.customSizePh", "p")}
            {choiceRow("set.aspect", ASPECTS, aspectChoice, setAspectChoice, aspectCustom, setAspectCustom, "set.customAspectPh")}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-medium">{t("set.extensions")}</h3>
              <p className="text-sm text-muted-foreground">{t("set.extHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="set-ext-audio">{t("set.extAudio")}</Label><Input id="set-ext-audio" value={audioText} onChange={(e) => setAudioText(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="set-ext-video">{t("set.extVideo")}</Label><Input id="set-ext-video" value={videoText} onChange={(e) => setVideoText(e.target.value)} /></div>
            </div>
          </section>

          {dataDir && (
            <section className="space-y-1.5">
              <Label>{t("set.dataDir")}</Label>
              <div className="flex gap-2">
                <Input value={dataDir} readOnly className="flex-1 text-muted-foreground" />
                <Button type="button" variant="outline" onClick={() => void revealItemInDir(dataDir).catch(() => undefined)}><FolderOpen /> {t("set.openFolder")}</Button>
              </div>
            </section>
          )}
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("set.cancel")}</Button>
          <Button disabled={saving || !loaded} onClick={() => void save()}>{saving ? t("set.saving") : t("set.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
