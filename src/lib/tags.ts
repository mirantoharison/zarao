import { open as openFile } from "@tauri-apps/plugin-fs";
import { parseBlob } from "music-metadata";

/** Tags éditables (mêmes clés que le serveur : cf. TAG_KEYS dans server/index.mjs). */
export type TagValues = {
  title: string; artist: string; album: string; album_artist: string; composer: string; genre: string;
  date: string; track: string; disc: string; publisher: string; copyright: string;
};

export const EMPTY_TAGS: TagValues = { title: "", artist: "", album: "", album_artist: "", composer: "", genre: "", date: "", track: "", disc: "", publisher: "", copyright: "" };

export type FileInfo = {
  name: string; path: string; size: number; format: string; duration: number; encoder: string;
  created: Date | null; modified: Date | null; accessed: Date | null;
};

export type LocalTags = { tags: TagValues; info: FileInfo; jacket: string };

/** On ne lit que le début du fichier : les tags ID3v2 y sont, et un film entier en mémoire pour lire un titre serait absurde. */
const READ_BYTES = 8 * 1024 * 1024;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
const pair = (v: { no: number | null; of: number | null } | undefined) => (v?.no ? (v.of ? `${v.no}/${v.of}` : String(v.no)) : "");

/** "3/12" → ["3", "12"] ; "3" → ["3", ""]. */
export function splitPair(value: string): [string, string] {
  const [n = "", total = ""] = value.split("/");
  return [n.trim(), total.trim()];
}
export function joinPair(n: string, total: string): string {
  const a = n.trim(), b = total.trim();
  return a ? (b ? `${a}/${b}` : a) : "";
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  // Par blocs : String.fromCharCode(...grandTableau) dépasse la pile pour une grosse pochette.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Tags et pochette intégrée d'un `File` du navigateur (téléversement) ; ne lève jamais : un fichier sans tags donne des champs vides. */
export async function readFileTags(file: File): Promise<{ tags: TagValues; jacket: File | null; duration: number; found: boolean }> {
  try {
    const meta = await parseBlob(file.slice(0, READ_BYTES), { duration: false, skipPostHeaders: true });
    const c = meta.common;
    const picture = c.picture?.[0];
    const tags: TagValues = {
      title: c.title ?? "", artist: c.artist ?? "", album: c.album ?? "", album_artist: c.albumartist ?? "", composer: first(c.composer),
      genre: first(c.genre), date: c.year ? String(c.year) : c.date?.slice(0, 4) ?? "", track: pair(c.track), disc: pair(c.disk),
      publisher: first(c.label), copyright: c.copyright ?? "",
    };
    const ext = (picture?.format ?? "image/jpeg").split("/")[1] ?? "jpg";
    return {
      tags, found: Object.values(tags).some(Boolean), duration: meta.format.duration ?? 0,
      jacket: picture ? new File([new Uint8Array(picture.data)], `cover.${ext}`, { type: picture.format }) : null,
    };
  } catch {
    return { tags: { ...EMPTY_TAGS }, jacket: null, duration: 0, found: false };
  }
}

/** Lit tags, pochette et informations d'un fichier local (plugin fs + music-metadata). */
export async function readLocalTags(path: string): Promise<LocalTags> {
  const handle = await openFile(path, { read: true });
  let stat: Awaited<ReturnType<typeof handle.stat>>;
  let blob: Blob;
  try {
    stat = await handle.stat();
    const buf = new Uint8Array(READ_BYTES);
    const n = (await handle.read(buf)) ?? 0;
    blob = new Blob([buf.slice(0, n)]);
  } finally {
    await handle.close();
  }

  const meta = await parseBlob(blob, { duration: false, skipPostHeaders: true });
  const c = meta.common;
  const picture = c.picture?.[0];
  return {
    tags: {
      title: c.title ?? "", artist: c.artist ?? "", album: c.album ?? "", album_artist: c.albumartist ?? "", composer: first(c.composer),
      genre: first(c.genre), date: c.year ? String(c.year) : c.date ?? "", track: pair(c.track), disc: pair(c.disk),
      publisher: first(c.label), copyright: c.copyright ?? "",
    },
    info: {
      name: path.split(/[\\/]/).pop() ?? path, path, size: stat.size, format: [meta.format.container, meta.format.codec].filter(Boolean).join(" / "),
      duration: meta.format.duration ?? 0, encoder: c.encodedby ?? c.encodersettings ?? "",
      created: stat.birthtime, modified: stat.mtime, accessed: stat.atime,
    },
    jacket: picture ? bytesToDataUrl(picture.data, picture.format) : "",
  };
}
