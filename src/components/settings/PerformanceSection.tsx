import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { makeReset } from "./fieldMeta";
import { Group, NumberField, Row, SegmentedField } from "./fields";
import type { Form, FormKey } from "./form";

type Props = { f: Form; set: (key: FormKey, value: string) => void; disabled: boolean };

/** Page « Performance » : ressources consommées par FFmpeg, puis options avancées (le champ de commande est long, il passe sous son libellé). */
export function PerformanceSection({ f, set, disabled }: Props) {
  const { t } = useI18n();
  const reset = makeReset(f, set);
  return (
    <>
      <Group title={t("set.grp.resources")}>
        <SegmentedField label={t("set.priority")} value={f.priority} disabled={disabled} reset={reset("priority")} onChange={(v) => set("priority", v)}
          options={[{ value: "normal", label: t("set.prio.normal") }, { value: "belowNormal", label: t("set.prio.belowNormal") }, { value: "low", label: t("set.prio.low") }]} />
        <NumberField id="set-threads" label={t("set.threads")} hint={t("set.threadsHint")} value={f.threads} placeholder={t("set.auto")} min={0} max={64} disabled={disabled} reset={reset("threads")} onChange={(v) => set("threads", v)} />
        <NumberField id="set-maxstreams" label={t("set.maxStreams")} hint={t("set.maxStreamsHint")} value={f.maxStreams} min={0} max={8} disabled={disabled} reset={reset("maxStreams")} onChange={(v) => set("maxStreams", v)} />
      </Group>
      <Group title={t("set.grp.advanced")}>
        <Row stacked label={t("set.extraArgs")} hint={t("set.extraArgsHint")} htmlFor="set-extra" reset={reset("extraArgs")}>
          <Input id="set-extra" className="font-mono text-sm" value={f.extraArgs} placeholder={t("set.extraArgsPh")} disabled={disabled} spellCheck={false} onChange={(e) => set("extraArgs", e.target.value)} />
        </Row>
      </Group>
    </>
  );
}
