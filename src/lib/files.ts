import { tr } from "@/i18n";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { audioExt, videoExt, isSupported } from "@/lib/media";

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

/** Scanne un dossier (non récursif, comme l'ancienne version) et ne garde que les médias supportés. */
export async function pickFolder(): Promise<string[]> {
  const dir = await open({ directory: true, title: tr("dlg.scanFolder") });
  if (typeof dir !== "string") return [];
  const sep = dir.includes("\\") ? "\\" : "/";
  const entries = await readDir(dir);
  return entries.filter((e) => e.isFile && isSupported(e.name)).map((e) => `${dir}${sep}${e.name}`);
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
 * IMPORTANT : un dossier est scanné à plat, comme « Ajouter un dossier » ; un chemin illisible est ignoré plutôt que de bloquer le dépôt.
 */
export async function expandDropped(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    try {
      if ((await stat(path)).isDirectory) {
        const sep = path.includes("\\") ? "\\" : "/";
        const entries = await readDir(path);
        out.push(...entries.filter((e) => e.isFile && isSupported(e.name)).map((e) => `${path}${sep}${e.name}`));
      } else if (isSupported(path)) out.push(path);
    } catch { /* chemin inaccessible : on passe au suivant */ }
  }
  return out;
}
