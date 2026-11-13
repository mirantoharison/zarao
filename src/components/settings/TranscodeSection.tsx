import { Check, Cpu, Gauge, Languages, Leaf, Monitor, PenLine, RectangleHorizontal, RefreshCw, Scale, Sparkles, Square, WandSparkles, Zap, CircleOff, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n, type TKey } from "@/i18n";
import type { FfmpegCapabilities } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ASPECTS, AUTO, CUSTOM, SIZES, type ChoiceState } from "./choice";
import { makeReset } from "./fieldMeta";
import { Group, NumberField, OptionLabel, Plain, Row, SegmentedField, SelectField, SwitchField } from "./fields";
import { isOn, type Form, type FormKey } from "./form";

/** Langues proposées (code ISO 639-2 → nom dans la langue elle-même : on la reconnaît sans lire l'interface). */
const AUDIO_LANGS: [string, string][] = [
  ["fra", "Français"], ["eng", "English"], ["mlg", "Malagasy"], ["spa", "Español"], ["deu", "Deutsch"], ["ita", "Italiano"],
  ["por", "Português"], ["jpn", "日本語"], ["kor", "한국어"], ["zho", "中文"], ["ara", "العربية"], ["rus", "Русский"],
];

// IMPORTANT : doit rester identique à la liste de server/settings-schema.mjs (le serveur refuse un préréglage inconnu).
const X264_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"];

type Preset = { x264Preset: string; x264Crf: string; videoBitrate: string; gop: string; threads: string };
/**
 * Préréglages de transcodage : un clic règle plusieurs champs. Un débit vide = débit propre à l'encodeur ; avec libx264, un débit
 * donné sert de plafond (qualité constante). Les threads se règlent aussi dans la page Performance.
 */
const TRANSCODE_PRESETS: Record<"economie" | "equilibre" | "qualite", Preset> = {
  economie: { x264Preset: "ultrafast", x264Crf: "28", videoBitrate: "", gop: "60", threads: "" },
  equilibre: { x264Preset: "medium", x264Crf: "23", videoBitrate: "5000", gop: "60", threads: "2" },
  qualite: { x264Preset: "slow", x264Crf: "18", videoBitrate: "10000", gop: "30", threads: "4" },
};
const PRESET_KEYS = Object.keys(TRANSCODE_PRESETS) as (keyof typeof TRANSCODE_PRESETS)[];
const PRESET_ICONS: Record<keyof typeof TRANSCODE_PRESETS, LucideIcon> = { economie: Leaf, equilibre: Scale, qualite: Sparkles };

/** Préréglage libx264 : l'icône dit où il se situe entre vitesse (éclair) et qualité (étincelles). */
const X264_ICONS: Record<string, LucideIcon> = { ultrafast: Zap, superfast: Zap, veryfast: Zap, faster: Gauge, fast: Gauge, medium: Scale, slow: Sparkles };

/** Encodeur matériel (carte graphique / puce dédiée) ou logiciel (processeur), d'après son nom FFmpeg. */
const encoderIcon = (name: string): LucideIcon => (/nvenc|qsv|amf|_mf$|vaapi|videotoolbox/i.test(name) ? Zap : Cpu);

/** Ratio : carré pour 1:1, rectangle paysage sinon. */
const aspectIcon = (value: string): LucideIcon => (value === "1:1" ? Square : RectangleHorizontal);

type Props = {
  f: Form;
  set: (key: FormKey, value: string) => void;
  disabled: boolean;
  caps: FfmpegCapabilities | null;
  size: ChoiceState; setSize: (v: ChoiceState) => void;
  aspect: ChoiceState; setAspect: (v: ChoiceState) => void;
};

/** Page « Transcodage » : ce qui est demandé à FFmpeg quand une vidéo ou un audio ne se lit pas tel quel. */
export function TranscodeSection({ f, set, disabled, caps, size, setSize, aspect, setAspect }: Props) {
  const { t } = useI18n();
  const reset = makeReset(f, set);

  /** Liste (automatique / valeurs usuelles / personnalisée) ; en mode personnalisé, un champ de saisie apparaît sous la liste. */
  const choiceRow = (label: TKey, presets: string[], state: ChoiceState, setState: (v: ChoiceState) => void, placeholder: TKey, iconFor: (value: string) => LucideIcon, suffix = "") => (
    <Row label={t(label)}>
      <div className="space-y-2">
        <Select value={state.choice} onValueChange={(choice) => setState({ ...state, choice })} disabled={disabled}>
          <SelectTrigger className="w-full" aria-label={t(label)}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}><OptionLabel icon={WandSparkles}>{t("set.auto")}</OptionLabel></SelectItem>
            {presets.map((p) => <SelectItem key={p} value={p}><OptionLabel icon={iconFor(p)}>{p}{suffix}</OptionLabel></SelectItem>)}
            <SelectItem value={CUSTOM}><OptionLabel icon={PenLine}>{t("set.custom")}</OptionLabel></SelectItem>
          </SelectContent>
        </Select>
        {state.choice === CUSTOM && <Input value={state.custom} aria-label={t(label)} placeholder={t(placeholder)} onChange={(e) => setState({ ...state, custom: e.target.value })} />}
      </div>
    </Row>
  );

  // Préréglage actif : celui dont tous les champs correspondent (un champ vide et « 0 » sont équivalents pour le débit et les threads).
  const same = (a: string, b: string) => Number(a.trim() || 0) === Number(b.trim() || 0);
  const activePreset = PRESET_KEYS.find((key) => {
    const p = TRANSCODE_PRESETS[key];
    return f.x264Preset === p.x264Preset && same(f.x264Crf, p.x264Crf) && same(f.videoBitrate, p.videoBitrate) && same(f.gop, p.gop) && same(f.threads, p.threads);
  });

  const applyPreset = (key: keyof typeof TRANSCODE_PRESETS) => {
    const p = TRANSCODE_PRESETS[key];
    set("x264Preset", p.x264Preset);
    set("x264Crf", p.x264Crf);
    set("videoBitrate", p.videoBitrate);
    set("gop", p.gop);
    set("threads", p.threads);
  };

  // Encodeurs proposés : ceux du FFmpeg enregistré, y compris ceux écartés après un échec (on peut vouloir les réessayer).
  const encoders = [...new Set([...(caps?.h264Encoders ?? []), ...(caps?.unusable ?? []), ...(f.encoder ? [f.encoder] : [])])];

  return (
    <>
      {/* Préréglages : un clic règle préréglage, CRF, débit, GOP et threads ; la carte active est mise en évidence */}
      <Group title={t("set.presets")} hint={t("set.presetsHint")}>
        <Plain>
          <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label={t("set.presets")}>
            {PRESET_KEYS.map((key) => {
              const p = TRANSCODE_PRESETS[key];
              const Icon = PRESET_ICONS[key];
              const active = activePreset === key;
              return (
                <button key={key} type="button" disabled={disabled} aria-pressed={active} onClick={() => applyPreset(key)}
                  className={cn("flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                    active ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30" : "bg-background/40 hover:border-primary/40 hover:bg-accent/40")}>
                  <span className="flex w-full items-center gap-2">
                    <span className={cn("grid size-7 place-items-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="size-4" /></span>
                    <span className="text-sm font-medium">{t(`set.pre.${key}`)}</span>
                    {active && <Check className="ml-auto size-4 text-primary" />}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{p.x264Preset} · CRF {p.x264Crf}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{p.videoBitrate ? `${p.videoBitrate} kbit/s` : t("set.auto")}</span>
                </button>
              );
            })}
          </div>
        </Plain>
      </Group>

      <Group title={t("set.grp.output")}>
        <SelectField label={t("set.policy")} hint={t("set.policyHint")} value={f.playPolicy} disabled={disabled} reset={reset("playPolicy")} controlClassName="sm:w-72" onChange={(v) => set("playPolicy", v)}
          options={[{ value: "auto", label: t("set.policy.auto"), icon: WandSparkles }, { value: "encode", label: t("set.policy.encode"), icon: RefreshCw }]} />
        {choiceRow("set.size", SIZES, size, setSize, "set.customSizePh", () => Monitor, "p")}
        {choiceRow("set.aspect", ASPECTS, aspect, setAspect, "set.customAspectPh", aspectIcon)}
        <SwitchField id="set-deint" label={t("set.deinterlace")} hint={t("set.deinterlaceHint")} checked={isOn(f, "deinterlace")} disabled={disabled} reset={reset("deinterlace")} onChange={(v) => set("deinterlace", v ? "1" : "0")} />
        <SwitchField id="set-hwaccel" label={t("set.hwaccel")} hint={t("set.hwaccelHint")} checked={isOn(f, "hwaccel")} disabled={disabled} reset={reset("hwaccel")} onChange={(v) => set("hwaccel", v ? "1" : "0")} />
      </Group>

      <Group title={t("set.grp.encoder")}>
        <SelectField label={t("set.encoder")} hint={t("set.encoderHint")} value={f.encoder || AUTO} disabled={disabled} reset={reset("encoder")} onChange={(v) => set("encoder", v === AUTO ? "" : v)}
          options={[{ value: AUTO, label: t("set.auto"), icon: WandSparkles }, ...encoders.map((e) => ({ value: e, label: e, icon: encoderIcon(e) }))]} />
        <SelectField label={t("set.x264Preset")} value={f.x264Preset} disabled={disabled} reset={reset("x264Preset")} onChange={(v) => set("x264Preset", v)} options={X264_PRESETS.map((p) => ({ value: p, label: p, icon: X264_ICONS[p] }))} />
        <NumberField id="set-crf" label={t("set.x264Crf")} hint={t("set.x264Hint")} value={f.x264Crf} min={0} max={51} disabled={disabled} reset={reset("x264Crf")} onChange={(v) => set("x264Crf", v)} />
        <NumberField id="set-vbitrate" label={t("set.vbitrate")} hint={t("set.vbitrateHint")} value={f.videoBitrate} placeholder={t("set.auto")} min={300} max={50000} disabled={disabled} reset={reset("videoBitrate")} onChange={(v) => set("videoBitrate", v)} />
        <NumberField id="set-gop" label={t("set.gop")} hint={t("set.gopHint")} value={f.gop} min={10} max={600} disabled={disabled} reset={reset("gop")} onChange={(v) => set("gop", v)} />
      </Group>

      <Group title={t("set.grp.audio")}>
        <SelectField label={t("set.audioLang")} hint={t("set.audioLangHint")} value={f.audioLang || AUTO} disabled={disabled} reset={reset("audioLang")} onChange={(v) => set("audioLang", v === AUTO ? "" : v)}
          options={[{ value: AUTO, label: t("set.none"), icon: CircleOff }, ...AUDIO_LANGS.map(([code, name]) => ({ value: code, label: name, icon: Languages })),
            ...(f.audioLang && !AUDIO_LANGS.some(([c]) => c === f.audioLang) ? [{ value: f.audioLang, label: f.audioLang, icon: Languages }] : [])]} />
        <NumberField id="set-atrack" label={t("set.audioTrack")} hint={t("set.audioTrackHint")} value={f.audioTrack} min={0} max={15} disabled={disabled} reset={reset("audioTrack")} onChange={(v) => set("audioTrack", v)} />
        <NumberField id="set-abitrate" label={t("set.abitrate")} value={f.audioBitrate} min={64} max={512} disabled={disabled} reset={reset("audioBitrate")} onChange={(v) => set("audioBitrate", v)} />
        <SegmentedField label={t("set.achannels")} value={f.audioChannels} disabled={disabled} reset={reset("audioChannels")} onChange={(v) => set("audioChannels", v)}
          options={[{ value: "2", label: t("set.ch.2") }, { value: "source", label: t("set.ch.source") }]} />
      </Group>
    </>
  );
}
