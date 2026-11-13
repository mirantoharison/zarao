import type { ReactNode } from "react";
import { CircleCheck, CircleX, Search, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import type { FfmpegCapabilities } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Group, Notice, Plain, Row } from "./fields";

/** Résultat du dernier « Tester » (état local du dialogue : il doit survivre au changement de page). */
export type FfmpegCheck = { status: "idle" } | { status: "testing" } | { status: "ok"; version: string } | { status: "error"; message: string };

type Props = {
  path: string; onPath: (v: string) => void;
  disabled: boolean;
  check: FfmpegCheck;
  caps: FfmpegCapabilities | null;
  onTest: () => void; onBrowse: () => void; onDetect: () => void;
};

/** Pastille d'état (vert = disponible, ambre = manquant). */
function StatePill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
      {children}
    </span>
  );
}

/** Page « FFmpeg » : chemin du programme (test, détection) puis ce que ce FFmpeg sait faire. */
export function FfmpegSection({ path, onPath, disabled, check, caps, onTest, onBrowse, onDetect }: Props) {
  const { t } = useI18n();
  return (
    <>
      <Group title={t("set.ffmpeg")} badge={caps && <StatePill ok={caps.ffmpeg}>{t(caps.ffmpeg ? "set.detected" : "set.notDetected")}</StatePill>}>
        <Plain className="space-y-3">
          <div className="flex gap-2">
            <Input className="min-w-0 flex-1 font-mono text-sm" value={path} disabled={disabled} placeholder="ffmpeg" spellCheck={false} aria-label={t("set.ffmpeg")} onChange={(e) => onPath(e.target.value)} />
            <Button type="button" variant="outline" disabled={disabled} onClick={onBrowse}><Search /> {t("set.browse")}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" disabled={disabled || check.status === "testing"} onClick={onTest}>{t("set.test")}</Button>
            <Button type="button" variant="outline" disabled={disabled} onClick={onDetect} title={t("set.detect")}><WandSparkles /> {t("set.detect")}</Button>
            <p className="flex min-h-5 min-w-0 items-center gap-1.5 text-sm" role="status">
              {check.status === "testing" && <span className="text-muted-foreground">{t("set.testing")}</span>}
              {check.status === "ok" && <><CircleCheck className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" /><span className="truncate text-emerald-700 dark:text-emerald-400">{t("set.ok", { v: check.version })}</span></>}
              {check.status === "error" && <><CircleX className="size-4 shrink-0 text-destructive" /><span className="text-destructive">{check.message}</span></>}
            </p>
          </div>
        </Plain>
      </Group>

      {caps && (
        <Group title={t("set.caps")}>
          {!caps.ffmpeg
            ? <Plain><Notice tone="warn">{t("set.capsNoFfmpeg")}</Notice></Plain>
            : (
              <>
                <Row label={t("set.cap.h264")} hint={caps.h264Encoders.length === 0 ? t("set.capsNoH264") : undefined} controlClassName="sm:w-auto">
                  {caps.h264Encoders.length > 0
                    ? <div className="flex flex-wrap gap-1.5 sm:justify-end">{caps.h264Encoders.map((e) => <code key={e} className="rounded-md bg-muted px-2 py-0.5 text-xs">{e}</code>)}</div>
                    : <StatePill ok={false}>{t("set.cap.missing")}</StatePill>}
                </Row>
                <Row label={t("set.cap.aac")} hint={caps.aac ? undefined : t("set.capsNoAac")} controlClassName="sm:w-auto">
                  <StatePill ok={caps.aac}>{t(caps.aac ? "set.cap.ok" : "set.cap.missing")}</StatePill>
                </Row>
                {caps.unusable.length > 0 && (
                  <Row label={t("set.cap.unusable")} controlClassName="sm:w-auto">
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">{caps.unusable.map((e) => <code key={e} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground line-through">{e}</code>)}</div>
                  </Row>
                )}
              </>
            )}
        </Group>
      )}
    </>
  );
}
