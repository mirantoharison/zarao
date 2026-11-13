import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CircleX, FileText, Info, Trash2, TriangleAlert, VolumeX, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { clearServerCache, DEFAULT_LOCAL_PORT } from "@/lib/api";
import { makeReset } from "./fieldMeta";
import { Group, NumberField, Notice, Row, SelectField } from "./fields";
import type { Form, FormKey } from "./form";

/** Niveaux de log FFmpeg, du plus discret au plus bavard. */
const LOG_ICONS: Record<"quiet" | "error" | "warning" | "info", LucideIcon> = { quiet: VolumeX, error: CircleX, warning: TriangleAlert, info: Info };

type Props = { f: Form; set: (key: FormKey, value: string) => void; disabled: boolean; logFile: string; portLocked: boolean; activePort: number };

/** Page « Serveur » : port, délais, journal et nettoyage. L'interface d'écoute reste 127.0.0.1 (volontairement non réglable). */
export function ServerSection({ f, set, disabled, logFile, portLocked, activePort }: Props) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = makeReset(f, set);

  async function clear() {
    setBusy(true);
    try {
      const r = await clearServerCache();
      setMessage(t("set.clearDone", { n: r.removed, size: Math.round(r.bytes / 1024) }));
    } catch {
      setMessage(t("on.serverDown"));
    } finally {
      setBusy(false);
    }
  }

  const portChanged = !portLocked && activePort > 0 && (Number(f.port) || DEFAULT_LOCAL_PORT) !== activePort;

  return (
    <>
      <Group title={t("set.grp.network")}>
        {/* IMPORTANT : l'interface d'écoute n'est pas réglable. Le serveur expose des routes qui exécutent un programme (chemin FFmpeg) et lisent le disque ; il reste sur 127.0.0.1. */}
        <NumberField id="set-port" label={t("set.port")} hint={portLocked ? t("set.portLocked", { p: activePort }) : t("set.portHint", { p: activePort || DEFAULT_LOCAL_PORT })} value={f.port}
          placeholder={String(DEFAULT_LOCAL_PORT)} min={1024} max={65535} disabled={disabled || portLocked} reset={portLocked ? undefined : reset("port")} onChange={(v) => set("port", v)} />
      </Group>
      {portChanged && <Notice tone="warn">{t("set.portRestart")}</Notice>}
      <Group title={t("set.grp.timeouts")}>
        <NumberField id="set-probe" label={t("set.probeTimeout")} value={f.probeTimeout} min={5} max={120} disabled={disabled} reset={reset("probeTimeout")} onChange={(v) => set("probeTimeout", v)} />
        <NumberField id="set-tagto" label={t("set.tagTimeout")} value={f.tagTimeout} min={10} max={600} disabled={disabled} reset={reset("tagTimeout")} onChange={(v) => set("tagTimeout", v)} />
      </Group>
      <Group title={t("set.grp.diag")}>
        <SelectField label={t("set.logLevel")} value={f.logLevel} disabled={disabled} reset={reset("logLevel")} onChange={(v) => set("logLevel", v)}
          options={(["quiet", "error", "warning", "info"] as const).map((l) => ({ value: l, label: t(`set.log.${l}`), icon: LOG_ICONS[l] }))} />
        <Row label={t("set.openLog")} hint={logFile ? <span className="break-all font-mono">{logFile}</span> : undefined} controlClassName="sm:w-auto">
          <Button type="button" variant="outline" disabled={disabled || !logFile} onClick={() => void revealItemInDir(logFile).catch(() => undefined)}><FileText /> {t("set.open")}</Button>
        </Row>
        <Row label={t("set.clearCache")} hint={message || t("set.clearHint")} controlClassName="sm:w-auto">
          <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void clear()}><Trash2 /> {t("set.clear")}</Button>
        </Row>
      </Group>
    </>
  );
}
