/**
 * Schéma des réglages du serveur local (fonctions pures, sans accès disque).
 *
 * IMPORTANT : tous les réglages sont stockés sous forme de TEXTE dans la table `settings` (clé → valeur). Une valeur vide
 * signifie « défaut » : on peut donc ajouter un réglage sans migration, et un ancien client qui n'envoie pas la clé
 * ne l'écrase pas. Les valeurs par défaut reproduisent exactement le comportement d'avant l'existence du réglage.
 */

const X264_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"];
const LOG_LEVELS = ["quiet", "error", "warning", "info"];

/**
 * type : "text" (regex facultative), "int" (bornes ; `zero` autorise 0 = automatique), "bool", "enum".
 * IMPORTANT : `def` est la valeur appliquée quand rien n'est enregistré.
 */
export const SETTING_DEFS = {
	ffmpeg: { type: "text", def: "", max: 1000 },
	// Transcodage
	videoSize: { type: "text", def: "", re: /^(\d{3,4}|\d{3,4}x\d{3,4})?$/ },
	videoAspect: { type: "text", def: "", re: /^(\d{1,2}:\d{1,2})?$/ },
	playPolicy: { type: "enum", def: "auto", values: ["auto", "encode"] },
	encoder: { type: "text", def: "", re: /^([a-z0-9_]{1,32})?$/ },
	videoBitrate: { type: "int", def: 0, min: 300, max: 50000, zero: true },
	x264Preset: { type: "enum", def: "ultrafast", values: X264_PRESETS },
	x264Crf: { type: "int", def: 23, min: 0, max: 51 },
	audioBitrate: { type: "int", def: 192, min: 64, max: 512 },
	audioChannels: { type: "enum", def: "2", values: ["2", "source"] },
	gop: { type: "int", def: 60, min: 10, max: 600 },
	audioTrack: { type: "int", def: 0, min: 0, max: 15 },
	/** Langue audio préférée (code ISO 639-2, ex. "fra") : prioritaire sur l'index quand le fichier la propose. */
	audioLang: { type: "text", def: "", re: /^([a-z]{3})?$/ },
	deinterlace: { type: "bool", def: false },
	hwaccel: { type: "bool", def: false },
	// Performance
	threads: { type: "int", def: 0, min: 1, max: 64, zero: true },
	priority: { type: "enum", def: "normal", values: ["normal", "belowNormal", "low"] },
	maxStreams: { type: "int", def: 0, min: 1, max: 8, zero: true },
	extraArgs: { type: "text", def: "", max: 400 },
	// Bibliothèque et tags
	id3v2: { type: "enum", def: "3", values: ["3", "4"] },
	tagBackup: { type: "bool", def: false },
	// Serveur et diagnostic
	/** Port d'écoute du serveur local (0 = défaut). Pris en compte au prochain lancement. */
	port: { type: "int", def: 0, min: 1024, max: 65535, zero: true },
	logLevel: { type: "enum", def: "error", values: LOG_LEVELS },
	probeTimeout: { type: "int", def: 15, min: 5, max: 120 },
	tagTimeout: { type: "int", def: 120, min: 10, max: 600 },
};

/** Valeur brute (texte de la base, "" = défaut) → valeur typée. Une valeur corrompue retombe sur le défaut. */
export function parseSetting(key, raw) {
	const d = SETTING_DEFS[key];
	const text = String(raw ?? "");
	if (!d || text === "") return d?.def ?? "";
	if (d.type === "bool") return text === "1";
	if (d.type === "int") {
		const n = Number(text);
		return Number.isInteger(n) && (n === 0 ? d.zero || d.min <= 0 : n >= d.min && n <= d.max) ? n : d.def;
	}
	if (d.type === "enum") return d.values.includes(text) ? text : d.def;
	return text;
}

/**
 * Valide une entrée venue du client. Retourne { ok: true, value } avec la valeur CANONIQUE à stocker (texte),
 * ou { ok: false }. Une entrée vide revient au défaut.
 */
export function validateSettingInput(key, input) {
	const d = SETTING_DEFS[key];
	if (!d) return { ok: false };
	if (d.type === "bool") {
		if (input === "" || input === null || input === undefined) return { ok: true, value: "" };
		if (input === true || input === "1" || input === "true") return { ok: true, value: "1" };
		if (input === false || input === "0" || input === "false") return { ok: true, value: "0" };
		return { ok: false };
	}
	const text = String(input ?? "").trim();
	if (text === "") return { ok: true, value: "" };
	if (d.type === "int") {
		const n = Number(text);
		if (!Number.isInteger(n)) return { ok: false };
		if (n === 0 && d.zero) return { ok: true, value: "0" };
		return n >= d.min && n <= d.max ? { ok: true, value: String(n) } : { ok: false };
	}
	if (d.type === "enum") return d.values.includes(text) ? { ok: true, value: text } : { ok: false };
	if (text.length > (d.max ?? 200)) return { ok: false };
	if (d.re && !d.re.test(text)) return { ok: false };
	if (key === "extraArgs" && !sanitizeExtraArgs(text).ok) return { ok: false };
	return { ok: true, value: text };
}

/**
 * Options ffmpeg que l'utilisateur peut ajouter à la main.
 * IMPORTANT : liste blanche. Ffmpeg sait lire n'importe quel fichier (-i), écrire ailleurs (-f segment…) ou charger des
 * filtres qui ouvrent des fichiers (movie=…) : on n'autorise donc que des réglages d'encodeur, avec une valeur « simple »
 * (lettres, chiffres et . : = , + - *), sans séparateur de chemin. Aucun shell n'est impliqué (spawn sans shell).
 */
const ALLOWED_EXTRA = new Set([
	"-preset", "-tune", "-profile:v", "-level", "-crf", "-qp", "-cq", "-bf", "-refs", "-maxrate", "-bufsize", "-rc",
	"-x264-params", "-x264opts", "-sc_threshold", "-keyint_min", "-ar", "-quality", "-usage",
]);
const EXTRA_VALUE_RE = /^[A-Za-z0-9_.:=,+*][A-Za-z0-9_.:=,+*-]*$/;

/** "-preset fast -tune zerolatency" → { ok: true, args: [...] } ; toute option inconnue ou valeur suspecte → { ok: false }. */
export function sanitizeExtraArgs(text) {
	const tokens = String(text ?? "").trim().split(/\s+/).filter(Boolean);
	if (tokens.length % 2 !== 0) return { ok: false };
	for (let i = 0; i < tokens.length; i += 2) {
		if (!ALLOWED_EXTRA.has(tokens[i]) || !EXTRA_VALUE_RE.test(tokens[i + 1])) return { ok: false };
	}
	return { ok: true, args: tokens };
}

/** Codes ISO 639-2 : certaines langues ont deux codes (bibliographique / terminologique), les fichiers utilisent l'un ou l'autre. */
const LANG_VARIANTS = [["fra", "fre"], ["deu", "ger"], ["zho", "chi"], ["ces", "cze"], ["nld", "dut"], ["ell", "gre"], ["fas", "per"]];

/** Vrai si l'étiquette de langue d'une piste correspond à la langue demandée. */
export function audioLangMatches(wanted, tag) {
	if (!wanted || !tag) return false;
	const group = LANG_VARIANTS.find((g) => g.includes(wanted)) ?? [wanted];
	return group.includes(String(tag).toLowerCase());
}
