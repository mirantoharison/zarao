import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { tr } from "@/i18n";
import { normalizeAudio, normalizeScan, type AudioSettings, type ScanSettings } from "@/lib/settings";

/**
 * Sauvegarde des réglages dans un fichier JSON (export / import des Paramètres).
 * Les valeurs importées sont revalidées champ par champ : un fichier édité à la main ou venant d'une autre version ne doit rien casser.
 * IMPORTANT : l'import ne fait que remplir le formulaire des Paramètres ; rien n'est appliqué avant « Enregistrer ».
 */
export type SettingsBackup = {
  app: "zarao";
  version: 1;
  /** Réglages du serveur local, en texte comme dans le formulaire (clé inconnue ou valeur non textuelle ignorée). */
  server: Record<string, string>;
  videoSize: string;
  videoAspect: string;
  extensions: { audio: string[]; video: string[] };
  audio: AudioSettings;
  scan: ScanSettings;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : []);

/** Fichier lu → sauvegarde valide, ou null si ce n'est pas une sauvegarde de réglages Zarao. */
export function parseBackup(raw: unknown): SettingsBackup | null {
  if (!isRecord(raw) || raw.app !== "zarao" || raw.version !== 1) return null;
  const server: Record<string, string> = {};
  if (isRecord(raw.server)) for (const [k, v] of Object.entries(raw.server)) if (typeof v === "string") server[k] = v.slice(0, 500);
  const ext = isRecord(raw.extensions) ? raw.extensions : {};
  return {
    app: "zarao",
    version: 1,
    server,
    videoSize: typeof raw.videoSize === "string" ? raw.videoSize : "",
    videoAspect: typeof raw.videoAspect === "string" ? raw.videoAspect : "",
    extensions: { audio: strings(ext.audio), video: strings(ext.video) },
    audio: normalizeAudio(isRecord(raw.audio) ? (raw.audio as Partial<AudioSettings>) : {}),
    scan: normalizeScan(isRecord(raw.scan) ? (raw.scan as Partial<ScanSettings>) : {}),
  };
}

/** Demande où enregistrer puis écrit la sauvegarde ; false si l'utilisateur annule. */
export async function exportBackup(backup: SettingsBackup): Promise<boolean> {
  const target = await save({ title: tr("set.exportTitle"), defaultPath: "zarao-settings.json", filters: [{ name: tr("dlg.settingsFilter"), extensions: ["json"] }] });
  if (!target) return false;
  await writeTextFile(target, JSON.stringify(backup, null, 2));
  return true;
}

/** Demande un fichier et le lit ; undefined si l'utilisateur annule, null si son contenu n'est pas valide. */
export async function importBackup(): Promise<SettingsBackup | null | undefined> {
  const file = await open({ title: tr("set.importTitle"), multiple: false, filters: [{ name: tr("dlg.settingsFilter"), extensions: ["json"] }] });
  if (typeof file !== "string") return undefined;
  try { return parseBackup(JSON.parse(await readTextFile(file))); } catch { return null; }
}
