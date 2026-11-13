/**
 * Backend local de Zarao (Express + SQLite + bcrypt), lancé par Tauri comme process annexe.
 *
 * IMPORTANT : lié à 127.0.0.1 uniquement. ffmpeg est un binaire externe appelé à la demande
 * (seek, transcodage, écriture de tags) ; son chemin vient des réglages ou de la variable ZARAO_FFMPEG.
 * ffprobe n'est PAS utilisé : durée et codecs sont lus par music-metadata (cf. probeMedia), ce qui évite
 * d'embarquer un second exécutable de plusieurs dizaines de Mo.
 * Codes de sortie : 0 arrêt volontaire (SIGINT/SIGTERM), 4 erreur inattendue.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import { parseFile } from "music-metadata";
import { writeMp3Lyrics } from "./id3-lyrics.mjs";
import { availableVideoEncoders, buildPlayArgs, buildTagArgs, parseEncoderList } from "./ffmpeg-args.mjs";
import { SETTING_DEFS, audioLangMatches, parseSetting, sanitizeExtraArgs, validateSettingInput } from "./settings-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// IMPORTANT : ZARAO_ROLE sépare les deux serveurs. "local" = fichiers du disque, ffmpeg, réglages (lancé par Tauri, 127.0.0.1) ;
// "online" = comptes, catalogue, playlists, social (déployable sur un vrai serveur) ; "all" (défaut) = les deux dans un seul process.
const ROLE = ["local", "online"].includes(process.env.ZARAO_ROLE ?? "") ? process.env.ZARAO_ROLE : "all";
const DEFAULT_PORT = ROLE === "online" ? 4001 : 4000;
// ZARAO_PORT (environnement) l'emporte sur le réglage des Paramètres, qui l'emporte sur le port par défaut.
const ENV_PORT = Number(process.env.ZARAO_PORT) || 0;
// 127.0.0.1 par défaut. Un serveur en ligne derrière un reverse proxy (HTTPS) passe ZARAO_HOST=0.0.0.0 (ou l'IP privée).
const HOST = process.env.ZARAO_HOST || "127.0.0.1";
// Données séparées par rôle : un serveur local et un serveur en ligne sur la même machine ne doivent pas partager zarao.db.
const DATA_DIR = process.env.ZARAO_DATA_DIR || path.join(os.homedir(), ROLE === "online" ? "zarao-online-data" : "zarao-data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const TMP_DIR = path.join(DATA_DIR, "tmp");
// Doit couvrir les extensions vidéo proposées par l'interface : une extension absente ici classait le fichier en "audio".
const VIDEO_EXTENSIONS = ["mp4", "mkv", "webm", "avi", "mov", "m4v", "mpg", "mpeg", "ts", "m2ts", "ogv", "wmv", "flv", "3gp"];

// Lus à chaque appel : l'utilisateur peut les changer sans redémarrer le serveur.
// Les réglages (table `settings`) priment sur l'environnement : l'utilisateur les change depuis l'interface, sans redémarrage.
const getFfmpegPath = () => getSetting("ffmpeg") || process.env.ZARAO_FFMPEG || "ffmpeg";

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// ---- Journal ----
// IMPORTANT : fichier texte dans le dossier de données (ouvrable depuis les Paramètres). Au-delà de 1 Mo on ne garde que la fin :
// un journal ne doit jamais grossir sans limite sur la machine de l'utilisateur.
const LOG_FILE = path.join(DATA_DIR, "zarao-server.log");
const LOG_MAX_BYTES = 1024 * 1024;
try { if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE).subarray(-LOG_MAX_BYTES / 4)); } catch { /* pas encore de journal */ }
/** Écrit dans la console ET dans le fichier ; une erreur d'écriture du journal ne doit jamais gêner le serveur. */
function logLine(level, ...parts) {
	const text = parts.map((p) => (p instanceof Error ? p.stack ?? p.message : String(p))).join(" ");
	(level === "error" ? console.error : console.log)(text);
	try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${text}\n`); } catch { /* disque plein, fichier verrouillé… */ }
}

const db = new Database(path.join(DATA_DIR, "zarao.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// IMPORTANT : JSON dans la colonne `data`, seules les clés filtrées/triées sont des colonnes
// (cf. conventions du projet) — évite une migration à chaque nouveau tag.
db.exec(`
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, usermail TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}'
	);
	CREATE TABLE IF NOT EXISTS medias (
		id TEXT PRIMARY KEY, userid TEXT NOT NULL, is_video INTEGER NOT NULL DEFAULT 0,
		savedate INTEGER NOT NULL, path TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}'
	);
	CREATE INDEX IF NOT EXISTS idx_medias_user ON medias(userid, is_video, savedate DESC);
	CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, userid TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL);
	CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(userid, created DESC);
	CREATE TABLE IF NOT EXISTS playlist_items (
		playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
		media_id TEXT NOT NULL, position INTEGER NOT NULL,
		PRIMARY KEY (playlist_id, media_id)
	);
	CREATE INDEX IF NOT EXISTS idx_playlist_items_media ON playlist_items(media_id);
	-- Réactions : au plus une par utilisateur et par média ("like" ou "dislike" s'excluent).
	CREATE TABLE IF NOT EXISTS reactions (
		media_id TEXT NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
		userid TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('like', 'dislike')), created INTEGER NOT NULL,
		PRIMARY KEY (media_id, userid)
	);
	CREATE TABLE IF NOT EXISTS comments (
		id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
		userid TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_comments_media ON comments(media_id, created DESC);
	-- Une ligne par session d'écoute (durée réellement écoutée, en secondes).
	CREATE TABLE IF NOT EXISTS views (
		id INTEGER PRIMARY KEY AUTOINCREMENT, media_id TEXT NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
		userid TEXT NOT NULL, duration REAL NOT NULL, ts INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_views_media ON views(media_id, ts);
`);

const stmt = {
	userByLogin: db.prepare("SELECT * FROM users WHERE username = ? OR usermail = ?"),
	userInsert: db.prepare("INSERT INTO users (id, username, usermail, password, data) VALUES (?, ?, ?, ?, ?)"),
	userCount: db.prepare("SELECT COUNT(*) AS n FROM users"),
	userById: db.prepare("SELECT * FROM users WHERE id = ?"),
	userByName: db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE"),
	userByMail: db.prepare("SELECT id FROM users WHERE usermail = ? COLLATE NOCASE"),
	userSetPassword: db.prepare("UPDATE users SET password = ? WHERE id = ?"),
	mediaInsert: db.prepare("INSERT INTO medias (id, userid, is_video, savedate, path, data) VALUES (?, ?, ?, ?, ?, ?)"),
	mediaById: db.prepare("SELECT * FROM medias WHERE id = ?"),
	mediaDelete: db.prepare("DELETE FROM medias WHERE id = ?"),
	mediaSetData: db.prepare("UPDATE medias SET data = ? WHERE id = ?"),
	reactionSet: db.prepare("INSERT INTO reactions (media_id, userid, kind, created) VALUES (?, ?, ?, ?) ON CONFLICT(media_id, userid) DO UPDATE SET kind = excluded.kind, created = excluded.created"),
	reactionDelete: db.prepare("DELETE FROM reactions WHERE media_id = ? AND userid = ?"),
	reactionCounts: db.prepare("SELECT kind, COUNT(*) AS n FROM reactions WHERE media_id = ? GROUP BY kind"),
	reactionMine: db.prepare("SELECT kind FROM reactions WHERE media_id = ? AND userid = ?"),
	commentInsert: db.prepare("INSERT INTO comments (id, media_id, userid, text, created) VALUES (?, ?, ?, ?, ?)"),
	commentById: db.prepare("SELECT * FROM comments WHERE id = ?"),
	commentDelete: db.prepare("DELETE FROM comments WHERE id = ?"),
	commentCount: db.prepare("SELECT COUNT(*) AS n FROM comments WHERE media_id = ?"),
	commentList: db.prepare("SELECT c.id, c.userid, c.text, c.created, u.username, u.data AS udata FROM comments c LEFT JOIN users u ON u.id = c.userid WHERE c.media_id = ? ORDER BY c.created DESC LIMIT ? OFFSET ?"),
	viewInsert: db.prepare("INSERT INTO views (media_id, userid, duration, ts) VALUES (?, ?, ?, ?)"),
	viewTotals: db.prepare("SELECT COUNT(*) AS views, COALESCE(SUM(duration), 0) AS seconds FROM views WHERE media_id = ?"),
	viewWeekly: db.prepare("SELECT strftime('%Y-%W', ts / 1000, 'unixepoch') AS week, COUNT(*) AS views, SUM(duration) AS seconds FROM views WHERE media_id = ? GROUP BY week ORDER BY week DESC LIMIT 26"),
	plByUser: db.prepare("SELECT p.id, p.name, p.created, (SELECT COUNT(*) FROM playlist_items i JOIN medias m ON m.id = i.media_id WHERE i.playlist_id = p.id) AS count FROM playlists p WHERE p.userid = ? ORDER BY p.created DESC"),
	plById: db.prepare("SELECT * FROM playlists WHERE id = ?"),
	plCountByUser: db.prepare("SELECT COUNT(*) AS n FROM playlists WHERE userid = ?"),
	plInsert: db.prepare("INSERT INTO playlists (id, userid, name, created) VALUES (?, ?, ?, ?)"),
	plRename: db.prepare("UPDATE playlists SET name = ? WHERE id = ?"),
	plDelete: db.prepare("DELETE FROM playlists WHERE id = ?"),
	// Jointure sur medias : un média supprimé disparaît de la playlist même si son entrée traînait.
	plItems: db.prepare("SELECT m.* FROM playlist_items i JOIN medias m ON m.id = i.media_id WHERE i.playlist_id = ? ORDER BY i.position"),
	plCovers: db.prepare("SELECT i.media_id FROM playlist_items i JOIN medias m ON m.id = i.media_id WHERE i.playlist_id = ? ORDER BY i.position LIMIT 4"),
	plItemCount: db.prepare("SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?"),
	plMaxPos: db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM playlist_items WHERE playlist_id = ?"),
	plItemInsert: db.prepare("INSERT OR IGNORE INTO playlist_items (playlist_id, media_id, position) VALUES (?, ?, ?)"),
	plItemDelete: db.prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND media_id = ?"),
	plItemSetPos: db.prepare("UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND media_id = ?"),
	mediaByUser: db.prepare("SELECT * FROM medias WHERE userid = ? AND is_video = ? ORDER BY savedate DESC"),
	mediaPage: db.prepare("SELECT * FROM medias ORDER BY savedate DESC LIMIT ? OFFSET ?"),
	mediaAll: db.prepare("SELECT * FROM medias ORDER BY savedate DESC"),
};

const settingGet = db.prepare("SELECT value FROM settings WHERE key = ?");
const settingSet = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
/** Lecture d'un réglage texte ("" si absent). Appelée à chaque transcodage : prepared statement, coût négligeable. */
function getSetting(key) {
	return settingGet.get(key)?.value ?? "";
}
/** Réglage typé (nombre, booléen…) ; le défaut du schéma s'applique tant que rien n'est enregistré. */
const cfg = (key) => parseSetting(key, getSetting(key));
/** Port d'écoute : lu une fois au démarrage (le changer dans les Paramètres demande de relancer l'application). */
const CONFIGURED_PORT = cfg("port");
const SERVER_PORT = ENV_PORT || CONFIGURED_PORT || DEFAULT_PORT;
let activePort = SERVER_PORT;
/** Réglages d'encodage passés à buildPlayArgs (cf. DEFAULT_PLAY_OPTS). */
function playOpts() {
	const extra = sanitizeExtraArgs(getSetting("extraArgs"));
	return {
		x264Preset: cfg("x264Preset"), x264Crf: cfg("x264Crf"), videoBitrate: cfg("videoBitrate"), audioBitrate: cfg("audioBitrate"),
		audioChannels: cfg("audioChannels"), gop: cfg("gop"), threads: cfg("threads"), hwaccel: cfg("hwaccel"), deinterlace: cfg("deinterlace"),
		audioTrack: cfg("audioTrack"), logLevel: cfg("logLevel"), extraArgs: extra.ok ? extra.args : [],
	};
}

/** Reconstitue l'objet média plat attendu par le front (`_id` conservé pour compat). */
const hydrate = (row) => row && { ...JSON.parse(row.data), _id: row.id, id: row.id, userid: row.userid, savedate: row.savedate, path: row.path, isVideo: Boolean(row.is_video) };
const toListItem = (row) => {
	const m = hydrate(row);
	return { _id: m.id, fileid: m.id, artist: m.artist, title: m.title, duration: m.duration, size: m.size };
};

// Types de pistes de music-metadata (TrackType) : 1 = vidéo, 2 = audio.
const TRACK_VIDEO = 1;
const TRACK_AUDIO = 2;

/** Repli pour les conteneurs que music-metadata ne lit pas (AVI, MPG, TS) : analyse de la sortie de `ffmpeg -i`. */
function probeWithFfmpeg(file) {
	return new Promise((resolve) => {
		const empty = { duration: 0, hasVideo: false, container: "", video: "", audio: "", via: "none", pixfmt: "", audioLangs: [] };
		let err = "";
		const proc = spawn(getFfmpegPath(), ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
		const timer = setTimeout(() => proc.kill("SIGKILL"), cfg("probeTimeout") * 1000);
		proc.stderr.on("data", (d) => { err = (err + d).slice(-8000); });
		// Sans fichier de sortie, ffmpeg se termine en erreur : c'est normal, seule la sortie d'information compte.
		proc.on("error", () => { clearTimeout(timer); resolve(empty); });
		proc.on("close", () => {
			clearTimeout(timer);
			const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
			const video = /Stream #\d+:\d+[^:]*: Video: ([\w.]+)/.exec(err);
			// Format de pixels de la 1re piste vidéo (ex. yuv420p10le) : un H.264 en 10 bits n'est pas lisible par la webview.
			const videoLine = /Stream #\d+:\d+[^\n]*: Video: [^\n]*/.exec(err)?.[0] ?? "";
			const pixfmt = /\b(yuv[a-z0-9]+|nv\d+[a-z0-9]*|p01\d[a-z0-9]*|gbr[a-z0-9]+|gray[a-z0-9]*)\b/.exec(videoLine.replace(/^[^,]*,/, ""))?.[1] ?? "";
			const audio = /Stream #\d+:\d+[^:]*: Audio: ([\w.]+)/.exec(err);
			// Langue de chaque piste audio, dans l'ordre : « Stream #0:2(fra): Audio: … » (vide si la piste n'est pas étiquetée).
			const audioLangs = [...err.matchAll(/Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([^)]*)\))?[^\n]*?: Audio:/g)].map((m) => (m[1] ?? "").toLowerCase());
			resolve({
				duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, hasVideo: Boolean(video),
				container: /Input #0, ([^,]+)/.exec(err)?.[1] ?? "", video: video?.[1] ?? "", audio: audio?.[1] ?? "", via: "ffmpeg",
				pixfmt, audioLangs,
			});
		});
	});
}

/**
 * Durée, présence de vidéo et codecs d'un média, sans ffprobe.
 * Ordre : music-metadata (MP3, WAV, FLAC, OGG, M4A, MP4, MKV, WebM : rapide, aucun processus), puis ffmpeg si disponible
 * (AVI, MPG, TS…), sinon valeurs vides : la durée réelle sera alors celle que la webview lit à la lecture.
 */
async function probeMedia(file) {
	try {
		const meta = await parseFile(file, { duration: true, skipCovers: true });
		const tracks = meta.format.trackInfo ?? [];
		const video = tracks.find((t) => t.type === TRACK_VIDEO);
		const audio = tracks.find((t) => t.type === TRACK_AUDIO);
		const info = {
			duration: meta.format.duration ?? 0, hasVideo: Boolean(meta.format.hasVideo ?? video), container: meta.format.container ?? "",
			video: video?.codecName ?? "", audio: audio?.codecName ?? meta.format.codec ?? "", via: "metadata", pixfmt: "",
		};
		// music-metadata ne donne pas le format de pixels : pour le H.264 (le seul codec pour lequel il décide de la lecture),
		// on le demande à ffmpeg s'il est disponible.
		if (info.hasVideo && canonVideo(info.video) === "h264" && await ffmpegAvailable()) info.pixfmt = (await probeWithFfmpeg(file)).pixfmt;
		return info;
	}
	catch {
		return probeWithFfmpeg(file);
	}
}
/**
 * Index de la piste audio à servir pour une vidéo : la langue préférée si le fichier la propose, sinon l'index réglé.
 * IMPORTANT : lire les langues demande un `ffmpeg -i` ; le résultat est mémorisé par fichier (chemin + date + taille).
 */
const audioLangCache = new Map();
/** Langues des pistes audio du fichier, dans l'ordre (tableau vide si ffmpeg est absent ou le fichier illisible). */
async function audioLangsOf(file) {
	if (!(await ffmpegAvailable())) return [];
	try {
		const st = fs.statSync(file);
		const key = `${file}|${st.mtimeMs}|${st.size}`;
		let langs = audioLangCache.get(key);
		if (!langs) {
			langs = (await probeWithFfmpeg(file)).audioLangs ?? [];
			if (audioLangCache.size > 500) audioLangCache.clear();
			audioLangCache.set(key, langs);
		}
		return langs;
	} catch { return []; }
}
async function resolveAudioTrack(file) {
	const lang = cfg("audioLang");
	const fallback = cfg("audioTrack");
	if (!lang) return fallback;
	const found = (await audioLangsOf(file)).findIndex((l) => audioLangMatches(lang, l));
	return found >= 0 ? found : fallback;
}

// ---- Décision de lecture : direct, remux ou transcodage partiel ----
// Noms de codecs normalisés : music-metadata ("MPEG4/ISO/AVC", "MPEG 1 Layer 3") et ffmpeg ("h264", "mp3") ne s'écrivent pas pareil.
function canonVideo(name) {
	const n = String(name ?? "").toLowerCase();
	if (!n) return "";
	if (/avc|h\.?264/.test(n)) return "h264"; // avant mpeg4 : "mpeg4/iso/avc" contient les deux
	if (/hevc|h\.?265|mpegh/.test(n)) return "hevc";
	if (/vp9/.test(n)) return "vp9";
	if (/vp8/.test(n)) return "vp8";
	if (/av1|av01/.test(n)) return "av1";
	if (/mpeg-?2|mpeg2/.test(n)) return "mpeg2";
	if (/mpeg-?1/.test(n)) return "mpeg1";
	if (/mpeg-?4|mp4v|xvid|divx/.test(n)) return "mpeg4";
	return n;
}
function canonAudio(name) {
	const n = String(name ?? "").toLowerCase();
	if (!n) return "";
	if (/aac|mp4a/.test(n)) return "aac";
	if (/layer 3|layer3|mp3/.test(n)) return "mp3";
	if (/layer 2|layer2|mp2/.test(n)) return "mp2";
	if (/opus/.test(n)) return "opus";
	if (/vorbis/.test(n)) return "vorbis";
	if (/flac/.test(n)) return "flac";
	if (/pcm|wave/.test(n)) return "pcm";
	if (/e-?ac-?3|eac3/.test(n)) return "eac3";
	if (/ac-?3/.test(n)) return "ac3";
	if (/dts/.test(n)) return "dts";
	if (/wma|wmav/.test(n)) return "wma";
	return n;
}
// Ce que la webview (Chromium) sait lire telle quelle.
const NATIVE_VIDEO = new Set(["h264", "vp8", "vp9", "av1"]);
const NATIVE_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac", "pcm"]);
const NATIVE_EXT = new Set(["mp4", "m4v", "m4a", "webm", "ogg", "oga", "ogv", "opus", "mp3", "wav", "flac", "aac"]);
// Ce qu'on peut copier tel quel dans un MP4 fragmenté (vorbis, pcm et vp8 n'y sont pas acceptés).
const MP4_VIDEO = new Set(["h264", "vp9", "av1"]);
const MP4_AUDIO = new Set(["aac", "mp3", "opus", "flac"]);

// La disponibilité de ffmpeg est mémorisée : 30 s si présent, 2 s seulement si absent.
// IMPORTANT : au tout premier lancement, le 1er `ffmpeg -version` est lent (analyse antivirus de l'exe) et peut dépasser le délai.
// Mémoriser cet échec 30 s faisait basculer toute lecture en "direct" (= média non pris en charge) jusqu'à expiration.
// Les appels simultanés partagent aussi la même sonde au lieu de lancer plusieurs ffmpeg froids.
let ffmpegState = { at: 0, ok: false, path: "" };
let ffmpegInflight = null;
async function ffmpegAvailable() {
	const path_ = getFfmpegPath();
	if (ffmpegState.path === path_ && Date.now() - ffmpegState.at < (ffmpegState.ok ? 30_000 : 2_000)) return ffmpegState.ok;
	if (ffmpegInflight?.path === path_) return ffmpegInflight.promise;
	const promise = probeBinary(path_, "ffmpeg", ffmpegState.at === 0 ? 25_000 : 8000).then((r) => {
		ffmpegState = { at: Date.now(), ok: r.ok, path: path_ };
		return r.ok;
	}).finally(() => { ffmpegInflight = null; });
	ffmpegInflight = { path: path_, promise };
	return promise;
}

// ---- Capacités d'ffmpeg : quels encodeurs H.264 sont réellement utilisables ----
// Le serveur doit marcher avec un ffmpeg minimal et libre (sans libx264) : on lit ce que le binaire possède.
let encoderCache = { path: "", names: new Set() };
let encoderInflight = null;
async function ffmpegEncoderNames() {
	const bin = getFfmpegPath();
	if (encoderCache.path === bin && encoderCache.names.size > 0) return encoderCache.names;
	if (encoderInflight?.bin === bin) return encoderInflight.promise;
	const promise = new Promise((resolve) => {
		execFile(bin, ["-hide_banner", "-encoders"], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? new Set() : parseEncoderList(stdout)));
	}).then((names) => { encoderCache = { path: bin, names }; return names; }).finally(() => { encoderInflight = null; });
	encoderInflight = { bin, promise };
	return promise;
}

// Un encodeur listé peut échouer à l'exécution (NVENC sans pilote compatible, AMF sans DLL) : après un échec on le met de côté 10 min.
const deadEncoders = new Map();
async function h264Candidates() {
	const now = Date.now();
	let list = availableVideoEncoders(await ffmpegEncoderNames());
	// ZARAO_VIDEO_ENCODERS="h264_mf,libx264" impose l'ordre (et la liste) des encodeurs : utile pour écarter un encodeur matériel
	// qui se comporte mal, ou pour tester le repli.
	const forced = (process.env.ZARAO_VIDEO_ENCODERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
	if (forced.length) list = forced.map((name) => list.find((e) => e.name === name)).filter(Boolean);
	list = list.filter((e) => (deadEncoders.get(e.name) ?? 0) < now);
	// Encodeur préféré des Paramètres : essayé en premier, les autres restent en repli s'il échoue. Absent ou écarté : sans effet.
	const preferred = getSetting("encoder");
	const first = preferred && list.find((e) => e.name === preferred);
	return first ? [first, ...list.filter((e) => e !== first)] : list;
}

/**
 * Lance ffmpeg et écrit sa sortie dans la réponse. Résout avec `started` : vrai dès qu'un octet a été envoyé.
 * Tant que `started` est faux, l'appelant peut réessayer avec un autre encodeur sans que le client ait rien reçu.
 */
const activeFfmpeg = new Set(); // suivis pour être tués à l'arrêt du serveur (cf. shutdown)
const PRIORITIES = { belowNormal: os.constants.priority.PRIORITY_BELOW_NORMAL, low: os.constants.priority.PRIORITY_LOW };
function streamFfmpeg(args, res) {
	return new Promise((resolve) => {
		// Nombre maximal de flux simultanés : au-delà, le plus ancien est interrompu (c'est presque toujours une lecture abandonnée).
		const max = cfg("maxStreams");
		while (max > 0 && activeFfmpeg.size >= max) {
			const oldest = activeFfmpeg.values().next().value;
			activeFfmpeg.delete(oldest);
			try { oldest.kill("SIGKILL"); } catch { /* déjà terminé */ }
		}
		const proc = spawn(getFfmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
		// Priorité basse : la lecture ne doit pas écraser le reste du poste. Sans effet (silencieux) si le système refuse.
		const priority = PRIORITIES[cfg("priority")];
		if (priority !== undefined && proc.pid) { try { os.setPriority(proc.pid, priority); } catch { /* droits insuffisants */ } }
		activeFfmpeg.add(proc);
		proc.on("close", () => activeFfmpeg.delete(proc));
		let started = false, stderr = "", done = false;
		const finish = () => { if (!done) { done = true; resolve({ started, stderr: stderr.trim() }); } };
		proc.stderr.on("data", (d) => { stderr = (stderr + d).slice(-1500); });
		proc.on("error", () => { stderr = stderr || "ffmpeg introuvable"; finish(); });
		proc.stdout.on("data", (chunk) => {
			started = true;
			// Contre-pression : si le client lit moins vite que ffmpeg n'écrit, on suspend ffmpeg plutôt que de tout mettre en mémoire.
			if (!res.write(chunk)) { proc.stdout.pause(); res.once("drain", () => proc.stdout.resume()); }
		});
		proc.on("close", () => { if (started && !res.writableEnded) res.end(); finish(); });
		// Chaque déplacement côté client coupe la requête précédente : ne pas laisser ffmpeg tourner dans le vide.
		res.on("close", () => { proc.kill("SIGKILL"); });
	});
}

/**
 * Choisit comment servir un média :
 *  - direct    : le fichier tel quel (Range natif, déplacement dans la piste natif) ;
 *  - remux     : codecs compatibles mais conteneur non lisible (MKV, TS…) → copie dans un MP4 fragmenté, presque gratuit ;
 *  - transcode : on ne réencode que ce qui n'est pas lisible (audio AC3 → AAC, vidéo HEVC/MPEG-4/10 bits → H.264).
 * Sans ffmpeg, retour au direct (au mieux) : mieux vaut tenter la lecture que refuser.
 */
async function planPlayback(row) {
	const data = JSON.parse(row.data);
	let codecs = data.codecs;
	if (!codecs) {
		// Média ancien, téléversé avant la mémorisation des codecs : on sonde une fois et on enregistre.
		const probe = await probeMedia(row.path);
		codecs = { container: probe.container, video: probe.video, audio: probe.audio, pixfmt: probe.pixfmt };
		data.codecs = codecs;
		stmt.mediaSetData.run(JSON.stringify(data), row.id);
	}
	// Médias sondés avant la mémorisation du format de pixels : on le complète une fois pour tout H.264 (cf. badPix plus bas).
	if (canonVideo(codecs.video) === "h264" && codecs.pixfmt === undefined && await ffmpegAvailable()) {
		codecs = { ...codecs, pixfmt: (await probeWithFfmpeg(row.path)).pixfmt };
		data.codecs = codecs;
		stmt.mediaSetData.run(JSON.stringify(data), row.id);
	}
	return decidePlayback(row.path, Boolean(row.is_video), codecs);
}

/** Décision pure à partir des codecs sondés : partagée par les médias du serveur et les fichiers locaux (/local/*). */
async function decidePlayback(file, isVideo, codecs) {
	await warmPromise;
	const ext = path.extname(file).slice(1).toLowerCase();
	const v = canonVideo(codecs.video), a = canonAudio(codecs.audio);
	// Une résolution ou un ratio réglés ne peuvent s'appliquer qu'en réencodant la vidéo.
	// La politique « toujours réencoder » s'applique de la même façon (cohérence des flux, ou pour écarter un lecteur capricieux).
	const forceEncode = isVideo && Boolean(v) && Boolean(getSetting("videoSize") || getSetting("videoAspect") || cfg("playPolicy") === "encode");
	// Une autre piste audio que la première ne peut être servie que par ffmpeg (le fichier brut joue toujours la piste par défaut).
	const audioTrack = isVideo && v ? await resolveAudioTrack(file) : 0;
	const forceStream = isVideo && Boolean(v) && audioTrack > 0;
	const nativeContainer = NATIVE_EXT.has(ext) && !/matroska/i.test(codecs.container ?? "");
	// La webview ne décode que le H.264 4:2:0 8 bits ; 10 bits, 4:2:2 et 4:4:4 doivent être réencodés.
	const badPix = v === "h264" && Boolean(codecs.pixfmt) && !/^yuvj?420p$/.test(codecs.pixfmt);
	const videoNative = !v || (NATIVE_VIDEO.has(v) && !badPix);
	const audioNative = !a || NATIVE_AUDIO.has(a);

	let plan;
	if (!forceEncode && !forceStream && nativeContainer && videoNative && audioNative) plan = { mode: "direct", reason: "compatible" };
	else if (!isVideo) plan = { mode: "transcode", video: null, audio: "mp3", reason: `audio:${a || ext}` };
	else if (isVideo && !v && !a) plan = { mode: "direct", reason: "unknown" }; // sonde impossible : on tente la lecture directe
	else {
		const videoCopy = !forceEncode && Boolean(v) && MP4_VIDEO.has(v) && !badPix;
		// Le codec sondé est celui de la 1re piste : pour une autre piste on réencode en AAC, seul résultat garanti lisible.
		const audioCopy = (!a || MP4_AUDIO.has(a)) && audioTrack === 0;
		const why = forceEncode || forceStream ? "settings" : badPix ? `video:${v}-${codecs.pixfmt}` : !videoCopy ? `video:${v}` : !audioCopy ? `audio:${a}` : `container:${ext}`;
		plan = videoCopy && audioCopy ? { mode: "remux", video: "copy", audio: "copy", reason: why } : { mode: "transcode", video: videoCopy ? "copy" : "encode", audio: audioCopy ? "copy" : "encode", reason: why };
	}
	if (plan.mode !== "direct" && !(await ffmpegAvailable())) return { mode: "direct", reason: "no-ffmpeg" };
	// Réencoder la vidéo demande un encodeur H.264 : sans lui, mieux vaut tenter le fichier brut que de produire une erreur.
	if (plan.video === "encode" && (await h264Candidates()).length === 0) return { mode: "direct", reason: "no-h264-encoder" };
	return { ...plan, sourceAudio: a, audioTrack };
}

const formatDuration = (sec) => {
	const s = Math.floor(sec);
	return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((p) => String(p).padStart(2, "0")).join(":");
};

// Aucune route d'inscription dans ce périmètre : compte local par défaut au premier lancement.
if (stmt.userCount.get().n === 0) {
	const password = crypto.randomBytes(6).toString("hex");
	stmt.userInsert.run(crypto.randomUUID(), "local", "local@zarao.local", await bcrypt.hash(password, 10), JSON.stringify({ name: "Utilisateur", surname: "Local", profilphoto: "" }));
	console.log(`[zarao-server] Compte créé -> utilisateur: local | mot de passe: ${password}`);
}

const app = express();
// IMPORTANT : pas de cors() ouvert à tous. Ce serveur écoute sur localhost et expose des réglages exécutables
// (chemin de ffmpeg) : n'importe quel site ouvert dans le navigateur de l'utilisateur pourrait sinon l'appeler.
// On n'autorise que la webview de l'app (Tauri, en dev et en prod).
// ZARAO_EXTRA_ORIGINS (liste séparée par des virgules) : origines supplémentaires pour le développement, ex. un second serveur Vite.
const EXTRA_ORIGINS = (process.env.ZARAO_EXTRA_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set(["http://localhost:1420", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", ...EXTRA_ORIGINS]);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)) }));
app.use(express.json({ limit: "20mb" }));
const upload = multer({ dest: TMP_DIR });
// Avatar : image seule, 2 Mo max, gardée en mémoire (elle est stockée en data URL dans la fiche utilisateur).
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")) });
// Les erreurs async d'Express 4 ne sont pas capturées toutes seules.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// `ready` : le préchauffage (cf. warmUp) est terminé. `ok` suffit pour savoir que le serveur répond.
let serverReady = false;
// Résolue quand le préchauffage est fini : decidePlayback l'attend pour ne jamais conclure "pas de ffmpeg" pendant le démarrage à froid.
let warmPromise = Promise.resolve();
app.get("/health", (_req, res) => res.json({ ok: true, ready: serverReady, role: ROLE }));

// Routes qui lisent/écrivent la machine de l'utilisateur : réservées au serveur local. Le reste appartient au serveur en ligne.
// IMPORTANT : un serveur en ligne ne doit jamais exposer /local, /settings (chemin de ffmpeg exécuté) ni /tags (écriture disque).
const LOCAL_ROUTES = /^\/(local|settings|tags)(\/|$)/;
app.use((req, res, next) => {
	if (ROLE === "all" || (ROLE === "local") === LOCAL_ROUTES.test(req.path)) return next();
	res.sendStatus(404);
});

// ---- Comptes ----
app.post("/connect/account", h(async (req, res) => {
	const { usermail, username, password } = req.body;
	const user = stmt.userByLogin.get(username || "", usermail || "");
	if (!user || !(await bcrypt.compare(password || "", user.password))) return res.json({ connected: false, forbidden: true });
	res.json({ connected: true, user: publicUser(user) });
}));

/** Fiche publique d'un utilisateur : jamais le hash du mot de passe. */
// IMPORTANT : `resume` (positions de lecture, cf. /account/resume) reste côté serveur : la session du client ne doit pas l'embarquer.
const publicUser = (row) => { const { resume: _resume, ...data } = JSON.parse(row.data); return { _id: row.id, username: row.username, usermail: row.usermail, ...data }; };

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[\w.-]{3,32}$/;
const MIN_PASSWORD = 8;

/** Retourne le code du premier champ invalide, ou null. Le front fait la même vérification : celle-ci fait foi. */
function validateRegistration(f) {
	if (!USERNAME_RE.test(f.username)) return "username";
	if (f.password.length < MIN_PASSWORD) return "password";
	if (f.name.length < 2) return "name";
	if (f.surname.length < 2) return "surname";
	const age = Number(f.age);
	if (!Number.isInteger(age) || age < 13 || age > 120) return "age";
	if (!MAIL_RE.test(f.mail) || f.mail.length > 255) return "mail";
	return null;
}

// ---- Inscription ----
// IMPORTANT : l'ancien flux envoyait un mail de confirmation et attendait une validation manuelle (pièce d'identité).
// Un serveur local n'a ni SMTP ni administrateur : le compte est créé et actif immédiatement.
app.post("/register", avatarUpload.single("avatar"), h(async (req, res) => {
	const f = {
		username: String(req.body.username ?? "").trim(), password: String(req.body.password ?? ""),
		name: String(req.body.name ?? "").trim(), surname: String(req.body.surname ?? "").trim(),
		age: String(req.body.age ?? "").trim(), mail: String(req.body.mail ?? "").trim().toLowerCase(),
	};
	const invalid = validateRegistration(f);
	if (invalid) return res.json({ registered: false, error: invalid });
	if (stmt.userByName.get(f.username)) return res.json({ registered: false, error: "usernameTaken" });
	if (stmt.userByMail.get(f.mail)) return res.json({ registered: false, error: "mailTaken" });

	const id = crypto.randomUUID();
	const profilphoto = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` : "";
	stmt.userInsert.run(id, f.username, f.mail, await bcrypt.hash(f.password, 10), JSON.stringify({
		name: f.name, surname: f.surname, age: Number(f.age), profilphoto,
		newsletter: req.body.newsletter === "true", registeredat: Date.now(),
	}));
	res.json({ registered: true, user: publicUser(stmt.userById.get(id)) });
}));

// ---- Compte ----
app.get("/account/detail", (req, res) => {
	const row = stmt.userById.get(String(req.query.id ?? ""));
	res.json(row ? { found: true, user: publicUser(row) } : { found: false });
});

// Pas de code par mail (pas de SMTP) : le mot de passe actuel sert de preuve d'identité.
app.put("/account/password", h(async (req, res) => {
	const { id, current, next } = req.body ?? {};
	const row = stmt.userById.get(String(id ?? ""));
	if (!row) return res.json({ changed: false, error: "notfound" });
	if (typeof next !== "string" || next.length < MIN_PASSWORD) return res.json({ changed: false, error: "weak" });
	if (!(await bcrypt.compare(String(current ?? ""), row.password))) return res.json({ changed: false, error: "wrong" });
	stmt.userSetPassword.run(await bcrypt.hash(next, 10), row.id);
	res.json({ changed: true });
}));

// ---- Profil ----
const userSetData = db.prepare("UPDATE users SET data = ? WHERE id = ?");
const clip = (v, max) => String(v ?? "").trim().slice(0, max);

// ---- Reprise de lecture synchronisée ----
// Position des vidéos en ligne (clé "online:<id>" → { t, at }) rangée dans la fiche du compte : on la retrouve d'un appareil à l'autre.
// `t: 0` est une « pierre tombale » (reprise effacée) : sans elle, une suppression serait annulée par la fusion avec les autres appareils.
// Les chemins de fichiers locaux ne sont jamais synchronisés (propres à chaque machine).
const RESUME_MAX = 200;
app.get("/account/resume", (req, res) => {
	const row = stmt.userById.get(String(req.query.id ?? ""));
	if (!row) return res.json({ found: false });
	res.json({ found: true, entries: JSON.parse(row.data).resume ?? {} });
});
app.put("/account/resume", h(async (req, res) => {
	const row = stmt.userById.get(String(req.body?.id ?? ""));
	if (!row) return res.json({ saved: false });
	const data = JSON.parse(row.data);
	const merged = { ...(data.resume ?? {}) };
	for (const [key, e] of Object.entries(req.body?.entries ?? {})) {
		if (!key.startsWith("online:") || key.length > 200 || !e || !Number.isFinite(e.t) || !Number.isFinite(e.at)) continue;
		if (!merged[key] || merged[key].at < e.at) merged[key] = { t: Math.max(0, Math.floor(e.t)), at: Math.floor(e.at) };
	}
	data.resume = Object.fromEntries(Object.entries(merged).sort((a, b) => b[1].at - a[1].at).slice(0, RESUME_MAX));
	userSetData.run(JSON.stringify(data), row.id);
	res.json({ saved: true, entries: data.resume });
}));

/** Met à jour la fiche (nom, prénom, âge, bio, lieu, newsletter). Le nom d'utilisateur et l'e-mail ne changent pas : ils servent à se connecter. */
app.put("/account/profile", h(async (req, res) => {
	const b = req.body ?? {};
	const row = stmt.userById.get(String(b.id ?? ""));
	if (!row) return res.json({ saved: false, error: "notfound" });
	const name = clip(b.name, 80), surname = clip(b.surname, 80), age = Number(clip(b.age, 4));
	if (name.length < 2) return res.json({ saved: false, error: "name" });
	if (surname.length < 2) return res.json({ saved: false, error: "surname" });
	if (!Number.isInteger(age) || age < 13 || age > 120) return res.json({ saved: false, error: "age" });
	const data = JSON.parse(row.data);
	Object.assign(data, { name, surname, age, bio: clip(b.bio, 500), city: clip(b.city, 80), country: clip(b.country, 80), newsletter: b.newsletter === true });
	userSetData.run(JSON.stringify(data), row.id);
	res.json({ saved: true, user: publicUser(stmt.userById.get(row.id)) });
}));

// IMPORTANT : pas de SVG ici — la photo est stockée en data URL et réaffichée telle quelle.
const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
app.post("/account/photo", avatarUpload.single("avatar"), h(async (req, res) => {
	const row = stmt.userById.get(String(req.body?.id ?? ""));
	if (!row) return res.json({ saved: false, error: "notfound" });
	if (!req.file || !PHOTO_TYPES.has(req.file.mimetype)) return res.json({ saved: false, error: "type" });
	const data = JSON.parse(row.data);
	data.profilphoto = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
	userSetData.run(JSON.stringify(data), row.id);
	res.json({ saved: true, user: publicUser(stmt.userById.get(row.id)) });
}));
app.delete("/account/photo", (req, res) => {
	const row = stmt.userById.get(String(req.body?.id ?? ""));
	if (!row) return res.json({ saved: false, error: "notfound" });
	const data = JSON.parse(row.data);
	data.profilphoto = "";
	userSetData.run(JSON.stringify(data), row.id);
	res.json({ saved: true, user: publicUser(stmt.userById.get(row.id)) });
});

// ---- Comptes reliés (OAuth : Google, GitHub) ----
// IMPORTANT : on ne garde jamais le jeton d'accès du fournisseur. Il ne sert qu'une fois, à lire l'identité
// (identifiant, nom, e-mail) ; seule cette identité est stockée, pour afficher « relié à … » et empêcher
// qu'un même compte Google/GitHub soit relié à deux comptes Zarao.
db.exec(`
	CREATE TABLE IF NOT EXISTS oauth_links (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL,
		provider_user_id TEXT NOT NULL, label TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', linked_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, provider), UNIQUE (provider, provider_user_id)
	);
`);
const oauthStmt = {
	byUser: db.prepare("SELECT provider, label, email, linked_at AS linkedAt FROM oauth_links WHERE user_id = ? ORDER BY linked_at"),
	byIdentity: db.prepare("SELECT user_id FROM oauth_links WHERE provider = ? AND provider_user_id = ?"),
	upsert: db.prepare(`INSERT INTO oauth_links (user_id, provider, provider_user_id, label, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, provider) DO UPDATE SET provider_user_id = excluded.provider_user_id, label = excluded.label, email = excluded.email, linked_at = excluded.linked_at`),
	remove: db.prepare("DELETE FROM oauth_links WHERE user_id = ? AND provider = ?"),
};

const OAUTH_PROVIDERS = {
	google: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", userUrl: "https://openidconnect.googleapis.com/v1/userinfo", scope: "openid email profile", pkce: true },
	github: { authUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", userUrl: "https://api.github.com/user", scope: "read:user user:email", pkce: false },
};
/** URL de retour à déclarer chez le fournisseur ; `localhost` (pas 127.0.0.1) car Google n'accepte que lui pour une adresse http. */
const OAUTH_REDIRECT_BASE = process.env.ZARAO_OAUTH_REDIRECT_BASE || `http://localhost:${SERVER_PORT}`;
const oauthRedirectUri = (provider) => `${OAUTH_REDIRECT_BASE}/oauth/${provider}/callback`;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const OAUTH_MAX_PENDING = 50;
/** state -> { userId, provider, verifier, expires, status: "pending" | "done" | "error", error? }. En mémoire : une connexion en cours ne survit pas à un redémarrage. */
const oauthPending = new Map();

/** Identifiants de l'application chez le fournisseur : variables ZARAO_<FOURNISSEUR>_CLIENT_ID / _CLIENT_SECRET, ou `oauth.json` du dossier de données. */
function oauthCredentials(provider) {
	const up = provider.toUpperCase();
	let fromFile = {};
	try { fromFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "oauth.json"), "utf8"))[provider] ?? {}; } catch { /* fichier absent ou invalide : variables seules */ }
	const clientId = process.env[`ZARAO_${up}_CLIENT_ID`] || fromFile.clientId || "";
	const clientSecret = process.env[`ZARAO_${up}_CLIENT_SECRET`] || fromFile.clientSecret || "";
	return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function sweepOauth() {
	const now = Date.now();
	for (const [state, p] of oauthPending) if (p.expires < now) oauthPending.delete(state);
}

/** Ouvre le navigateur système. L'adresse vient toujours des constantes ci-dessus : jamais d'une saisie de l'utilisateur. */
function openInBrowser(url) {
	// ZARAO_OAUTH_NO_BROWSER=1 : environnement sans navigateur (serveur de test) ; l'adresse reste renvoyée au client.
	if (process.env.ZARAO_OAUTH_NO_BROWSER === "1") return;
	const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
	try { spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => undefined).unref(); } catch { /* l'adresse est aussi renvoyée au client */ }
}

app.get("/oauth/providers", (_req, res) => {
	res.json(Object.fromEntries(Object.keys(OAUTH_PROVIDERS).map((p) => [p, { configured: Boolean(oauthCredentials(p)), redirectUri: oauthRedirectUri(p) }])));
});

app.get("/account/oauth", (req, res) => {
	const row = stmt.userById.get(String(req.query.id ?? ""));
	res.json({ links: row ? oauthStmt.byUser.all(row.id) : [] });
});

app.delete("/account/oauth/:provider", (req, res) => {
	const row = stmt.userById.get(String(req.body?.id ?? ""));
	if (!row || !OAUTH_PROVIDERS[req.params.provider]) return res.json({ unlinked: false });
	oauthStmt.remove.run(row.id, req.params.provider);
	res.json({ unlinked: true });
});

/**
 * Démarre une liaison (avec `id`) ou une connexion (sans `id`) : prépare `state` (anti-CSRF, lié à l'utilisateur)
 * et ouvre la page de consentement du fournisseur. Une connexion ne marche que pour un compte déjà relié.
 */
app.post("/oauth/:provider/start", (req, res) => {
	const provider = req.params.provider;
	const conf = OAUTH_PROVIDERS[provider];
	const isLogin = !req.body?.id;
	const row = isLogin ? null : stmt.userById.get(String(req.body.id));
	if (!conf || (!isLogin && !row)) return res.json({ started: false, error: "notfound" });
	const creds = oauthCredentials(provider);
	if (!creds) return res.json({ started: false, error: "notConfigured" });
	sweepOauth();
	if (oauthPending.size >= OAUTH_MAX_PENDING) return res.json({ started: false, error: "busy" });

	const state = crypto.randomBytes(24).toString("hex");
	const verifier = crypto.randomBytes(32).toString("base64url");
	oauthPending.set(state, { userId: row?.id ?? null, provider, verifier, expires: Date.now() + OAUTH_TTL_MS, status: "pending" });
	const url = new URL(conf.authUrl);
	url.searchParams.set("client_id", creds.clientId);
	url.searchParams.set("redirect_uri", oauthRedirectUri(provider));
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", conf.scope);
	url.searchParams.set("state", state);
	if (conf.pkce) {
		url.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
		url.searchParams.set("code_challenge_method", "S256");
	}
	if (provider === "google") url.searchParams.set("prompt", "select_account");
	openInBrowser(url.toString());
	res.json({ started: true, state, url: url.toString() });
});

/** Suivi côté application : la page de consentement s'ouvre dans le navigateur, l'app interroge ceci jusqu'au résultat. */
app.get("/oauth/status", (req, res) => {
	const p = oauthPending.get(String(req.query.state ?? ""));
	if (!p || p.expires < Date.now()) return res.json({ status: "expired" });
	// Connexion réussie : la fiche n'est remise qu'une fois, à celui qui détient `state` (192 bits aléatoires), puis la demande est close.
	if (p.status === "done" && p.loginUserId) {
		oauthPending.delete(String(req.query.state));
		return res.json({ status: "done", user: publicUser(stmt.userById.get(p.loginUserId)) });
	}
	res.json({ status: p.status, error: p.error });
});

/** Échange le code contre un jeton, lit l'identité du compte distant, puis jette le jeton. */
async function fetchOauthIdentity(provider, code, verifier) {
	const conf = OAUTH_PROVIDERS[provider];
	const creds = oauthCredentials(provider);
	const body = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, code, redirect_uri: oauthRedirectUri(provider) });
	if (provider === "google") body.set("grant_type", "authorization_code");
	if (conf.pkce) body.set("code_verifier", verifier);
	const tokenRes = await fetch(conf.tokenUrl, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000) });
	const token = await tokenRes.json().catch(() => ({}));
	if (!tokenRes.ok || !token.access_token) throw new Error("exchange");
	const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/json", "User-Agent": "Zarao" };
	const who = await (await fetch(conf.userUrl, { headers, signal: AbortSignal.timeout(10000) })).json().catch(() => ({}));
	if (provider === "google") {
		if (!who.sub) throw new Error("exchange");
		return { id: String(who.sub), label: String(who.name || who.email || "Google"), email: String(who.email ?? "") };
	}
	if (!who.id) throw new Error("exchange");
	let email = String(who.email ?? "");
	if (!email) {
		// L'e-mail GitHub peut être privé : on lit alors l'adresse principale vérifiée.
		const list = await (await fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(10000) })).json().catch(() => []);
		email = Array.isArray(list) ? String(list.find((e) => e.primary && e.verified)?.email ?? "") : "";
	}
	return { id: String(who.id), label: String(who.login || who.name || "GitHub"), email };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function oauthPage(res, ok, message) {
	res.set({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
	res.status(ok ? 200 : 400).type("html").send(`<!doctype html><meta charset="utf-8"><title>Zarao</title>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><div style="font-size:48px">${ok ? "✓" : "✕"}</div><h1 style="font-size:20px">${escapeHtml(message)}</h1>
<p style="color:#a1a1aa">Vous pouvez fermer cet onglet et revenir dans Zarao.<br>You can close this tab and go back to Zarao.</p></div></body>`);
}

app.get("/oauth/:provider/callback", h(async (req, res) => {
	const pending = oauthPending.get(String(req.query.state ?? ""));
	if (!pending || pending.provider !== req.params.provider || pending.expires < Date.now() || pending.status !== "pending") {
		return oauthPage(res, false, "Demande expirée ou inconnue");
	}
	const fail = (error, message) => { pending.status = "error"; pending.error = error; return oauthPage(res, false, message); };
	if (req.query.error || !req.query.code) return fail("denied", "Autorisation refusée");
	let identity;
	try { identity = await fetchOauthIdentity(pending.provider, String(req.query.code), pending.verifier); } catch { return fail("exchange", "Échec de la connexion au fournisseur"); }
	const owner = oauthStmt.byIdentity.get(pending.provider, identity.id);
	if (!pending.userId) {
		// Connexion : seul un compte déjà relié depuis « Mon compte » est reconnu, on ne crée jamais de compte ici.
		if (!owner) return fail("notLinked", "Aucun compte Zarao n'est relié à ce compte");
		pending.loginUserId = owner.user_id;
		pending.status = "done";
		return oauthPage(res, true, "Connexion réussie");
	}
	if (owner && owner.user_id !== pending.userId) return fail("alreadyLinked", "Ce compte est déjà relié à un autre compte Zarao");
	oauthStmt.upsert.run(pending.userId, pending.provider, identity.id, identity.label, identity.email, Date.now());
	pending.status = "done";
	oauthPage(res, true, "Compte relié");
}));

// ---- Réglages ----
/** Lance `<binaire> -version` ; résout avec la 1re ligne si c'est bien ffmpeg. */
function probeBinary(file, expectedName, timeout = 8000) {
	return new Promise((resolve) => {
		// IMPORTANT : le nom du fichier doit être ffmpeg. Les réglages sont exécutés ensuite par le serveur :
		// on refuse d'enregistrer n'importe quel exécutable.
		const base = path.basename(file).toLowerCase().replace(/\.exe$/, "");
		if (base !== expectedName) return resolve({ ok: false, error: "name" });
		if (path.isAbsolute(file) && !fs.existsSync(file)) return resolve({ ok: false, error: "missing" });
		execFile(file, ["-version"], { timeout }, (err, stdout) => {
			const first = String(stdout ?? "").split("\n")[0]?.trim() ?? "";
			if (err || !first.toLowerCase().startsWith(`${expectedName} version`)) return resolve({ ok: false, error: err ? "run" : "notffmpeg" });
			resolve({ ok: true, version: first });
		});
	});
}

/** Cherche un binaire dans le PATH, puis dans quelques emplacements Windows usuels. */
function detectBinary(name) {
	const finder = process.platform === "win32" ? "where" : "which";
	try {
		const out = spawnSync(finder, [name], { encoding: "utf8" }).stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
		if (out[0]) return out[0];
	} catch { /* introuvable : on tente les emplacements usuels */ }
	if (process.platform === "win32") {
		for (const dir of ["C:\\Program Files\\ffmpeg\\bin", "C:\\Program Files\\Ffmpeg", "C:\\ffmpeg\\bin", "C:\\Program Files (x86)\\ffmpeg\\bin"]) {
			const candidate = path.join(dir, `${name}.exe`);
			if (fs.existsSync(candidate)) return candidate;
		}
	}
	return "";
}

/** Tous les réglages, typés, avec leurs défauts (le client n'a rien à deviner). */
const readSettings = () => ({ ...Object.fromEntries(Object.keys(SETTING_DEFS).map((k) => [k, cfg(k)])), dataDir: DATA_DIR, logFile: LOG_FILE, activePort, portLocked: ENV_PORT > 0 });

app.get("/settings", (_req, res) => {
	res.json(readSettings());
});

/** Ce que le ffmpeg configuré sait faire pour l'application (affiché dans les Paramètres). */
app.get("/settings/capabilities", h(async (_req, res) => {
	const ok = await ffmpegAvailable();
	const names = ok ? await ffmpegEncoderNames() : new Set();
	res.json({ ffmpeg: ok, aac: names.has("aac"), h264Encoders: ok ? (await h264Candidates()).map((e) => e.name) : [], unusable: [...deadEncoders.keys()] });
}));

app.post("/settings/test", h(async (req, res) => {
	// Seul ffmpeg est testé : un ancien client qui enverrait kind "ffprobe" obtient simplement le test de ffmpeg.
	const file = String(req.body?.path ?? "").trim() || "ffmpeg";
	res.json(await probeBinary(file, "ffmpeg"));
}));

app.post("/settings/detect", (_req, res) => {
	res.json({ ffmpeg: detectBinary("ffmpeg") });
});

app.put("/settings", h(async (req, res) => {
	const body = req.body ?? {};
	// Seules les clés envoyées sont modifiées : un client plus ancien ne réinitialise pas les réglages qu'il ne connaît pas.
	const next = {};
	for (const key of Object.keys(SETTING_DEFS)) {
		if (!(key in body)) continue;
		const r = validateSettingInput(key, body[key]);
		if (!r.ok) return res.json({ saved: false, field: key, error: "format" });
		next[key] = r.value;
	}
	// Un chemin vide est permis (retour au PATH) ; sinon il doit pointer vers le bon binaire.
	if (next.ffmpeg) { const r = await probeBinary(next.ffmpeg, "ffmpeg"); if (!r.ok) return res.json({ saved: false, field: "ffmpeg", error: r.error }); }
	db.transaction(() => { for (const [k, v] of Object.entries(next)) settingSet.run(k, v); })();
	// Un nouveau chemin ffmpeg ou un nouvel encodeur préféré ne doit pas être masqué par l'état mémorisé de l'ancien.
	if ("ffmpeg" in next) { ffmpegState = { at: 0, ok: false, path: "" }; encoderCache = { path: "", names: new Set() }; }
	res.json({ saved: true });
}));

/**
 * Vide ce qui peut l'être sans risque : fichiers temporaires d'au moins 10 minutes (un envoi en cours n'est pas touché),
 * sondes mémorisées, état de ffmpeg et encodeurs écartés après un échec (ils seront réessayés).
 */
app.post("/settings/clear-cache", (_req, res) => {
	let removed = 0, bytes = 0;
	const limit = Date.now() - 10 * 60_000;
	try {
		for (const f of fs.readdirSync(TMP_DIR)) {
			const full = path.join(TMP_DIR, f);
			const st = fs.statSync(full);
			if (st.mtimeMs > limit) continue;
			bytes += st.size; removed++;
			fs.rmSync(full, { recursive: true, force: true });
		}
	} catch { /* dossier absent ou fichier verrouillé : on rend compte de ce qui a été fait */ }
	localProbeCache.clear();
	audioLangCache.clear();
	deadEncoders.clear();
	ffmpegState = { at: 0, ok: false, path: "" };
	encoderCache = { path: "", names: new Set() };
	res.json({ removed, bytes });
});

// ---- Métadonnées ----
/**
 * Paroles intégrées au fichier : formats où ffmpeg écrit réellement le tag `lyrics` (USLT en MP3, ©lyr en MP4/M4A, LYRICS en Vorbis/Matroska).
 * IMPORTANT : sur les autres (WAV, AVI…) ffmpeg ignore le tag sans erreur ; on refuse plutôt que de perdre les paroles en silence.
 */
const LYRICS_EMBED_EXT_RE = /\.(mp3|m4a|mp4|m4v|flac|ogg|oga|opus|mkv|webm)$/i;
/** Plafond des paroles passées en argument : la ligne de commande Windows est limitée à ~32 000 caractères. */
const MAX_EMBED_LYRICS = 12_000;
const TAG_KEYS = ["title", "artist", "album", "album_artist", "composer", "genre", "date", "track", "disc", "publisher", "copyright"];
const MEDIA_EXT_RE = /\.(mp3|mp2|wav|ogg|flac|m4a|aac|mp4|webm|mpg|mkv|avi|ts|mov)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mpg|mkv|avi|ts|mov)$/i;
const JACKET_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_JACKET_BYTES = 5 * 1024 * 1024;
const MAX_LYRICS_CHARS = 200_000;

/** Paroles : texte seulement (LRC ou brut), BOM retiré, taille bornée. null si trop long. */
function cleanLyrics(text) {
	const t = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	return t.length <= MAX_LYRICS_CHARS ? t : null;
}

/** Ne garde que les clés de tags connues, en texte court : le reste est ignoré plutôt que transmis à ffmpeg. */
function cleanTags(input) {
	const out = {};
	for (const k of TAG_KEYS) {
		if (typeof input?.[k] === "string") out[k] = input[k].trim().slice(0, 500);
	}
	return out;
}

/** Pochette en data URL → { mime, buffer } ou null si invalide / trop lourde. */
function decodeJacket(dataUrl) {
	const m = JACKET_RE.exec(String(dataUrl ?? ""));
	if (!m) return null;
	const buffer = Buffer.from(m[2], "base64");
	return buffer.length > 0 && buffer.length <= MAX_JACKET_BYTES ? { mime: `image/${m[1]}`, ext: m[1] === "jpeg" ? "jpg" : m[1], buffer } : null;
}

/**
 * Écrit les tags dans un fichier local avec ffmpeg (copie sans réencodage), puis remplace l'original.
 * IMPORTANT : réservé aux appels JSON (pas de preflight contourné) et à des chemins absolus de médias existants.
 * `jacket` : absent = conserver, null = retirer, data URL = remplacer (audio seulement).
 */
app.post("/tags/write", h(async (req, res) => {
	const { path: file, tags, jacket, id3v1, newName, lyrics } = req.body ?? {};
	if (typeof file !== "string" || !path.isAbsolute(file) || !MEDIA_EXT_RE.test(file)) return res.json({ saved: false, error: "path" });
	let stat;
	try { stat = fs.statSync(file); } catch { return res.json({ saved: false, error: "missing" }); }
	if (!stat.isFile()) return res.json({ saved: false, error: "missing" });

	// Paroles : undefined = conserver, "" = retirer, texte = remplacer (LRC horodaté conservé tel quel).
	let lyricsText;
	if (typeof lyrics === "string") {
		if (!LYRICS_EMBED_EXT_RE.test(file)) return res.json({ saved: false, error: "lyricsFormat" });
		lyricsText = lyrics.replace(/\r\n?/g, "\n");
		if (lyricsText.length > MAX_EMBED_LYRICS) return res.json({ saved: false, error: "lyricsTooLong" });
	}

	const dir = path.dirname(file);
	const ext = path.extname(file);
	const isVideo = VIDEO_EXT_RE.test(file);

	// Renommage : un simple nom de fichier, même extension, sans séparateur de chemin.
	let finalPath = file;
	if (typeof newName === "string" && newName.trim() && newName.trim() !== path.basename(file)) {
		const name = newName.trim();
		if (/[\\/:*?"<>|]/.test(name) || name.startsWith(".") || path.extname(name).toLowerCase() !== ext.toLowerCase()) return res.json({ saved: false, error: "name" });
		finalPath = path.join(dir, name);
		if (fs.existsSync(finalPath)) return res.json({ saved: false, error: "exists" });
	}

	let coverFile = null;
	if (jacket !== undefined && jacket !== null && !isVideo) {
		const decoded = decodeJacket(jacket);
		if (!decoded) return res.json({ saved: false, error: "jacket" });
		coverFile = path.join(TMP_DIR, `${crypto.randomUUID()}.${decoded.ext}`);
		fs.writeFileSync(coverFile, decoded.buffer);
	}

	const tmp = path.join(dir, `.${path.basename(file, ext)}.zarao-tmp${ext}`);
	const isMp3 = /\.mp3$/i.test(file);
	const args = buildTagArgs({ file, tmp, coverFile, jacket, isVideo, isMp3, id3v1, id3v2: cfg("id3v2"), tags: { ...cleanTags(tags), ...(lyricsText !== undefined && !isMp3 ? { lyrics: lyricsText } : {}) } });

	const result = await new Promise((resolve) => {
		const proc = spawn(getFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		proc.stderr.on("data", (d) => { err = (err + d).slice(-600); });
		const timer = setTimeout(() => proc.kill("SIGKILL"), cfg("tagTimeout") * 1000);
		proc.on("error", () => { clearTimeout(timer); resolve({ ok: false, error: "ffmpeg" }); });
		proc.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? { ok: true } : { ok: false, error: "failed", detail: err.trim() }); });
	});
	if (coverFile) fs.rmSync(coverFile, { force: true });
	if (!result.ok) { fs.rmSync(tmp, { force: true }); return res.json({ saved: false, error: result.error, detail: result.detail }); }

	// Paroles : MP3 = trame USLT injectée à la main ; les autres formats ont reçu le tag via ffmpeg.
	// IMPORTANT : on relit le résultat avant de remplacer l'original. Un format dont ffmpeg ignore le tag sans erreur ne doit pas
	// faire croire que les paroles sont enregistrées : on refuse (le client les range alors dans un .lrc voisin).
	if (lyricsText !== undefined) {
		let ok = true;
		try {
			if (isMp3) ok = writeMp3Lyrics(tmp, lyricsText);
			if (ok && lyricsText) {
				const meta = await parseFile(tmp, { duration: false, skipCovers: true });
				ok = (meta.common.lyrics ?? []).some((l) => typeof l?.text === "string" && l.text.trim() !== "");
			}
		} catch { ok = false; }
		if (!ok) { fs.rmSync(tmp, { force: true }); return res.json({ saved: false, error: "lyricsFormat" }); }
	}

	try {
		// Sauvegarde facultative : copie de l'original à côté (« fichier.mp3.bak ») AVANT de le remplacer.
		if (cfg("tagBackup")) fs.copyFileSync(file, `${file}.bak`);
		// Remplacement sur le même volume : l'original n'est jamais laissé à moitié écrit.
		fs.renameSync(tmp, finalPath);
		if (finalPath !== file) fs.unlinkSync(file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		// Windows refuse de remplacer un fichier que le lecteur a encore ouvert.
		return res.json({ saved: false, error: err.code === "EBUSY" || err.code === "EPERM" ? "busy" : "write" });
	}
	res.json({ saved: true, path: finalPath });
}));

/** Met à jour les tags (et la pochette) d'un média en ligne appartenant à l'utilisateur. */
app.put("/media/all/update", h(async (req, res) => {
	const { id, userid, tags, jacket, lyrics } = req.body ?? {};
	const row = stmt.mediaById.get(String(id ?? ""));
	if (!row) return res.json({ updated: false, error: "notfound" });
	// Même modèle de confiance que le reste du serveur local : l'identifiant utilisateur vient du client.
	if (row.userid !== String(userid ?? "")) return res.json({ updated: false, error: "forbidden" });

	const data = JSON.parse(row.data);
	Object.assign(data, cleanTags(tags));
	if (jacket === null) data.jacket = "";
	else if (jacket !== undefined) {
		const decoded = decodeJacket(jacket);
		if (!decoded) return res.json({ updated: false, error: "jacket" });
		data.jacket = jacket;
	}
	// Paroles : absent = conserver ; null ou "" = retirer ; texte = remplacer.
	if (lyrics === null) data.lyrics = "";
	else if (lyrics !== undefined) {
		const clean = cleanLyrics(lyrics);
		if (clean === null) return res.json({ updated: false, error: "lyrics" });
		data.lyrics = clean;
	}
	stmt.mediaSetData.run(JSON.stringify(data), row.id);
	res.json({ updated: true });
}));

// ---- Playlists ----
// Même modèle de confiance que le reste du serveur local : l'identifiant utilisateur vient du client,
// mais chaque route vérifie que la playlist appartient bien à cet utilisateur.
const MAX_PLAYLISTS = 100;
const MAX_PLAYLIST_ITEMS = 1000;
const cleanName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 80);

/** Charge la playlist et vérifie son propriétaire ; répond et retourne null en cas d'échec. */
function ownedPlaylist(req, res, userid) {
	const row = stmt.plById.get(String(req.params.id ?? ""));
	if (!row) { res.json({ ok: false, error: "notfound" }); return null; }
	if (row.userid !== String(userid ?? "")) { res.json({ ok: false, error: "forbidden" }); return null; }
	return row;
}

app.get("/playlists", (req, res) => {
	const list = stmt.plByUser.all(String(req.query.userid ?? "")).map((p) => ({ ...p, coverIds: stmt.plCovers.all(p.id).map((r) => r.media_id) }));
	res.json({ list });
});

app.post("/playlists", (req, res) => {
	const userid = String(req.body?.userid ?? "");
	const name = cleanName(req.body?.name);
	if (!userid) return res.json({ ok: false, error: "forbidden" });
	if (!name) return res.json({ ok: false, error: "name" });
	if (stmt.plCountByUser.get(userid).n >= MAX_PLAYLISTS) return res.json({ ok: false, error: "limit" });
	const id = crypto.randomUUID();
	stmt.plInsert.run(id, userid, name, Date.now());
	res.json({ ok: true, id });
});

app.get("/playlists/:id", (req, res) => {
	const row = ownedPlaylist(req, res, req.query.userid);
	if (!row) return;
	res.json({ ok: true, playlist: { id: row.id, name: row.name, created: row.created }, items: stmt.plItems.all(row.id).map(toListItem) });
});

app.put("/playlists/:id", (req, res) => {
	const row = ownedPlaylist(req, res, req.body?.userid);
	if (!row) return;
	const name = cleanName(req.body?.name);
	if (!name) return res.json({ ok: false, error: "name" });
	stmt.plRename.run(name, row.id);
	res.json({ ok: true });
});

app.delete("/playlists/:id", (req, res) => {
	const row = ownedPlaylist(req, res, req.body?.userid);
	if (!row) return;
	stmt.plDelete.run(row.id);
	res.json({ ok: true });
});

/** Ajoute des médias en fin de playlist (les doublons et les médias inexistants sont ignorés). */
app.post("/playlists/:id/items", (req, res) => {
	const row = ownedPlaylist(req, res, req.body?.userid);
	if (!row) return;
	const ids = Array.isArray(req.body?.mediaIds) ? [...new Set(req.body.mediaIds.map(String))] : [];
	let added = 0;
	db.transaction(() => {
		let pos = stmt.plMaxPos.get(row.id).p + 1;
		let count = stmt.plItemCount.get(row.id).n;
		for (const mid of ids) {
			if (count >= MAX_PLAYLIST_ITEMS) break;
			if (!stmt.mediaById.get(mid)) continue;
			if (stmt.plItemInsert.run(row.id, mid, pos).changes) { pos++; count++; added++; }
		}
	})();
	res.json({ ok: true, added });
});

app.delete("/playlists/:id/items", (req, res) => {
	const row = ownedPlaylist(req, res, req.body?.userid);
	if (!row) return;
	stmt.plItemDelete.run(row.id, String(req.body?.mediaId ?? ""));
	res.json({ ok: true });
});

/** Réordonne : `mediaIds` donne le nouvel ordre ; les éléments absents de la liste passent à la suite, dans leur ordre actuel. */
app.put("/playlists/:id/order", (req, res) => {
	const row = ownedPlaylist(req, res, req.body?.userid);
	if (!row) return;
	const wanted = Array.isArray(req.body?.mediaIds) ? req.body.mediaIds.map(String) : [];
	const current = stmt.plItems.all(row.id).map((m) => m.id);
	const known = new Set(current);
	const ordered = [...new Set(wanted.filter((id) => known.has(id))), ...current.filter((id) => !wanted.includes(id))];
	db.transaction(() => ordered.forEach((mid, i) => stmt.plItemSetPos.run(i, row.id, mid)))();
	res.json({ ok: true });
});

// ---- Réactions, commentaires, vues ----
const MIN_COMMENT = 10;
const MAX_COMMENT = 510;
const MAX_VIEW_SECONDS = 24 * 3600;

/** Valide `userid` (compte existant) et `:id` (média existant) ; répond et retourne null sinon. */
function socialContext(req, res, userid) {
	const media = stmt.mediaById.get(String(req.params.id ?? ""));
	if (!media) { res.json({ ok: false, error: "notfound" }); return null; }
	const user = stmt.userById.get(String(userid ?? ""));
	if (!user) { res.json({ ok: false, error: "forbidden" }); return null; }
	return { media, user };
}

function socialSummary(mediaId, userid) {
	const counts = Object.fromEntries(stmt.reactionCounts.all(mediaId).map((r) => [r.kind, r.n]));
	const totals = stmt.viewTotals.get(mediaId);
	return {
		like: counts.like ?? 0, dislike: counts.dislike ?? 0, mine: stmt.reactionMine.get(mediaId, String(userid ?? ""))?.kind ?? null,
		views: totals.views, streamSeconds: Math.round(totals.seconds), comments: stmt.commentCount.get(mediaId).n,
	};
}

app.get("/media/:id/social", (req, res) => {
	if (!stmt.mediaById.get(String(req.params.id ?? ""))) return res.json({ ok: false, error: "notfound" });
	res.json({ ok: true, ...socialSummary(req.params.id, req.query.userid) });
});

/** `kind` : "like", "dislike" ou null (retirer sa réaction). Poser l'une remplace l'autre. */
app.put("/media/:id/reaction", (req, res) => {
	const ctx = socialContext(req, res, req.body?.userid);
	if (!ctx) return;
	const kind = req.body?.kind;
	if (kind !== null && kind !== "like" && kind !== "dislike") return res.json({ ok: false, error: "kind" });
	if (kind === null) stmt.reactionDelete.run(ctx.media.id, ctx.user.id);
	else stmt.reactionSet.run(ctx.media.id, ctx.user.id, kind, Date.now());
	res.json({ ok: true, ...socialSummary(ctx.media.id, ctx.user.id) });
});

/** Enregistre une session d'écoute (durée réellement écoutée, en secondes). */
app.post("/media/:id/view", (req, res) => {
	const ctx = socialContext(req, res, req.body?.userid);
	if (!ctx) return;
	const duration = Number(req.body?.duration);
	if (!Number.isFinite(duration) || duration < 1) return res.json({ ok: false, error: "duration" });
	stmt.viewInsert.run(ctx.media.id, ctx.user.id, Math.min(duration, MAX_VIEW_SECONDS), Date.now());
	res.json({ ok: true });
});

app.get("/media/:id/stats", (req, res) => {
	const media = stmt.mediaById.get(String(req.params.id ?? ""));
	if (!media) return res.json({ ok: false, error: "notfound" });
	const totals = stmt.viewTotals.get(media.id);
	res.json({ ok: true, views: totals.views, streamSeconds: Math.round(totals.seconds), weekly: stmt.viewWeekly.all(media.id).reverse().map((w) => ({ week: w.week, views: w.views, seconds: Math.round(w.seconds) })) });
});

const commentView = (r) => {
	const u = r.udata ? JSON.parse(r.udata) : {};
	return { id: r.id, userid: r.userid, text: r.text, created: r.created, author: { username: r.username ?? "?", name: u.name ?? "", surname: u.surname ?? "", hasAvatar: Boolean(u.profilphoto) } };
};

app.get("/media/:id/comments", (req, res) => {
	if (!stmt.mediaById.get(String(req.params.id ?? ""))) return res.json({ ok: false, error: "notfound" });
	const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
	const offset = Math.max(0, parseInt(req.query.offset) || 0);
	res.json({ ok: true, total: stmt.commentCount.get(req.params.id).n, list: stmt.commentList.all(req.params.id, limit, offset).map(commentView) });
});

app.post("/media/:id/comments", (req, res) => {
	const ctx = socialContext(req, res, req.body?.userid);
	if (!ctx) return;
	const text = String(req.body?.text ?? "").replace(/\r\n?/g, "\n").trim();
	if (text.length < MIN_COMMENT) return res.json({ ok: false, error: "short" });
	if (text.length > MAX_COMMENT) return res.json({ ok: false, error: "long" });
	const id = crypto.randomUUID();
	stmt.commentInsert.run(id, ctx.media.id, ctx.user.id, text, Date.now());
	res.json({ ok: true, comment: commentView({ ...stmt.commentById.get(id), username: ctx.user.username, udata: ctx.user.data }) });
});

/** Un commentaire se supprime par son auteur ou par le propriétaire du média. */
app.delete("/media/:id/comments/:cid", (req, res) => {
	const ctx = socialContext(req, res, req.body?.userid);
	if (!ctx) return;
	const c = stmt.commentById.get(String(req.params.cid ?? ""));
	if (!c || c.media_id !== ctx.media.id) return res.json({ ok: false, error: "notfound" });
	if (c.userid !== ctx.user.id && ctx.media.userid !== ctx.user.id) return res.json({ ok: false, error: "forbidden" });
	stmt.commentDelete.run(c.id);
	res.json({ ok: true });
});

/** Avatar d'un utilisateur, servi comme une image (les commentaires y font référence au lieu d'embarquer chaque photo). */
app.get("/users/:id/avatar", (req, res) => {
	const row = stmt.userById.get(String(req.params.id ?? ""));
	const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(row ? JSON.parse(row.data).profilphoto ?? "" : "");
	if (!m) return res.sendStatus(404);
	res.set({ "Content-Type": m[1], "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" });
	res.send(Buffer.from(m[2], "base64"));
});

// ---- Catalogue ----
app.get("/media/:type(music|video)/list", (req, res) => {
	const rows = stmt.mediaByUser.all(req.query.userid || "", req.params.type === "video" ? 1 : 0);
	res.json({ count: rows.length, list: rows.map(toListItem) });
});
app.get("/media/all/list", (req, res) => {
	res.json({ list: stmt.mediaPage.all(parseInt(req.query.count) || 10, parseInt(req.query.offset) || 0).map(toListItem) });
});
app.get("/media/news", (_req, res) => res.json({ list: stmt.mediaPage.all(20, 0).map(toListItem) }));
app.get("/media/all/list/metadata", h(async (req, res) => {
	const row = stmt.mediaById.get(req.query.id || "");
	const m = hydrate(row);
	if (!m) return res.json({ found: false });
	// playMode dit au lecteur si le déplacement dans la piste est natif ("direct") ou doit relancer le flux (remux, transcode).
	const plan = await planPlayback(row);
	res.json({ found: true, key: { ...m, thumbnail: m.jacket, playMode: plan.mode, playReason: plan.reason } });
}));
app.get("/media/music/data", (req, res) => {
	const m = hydrate(stmt.mediaById.get(req.query.mediaid || ""));
	res.json(m ? { found: true, media: { size: m.size, name: m.name } } : { found: false });
});
app.get("/media/detail", (req, res) => res.json({ detail: hydrate(stmt.mediaById.get(req.query.id || "")) }));
app.post("/media/search", (req, res) => {
	const { skip = 0, text, keyword, query } = req.body.search || {};
	const needle = String(text || keyword || query || "").toLowerCase();
	const found = stmt.mediaAll.all().map(hydrate)
		.filter((m) => !needle || [m.title, m.artist, m.album, m.genre].some((v) => String(v || "").toLowerCase().includes(needle)));
	res.json({ ok: true, media: found.slice(skip, skip + 10).map((m) => ({ _id: m.id, fileid: m.id, artist: m.artist, title: m.title, duration: m.duration, size: m.size })) });
});
app.get("/media/music/verifypath", (req, res) => {
	const m = stmt.mediaById.get(req.query.id || "");
	res.json({ found: Boolean(m && fs.existsSync(m.path)) });
});
app.delete("/media/all/delete", (req, res) => {
	const m = stmt.mediaById.get(req.body.id || "");
	if (m) { fs.rmSync(m.path, { force: true }); db.prepare("DELETE FROM playlist_items WHERE media_id = ?").run(m.id); stmt.mediaDelete.run(m.id); }
	res.json({ deleted: Boolean(m) });
});

// ---- Upload ----
app.post("/media/upload", upload.fields([{ name: "media", maxCount: 1 }, { name: "jacket", maxCount: 1 }, { name: "lyrics", maxCount: 1 }]), h(async (req, res) => {
	const file = req.files?.media?.[0];
	if (!file) return res.json({ notsupported: true, name: "NoMedia", message: "Aucun fichier reçu." });

	const ext = path.extname(file.originalname).replace(".", "").toLowerCase();
	const target = path.join(MEDIA_DIR, `${crypto.randomUUID()}.${ext}`);
	fs.renameSync(file.path, target);
	const probe = await probeMedia(target);

	let jacket = "";
	const jacketFile = req.files?.jacket?.[0];
	if (jacketFile) {
		jacket = `data:${jacketFile.mimetype};base64,${fs.readFileSync(jacketFile.path).toString("base64")}`;
		fs.rmSync(jacketFile.path, { force: true });
	}
	// Paroles : le fichier envoyé est lu comme du texte UTF-8 puis supprimé ; seules les paroles valides sont conservées.
	let lyrics = "";
	const lyricsFile = req.files?.lyrics?.[0];
	if (lyricsFile) {
		if (lyricsFile.size <= MAX_LYRICS_CHARS * 4) lyrics = cleanLyrics(fs.readFileSync(lyricsFile.path, "utf8")) ?? "";
		fs.rmSync(lyricsFile.path, { force: true });
	}

	const { userid, ...tags } = req.body;
	const isVideo = probe.hasVideo || VIDEO_EXTENSIONS.includes(ext);
	const id = crypto.randomUUID();
	stmt.mediaInsert.run(id, userid || "", isVideo ? 1 : 0, Date.now(), target, JSON.stringify({
		...tags, name: file.originalname, ext, size: file.size, jacket, type: file.mimetype,
		duration: formatDuration(probe.duration), durationFloat: probe.duration, lyrics,
		codecs: { container: probe.container, video: probe.video, audio: probe.audio, pixfmt: probe.pixfmt },
	}));
	res.json({ id });
}));

// ---- Lecture : brut (Range) sans seek, ffmpeg avec seek ----
app.get("/media/play", h(async (req, res) => {
	const m = stmt.mediaById.get(req.query.id || "");
	if (!m || !fs.existsSync(m.path)) return res.sendStatus(404);
	const start = Math.max(0, parseFloat(req.query.time) || 0);
	await servePlayback(res, m.path, Boolean(m.is_video), await planPlayback(m), start);
}));

/** Sert un fichier selon le plan : brut (Range) ou flux ffmpeg. Commun aux médias du serveur et aux fichiers locaux. */
async function servePlayback(res, file, isVideo, plan, start) {
	// Niveau 1 : fichier brut. Le navigateur gère Range et déplacement tout seul.
	if (plan.mode === "direct") return res.sendFile(file);

	// Niveaux 2 et 3 : flux produit à la volée (pas de Range) ; le client se déplace en relançant avec ?time=.
	const candidates = isVideo ? await h264Candidates() : [];
	let video = plan.video ?? null;
	// IMPORTANT : une vidéo copiée repart de l'image clé qui précède le point demandé (parfois 10 s avant) et le lecteur
	// afficherait une position fausse. Après un déplacement on réencode donc la vidéo, si un encodeur H.264 existe.
	if (isVideo && video === "copy" && start > 0 && candidates.length > 0) video = "encode";
	if (isVideo && video === "encode" && candidates.length === 0) return res.status(501).json({ error: "no-h264-encoder" });

	const base = { file, start, isVideo, video, audio: plan.audio ?? "encode", sourceAudio: plan.sourceAudio, size: getSetting("videoSize"), aspect: getSetting("videoAspect"), opts: { ...playOpts(), audioTrack: plan.audioTrack ?? cfg("audioTrack") } };
	res.set("Cache-Control", "no-store");
	// Encodeurs essayés à la suite tant que rien n'est parti vers le client.
	for (const encoder of video === "encode" ? candidates : [null]) {
		const { args, mime } = buildPlayArgs({ ...base, encoder });
		res.type(mime);
		if (cfg("logLevel") === "info") logLine("info", `[zarao-server] lecture ${plan.mode} (${plan.reason}) : ${getFfmpegPath()} ${args.join(" ")}`);
		const r = await streamFfmpeg(args, res);
		if (r.started || res.destroyed) return;
		logLine("error", `[zarao-server] ffmpeg (${encoder?.name ?? "copie"}) : ${r.stderr}`);
		if (encoder) deadEncoders.set(encoder.name, Date.now() + 10 * 60_000);
	}
	if (!res.headersSent) res.status(500).end();
}

// ---- Fichiers locaux (mode hors ligne) : même décision et mêmes flux que pour les médias du serveur ----
// IMPORTANT : ces routes lisent un chemin DU DISQUE. Garde-fous : Host local (anti DNS rebinding), origine de l'application
// (en-tête Origin, ou à défaut Referer, qu'un élément <video> envoie toujours), extension média, fichier ordinaire.
// Les routes /media/* n'ont pas ce risque : elles ne servent que ce que l'utilisateur a téléversé.
const LOCAL_EXT = new Set([...VIDEO_EXTENSIONS, "mp3", "m4a", "m4b", "aac", "flac", "wav", "ogg", "oga", "opus", "wma", "mka", "mp2", "ac3", "eac3", "dts", "aif", "aiff", "amr"]);
const refererOrigin = (req) => { try { return new URL(req.get("referer") ?? "").origin; } catch { return ""; } };
function checkLocalFile(req) {
	if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.get("host") ?? "")) return { status: 403 };
	if (!ALLOWED_ORIGINS.has(req.get("origin") || refererOrigin(req))) return { status: 403 };
	const file = String(req.query.path ?? "");
	if (!path.isAbsolute(file) || !LOCAL_EXT.has(path.extname(file).slice(1).toLowerCase())) return { status: 400 };
	let st;
	try { st = fs.statSync(file); } catch { return { status: 404 }; }
	return st.isFile() ? { file, st } : { status: 404 };
}
// La sonde peut lancer ffmpeg : on la mémorise par fichier (chemin + date + taille).
const localProbeCache = new Map();
async function localPlan(file, st) {
	const key = `${file}|${st.mtimeMs}|${st.size}`;
	let hit = localProbeCache.get(key);
	if (!hit) {
		const probe = await probeMedia(file);
		const isVideo = probe.hasVideo || VIDEO_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
		hit = { probe, isVideo };
		if (localProbeCache.size > 500) localProbeCache.clear();
		localProbeCache.set(key, hit);
	}
	const plan = await decidePlayback(file, hit.isVideo, { container: hit.probe.container, video: hit.probe.video, audio: hit.probe.audio, pixfmt: hit.probe.pixfmt });
	return { ...hit, plan };
}
app.get("/local/probe", h(async (req, res) => {
	const c = checkLocalFile(req);
	if (!c.file) return res.sendStatus(c.status);
	const { probe, isVideo, plan } = await localPlan(c.file, c.st);
	// `audioLangs` : une entrée par piste audio d'une vidéo (code de langue, "" si inconnu) ; sert au choix de la piste dans le lecteur.
	res.json({ playMode: plan.mode, playReason: plan.reason, duration: probe.duration || 0, isVideo, audioLangs: isVideo ? await audioLangsOf(c.file) : [] });
}));
app.get("/local/play", h(async (req, res) => {
	const c = checkLocalFile(req);
	if (!c.file) return res.sendStatus(c.status);
	const { probe, isVideo, plan: base } = await localPlan(c.file, c.st);
	let plan = base;
	// `audio=N` : piste audio choisie dans le lecteur (l'emporte sur la langue préférée et l'index des Paramètres). Une autre piste que la
	// première ne peut être servie que par ffmpeg : l'audio est réencodé en AAC ; la vidéo reste copiée si elle est en H.264, sinon réencodée.
	if (isVideo && req.query.audio !== undefined && (await ffmpegAvailable())) {
		const track = Math.max(0, Math.min(15, parseInt(req.query.audio, 10) || 0));
		const copyVideo = base.mode === "direct" ? canonVideo(probe.video) === "h264" && /^yuvj?420p$/.test(probe.pixfmt ?? "yuv420p") : base.video === "copy";
		plan = { ...base, mode: "transcode", video: copyVideo ? "copy" : "encode", audio: "encode", audioTrack: track, reason: "audio-track" };
	}
	await servePlayback(res, c.file, isVideo, plan, Math.max(0, parseFloat(req.query.time) || 0));
}));

// ---- Téléchargement (jeton opaque pour ne pas exposer de chemin disque) ----
app.get("/media/download/prepare", (req, res) => {
	const m = hydrate(stmt.mediaById.get(req.query.id || ""));
	if (!m || !fs.existsSync(m.path)) return res.json({ found: false });
	res.json({ found: true, file: { path: m.id, name: m.name, size: m.size } });
});
app.get("/media/download", (req, res) => {
	const m = hydrate(stmt.mediaById.get(req.query.token || ""));
	if (!m || !fs.existsSync(m.path)) return res.sendStatus(404);
	res.download(m.path, m.name);
});

app.use((err, _req, res, _next) => {
	if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ registered: false, error: "avatarTooBig" });
	logLine("error", err);
	res.status(500).json({ error: err.message });
});

const server = app.listen(SERVER_PORT, HOST, () => logLine("info", `[zarao-server] ${ROLE} http://${HOST}:${activePort}`));
// IMPORTANT : un port choisi dans les Paramètres peut être pris par un autre programme. Plutôt que de laisser l'application sans serveur
// (et sans moyen de corriger le réglage), on revient au port par défaut et on efface le réglage ; le client fait de même (cf. isServerUp).
server.on("error", (err) => {
	if (err.code === "EADDRINUSE" && !ENV_PORT && CONFIGURED_PORT && activePort !== DEFAULT_PORT) {
		logLine("error", `[zarao-server] port ${CONFIGURED_PORT} occupé : retour au port par défaut ${DEFAULT_PORT}`);
		settingSet.run("port", "0");
		activePort = DEFAULT_PORT;
		server.listen(DEFAULT_PORT, HOST);
		return;
	}
	logLine("error", err);
	process.exit(4);
});
// ---- Préchauffage ----
// IMPORTANT : on déclenche en arrière-plan, juste après l'écoute, ce qui est coûteux à froid (1er lancement de ffmpeg.exe,
// liste des encodeurs, chargement de music-metadata) pour que la première lecture de l'utilisateur ne le paie pas.
async function warmUp() {
	try {
		if (await ffmpegAvailable()) await ffmpegEncoderNames();
		await parseFile(path.join(__dirname, "package.json")).catch(() => {}); // charge les parseurs de music-metadata
	}
	finally { serverReady = true; }
}
warmPromise = warmUp();
// ---- Arrêt propre ----
// IMPORTANT : sur Windows, tuer node n'arrête pas ses ffmpeg enfants. On les tue ici, on vide tmp et on ferme la base.
let shuttingDown = false;
const shutdown = () => {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const proc of activeFfmpeg) { try { proc.kill("SIGKILL"); } catch { /* déjà terminé */ } }
	try { server.closeAllConnections?.(); server.close(); } catch { /* déjà fermé */ }
	try { for (const f of fs.readdirSync(TMP_DIR)) fs.rmSync(path.join(TMP_DIR, f), { recursive: true, force: true }); } catch { /* best effort */ }
	try { db.pragma("wal_checkpoint(TRUNCATE)"); db.close(); } catch { /* best effort */ }
	process.exit(0);
};
// Tauri garde le tuyau stdin ouvert tant qu'il vit : sa fermeture (fermeture normale OU plantage de l'app) = demande d'arrêt.
if (process.env.ZARAO_WATCH_STDIN === "1") {
	process.stdin.resume();
	process.stdin.on("end", shutdown);
	process.stdin.on("close", shutdown);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGBREAK", shutdown);
process.on("uncaughtException", (err) => { logLine("error", err); process.exit(4); });
