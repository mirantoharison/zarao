/**
 * Deux serveurs (cf. server/index.mjs, ZARAO_ROLE) :
 *  - LOCAL_BASE  : lancé par Tauri, lié à 127.0.0.1 — fichiers du disque, ffmpeg, réglages (/local, /settings, /tags).
 *  - ONLINE_BASE : comptes, catalogue partagé, playlists, social. Par défaut le même serveur local (mode "all") ;
 *    VITE_ONLINE_URL (ex. https://api.zarao.mg) le pointe vers un vrai serveur en ligne.
 * Surchargeable par VITE_API_BASE (tests sur un serveur annexe) pour le serveur local.
 */
export const DEFAULT_LOCAL_PORT = 4000;
const PORT_KEY = "zarao.localPort";
/**
 * Port du serveur local choisi dans les Paramètres. IMPORTANT : le serveur le lit au démarrage (table settings), le client ici,
 * au chargement : les deux n'en changent qu'au prochain lancement. Mémorisé dans le localStorage car il faut le connaître AVANT
 * de pouvoir interroger le serveur.
 */
function storedPort(): number {
  try {
    const n = Number(localStorage.getItem(PORT_KEY));
    return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_LOCAL_PORT;
  } catch { return DEFAULT_LOCAL_PORT; }
}
export const LOCAL_PORT = storedPort();
/** 0 = port par défaut. */
export function setLocalPort(port: number): void {
  try { if (port > 0) localStorage.setItem(PORT_KEY, String(port)); else localStorage.removeItem(PORT_KEY); } catch { /* non bloquant */ }
}
export const LOCAL_BASE: string = import.meta.env.VITE_API_BASE ?? `http://127.0.0.1:${LOCAL_PORT}`;
export const ONLINE_BASE: string = (import.meta.env.VITE_ONLINE_URL ?? LOCAL_BASE).replace(/\/+$/, "");
/** Routes qui touchent la machine de l'utilisateur : elles ne doivent JAMAIS partir vers le serveur en ligne. */
const LOCAL_PATH = /^\/(health|local|settings|tags)(\/|\?|$)/;
const baseFor = (path: string) => (LOCAL_PATH.test(path) ? LOCAL_BASE : ONLINE_BASE);

export type SessionUser = { _id: string; username: string; name?: string; surname?: string; profilphoto?: string };

/** Fiche complète du compte (jamais de mot de passe). */
export type Account = SessionUser & { usermail?: string; age?: number; newsletter?: boolean; registeredat?: number; bio?: string; city?: string; country?: string };

/** Média tel que listé par le serveur (liste, nouveautés, recherche). */
export type ServerMedia = { _id: string; fileid?: string; artist?: string; title?: string; duration?: string; size?: number };

/** Métadonnées complètes d'un média (pochette incluse, d'où l'appel séparé : la pochette est lourde). */
export type ServerMediaMeta = {
  id: string; userid?: string; name?: string; ext?: string; size?: number; type?: string; isVideo?: boolean;
  artist?: string; title?: string; album?: string; album_artist?: string; genre?: string; date?: string; year?: string;
  composer?: string; copyright?: string; publisher?: string; track?: string; disc?: string;
  duration?: string; durationFloat?: number; jacket?: string; savedate?: number;
  /** Paroles (LRC ou texte brut), vides si absentes. */
  lyrics?: string;
  /** Comment le serveur sert ce média : fichier brut, remux ou transcodage partiel (cf. planPlayback). */
  playMode?: "direct" | "remux" | "transcode";
  playReason?: string;
};

async function ping(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Vrai si le serveur local répond et, quand le serveur en ligne est distinct, si lui aussi répond. */
export async function isServerUp(): Promise<boolean> {
  if (!(await ping(LOCAL_BASE))) {
    // Port réglé mais occupé : le serveur est revenu au port par défaut et a effacé le réglage (cf. server/index.mjs). On fait de même ici.
    if (!import.meta.env.VITE_API_BASE && LOCAL_PORT !== DEFAULT_LOCAL_PORT && (await ping(`http://127.0.0.1:${DEFAULT_LOCAL_PORT}`))) {
      setLocalPort(0);
      location.reload();
    }
    return false;
  }
  return ONLINE_BASE === LOCAL_BASE || ping(ONLINE_BASE);
}

async function getJson<T>(path: string, params?: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  const r = await fetch(`${baseFor(path)}${path}${qs}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function connect(username: string, password: string): Promise<SessionUser | null> {
  const r = await fetch(`${ONLINE_BASE}/connect/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, usermail: username, password }),
  });
  const data = await r.json();
  return data.connected ? (data.user as SessionUser) : null;
}

/** Flux d'un fichier local converti à la volée par le serveur (conteneur ou codec que la webview ne lit pas). */
export const localPlayUrl = (path: string) => `${LOCAL_BASE}/local/play?path=${encodeURIComponent(path)}`;

/** `audioLangs` : une entrée par piste audio d'une vidéo (code de langue, "" si inconnu) ; absent avec un ancien serveur. */
export type LocalProbe = { playMode: "direct" | "remux" | "transcode"; playReason: string; duration: number; isVideo: boolean; audioLangs?: string[] };
/** Demande au serveur comment lire un fichier local ; null si le serveur est injoignable (on garde alors la lecture directe). */
export async function probeLocal(path: string): Promise<LocalProbe | null> {
  // IMPORTANT : au démarrage à froid, le serveur peut ne pas encore répondre, ou ne pas avoir fini de détecter ffmpeg
  // ("no-ffmpeg" : repli provisoire sur la lecture directe). On réessaie brièvement au lieu de conclure "non pris en charge".
  let last: LocalProbe | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${LOCAL_BASE}/local/probe?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) {
        last = (await r.json()) as LocalProbe;
        if (last.playReason !== "no-ffmpeg") return last;
      }
    } catch { /* serveur pas encore prêt */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return last;
}

export const playUrl = (id: string) => `${ONLINE_BASE}/media/play?id=${encodeURIComponent(id)}`;

/** Mes médias, par type (`music` ou `video`). */
export const listOwn = (type: "music" | "video", userid: string, signal?: AbortSignal) =>
  getJson<{ count: number; list: ServerMedia[] }>(`/media/${type}/list`, { userid }, signal);

/** Catalogue complet paginé (suggestions). */
export const listAll = (userid: string, count: number, offset: number, signal?: AbortSignal) =>
  getJson<{ list: ServerMedia[] }>("/media/all/list", { userid, count, offset }, signal);

export const listNews = (userid: string, signal?: AbortSignal) => getJson<{ list: ServerMedia[] }>("/media/news", { userid }, signal);

export async function searchMedia(text: string, skip: number, signal?: AbortSignal): Promise<ServerMedia[]> {
  const r = await fetch(`${ONLINE_BASE}/media/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search: { text, skip } }),
    signal,
  });
  const data = await r.json();
  return data.ok ? (data.media as ServerMedia[]) : [];
}

const metaCache = new Map<string, Promise<ServerMediaMeta | null>>();

/** Métadonnées avec cache : une carte visible puis réaffichée ne redemande pas la pochette. */
export function getMeta(id: string): Promise<ServerMediaMeta | null> {
  let hit = metaCache.get(id);
  if (!hit) {
    hit = getJson<{ found: boolean; key: ServerMediaMeta }>("/media/all/list/metadata", { id })
      .then((d) => (d.found ? d.key : null))
      .catch(() => { metaCache.delete(id); return null; });
    metaCache.set(id, hit);
  }
  return hit;
}

export async function deleteMedia(id: string): Promise<boolean> {
  const r = await fetch(`${ONLINE_BASE}/media/all/delete`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  metaCache.delete(id);
  return ((await r.json()) as { deleted: boolean }).deleted;
}

export type UploadFields = {
  userid: string; media: File; artist: string; title: string; genre: string; date: string;
  album?: string; disc?: string; track?: string; composer?: string; copyright?: string; publisher?: string; jacket?: File | null;
  /** Fichier de paroles (.lrc ou .txt). */
  lyrics?: File | null;
};

/** Téléversement avec progression (XHR : fetch ne sait pas suivre l'envoi). */
export function uploadMedia(fields: UploadFields, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<{ id?: string; notsupported?: boolean; message?: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || v === "") continue;
      form.append(k, v as string | Blob);
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${ONLINE_BASE}/media/upload`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Réponse invalide")); } };
    xhr.onerror = () => reject(new Error("network"));
    signal?.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("aborted", "AbortError")); });
    xhr.send(form);
  });
}

/** Prépare un téléchargement : retourne le jeton opaque et le nom du fichier. */
export async function prepareDownload(id: string): Promise<{ token: string; name: string; size: number } | null> {
  const d = await getJson<{ found: boolean; file?: { path: string; name: string; size: number } }>("/media/download/prepare", { id });
  return d.found && d.file ? { token: d.file.path, name: d.file.name, size: d.file.size } : null;
}

export const downloadUrl = (token: string) => `${ONLINE_BASE}/media/download?token=${encodeURIComponent(token)}`;

export type RegisterFields = { username: string; password: string; name: string; surname: string; age: string; mail: string; newsletter: boolean; avatar: File | null };
/** Codes d'erreur renvoyés par le serveur (cf. validateRegistration dans server/index.mjs). */
export type RegisterError = "username" | "password" | "name" | "surname" | "age" | "mail" | "usernameTaken" | "mailTaken" | "avatarTooBig";

export async function registerAccount(f: RegisterFields): Promise<{ user?: Account; error?: RegisterError }> {
  const form = new FormData();
  form.append("username", f.username); form.append("password", f.password); form.append("name", f.name);
  form.append("surname", f.surname); form.append("age", f.age); form.append("mail", f.mail); form.append("newsletter", String(f.newsletter));
  if (f.avatar) form.append("avatar", f.avatar);
  const r = await fetch(`${ONLINE_BASE}/register`, { method: "POST", body: form });
  const data = (await r.json()) as { registered: boolean; user?: Account; error?: RegisterError };
  return data.registered ? { user: data.user } : { error: data.error };
}

export async function getAccount(id: string): Promise<Account | null> {
  const d = await getJson<{ found: boolean; user?: Account }>("/account/detail", { id });
  return d.found ? d.user ?? null : null;
}

export async function changePassword(id: string, current: string, next: string): Promise<{ changed: boolean; error?: "wrong" | "weak" | "notfound" }> {
  const r = await fetch(`${ONLINE_BASE}/account/password`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, current, next }) });
  return (await r.json()) as { changed: boolean; error?: "wrong" | "weak" | "notfound" };
}

export type ProfileFields = { name: string; surname: string; age: string; bio: string; city: string; country: string; newsletter: boolean };
export type ProfileError = "name" | "surname" | "age" | "notfound";

/** Met à jour la fiche du compte ; renvoie la fiche à jour (à répercuter sur la session). */
export async function updateProfile(id: string, f: ProfileFields): Promise<{ user?: Account; error?: ProfileError }> {
  const r = await fetch(`${ONLINE_BASE}/account/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...f }) });
  const d = (await r.json()) as { saved: boolean; user?: Account; error?: ProfileError };
  return d.saved ? { user: d.user } : { error: d.error };
}

export type PhotoError = "type" | "tooBig" | "notfound";

export async function uploadPhoto(id: string, file: File): Promise<{ user?: Account; error?: PhotoError }> {
  const form = new FormData();
  form.append("id", id); form.append("avatar", file);
  const r = await fetch(`${ONLINE_BASE}/account/photo`, { method: "POST", body: form });
  if (r.status === 413) return { error: "tooBig" };
  const d = (await r.json()) as { saved: boolean; user?: Account; error?: PhotoError };
  return d.saved ? { user: d.user } : { error: d.error };
}

export async function removePhoto(id: string): Promise<Account | null> {
  const r = await fetch(`${ONLINE_BASE}/account/photo`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  const d = (await r.json()) as { saved: boolean; user?: Account };
  return d.saved ? d.user ?? null : null;
}

export type OAuthProvider = "google" | "github";
export const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "github"];
export type OAuthProviderInfo = { configured: boolean; redirectUri: string };
export type OAuthLink = { provider: OAuthProvider; label: string; email: string; linkedAt: number };
export type OAuthError = "denied" | "exchange" | "alreadyLinked" | "expired" | "notLinked";

export const getOAuthProviders = () => getJson<Record<OAuthProvider, OAuthProviderInfo>>("/oauth/providers");
export const getOAuthLinks = (id: string) => getJson<{ links: OAuthLink[] }>("/account/oauth", { id }).then((d) => d.links);

/** Ouvre la page de consentement dans le navigateur système ; `state` sert ensuite à suivre le résultat. */
export async function startOAuth(provider: OAuthProvider, id: string): Promise<{ state?: string; url?: string; error?: "notConfigured" | "busy" | "notfound" }> {
  const r = await fetch(`${ONLINE_BASE}/oauth/${provider}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  const d = (await r.json()) as { started: boolean; state?: string; url?: string; error?: "notConfigured" | "busy" | "notfound" };
  return d.started ? { state: d.state, url: d.url } : { error: d.error };
}

export const getOAuthStatus = (state: string) => getJson<{ status: "pending" | "done" | "error" | "expired"; error?: OAuthError; user?: Account }>("/oauth/status", { state });

export async function unlinkOAuth(provider: OAuthProvider, id: string): Promise<boolean> {
  const r = await fetch(`${ONLINE_BASE}/account/oauth/${provider}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  return ((await r.json()) as { unlinked: boolean }).unlinked;
}

/** Réglages du serveur local (cf. server/settings-schema.mjs : mêmes clés, mêmes défauts, mêmes bornes). */
export type EditableSettings = {
  ffmpeg: string;
  // Transcodage
  videoSize: string; videoAspect: string; playPolicy: "auto" | "encode"; encoder: string;
  /** kbit/s ; 0 = débit propre à l'encodeur. */
  videoBitrate: number;
  x264Preset: string; x264Crf: number; audioBitrate: number; audioChannels: "2" | "source"; gop: number;
  /** Index de la piste audio (0 = première). */
  audioTrack: number;
  /** Langue audio préférée (ISO 639-2, ex. "fra") ; "" = aucune. Prioritaire sur l'index quand le fichier la propose. */
  audioLang: string;
  deinterlace: boolean; hwaccel: boolean;
  // Performance
  /** 0 = automatique. */
  threads: number; priority: "normal" | "belowNormal" | "low";
  /** 0 = illimité. */
  maxStreams: number; extraArgs: string;
  // Bibliothèque et tags
  id3v2: "3" | "4"; tagBackup: boolean;
  // Serveur
  logLevel: "quiet" | "error" | "warning" | "info"; probeTimeout: number; tagTimeout: number;
  /** 0 = port par défaut ; pris en compte au prochain lancement. */
  port: number;
};
export type ServerSettings = EditableSettings & {
  dataDir: string; logFile: string;
  /** Port réellement écouté, et vrai si l'environnement (ZARAO_PORT) l'impose. */
  activePort: number; portLocked: boolean;
};
export type BinaryCheck = { ok: boolean; version?: string; error?: "name" | "missing" | "run" | "notffmpeg" };

export const getSettings = () => getJson<ServerSettings>("/settings");

/** Ce que le ffmpeg configuré sait faire : AAC et encodeurs H.264 réellement utilisables. */
export type FfmpegCapabilities = { ffmpeg: boolean; aac: boolean; h264Encoders: string[]; unusable: string[] };
export const getCapabilities = () => getJson<FfmpegCapabilities>("/settings/capabilities");

export async function testBinary(path: string): Promise<BinaryCheck> {
  const r = await fetch(`${LOCAL_BASE}/settings/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  return (await r.json()) as BinaryCheck;
}

export async function detectBinaries(): Promise<{ ffmpeg: string }> {
  const r = await fetch(`${LOCAL_BASE}/settings/detect`, { method: "POST" });
  return (await r.json()) as { ffmpeg: string };
}

/** Le formulaire envoie tout en texte (le serveur valide et convertit ; vide = défaut). */
export async function saveSettings(s: Record<string, string>): Promise<{ saved: boolean; field?: keyof EditableSettings; error?: string }> {
  const r = await fetch(`${LOCAL_BASE}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
  return (await r.json()) as { saved: boolean; field?: keyof EditableSettings; error?: string };
}

/** Vide les fichiers temporaires et les états mémorisés du serveur (sondes, ffmpeg, encodeurs écartés). */
export async function clearServerCache(): Promise<{ removed: number; bytes: number }> {
  const r = await fetch(`${LOCAL_BASE}/settings/clear-cache`, { method: "POST" });
  return (await r.json()) as { removed: number; bytes: number };
}

/** Oublie les métadonnées en cache d'un média (après modification). */
export const invalidateMeta = (id: string) => { metaCache.delete(id); };

export type TagWriteResult = { saved: boolean; path?: string; error?: string; detail?: string };

/** Écrit les tags d'un fichier local (FFmpeg côté serveur). `jacket` : undefined = conserver, null = retirer, data URL = remplacer. */
export async function writeLocalTags(body: { path: string; tags: Record<string, string>; jacket?: string | null; id3v1?: boolean; newName?: string; lyrics?: string }): Promise<TagWriteResult> {
  const r = await fetch(`${LOCAL_BASE}/tags/write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()) as TagWriteResult;
}

/** Met à jour les métadonnées d'un média en ligne de l'utilisateur. */
export async function updateOnlineMeta(body: { id: string; userid: string; tags: Record<string, string>; jacket?: string | null; lyrics?: string | null }): Promise<{ updated: boolean; error?: string }> {
  const r = await fetch(`${ONLINE_BASE}/media/all/update`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const res = (await r.json()) as { updated: boolean; error?: string };
  if (res.updated) invalidateMeta(body.id);
  return res;
}

// ---------- Playlists ----------
export type Playlist = { id: string; name: string; created: number; count: number; coverIds: string[] };
export type PlaylistResult = { ok: boolean; error?: "notfound" | "forbidden" | "name" | "limit" };

async function sendJson<T>(method: string, path: string, body: unknown): Promise<T> {
  const r = await fetch(`${baseFor(path)}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()) as T;
}

export const listPlaylists = (userid: string) => getJson<{ list: Playlist[] }>("/playlists", { userid });
export const createPlaylist = (userid: string, name: string) => sendJson<PlaylistResult & { id?: string }>("POST", "/playlists", { userid, name });
export const renamePlaylist = (id: string, userid: string, name: string) => sendJson<PlaylistResult>("PUT", `/playlists/${encodeURIComponent(id)}`, { userid, name });
export const deletePlaylist = (id: string, userid: string) => sendJson<PlaylistResult>("DELETE", `/playlists/${encodeURIComponent(id)}`, { userid });
export const getPlaylist = (id: string, userid: string) =>
  getJson<PlaylistResult & { playlist?: { id: string; name: string; created: number }; items?: ServerMedia[] }>(`/playlists/${encodeURIComponent(id)}`, { userid });
export const addToPlaylist = (id: string, userid: string, mediaIds: string[]) => sendJson<PlaylistResult & { added?: number }>("POST", `/playlists/${encodeURIComponent(id)}/items`, { userid, mediaIds });
export const removeFromPlaylist = (id: string, userid: string, mediaId: string) => sendJson<PlaylistResult>("DELETE", `/playlists/${encodeURIComponent(id)}/items`, { userid, mediaId });
export const reorderPlaylist = (id: string, userid: string, mediaIds: string[]) => sendJson<PlaylistResult>("PUT", `/playlists/${encodeURIComponent(id)}/order`, { userid, mediaIds });

// ---------- Réactions, commentaires, vues ----------
export type Reaction = "like" | "dislike";
export type Social = { like: number; dislike: number; mine: Reaction | null; views: number; streamSeconds: number; comments: number };
export type WeeklyStat = { week: string; views: number; seconds: number };
export type CommentItem = { id: string; userid: string; text: string; created: number; author: { username: string; name: string; surname: string; hasAvatar: boolean } };

export const getSocial = (mediaId: string, userid: string) => getJson<{ ok: boolean } & Social>(`/media/${encodeURIComponent(mediaId)}/social`, { userid });

/** `kind` null = retirer sa réaction. Retourne les compteurs à jour. */
export const reactToMedia = (mediaId: string, userid: string, kind: Reaction | null) =>
  sendJson<{ ok: boolean; error?: string } & Social>("PUT", `/media/${encodeURIComponent(mediaId)}/reaction`, { userid, kind });

export const getStats = (mediaId: string) => getJson<{ ok: boolean; views: number; streamSeconds: number; weekly: WeeklyStat[] }>(`/media/${encodeURIComponent(mediaId)}/stats`);
export const getComments = (mediaId: string, offset = 0, limit = 20) =>
  getJson<{ ok: boolean; total: number; list: CommentItem[] }>(`/media/${encodeURIComponent(mediaId)}/comments`, { offset, limit });
export const postComment = (mediaId: string, userid: string, text: string) =>
  sendJson<{ ok: boolean; error?: "short" | "long" | "notfound" | "forbidden"; comment?: CommentItem }>("POST", `/media/${encodeURIComponent(mediaId)}/comments`, { userid, text });
export const deleteComment = (mediaId: string, commentId: string, userid: string) =>
  sendJson<{ ok: boolean; error?: string }>("DELETE", `/media/${encodeURIComponent(mediaId)}/comments/${encodeURIComponent(commentId)}`, { userid });

export const avatarUrl = (userid: string) => `${ONLINE_BASE}/users/${encodeURIComponent(userid)}/avatar`;

/**
 * Enregistre une session d'écoute. `keepalive` : la requête part même si la page se ferme juste après.
 * Silencieux en cas d'échec : une statistique perdue ne doit jamais gêner la lecture.
 */
export function sendView(mediaId: string, userid: string, duration: number): void {
  void fetch(`${ONLINE_BASE}/media/${encodeURIComponent(mediaId)}/view`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userid, duration }), keepalive: true,
  }).catch(() => undefined);
}
