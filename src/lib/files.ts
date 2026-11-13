import { tr } from "@/i18n";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { audioExt, videoExt, isSupported } from "@/lib/media";
import { getScanSettings, matchesAnyPattern } from "@/lib/settings";

/** Sélection de fichiers médias (multi). Retourne des chemins disque. */
export async function pickFiles(): Promise<string[]> {
  const res = await open({
    multiple: true,
    title: tr("dlg.openFiles"),
    filters: [
      { name: tr("dlg.allMedia"), extensions: [...audioExt(), ...videoExt()] },
      { name: tr("dlg.audio"), extensions: audioExt() },
      { name: tr("dlg.video"), extensions: videoExt() },
    ],
  });
  return Array.isArray(res) ? res : res ? [res] : [];
}

/** Plafond de fichiers retenus par scan : un parcours récursif d'un disque entier ne doit pas figer l'interface. */
const MAX_SCAN_FILES = 5000;

/**
 * Médias supportés d'un dossier. Par défaut à plat (comme l'ancienne version) ; les Paramètres (Bibliothèque) activent le parcours
 * des sous-dossiers (profondeur bornée), l'ignorance des éléments cachés et des motifs d'exclusion.
 * IMPORTANT : seul le dossier de départ propage son erreur de lecture ; un sous-dossier illisible est simplement ignoré.
 */
export async function scanFolder(dir: string): Promise<string[]> {
  const { recursive, maxDepth, hidden, exclude } = getScanSettings();
  const sep = dir.includes("\\") ? "\\" : "/";
  const out: string[] = [];
  const walk = async (current: string, depth: number) => {
    const entries = depth === 0 ? await readDir(current) : await readDir(current).catch(() => []);
    for (const e of entries) {
      if (out.length >= MAX_SCAN_FILES) return;
      if (!hidden && e.name.startsWith(".")) continue;
      if (exclude.length > 0 && matchesAnyPattern(e.name, exclude)) continue;
      const full = `${current}${sep}${e.name}`;
      if (e.isFile) { if (isSupported(e.name)) out.push(full); }
      else if (e.isDirectory && recursive && depth < maxDepth) await walk(full, depth + 1);
    }
  };
  await walk(dir, 0);
  return out;
}

/** Choix d'un dossier puis scan (cf. scanFolder). */
export async function pickFolder(): Promise<string[]> {
  const dir = await open({ directory: true, title: tr("dlg.scanFolder") });
  return typeof dir === "string" ? scanFolder(dir) : [];
}

type PlaylistFile = { version: 1; paths: string[] };

export async function savePlaylist(paths: string[]): Promise<boolean> {
  const target = await save({ title: tr("dlg.savePlaylist"), filters: [{ name: tr("dlg.playlistFilter"), extensions: ["zp"] }] });
  if (!target) return false;
  const content: PlaylistFile = { version: 1, paths };
  await writeTextFile(target, JSON.stringify(content));
  return true;
}

/**
 * IMPORTANT : format .zp en JSON clair. Les anciens .zp chiffrés (Electron) ne sont pas lisibles ici ;
 * on le signale plutôt que de planter silencieusement.
 */
export async function loadPlaylist(): Promise<string[]> {
  const file = await open({ multiple: false, title: tr("dlg.openPlaylist"), filters: [{ name: tr("dlg.playlistFilter"), extensions: ["zp"] }] });
  if (typeof file !== "string") return [];
  const raw = await readTextFile(file);
  try {
    const parsed = JSON.parse(raw) as PlaylistFile;
    if (!Array.isArray(parsed.paths)) throw new Error();
    return parsed.paths;
  } catch {
    throw new Error(tr("msg.playlistFormat"));
  }
}

/**
 * Convertit des chemins déposés (fichiers ou dossiers) en liste de médias supportés.
 * IMPORTANT : un dossier est scanné comme « Ajouter un dossier » (mêmes réglages) ; un chemin illisible est ignoré plutôt que de bloquer le dépôt.
 */
export async function expandDropped(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    try {
      if ((await stat(path)).isDirectory) out.push(...(await scanFolder(path)));
      else if (isSupported(path)) out.push(path);
    } catch { /* chemin inaccessible : on passe au suivant */ }
  }
  return out;
}
