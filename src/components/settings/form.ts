import type { EditableSettings } from "@/lib/api";

/**
 * Formulaire des réglages serveur : tout en TEXTE, pour qu'un champ vide reste vide (= valeur par défaut côté serveur)
 * et que la saisie d'un nombre ne soit pas contrariée à chaque frappe. Le serveur valide et convertit (settings-schema.mjs).
 */
export type FormKey = keyof EditableSettings;
export type Form = Record<FormKey, string>;

export const FORM_KEYS: FormKey[] = [
  "ffmpeg", "videoSize", "videoAspect", "playPolicy", "encoder", "videoBitrate", "x264Preset", "x264Crf", "audioBitrate", "audioChannels",
  "gop", "audioTrack", "audioLang", "deinterlace", "hwaccel", "threads", "priority", "maxStreams", "extraArgs", "id3v2", "tagBackup", "logLevel",
  "probeTimeout", "tagTimeout", "port",
];

/** Réglages où 0 signifie « automatique / illimité » : affichés vides pour que le placeholder le dise. */
export const ZERO_IS_AUTO = new Set<FormKey>(["videoBitrate", "threads", "maxStreams", "port"]);

export function toForm(s: EditableSettings): Form {
  const out = {} as Form;
  for (const key of FORM_KEYS) {
    const v = s[key];
    out[key] = typeof v === "boolean" ? (v ? "1" : "0") : ZERO_IS_AUTO.has(key) && v === 0 ? "" : String(v ?? "");
  }
  return out;
}

export const EMPTY_FORM: Form = Object.fromEntries(FORM_KEYS.map((k) => [k, ""])) as Form;

/** Booléen d'un champ du formulaire. */
export const isOn = (f: Form, key: FormKey) => f[key] === "1";
