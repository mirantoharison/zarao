/**
 * Playlists enregistrées dans l'application (localStorage), pour retrouver ses listes d'une session à l'autre sans passer par un fichier.
 * On mémorise les CHEMINS des fichiers (les identifiants de liste changent à chaque ajout). Un fichier déplacé ou supprimé depuis est
 * simplement ignoré au chargement.
 */
export type SavedPlaylist = { id: string; name: string; paths: string[]; updatedAt: number };

const KEY = "zarao.playlists";
const MAX_PLAYLISTS = 100;

export function readPlaylists(): SavedPlaylist[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is SavedPlaylist => typeof p?.id === "string" && typeof p?.name === "string" && Array.isArray(p?.paths));
  } catch { return []; }
}

function write(list: SavedPlaylist[]): SavedPlaylist[] {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PLAYLISTS);
  try { localStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* quota / stockage indisponible : non bloquant */ }
  return sorted;
}

/** Enregistre la liste sous ce nom ; un nom déjà pris (sans tenir compte de la casse) est remplacé, pas dupliqué. */
export function savePlaylistNamed(name: string, paths: string[]): SavedPlaylist[] {
  const clean = name.trim().slice(0, 80);
  const list = readPlaylists();
  const existing = list.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  const entry: SavedPlaylist = { id: existing?.id ?? crypto.randomUUID(), name: clean, paths: [...paths], updatedAt: Date.now() };
  return write([entry, ...list.filter((p) => p.id !== entry.id)]);
}

export const deletePlaylist = (id: string): SavedPlaylist[] => write(readPlaylists().filter((p) => p.id !== id));
