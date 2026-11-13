/**
 * Signets : repères nommés posés à un instant précis d'un média (un morceau dans un long mix, un passage d'une vidéo).
 * Rangés dans le localStorage, par CHEMIN du fichier (comme les favoris et les playlists) : ils survivent à un redémarrage
 * et suivent le fichier même s'il change de place dans la liste. Un fichier renommé ou déplacé perd simplement ses signets.
 */
import { useEffect, useState } from "react";

/**
 * `seq` : rang de création dans ce média (0, 1, 2…) ; il fixe la couleur (cf. PALETTE) une fois pour toutes.
 * `hue` : ancien système (teinte aléatoire), conservé pour les signets créés avant `seq`.
 */
export type Bookmark = { id: string; t: number; name: string; at: number; seq?: number; hue?: number; note?: string };

/**
 * Teintes de l'arc-en-ciel, dans l'ordre, du rouge au rose : les signets les prennent l'une après l'autre (puis on recommence).
 * 14 teintes plutôt que les 7 classiques : deux signets consécutifs sont toujours bien distincts, et il faut plus de 14 signets pour voir une répétition.
 */
const PALETTE = [0, 22, 42, 58, 85, 130, 160, 185, 205, 225, 250, 275, 305, 335];

/** Couleur d'un signet : celle de son rang de création, sinon (ancien signet) sa teinte aléatoire mémorisée, sinon une teinte déduite de son identifiant. */
export function bookmarkColor(b: Bookmark): string {
  if (b.seq !== undefined) return `hsl(${PALETTE[b.seq % PALETTE.length]} 85% 55%)`;
  let hue = b.hue;
  if (hue === undefined) { let h = 0; for (const c of b.id) h = (h * 31 + c.charCodeAt(0)) % 360; hue = h; }
  return `hsl(${hue} 85% 55%)`;
}

/** Signale aux écrans ouverts (barre de progression, dialogue) qu'un signet a changé. */
const CHANGED = "zarao:bookmarks";
const notify = () => window.dispatchEvent(new Event(CHANGED));

const KEY = "zarao.bookmarks";
/** Garde-fous : un stockage qui enfle sans fin finirait par faire échouer les autres écritures du localStorage. */
const MAX_PER_MEDIA = 100;
const MAX_MEDIA = 500;

type Store = Record<string, Bookmark[]>;

function readAll(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Store = {};
    for (const [path, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const clean = list.filter((b): b is Bookmark => typeof b?.id === "string" && Number.isFinite(b?.t) && typeof b?.name === "string");
      if (clean.length > 0) out[path] = clean;
    }
    return out;
  } catch { return {}; }
}

function writeAll(store: Store): void {
  // Les médias les plus récemment marqués d'abord : au-delà du plafond, ce sont les plus anciens qui partent.
  const entries = Object.entries(store).sort((a, b) => Math.max(...b[1].map((x) => x.at)) - Math.max(...a[1].map((x) => x.at))).slice(0, MAX_MEDIA);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* quota / stockage indisponible : non bloquant */ }
  notify();
}

/** Signets du média donné, tenus à jour quand ils changent (null = aucun média). */
export function useBookmarks(path: string | null): Bookmark[] {
  const [list, setList] = useState<Bookmark[]>(() => (path ? readBookmarks(path) : []));
  useEffect(() => {
    const refresh = () => setList(path ? readBookmarks(path) : []);
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [path]);
  return list;
}

/** Signets d'un média, dans l'ordre de la lecture. */
export function readBookmarks(path: string): Bookmark[] {
  return [...(readAll()[path] ?? [])].sort((a, b) => a.t - b.t);
}

/** Ajoute un signet à l'instant `t` (secondes) ; renvoie la liste à jour. Deux signets au même dixième de seconde n'en font qu'un. */
export function addBookmark(path: string, t: number, name: string): Bookmark[] {
  const store = readAll();
  const list = store[path] ?? [];
  const at = Math.round(t * 10) / 10;
  if (!list.some((b) => Math.abs(b.t - at) < 0.1) && list.length < MAX_PER_MEDIA) {
    // Rang = plus grand rang existant + 1 (pas le nombre de signets) : supprimer un signet du milieu ne fait pas réutiliser la couleur d'un autre.
    const seq = list.reduce((max, b) => Math.max(max, b.seq ?? -1), -1) + 1;
    list.push({ id: crypto.randomUUID(), t: at, name: name.trim().slice(0, 80), at: Date.now(), seq });
  }
  store[path] = list;
  writeAll(store);
  return readBookmarks(path);
}

/** Change le nom (vide = on garde l'ancien) et la note (vide = effacée) d'un signet ; renvoie la liste à jour. */
export function updateBookmark(path: string, id: string, name: string, note: string): Bookmark[] {
  const cleanName = name.trim().slice(0, 80);
  const cleanNote = note.trim().slice(0, 300);
  const store = readAll();
  const list = store[path];
  if (list) {
    store[path] = list.map((b) => {
      if (b.id !== id) return b;
      const { note: _old, ...rest } = b;
      return { ...rest, name: cleanName || b.name, ...(cleanNote ? { note: cleanNote } : {}) };
    });
    writeAll(store);
  }
  return readBookmarks(path);
}

/** Tous les signets de l'application, par chemin de média, tenus à jour quand ils changent. */
export function useAllBookmarks(): Record<string, Bookmark[]> {
  const [all, setAll] = useState<Store>(readAll);
  useEffect(() => {
    const refresh = () => setAll(readAll());
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, []);
  return all;
}

/** Sauvegarde de TOUS les signets (JSON lisible, versionné) : pour les conserver ou les transférer vers un autre poste. */
export function exportBookmarks(): string {
  return JSON.stringify({ version: 1, bookmarks: readAll() }, null, 2);
}

/**
 * Fusionne une sauvegarde dans les signets existants et renvoie le nombre de signets ajoutés.
 * IMPORTANT : fusion, jamais remplacement (importer ne doit pas effacer ce qu'on a déjà), et un signet déjà présent au même instant du
 * même fichier est ignoré : réimporter deux fois la même sauvegarde ne duplique rien. Lève une erreur si le fichier n'a pas la bonne forme.
 */
export function importBookmarks(json: string): number {
  const parsed = JSON.parse(json) as { bookmarks?: unknown };
  if (!parsed || typeof parsed.bookmarks !== "object" || parsed.bookmarks === null || Array.isArray(parsed.bookmarks)) throw new Error("format");
  const store = readAll();
  let added = 0;
  for (const [path, list] of Object.entries(parsed.bookmarks as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const target = store[path] ?? [];
    for (const raw of list) {
      const b = raw as Partial<Bookmark>;
      if (typeof b?.t !== "number" || !Number.isFinite(b.t) || typeof b.name !== "string") continue;
      if (target.some((x) => Math.abs(x.t - (b.t as number)) < 0.1) || target.length >= MAX_PER_MEDIA) continue;
      const seq = target.reduce((max, x) => Math.max(max, x.seq ?? -1), -1) + 1;
      target.push({ id: crypto.randomUUID(), t: b.t, name: b.name.slice(0, 80), at: typeof b.at === "number" ? b.at : Date.now(), seq, ...(typeof b.note === "string" && b.note ? { note: b.note.slice(0, 300) } : {}) });
      added++;
    }
    if (target.length > 0) store[path] = target;
  }
  if (added > 0) writeAll(store);
  return added;
}

/** Supprime tous les signets d'un média. */
export function clearBookmarks(path: string): Bookmark[] {
  const store = readAll();
  delete store[path];
  writeAll(store);
  return [];
}

export function removeBookmark(path: string, id: string): Bookmark[] {
  const store = readAll();
  const left = (store[path] ?? []).filter((b) => b.id !== id);
  if (left.length > 0) store[path] = left; else delete store[path];
  writeAll(store);
  return readBookmarks(path);
}
