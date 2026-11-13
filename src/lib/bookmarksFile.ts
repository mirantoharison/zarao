import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { tr } from "@/i18n";
import { exportBookmarks, importBookmarks } from "@/lib/bookmarks";

const FILTERS = () => [{ name: tr("dlg.bmFilter"), extensions: ["zbm"] }];

/** Enregistre tous les signets dans un fichier .zbm choisi par l'utilisateur. Renvoie false s'il annule. */
export async function saveBookmarksFile(): Promise<boolean> {
  const target = await save({ title: tr("dlg.bmSave"), defaultPath: "zarao-signets.zbm", filters: FILTERS() });
  if (!target) return false;
  await writeTextFile(target, exportBookmarks());
  return true;
}

/** Importe un fichier .zbm : renvoie le nombre de signets ajoutés, ou null si l'utilisateur annule. Lève si le fichier est illisible. */
export async function loadBookmarksFile(): Promise<number | null> {
  const file = await open({ multiple: false, title: tr("dlg.bmOpen"), filters: FILTERS() });
  if (typeof file !== "string") return null;
  try {
    return importBookmarks(await readTextFile(file));
  } catch {
    throw new Error(tr("bm.fileErr"));
  }
}
