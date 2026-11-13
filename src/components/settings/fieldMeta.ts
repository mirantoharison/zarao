import type { TKey } from "@/i18n";
import { ZERO_IS_AUTO, type Form, type FormKey } from "./form";
import type { SettingsSection } from "./sections";

/**
 * Métadonnées des champs serveur : libellé, page où ils se règlent et valeur par défaut (en TEXTE, comme le formulaire).
 * Elles servent à dire OÙ corriger une valeur refusée, à « Rétablir » un champ et à la recherche.
 * IMPORTANT : les défauts doivent rester identiques à ceux de server/settings-schema.mjs (une valeur vide = défaut côté serveur).
 * Module à part (et non dans SettingsDialog) : les sections l'importent, un import circulaire avec le dialogue casserait le chargement.
 */
export const FIELD_META: Record<Exclude<FormKey, "ffmpeg">, { label: TKey; section: SettingsSection; default: string }> = {
  videoSize: { label: "set.size", section: "transcode", default: "" }, videoAspect: { label: "set.aspect", section: "transcode", default: "" },
  playPolicy: { label: "set.policy", section: "transcode", default: "auto" }, encoder: { label: "set.encoder", section: "transcode", default: "" },
  videoBitrate: { label: "set.vbitrate", section: "transcode", default: "" }, x264Preset: { label: "set.x264Preset", section: "transcode", default: "ultrafast" },
  x264Crf: { label: "set.x264Crf", section: "transcode", default: "23" }, audioBitrate: { label: "set.abitrate", section: "transcode", default: "192" },
  audioChannels: { label: "set.achannels", section: "transcode", default: "2" }, gop: { label: "set.gop", section: "transcode", default: "60" },
  audioTrack: { label: "set.audioTrack", section: "transcode", default: "0" }, audioLang: { label: "set.audioLang", section: "transcode", default: "" },
  deinterlace: { label: "set.deinterlace", section: "transcode", default: "0" }, hwaccel: { label: "set.hwaccel", section: "transcode", default: "0" },
  threads: { label: "set.threads", section: "performance", default: "" }, priority: { label: "set.priority", section: "performance", default: "normal" },
  maxStreams: { label: "set.maxStreams", section: "performance", default: "" }, extraArgs: { label: "set.extraArgs", section: "performance", default: "" },
  id3v2: { label: "set.id3v2", section: "library", default: "3" }, tagBackup: { label: "set.tagBackup", section: "library", default: "0" },
  logLevel: { label: "set.logLevel", section: "server", default: "error" }, probeTimeout: { label: "set.probeTimeout", section: "server", default: "15" },
  tagTimeout: { label: "set.tagTimeout", section: "server", default: "120" }, port: { label: "set.port", section: "server", default: "" },
};

/** Valeur par défaut d'un champ, en texte. */
export const defaultText = (key: Exclude<FormKey, "ffmpeg">): string => FIELD_META[key].default;

/** Forme canonique pour comparer : « 023 » = « 23 », « 0 » = « vide » là où 0 veut dire automatique, un booléen vide = « 0 ». */
function canonical(key: FormKey, value: string): string {
  const v = value.trim();
  const meta = FIELD_META[key as Exclude<FormKey, "ffmpeg">];
  if (meta && (meta.default === "0" || meta.default === "1") && v === "") return meta.default;
  if (v !== "" && Number.isFinite(Number(v))) {
    const n = String(Number(v));
    return n === "0" && ZERO_IS_AUTO.has(key) ? "" : n;
  }
  return v;
}

/** Vrai si le champ diffère de sa valeur par défaut. */
export function isModified(f: Form, key: Exclude<FormKey, "ffmpeg">): boolean {
  return canonical(key, f[key]) !== canonical(key, defaultText(key));
}

/** Propriétés `reset` à donner à un champ : bouton « Rétablir » visible seulement quand la valeur n'est plus celle par défaut. */
export type FieldReset = { modified: boolean; onReset: () => void };
export const makeReset = (f: Form, set: (key: FormKey, value: string) => void) => (key: Exclude<FormKey, "ffmpeg">): FieldReset => ({
  modified: isModified(f, key), onReset: () => set(key, defaultText(key)),
});

/** Réglages locaux à l'interface (hors formulaire serveur) : ils n'ont pas de valeur par défaut « Rétablir » mais restent trouvables. */
const LOCAL_SEARCH: [TKey, SettingsSection][] = [
  ["set.ffmpeg", "ffmpeg"],
  ["set.fft", "audio"], ["set.attack", "audio"], ["set.release", "audio"], ["set.latency", "audio"], ["set.sink", "audio"],
  ["set.limiter", "audio"], ["set.replayGain", "audio"], ["set.fade", "audio"], ["set.preload", "audio"], ["set.resume", "audio"], ["set.resumeMin", "audio"],
  ["set.extensions", "library"], ["set.recursive", "library"], ["set.hidden", "library"], ["set.exclude", "library"], ["set.watch", "library"],
];

export type SearchHit = { label: TKey; section: SettingsSection };

/** Sans accents ni casse : « priorite » trouve « Priorité ». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Réglages dont le libellé AFFICHÉ (dans la langue courante) ou le nom technique contient la requête.
 * `t` traduit un libellé ; on cherche sur le texte vu par l'utilisateur, pas sur la clé de traduction.
 */
export function searchSettings(query: string, t: (key: TKey) => string, limit = 8): SearchHit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const all: (SearchHit & { name: string })[] = [
    ...(Object.entries(FIELD_META) as [string, (typeof FIELD_META)[keyof typeof FIELD_META]][]).map(([name, m]) => ({ label: m.label, section: m.section, name })),
    ...LOCAL_SEARCH.map(([label, section]) => ({ label, section, name: "" })),
  ];
  const seen = new Set<TKey>();
  const hits: SearchHit[] = [];
  for (const h of all) {
    if (seen.has(h.label) || !(fold(t(h.label)).includes(q) || fold(h.name).includes(q))) continue;
    seen.add(h.label);
    hits.push({ label: h.label, section: h.section });
    if (hits.length >= limit) break;
  }
  return hits;
}
