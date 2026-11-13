import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n, type TKey } from "@/i18n";
import { detectBinaries, getCapabilities, getSettings, saveSettings, setLocalPort, testBinary, type FfmpegCapabilities } from "@/lib/api";
import { cn } from "@/lib/utils";
import { exportBackup, importBackup } from "@/lib/settingsBackup";
import {
  DEFAULT_AUDIO, getAudioSettings, getExtensions, getScanSettings, parseExtensionList, parsePatternList, setAudioSettings, setExtensions, setScanSettings,
  type AudioSettings, type ScanSettings,
} from "@/lib/settings";
import { AudioSection } from "@/components/settings/AudioSection";
import { defaultText, FIELD_META, isModified, searchSettings, type SearchHit } from "@/components/settings/fieldMeta";
import { FfmpegSection, type FfmpegCheck } from "@/components/settings/FfmpegSection";
import { Notice } from "@/components/settings/fields";
import { EMPTY_FORM, FORM_KEYS, toForm, type Form, type FormKey } from "@/components/settings/form";
import { LibrarySection } from "@/components/settings/LibrarySection";
import { PerformanceSection } from "@/components/settings/PerformanceSection";
import { ServerSection } from "@/components/settings/ServerSection";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { ASPECTS, AUTO, CUSTOM, SIZES, toChoice, type ChoiceState } from "@/components/settings/choice";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/components/settings/sections";
import { TranscodeSection } from "@/components/settings/TranscodeSection";

/** `section` : page à afficher ; null = dialogue fermé. Chaque page est une entrée du menu « Paramètres ». */
type Props = { section: SettingsSection | null; onClose: () => void };

const toState = (value: string, presets: string[]): ChoiceState => ({ choice: toChoice(value, presets), custom: presets.includes(value) ? "" : value });
const fromState = (s: ChoiceState) => (s.choice === AUTO ? "" : s.choice === CUSTOM ? s.custom.trim() : s.choice);

/** Instantané des champs modifiables, dans l'ordre : sert à repérer les pages modifiées. */
type Snapshot = [Form, ChoiceState, ChoiceState, string, string, AudioSettings, ScanSettings, string];

/**
 * Paramètres (équivalent de parameter-window.hbs) : une fenêtre à navigation latérale, six pages regroupées par thème
 * (écoute : audio, bibliothèque ; FFmpeg : programme, transcodage, performance ; application : serveur).
 * Les réglages techniques sont enregistrés par le serveur (qui les utilise) ; extensions, audio et scan sont locaux à l'interface.
 * Les couleurs n'y figurent pas : elles se choisissent dans le menu Affichage, et s'appliquent tout de suite.
 * Non repris de l'ancienne version : méthode de compression et clé de cryptage des mots de passe enregistrés
 * (liés à l'ancien stockage nedb/Electron, sans équivalent ici). Le port du serveur est réglable (au prochain lancement), mais pas
 * l'interface d'écoute : le serveur exécute un programme (chemin FFmpeg) et lit le disque, il reste donc sur 127.0.0.1.
 */
export function SettingsDialog({ section, onClose }: Props) {
  const { t } = useI18n();
  const open = section !== null;
  // Recherche de réglage (champ de la barre latérale) : un résultat ouvre la page qui le contient et met la ligne en évidence.
  const [query, setQuery] = useState("");
  // Fermer avec des modifications non enregistrées demande confirmation (Échap, croix ou Annuler) ; `closeNow` ferme sans rien demander.
  const [confirmClose, setConfirmClose] = useState(false);
  const closeNow = () => { setQuery(""); setConfirmClose(false); onClose(); };
  const onOpenChange = (next: boolean) => { if (next) return; if (dirty && !saving) setConfirmClose(true); else closeNow(); };
  /** Message passager du pied de fenêtre (export réussi, import chargé), effacé tout seul. */
  const [info, setInfo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [check, setCheck] = useState<FfmpegCheck>({ status: "idle" });
  const [dataDir, setDataDir] = useState("");
  const [logFile, setLogFile] = useState("");
  const [portLocked, setPortLocked] = useState(false);
  const [activePort, setActivePort] = useState(0);
  const [caps, setCaps] = useState<FfmpegCapabilities | null>(null);
  const [size, setSize] = useState<ChoiceState>({ choice: AUTO, custom: "" });
  const [aspect, setAspect] = useState<ChoiceState>({ choice: AUTO, custom: "" });
  const [audioText, setAudioText] = useState("");
  const [videoText, setVideoText] = useState("");
  const [audio, setAudio] = useState<AudioSettings>(getAudioSettings);
  const [scan, setScan] = useState<ScanSettings>(getScanSettings);
  const [excludeText, setExcludeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // La page suit la demande du menu ; elle est conservée à la fermeture pour que le contenu ne disparaisse pas pendant l'animation de sortie.
  // `setPage` sert aussi à revenir sur la page d'une valeur refusée par le serveur.
  const [page, setPage] = useState<SettingsSection>(section ?? "ffmpeg");
  const [requested, setRequested] = useState(section);
  if (section !== requested) { setRequested(section); if (section) setPage(section); }
  // Instantané des réglages à l'ouverture : sert à afficher « Modifications non enregistrées » (globalement et page par page).
  const snapshot = JSON.stringify([form, size, aspect, audioText, videoText, audio, scan, excludeText] satisfies Snapshot);
  const [initial, setInitial] = useState<string | null>(null);
  const dirty = initial !== null && snapshot !== initial;

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Libellé affiché de la ligne à mettre en évidence après un clic sur un résultat de recherche. */
  const [focusLabel, setFocusLabel] = useState<string | null>(null);

  const set = useCallback((key: FormKey, value: string) => setForm((f) => ({ ...f, [key]: value })), []);

  const errorText = useCallback((code: string | undefined) => t(`set.err.${code}` as TKey, { n: "ffmpeg" }), [t]);

  // Rechargé à chaque ouverture : le serveur peut avoir été modifié ailleurs, et on repart d'un état propre après une annulation.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoaded(false);
    const ext = getExtensions();
    setAudioText(ext.audio.join("; "));
    setVideoText(ext.video.join("; "));
    setAudio(getAudioSettings());
    const sc = getScanSettings();
    setScan(sc);
    setExcludeText(sc.exclude.join("; "));
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        setServerDown(false);
        setForm(toForm(s));
        setCheck({ status: "idle" });
        setDataDir(s.dataDir);
        setLogFile(s.logFile);
        setPortLocked(s.portLocked);
        setActivePort(s.activePort);
        setSize(toState(s.videoSize, SIZES));
        setAspect(toState(s.videoAspect, ASPECTS));
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

  // Pages contenant des modifications : comparaison champ par champ avec l'instantané initial.
  const dirtySections = useMemo(() => {
    const out = new Set<SettingsSection>();
    if (!initial) return out;
    const [f0, size0, aspect0, audioText0, videoText0, audio0, scan0, exclude0] = JSON.parse(initial) as Snapshot;
    const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    for (const key of FORM_KEYS) {
      if (form[key] !== f0[key]) out.add(key === "ffmpeg" ? "ffmpeg" : FIELD_META[key].section);
    }
    if (differs(size, size0) || differs(aspect, aspect0)) out.add("transcode");
    if (differs(audio, audio0)) out.add("audio");
    if (audioText !== audioText0 || videoText !== videoText0 || excludeText !== exclude0 || differs(scan, scan0)) out.add("library");
    return out;
  }, [initial, form, size, aspect, audio, scan, audioText, videoText, excludeText]);

  async function runTest() {
    setCheck({ status: "testing" });
    try {
      const r = await testBinary(form.ffmpeg);
      setCheck(r.ok ? { status: "ok", version: r.version ?? "" } : { status: "error", message: errorText(r.error) });
      if (r.ok) refreshCaps();
    } catch {
      setCheck({ status: "error", message: t("on.serverDown") });
    }
  }

  async function browse() {
    try {
      const picked = await openFileDialog({ multiple: false, title: t("set.ffmpeg") });
      if (typeof picked === "string") set("ffmpeg", picked);
    } catch { /* hors Tauri (navigateur de dev) : pas de boîte de dialogue, la saisie manuelle reste possible */ }
  }

  async function detect() {
    setError(null);
    try {
      const found = await detectBinaries();
      if (!found.ffmpeg) return setError(t("set.noneFound"));
      set("ffmpeg", found.ffmpeg);
    } catch {
      setError(t("on.serverDown"));
    }
  }

  async function save() {
    setError(null);
    const audioExts = parseExtensionList(audioText);
    const videoExts = parseExtensionList(videoText);
    if (audioExts.length + videoExts.length === 0) { setPage("library"); return setError(t("set.err.extEmpty")); }
    setSaving(true);
    try {
      if (!serverDown) {
        const res = await saveSettings({ ...form, ffmpeg: form.ffmpeg.trim(), videoSize: fromState(size), videoAspect: fromState(aspect) });
        if (!res.saved) {
          if (res.field === "ffmpeg") { setPage("ffmpeg"); setError(`FFmpeg : ${errorText(res.error)}`); }
          else if (res.field && res.field in FIELD_META) {
            const info = FIELD_META[res.field as keyof typeof FIELD_META];
            setPage(info.section);
            setError(t("set.err.field", { f: t(info.label) }));
          } else setError(t("on.serverDown"));
          return;
        }
      }
      // Le port n'est mémorisé côté client qu'une fois accepté par le serveur ; les deux le prennent en compte au prochain lancement.
      if (!serverDown && !portLocked) setLocalPort(Number(form.port) || 0);
      setExtensions(audioExts, videoExts);
      setAudioSettings(audio);
      setScanSettings({ ...scan, exclude: parsePatternList(excludeText) });
      closeNow();
    } catch {
      setError(t("on.serverDown"));
    } finally {
      setSaving(false);
    }
  }

  const currentSection = SETTINGS_SECTIONS.find((x) => x.id === page) ?? SETTINGS_SECTIONS[0];

  // « Rétablir cette page » : pages dont les réglages ont une valeur par défaut connue (serveur : fieldMeta ; audio : DEFAULT_AUDIO).
  // Le port imposé par l'environnement n'est pas touché. Bibliothèque et FFmpeg n'ont pas de défaut global : pas de bouton.
  const pageKeys = (Object.keys(FIELD_META) as (keyof typeof FIELD_META)[]).filter((k) => FIELD_META[k].section === page && !(k === "port" && portLocked));
  const pageModified = page === "audio" ? JSON.stringify(audio) !== JSON.stringify({ ...DEFAULT_AUDIO, sinkId: audio.sinkId })
    : (page === "transcode" || page === "performance" || page === "server")
      && (pageKeys.some((k) => isModified(form, k)) || (page === "transcode" && (fromState(size) !== "" || fromState(aspect) !== "")));
  const resetPage = () => {
    if (page === "audio") setAudio({ ...DEFAULT_AUDIO, sinkId: audio.sinkId });
    for (const k of pageKeys) set(k, defaultText(k));
    if (page === "transcode") { setSize({ choice: AUTO, custom: "" }); setAspect({ choice: AUTO, custom: "" }); }
  };

  /** Export : toutes les valeurs du formulaire ET les réglages locaux, tels qu'affichés (y compris non enregistrés). */
  async function doExport() {
    setError(null);
    try {
      const server: Record<string, string> = {};
      for (const k of FORM_KEYS) server[k] = form[k];
      const ok = await exportBackup({
        app: "zarao", version: 1, server, videoSize: fromState(size), videoAspect: fromState(aspect),
        extensions: { audio: parseExtensionList(audioText), video: parseExtensionList(videoText) }, audio, scan: { ...scan, exclude: parsePatternList(excludeText) },
      });
      if (ok) setInfo(t("set.exported"));
    } catch { setError(t("msg.saveFail")); }
  }

  /** Import : remplit le formulaire (rien n'est appliqué avant « Enregistrer »). Port ignoré s'il est imposé par l'environnement. */
  async function doImport() {
    setError(null);
    try {
      const backup = await importBackup();
      if (backup === undefined) return;
      if (backup === null) return setError(t("set.importInvalid"));
      setForm((f) => {
        const next = { ...f };
        for (const k of FORM_KEYS) if (k in backup.server && !(k === "port" && portLocked)) next[k] = backup.server[k];
        return next;
      });
      setSize(toState(backup.videoSize, SIZES));
      setAspect(toState(backup.videoAspect, ASPECTS));
      if (backup.extensions.audio.length + backup.extensions.video.length > 0) {
        setAudioText(backup.extensions.audio.join("; "));
        setVideoText(backup.extensions.video.join("; "));
      }
      setAudio(backup.audio);
      setScan(backup.scan);
      setExcludeText(backup.scan.exclude.join("; "));
      setInfo(t("set.imported"));
    } catch { setError(t("set.importInvalid")); }
  }
  // Le message passager s'efface seul.
  useEffect(() => {
    if (!info) return;
    const id = window.setTimeout(() => setInfo(null), 5000);
    return () => window.clearTimeout(id);
  }, [info]);

  const hits = useMemo<SearchHit[]>(() => searchSettings(query, (key) => t(key)), [query, t]);
  const goTo = (hit: SearchHit) => { setPage(hit.section); setQuery(""); setFocusLabel(t(hit.label)); };

  // Changer de page repart du haut (sauf si on arrive d'une recherche : la ligne visée est alors amenée au centre).
  useEffect(() => { if (!focusLabel) viewportRef.current?.scrollTo({ top: 0 }); }, [page, focusLabel]);

  // Défilement vers la ligne trouvée, puis un bref halo (classe `setting-flash`, voir index.css).
  useEffect(() => {
    if (!focusLabel) return;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      const target = [...(contentRef.current?.querySelectorAll<HTMLElement>("[data-setting-label]") ?? [])].find((n) => n.dataset.settingLabel === focusLabel);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.classList.add("setting-flash");
      timer = window.setTimeout(() => target?.classList.remove("setting-flash"), 1800);
      setFocusLabel(null);
    });
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [focusLabel, page]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Même gabarit que la fenêtre des métadonnées. IMPORTANT : hauteur DÉFINIE (h-, pas max-h-) sinon le viewport Radix ne contraint rien et rien ne défile.
          Échap vide d'abord la recherche avant de fermer la fenêtre. */}
      <DialogContent bare onOpenAutoFocus={(e) => e.preventDefault()} onEscapeKeyDown={(e) => { if (query) { e.preventDefault(); setQuery(""); } }}
        className="h-[min(90vh,800px)] sm:max-w-[min(64rem,calc(100vw-3rem))]! lg:max-w-[min(1080px,calc(100vw-3rem))]! 2xl:max-w-[min(1240px,calc(100vw-3rem))]!">
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SettingsNav page={page} onSelect={setPage} dirtySections={dirtySections} query={query} onQuery={setQuery} hits={hits} onPick={goTo} serverUp={loaded ? !serverDown : null}
            onExport={() => void doExport()} onImport={() => void doImport()} />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0">
                {/* `[&>div]:block!` : Radix enveloppe le contenu dans un div `display:table` qui déborde en largeur. */}
                <ScrollArea className="size-full" viewportRef={viewportRef} viewportProps={{ className: "[&>div]:block!" }}>
                  <div ref={contentRef} className="mx-auto w-full max-w-[60rem] p-6 pb-10 md:px-8 [&>*]:min-w-0">
                    <header className="mb-6 flex items-start gap-3.5 pr-8">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20"><currentSection.icon className="size-5" /></span>
                      <div className="min-w-0 flex-1">
                        <DialogTitle className="text-xl leading-tight">{t(currentSection.label)}</DialogTitle>
                        <DialogDescription className="mt-1.5 max-w-[70ch] leading-relaxed">{t(currentSection.hint)}</DialogDescription>
                      </div>
                      {pageModified && <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={resetPage}><RotateCcw /> {t("set.resetPage")}</Button>}
                    </header>

                    {/* Une seule colonne de groupes : chaque page se lit de haut en bas. `key` rejoue la transition à chaque changement de page. */}
                    <div key={page} className="animate-in space-y-6 duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
                      {serverDown && loaded && <Notice tone="error">{t("on.serverDown")}</Notice>}
                      {page === "ffmpeg" && (
                        <FfmpegSection path={form.ffmpeg} onPath={(v) => { set("ffmpeg", v); setCheck({ status: "idle" }); }} disabled={serverDown} check={check} caps={caps}
                          onTest={() => void runTest()} onBrowse={() => void browse()} onDetect={() => void detect()} />
                      )}
                      {page === "transcode" && <TranscodeSection f={form} set={set} disabled={serverDown} caps={caps} size={size} setSize={setSize} aspect={aspect} setAspect={setAspect} />}
                      {page === "performance" && <PerformanceSection f={form} set={set} disabled={serverDown} />}
                      {page === "audio" && <AudioSection audio={audio} setAudio={setAudio} />}
                      {page === "library" && (
                        <LibrarySection f={form} set={set} disabled={serverDown} scan={scan} setScan={setScan} excludeText={excludeText} setExcludeText={setExcludeText}
                          audioText={audioText} setAudioText={setAudioText} videoText={videoText} setVideoText={setVideoText} dataDir={dataDir} />
                      )}
                      {page === "server" && <ServerSection f={form} set={set} disabled={serverDown} logFile={logFile} portLocked={portLocked} activePort={activePort} />}
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Pied fixe : toujours visible, avec l'état des modifications */}
            <div className="flex items-center gap-3 border-t bg-card/40 px-6 py-3">
              <p className={cn("flex min-w-0 flex-1 items-center gap-2 truncate text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : "status"}>
                {!error && (info || dirty) && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                <span className="truncate">{error ?? info ?? (dirty ? t("set.dirty") : "")}</span>
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t("set.cancel")}</Button>
              <Button disabled={saving || !loaded} onClick={() => void save()}>{saving ? t("set.saving") : t("set.save")}</Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Fermeture avec des modifications non enregistrées */}
      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("set.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("set.confirmBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmClose(false)}>{t("set.keepEditing")}</Button>
            <Button variant="destructive" onClick={closeNow}>{t("set.discard")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
