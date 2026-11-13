import { useEffect, useState } from "react";
import { AudioWaveform, Headphones, Leaf, Scale, Volume2, Zap, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { listOutputDevices, type OutputDevice } from "@/lib/media";
import { FFT_SIZES, LATENCY_HINTS, REPLAY_GAIN_MODES, type AudioSettings } from "@/lib/settings";
import { Group, SegmentedField, SelectField, SliderField, SwitchField } from "./fields";

const SYSTEM = "system";

type Props = { audio: AudioSettings; setAudio: (a: AudioSettings) => void };

/** Page « Audio » : sortie sonore, volume et transitions, puis analyse du spectre. Réglages locaux à l'interface (localStorage), appliqués à l'enregistrement. */
export function AudioSection({ audio, setAudio }: Props) {
  const { t } = useI18n();
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  useEffect(() => { void listOutputDevices().then(setDevices); }, []);
  const patch = (p: Partial<AudioSettings>) => setAudio({ ...audio, ...p });

  // Un périphérique enregistré mais absent de la liste (débranché) reste sélectionnable : on ne le perd pas en silence.
  const known = audio.sinkId === "" || devices.some((d) => d.id === audio.sinkId);
  const options = [
    { value: SYSTEM, label: t("set.sinkDefault"), icon: Volume2 },
    ...devices.map((d) => ({ value: d.id, label: d.label, icon: Headphones })),
    ...(known ? [] : [{ value: audio.sinkId, label: audio.sinkId.slice(0, 24), icon: Headphones }]),
  ];
  // Latence : de la plus réactive à la plus économe.
  const LATENCY_ICONS: Record<AudioSettings["latencyHint"], LucideIcon> = { interactive: Zap, balanced: Scale, playback: Leaf };

  return (
    <>
      <Group title={t("set.grp.sound")}>
        <SelectField label={t("set.sink")} hint={t("set.sinkHint")} value={audio.sinkId || SYSTEM} controlClassName="sm:w-72" onChange={(v) => patch({ sinkId: v === SYSTEM ? "" : v })} options={options} />
        <SelectField label={t("set.latency")} hint={t("set.latencyHint")} value={audio.latencyHint} onChange={(v) => patch({ latencyHint: v as AudioSettings["latencyHint"] })}
          options={LATENCY_HINTS.map((h) => ({ value: h, label: t(`set.lat.${h}`), icon: LATENCY_ICONS[h] }))} />
        <SwitchField id="set-limiter" label={t("set.limiter")} hint={t("set.limiterHint")} checked={audio.limiter} onChange={(limiter) => patch({ limiter })} />
      </Group>
      <Group title={t("set.grp.volume")}>
        <SegmentedField label={t("set.replayGain")} hint={t("set.replayGainHint")} value={audio.replayGain} onChange={(v) => patch({ replayGain: v as AudioSettings["replayGain"] })}
          options={REPLAY_GAIN_MODES.map((m) => ({ value: m, label: t(`set.rg.${m}`) }))} />
        <SliderField label={t("set.fade")} hint={t("set.fadeHint")} value={audio.fadeSeconds} min={0} max={12} step={1} format={(v) => (v === 0 ? t("set.off") : `${v} s`)} onChange={(fadeSeconds) => patch({ fadeSeconds })} />
        <SwitchField id="set-preload" label={t("set.preload")} hint={t("set.preloadHint")} checked={audio.preloadNext} onChange={(preloadNext) => patch({ preloadNext })} />
      </Group>
      <Group title={t("set.grp.resume")}>
        <SwitchField id="set-resume" label={t("set.resume")} hint={t("set.resumeHint")} checked={audio.resumeEnabled} onChange={(resumeEnabled) => patch({ resumeEnabled })} />
        <SliderField label={t("set.resumeMin")} hint={t("set.resumeMinHint")} value={audio.resumeMinSeconds} min={10} max={600} step={10}
          format={(v) => (v >= 60 && v % 60 === 0 ? `${v / 60} min` : `${v} s`)} onChange={(resumeMinSeconds) => patch({ resumeMinSeconds })} />
      </Group>
      <Group title={t("set.grp.spectrum")}>
        <SelectField label={t("set.fft")} hint={t("set.fftHint")} value={String(audio.fftSize)} controlClassName="sm:w-36" onChange={(v) => patch({ fftSize: Number(v) })} options={FFT_SIZES.map((n) => ({ value: String(n), label: String(n), icon: AudioWaveform }))} />
        <SliderField label={t("set.attack")} hint={t("set.smoothHint")} value={audio.attack} min={0.1} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(attack) => patch({ attack })} />
        <SliderField label={t("set.release")} value={audio.release} min={0.03} max={0.5} step={0.01} format={(v) => v.toFixed(2)} onChange={(release) => patch({ release })} />
      </Group>
    </>
  );
}
