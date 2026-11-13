export const AUTO = "auto";
export const CUSTOM = "custom";
export const SIZES = ["1080", "720", "480", "360", "240"];
export const ASPECTS = ["16:9", "4:3", "1:1"];

export type ChoiceState = { choice: string; custom: string };

/** Valeur enregistrée → choix du menu ("" = automatique, valeur hors liste = personnalisée). */
export const toChoice = (value: string, presets: string[]) => (value === "" ? AUTO : presets.includes(value) ? value : CUSTOM);
