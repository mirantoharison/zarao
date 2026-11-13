import { FolderOpen, Plus, X } from "lucide-react";
import { open as openDirDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { SCAN_MAX_DEPTH, type ScanSettings } from "@/lib/settings";
import { makeReset } from "./fieldMeta";
import { Group, NumberField, Plain, Row, SegmentedField, SwitchField } from "./fields";
import { isOn, type Form, type FormKey } from "./form";

type Props = {
  f: Form; set: (key: FormKey, value: string) => void; disabled: boolean;
  scan: ScanSettings; setScan: (s: ScanSettings) => void;
  excludeText: string; setExcludeText: (v: string) => void;
  audioText: string; setAudioText: (v: string) => void; videoText: string; setVideoText: (v: string) => void;
  dataDir: string;
};

/** Page « Bibliothèque » : extensions prises en compte, parcours des dossiers, dossiers surveillés et écriture des tags. */
export function LibrarySection({ f, set, disabled, scan, setScan, excludeText, setExcludeText, audioText, setAudioText, videoText, setVideoText, dataDir }: Props) {
  const { t } = useI18n();
  const reset = makeReset(f, set);
  async function addWatchFolder() {
    try {
      const dir = await openDirDialog({ directory: true, title: t("set.watchAdd") });
      if (typeof dir === "string" && !scan.watchFolders.includes(dir)) setScan({ ...scan, watchFolders: [...scan.watchFolders, dir] });
    } catch { /* hors Tauri (navigateur de dev) : pas de boîte de dialogue */ }
  }
  return (
    <>
      <Group title={t("set.extensions")} hint={t("set.extHint")}>
        <Row label={t("set.extAudio")} htmlFor="set-ext-audio" controlClassName="sm:w-80"><Input id="set-ext-audio" value={audioText} spellCheck={false} onChange={(e) => setAudioText(e.target.value)} /></Row>
        <Row label={t("set.extVideo")} htmlFor="set-ext-video" controlClassName="sm:w-80"><Input id="set-ext-video" value={videoText} spellCheck={false} onChange={(e) => setVideoText(e.target.value)} /></Row>
      </Group>

      <Group title={t("set.grp.scan")}>
        <SwitchField id="set-recursive" label={t("set.recursive")} checked={scan.recursive} onChange={(recursive) => setScan({ ...scan, recursive })} />
        {scan.recursive && (
          <NumberField id="set-depth" label={t("set.depth")} value={String(scan.maxDepth)} min={1} max={SCAN_MAX_DEPTH} onChange={(v) => setScan({ ...scan, maxDepth: Number(v) || 1 })} />
        )}
        <SwitchField id="set-hidden" label={t("set.hidden")} checked={scan.hidden} onChange={(hidden) => setScan({ ...scan, hidden })} />
        <Row label={t("set.exclude")} hint={t("set.excludeHint")} htmlFor="set-exclude" controlClassName="sm:w-80">
          <Input id="set-exclude" value={excludeText} placeholder="*.tmp; Samples" spellCheck={false} onChange={(e) => setExcludeText(e.target.value)} />
        </Row>
      </Group>

      <Group title={t("set.watch")} hint={t("set.watchHint")}>
        {scan.watchFolders.length === 0
          ? <Plain className="text-sm text-muted-foreground">{t("set.watchNone")}</Plain>
          : scan.watchFolders.map((folder) => (
            <div key={folder} className="flex items-center gap-3 py-2 pr-2 pl-4 hover:bg-accent/25">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FolderOpen className="size-4" /></span>
              <span className="min-w-0 flex-1 truncate text-sm" title={folder}>{folder}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("set.watchRemove")} title={t("set.watchRemove")} onClick={() => setScan({ ...scan, watchFolders: scan.watchFolders.filter((x) => x !== folder) })}><X /></Button>
            </div>
          ))}
        {scan.watchFolders.length > 0 && (
          <NumberField id="set-watch-interval" label={t("set.watchInterval")} value={String(scan.watchInterval)} min={5} max={600} onChange={(v) => setScan({ ...scan, watchInterval: Number(v) || 30 })} />
        )}
        <Plain><Button type="button" variant="outline" size="sm" onClick={() => void addWatchFolder()}><Plus /> {t("set.watchAdd")}</Button></Plain>
      </Group>

      <Group title={t("set.grp.tags")}>
        <SegmentedField label={t("set.id3v2")} hint={t("set.id3v2Hint")} value={f.id3v2} disabled={disabled} reset={reset("id3v2")} onChange={(v) => set("id3v2", v)}
          options={[{ value: "3", label: "ID3v2.3" }, { value: "4", label: "ID3v2.4" }]} />
        <SwitchField id="set-bak" label={t("set.tagBackup")} hint={t("set.tagBackupHint")} checked={isOn(f, "tagBackup")} disabled={disabled} reset={reset("tagBackup")} onChange={(v) => set("tagBackup", v ? "1" : "0")} />
      </Group>

      {dataDir && (
        <Group title={t("set.dataDir")}>
          <Plain className="flex gap-2">
            <Input value={dataDir} readOnly aria-label={t("set.dataDir")} className="min-w-0 flex-1 font-mono text-xs text-muted-foreground" />
            <Button type="button" variant="outline" onClick={() => void revealItemInDir(dataDir).catch(() => undefined)}><FolderOpen /> {t("set.openFolder")}</Button>
          </Plain>
        </Group>
      )}
    </>
  );
}
