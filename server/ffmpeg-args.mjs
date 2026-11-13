/**
 * Construction des arguments ffmpeg (fonctions pures, sans accès disque ni processus).
 *
 * IMPORTANT : ce module est partagé par le serveur (server/index.mjs) et par le script de vérification
 * (tools/ffmpeg-check.mjs). Ce que le script valide sur un ffmpeg donné est donc exactement ce que le serveur lui demandera.
 *
 * Contrainte de conception : le serveur doit fonctionner avec un ffmpeg MINIMAL et sous licence LGPL (sans libx264, sans
 * libmp3lame), pour que l'application reste légère à distribuer. D'où : audio toujours en AAC (encodeur natif de ffmpeg) et
 * encodeur H.264 choisi parmi ceux que le binaire possède réellement.
 */

/**
 * Réglages de lecture (valeurs par défaut = comportement historique). Tous facultatifs : le script de vérification
 * (tools/ffmpeg-check.mjs) n'en passe aucun et obtient donc exactement les arguments d'origine.
 */
export const DEFAULT_PLAY_OPTS = {
	x264Preset: "ultrafast", x264Crf: 23,
	/** kbit/s ; 0 = débit propre à chaque encodeur. */
	videoBitrate: 0,
	audioBitrate: 192,
	/** "2" = stéréo forcée ; "source" = nombre de canaux d'origine. */
	audioChannels: "2",
	/** Images entre deux images clés (60 ≈ 2 s). */
	gop: 60,
	/** 0 = laisser ffmpeg décider. */
	threads: 0,
	hwaccel: false, deinterlace: false,
	/** Index de la piste audio (0 = la première). */
	audioTrack: 0,
	logLevel: "error",
	/** Options supplémentaires déjà validées (cf. settings-schema.mjs). */
	extraArgs: [],
};

/** `-b:v` si un débit est demandé, sinon celui par défaut de l'encodeur (`auto` kbit/s, 0 = aucun). */
const bitrate = (o, auto = 0) => {
	const k = o.videoBitrate || auto;
	return k ? ["-b:v", `${k}k`] : [];
};

/**
 * Encodeurs H.264 par ordre de préférence. Un encodeur "listé" n'est pas forcément utilisable (NVENC sans pilote, AMF sans DLL) :
 * le serveur les essaie à la suite et retient ceux qui échouent (cf. server/index.mjs).
 */
export const VIDEO_ENCODERS = [
	// Logiciels d'abord : ils marchent partout où ils sont compilés.
	// libx264 : le débit demandé sert de PLAFOND (qualité constante + débit maximal), pas de débit cible.
	{ name: "libx264", args: (o) => ["-c:v", "libx264", "-preset", o.x264Preset, "-crf", String(o.x264Crf), ...(o.videoBitrate ? ["-maxrate", `${o.videoBitrate}k`, "-bufsize", `${o.videoBitrate * 2}k`] : [])] },
	{ name: "libopenh264", args: (o) => ["-c:v", "libopenh264", ...bitrate(o)] },
	// Media Foundation (Windows) : encodeur H.264 fourni par le système, aucune bibliothèque à embarquer, licence LGPL.
	{ name: "h264_mf", args: (o) => ["-c:v", "h264_mf", ...bitrate(o, 3000)] },
	// Autres plateformes et accélérations matérielles.
	{ name: "h264_videotoolbox", args: (o) => ["-c:v", "h264_videotoolbox", ...bitrate(o, 3000)] },
	{ name: "h264_qsv", args: (o) => ["-c:v", "h264_qsv", "-preset", "veryfast", ...bitrate(o)] },
	{ name: "h264_nvenc", args: (o) => ["-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll", ...bitrate(o)] },
	{ name: "h264_amf", args: (o) => ["-c:v", "h264_amf", "-usage", "lowlatency", ...bitrate(o)] },
	{ name: "h264_vaapi", args: (o) => ["-c:v", "h264_vaapi", ...bitrate(o)] },
];

/** Noms des encodeurs d'une sortie `ffmpeg -encoders` ("  V....D libx264   libx264 H.264 …"). */
export function parseEncoderList(text) {
	const names = new Set();
	for (const line of String(text).split(/\r?\n/)) {
		const m = /^\s*[VAS][.A-Za-z]{5}\s+(\S+)/.exec(line);
		if (m) names.add(m[1]);
	}
	return names;
}

/** Encodeurs H.264 possédés par ce ffmpeg, dans l'ordre de préférence. */
export function availableVideoEncoders(encoderNames) {
	return VIDEO_ENCODERS.filter((e) => encoderNames.has(e.name));
}

const SIZE_RE = /^(\d{3,4})$/;
const SIZE_WH_RE = /^(\d{3,4})x(\d{3,4})$/;
const ASPECT_RE = /^\d{1,2}:\d{1,2}$/;

/**
 * Arguments pour servir un média à la volée (remux ou transcodage partiel) vers `pipe:1`, en MP4 fragmenté.
 * @param {object} o
 * @param {string} o.file        fichier source
 * @param {number} o.start       secondes (0 = depuis le début)
 * @param {boolean} o.isVideo
 * @param {"copy"|"encode"|null} o.video  traitement de la vidéo
 * @param {"copy"|"encode"} o.audio       traitement de l'audio
 * @param {string} o.sourceAudio  codec audio source normalisé ("aac"…), pour le filtre ADTS
 * @param {{name:string,args:(o:object)=>string[]}|null} o.encoder  encodeur H.264 à utiliser si video === "encode"
 * @param {string} [o.size]      "720" ou "1280x720" (vide = automatique)
 * @param {string} [o.aspect]    "16:9" (vide = automatique)
 * @param {Partial<typeof DEFAULT_PLAY_OPTS>} [o.opts]  réglages de l'utilisateur (cf. DEFAULT_PLAY_OPTS)
 * @returns {{args: string[], mime: string}}
 */
export function buildPlayArgs(o) {
	const p = { ...DEFAULT_PLAY_OPTS, ...(o.opts ?? {}) };
	const args = ["-nostdin", "-hide_banner", "-v", p.logLevel];
	// IMPORTANT : -hwaccel est une option d'ENTRÉE (avant -i) ; elle ne concerne que le décodage vidéo. « auto » laisse ffmpeg
	// choisir et retomber sur le logiciel si rien n'est disponible.
	if (p.hwaccel && o.isVideo && o.video === "encode") args.push("-hwaccel", "auto");
	if (o.start > 0) args.push("-ss", String(o.start));
	args.push("-i", o.file);
	const audioCodecArgs = ["-c:a", "aac", "-b:a", `${p.audioBitrate}k`, ...(p.audioChannels === "2" ? ["-ac", "2"] : [])];

	if (!o.isVideo) {
		// Audio seul : AAC dans un MP4 fragmenté. Pas de MP3 (libmp3lame est une dépendance externe dont un ffmpeg minimal se passe).
		args.push("-vn", ...audioCodecArgs, "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
		return { args, mime: "audio/mp4" };
	}

	// Première vidéo et piste audio choisie ; sous-titres et données écartés (la webview ne les affiche pas).
	// Le « ? » rend la piste facultative : un index absent du fichier donne une vidéo muette plutôt qu'une erreur.
	args.push("-map", "0:v:0", "-map", `0:a:${p.audioTrack}?`, "-sn", "-dn");
	if (o.video === "copy") args.push("-c:v", "copy");
	else {
		const wh = SIZE_WH_RE.exec(o.size ?? "");
		// Désentrelacement d'abord (avant la mise à l'échelle, sinon les lignes sont déjà mélangées).
		const filters = p.deinterlace ? ["yadif"] : [];
		// À défaut de réglage, dimensions paires (exigées par yuv420p).
		if (SIZE_RE.test(o.size ?? "")) filters.push(`scale=-2:${o.size}`);
		else if (wh) filters.push(`scale=${wh[1]}:${wh[2]}`);
		else filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2");
		args.push("-vf", filters.join(","));
		if (ASPECT_RE.test(o.aspect ?? "")) args.push("-aspect", o.aspect);
		// yuv420p force du 8 bits (un H.264 10 bits ressortirait illisible) ; -g : une image clé toutes les ~2 s par défaut, pour que
		// les fragments partent vite et que le démarrage ne dépende pas d'un long GOP.
		args.push(...o.encoder.args(p), "-pix_fmt", "yuv420p", "-g", String(p.gop));
		if (p.threads > 0) args.push("-threads", String(p.threads));
		// En dernier : une option répétée l'emporte sur la précédente, l'utilisateur peut donc affiner l'encodeur.
		args.push(...p.extraArgs);
	}
	if (o.audio === "copy") {
		args.push("-c:a", "copy");
		// L'AAC d'un MPEG-TS est en "ADTS" : sans ce filtre le MP4 refuse le flux. Sans effet sur un AAC déjà prêt (MKV, MP4).
		if (o.sourceAudio === "aac") args.push("-bsf:a", "aac_adtstoasc");
	}
	else args.push(...audioCodecArgs);
	args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
	return { args, mime: "video/mp4" };
}

/**
 * Arguments pour écrire des tags (et la pochette) dans un fichier, en copie sans réencodage, vers `tmp`.
 * @param {object} o
 * @param {string} o.file
 * @param {string} o.tmp
 * @param {string|null} o.coverFile  image de pochette à intégrer, ou null
 * @param {null|undefined|string} o.jacket  undefined = conserver, null = retirer, chaîne = remplacer
 * @param {boolean} o.isVideo
 * @param {boolean} o.isMp3
 * @param {boolean} o.id3v1
 * @param {"3"|"4"} [o.id3v2]  version ID3v2 écrite dans un MP3 (2.3 par défaut : la mieux comprise des lecteurs)
 * @param {Record<string,string>} o.tags  tags déjà nettoyés
 */
export function buildTagArgs(o) {
	const args = ["-y", "-v", "error", "-i", o.file];
	if (o.coverFile) args.push("-i", o.coverFile);
	if (o.isVideo) args.push("-map", "0");
	else if (o.coverFile) args.push("-map", "0:a", "-map", "1:v");
	else if (o.jacket === null) args.push("-map", "0:a");
	else args.push("-map", "0");
	args.push("-map_metadata", "0", "-c", "copy");
	if (o.coverFile) args.push("-disposition:v:0", "attached_pic", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
	if (o.isMp3) { args.push("-id3v2_version", o.id3v2 === "4" ? "4" : "3"); if (o.id3v1) args.push("-write_id3v1", "1"); }
	for (const [k, v] of Object.entries(o.tags)) args.push("-metadata", `${k}=${v}`);
	args.push(o.tmp);
	return args;
}
