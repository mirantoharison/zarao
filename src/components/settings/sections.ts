import { AudioLines, Cpu, Film, FolderTree, RefreshCw, Server, type LucideIcon } from "lucide-react";
import type { TKey } from "@/i18n";

/** Pages des Paramètres. Chacune est une entrée du menu « Paramètres » et ouvre le dialogue directement sur elle. */
export type SettingsSection = "ffmpeg" | "transcode" | "performance" | "audio" | "library" | "server";

/** `hint` : texte d'introduction affiché sous le titre de la page. */
export const SETTINGS_SECTIONS: { id: SettingsSection; icon: LucideIcon; label: TKey; hint: TKey }[] = [
  { id: "audio", icon: AudioLines, label: "set.sec.audio", hint: "set.audioHint" },
  { id: "library", icon: FolderTree, label: "set.sec.library", hint: "set.libHint" },
  { id: "ffmpeg", icon: Film, label: "set.sec.ffmpeg", hint: "set.ffHint" },
  { id: "transcode", icon: RefreshCw, label: "set.sec.transcode", hint: "set.transcodeHint" },
  { id: "performance", icon: Cpu, label: "set.sec.perf", hint: "set.perfHint" },
  { id: "server", icon: Server, label: "set.sec.server", hint: "set.srvHint" },
];

/**
 * Regroupement de la navigation latérale : ce qui concerne l'écoute, puis FFmpeg, puis l'application elle-même.
 * IMPORTANT : chaque page doit figurer dans un (et un seul) groupe, sinon elle disparaît de la navigation.
 */
export const SETTINGS_GROUPS: { label: TKey; sections: SettingsSection[] }[] = [
  { label: "set.nav.player", sections: ["audio", "library"] },
  { label: "set.nav.ffmpeg", sections: ["ffmpeg", "transcode", "performance"] },
  { label: "set.nav.app", sections: ["server"] },
];
