#!/usr/bin/env node
/**
 * Vérifie qu'un binaire ffmpeg sait faire tout ce que le serveur de Zarao lui demande.
 *
 *   node tools/ffmpeg-check.mjs --ffmpeg <ffmpeg à tester> [--fixtures-ffmpeg <ffmpeg complet>] [--without <enc1,enc2>] [--keep]
 *
 * Les fichiers de test sont fabriqués avec un ffmpeg COMPLET (sources lavfi, encodeurs x264/x265/vorbis/wma…) : par défaut le
 * même binaire, sinon `--fixtures-ffmpeg`. Un ffmpeg minimal ne sait pas les fabriquer, mais il doit savoir les LIRE.
 * Les arguments viennent de server/ffmpeg-args.mjs : ce qui est validé ici est exactement ce que le serveur exécute.
 *
 * Codes de sortie : 0 tout passe, 1 au moins un test échoue, 2 mauvaise utilisation.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { availableVideoEncoders, buildPlayArgs, buildTagArgs, parseEncoderList } from "../server/ffmpeg-args.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const TESTED = opt("ffmpeg");
const FIXTURER = opt("fixtures-ffmpeg") ?? TESTED;
const KEEP = argv.includes("--keep");
if (!TESTED) { console.error("Usage : node tools/ffmpeg-check.mjs --ffmpeg <chemin> [--fixtures-ffmpeg <chemin>] [--keep]"); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zarao-check-"));
const run = (bin, args, timeout = 60_000) => spawnSync(bin, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });

// ---------- Fixtures ----------
const A = ["-f", "lavfi", "-i", "sine=frequency=440:duration=6"];
const V = ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=6"];
const fx = (name, ...args) => { const r = run(FIXTURER, ["-y", "-v", "error", ...args, path.join(dir, name)]); return r.status === 0 ? path.join(dir, name) : null; };
console.log(`ffmpeg testé : ${TESTED} (${(fs.statSync(TESTED).size / 1048576).toFixed(1)} Mo)`);
console.log("Fabrication des fichiers de test…");
const F = {
	wma: fx("a.wma", ...A, "-c:a", "wmav2"),
	avi: fx("v.avi", ...V, ...A, "-c:v", "mpeg4", "-c:a", "libmp3lame", "-shortest"),
	mpg: fx("v.mpg", ...V, ...A, "-c:v", "mpeg2video", "-c:a", "mp2", "-shortest"),
	ts: fx("v.ts", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "15", "-c:a", "aac", "-shortest", "-f", "mpegts"),
	mkvTenBit: fx("v_10bit.mkv", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-c:a", "aac", "-shortest"),
	mkvAac: fx("v_h264_aac.mkv", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"),
	mkvAc3: fx("v_h264_ac3.mkv", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "ac3", "-shortest"),
	mp4Ac3: fx("v_h264_ac3.mp4", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "ac3", "-shortest"),
	mkvVorbis: fx("v_h264_vorbis.mkv", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "libvorbis", "-shortest"),
	mkvHevc: fx("v_hevc.mkv", ...V, ...A, "-c:v", "libx265", "-c:a", "aac", "-shortest"),
	mkvVp9: fx("v_vp9_opus.mkv", ...V, ...A, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-c:a", "libopus", "-shortest"),
	mp3: fx("a.mp3", ...A, "-c:a", "libmp3lame"),
	flac: fx("a.flac", ...A, "-c:a", "flac"),
	m4a: fx("a.m4a", ...A, "-c:a", "aac"),
	mp4: fx("v.mp4", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"),
	mkvTags: fx("t.mkv", ...V, ...A, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"),
	cover: fx("cover.png", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1"),
};
const missing = Object.entries(F).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
	console.error(`\nImpossible de fabriquer : ${missing.join(", ")}.\nLe ffmpeg de fixtures doit être un build COMPLET (lavfi, libx264, libx265, libvpx, libopus, libvorbis, libmp3lame, wmav2, ac3).\nPassez-en un avec --fixtures-ffmpeg.`);
	process.exit(2);
}

// ---------- Lecture d'un résultat avec le ffmpeg testé ----------
/** Décode `file` en entier et retourne codecs, images décodées et métadonnées lues dans la sortie de ffmpeg. */
function inspect(file) {
	const r = run(TESTED, ["-hide_banner", "-i", file, "-f", "null", "-"]);
	const err = r.stderr ?? "";
	const video = /Stream #\d+:\d+[^\n]*: Video: ([\w.]+)[^\n]*/.exec(err);
	const audio = /Stream #\d+:\d+[^\n]*: Audio: ([\w.]+)/.exec(err);
	const frames = [...err.matchAll(/frame=\s*(\d+)/g)].pop()?.[1];
	return {
		ok: r.status === 0, video: video?.[1] ?? "", audio: audio?.[1] ?? "",
		pix: /\b(yuv\w+|nv12|gbr\w+)\b/.exec((video?.[0] ?? "").replace(/^[^,]*,/, ""))?.[1] ?? "",
		height: Number(/,\s*\d+x(\d+)/.exec(video?.[0] ?? "")?.[1] ?? 0), frames: frames ? Number(frames) : 0, err,
	};
}

// ---------- Encodeurs ----------
const encList = run(TESTED, ["-hide_banner", "-encoders"]);
if (encList.status !== 0) { console.error("Ce binaire ne répond pas à `ffmpeg -encoders`."); process.exit(1); }
const names = parseEncoderList(encList.stdout);
// --without libx264,h264_qsv : simule un build qui n'a pas ces encodeurs (vérifie le repli sans avoir à compiler).
const exclude = new Set((opt("without") ?? "").split(",").map((x) => x.trim()).filter(Boolean));
const candidates = availableVideoEncoders(names).filter((e) => !exclude.has(e.name));
console.log(`Encodeur AAC (natif) : ${names.has("aac") ? "oui" : "NON"}`);
console.log(`Encodeurs H.264 listés : ${candidates.map((e) => e.name).join(", ") || "AUCUN"}`);

// ---------- Scénarios ----------
const results = [];
const report = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "  ok " : "  ÉCHEC"}  ${name}${detail ? "  — " + detail : ""}`); };
const usedEncoders = new Map();

/** Comme le serveur : on essaie les encodeurs à la suite jusqu'à ce qu'un produise un flux. */
function playOnce(file, { video, audio, sourceAudio, isVideo = true, start = 0, size = "", aspect = "" }) {
	const needsEncoder = isVideo && video === "encode";
	for (const encoder of needsEncoder ? candidates : [null]) {
		const { args } = buildPlayArgs({ file, start, isVideo, video, audio, sourceAudio, encoder, size, aspect });
		const out = path.join(dir, `out-${Math.random().toString(36).slice(2)}.mp4`);
		const r = run(TESTED, [...args.slice(0, -1), "-y", out]);
		if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) return { out, encoder: encoder?.name ?? null };
	}
	return null;
}

const PLAYS = [
	{ label: "audio WMA → AAC (audio seul)", file: F.wma, isVideo: false, audio: "encode", expectAudio: "aac" },
	{ label: "AVI MPEG-4 + MP3 → H.264, audio copié", file: F.avi, video: "encode", audio: "copy", sourceAudio: "mp3", expectVideo: "h264", expectAudio: "mp3" },
	{ label: "MPG MPEG-2 + MP2 → H.264 + AAC", file: F.mpg, video: "encode", audio: "encode", expectVideo: "h264", expectAudio: "aac" },
	{ label: "TS H.264 + AAC ADTS → remux", file: F.ts, video: "copy", audio: "copy", sourceAudio: "aac", expectVideo: "h264", expectAudio: "aac" },
	{ label: "MKV H.264 10 bits → H.264 8 bits", file: F.mkvTenBit, video: "encode", audio: "copy", sourceAudio: "aac", expectVideo: "h264", expectAudio: "aac", expectPix: "yuv420p" },
	{ label: "MKV H.264 + AAC → remux", file: F.mkvAac, video: "copy", audio: "copy", sourceAudio: "aac", expectVideo: "h264", expectAudio: "aac" },
	{ label: "MKV H.264 + AC3 → audio AAC", file: F.mkvAc3, video: "copy", audio: "encode", expectVideo: "h264", expectAudio: "aac" },
	{ label: "MP4 H.264 + AC3 → audio AAC", file: F.mp4Ac3, video: "copy", audio: "encode", expectVideo: "h264", expectAudio: "aac" },
	{ label: "MKV H.264 + Vorbis → audio AAC", file: F.mkvVorbis, video: "copy", audio: "encode", expectVideo: "h264", expectAudio: "aac" },
	{ label: "MKV HEVC + AAC → H.264", file: F.mkvHevc, video: "encode", audio: "copy", sourceAudio: "aac", expectVideo: "h264", expectAudio: "aac" },
	{ label: "MKV VP9 + Opus → remux", file: F.mkvVp9, video: "copy", audio: "copy", expectVideo: "vp9", expectAudio: "opus" },
];

console.log("\nLecture à la volée :");
for (const t of PLAYS) {
	const res = playOnce(t.file, t);
	if (!res) { report(t.label, false, "aucun encodeur/démultiplexeur n'a produit de flux"); continue; }
	const i = inspect(res.out);
	const problems = [];
	if (!i.ok) problems.push("sortie illisible");
	if (t.expectVideo && i.video !== t.expectVideo) problems.push(`vidéo ${i.video || "—"} (attendu ${t.expectVideo})`);
	if (t.expectAudio && i.audio !== t.expectAudio) problems.push(`audio ${i.audio || "—"} (attendu ${t.expectAudio})`);
	if (t.expectPix && i.pix !== t.expectPix) problems.push(`pixels ${i.pix} (attendu ${t.expectPix})`);
	if (res.encoder) usedEncoders.set(res.encoder, (usedEncoders.get(res.encoder) ?? 0) + 1);
	report(t.label, problems.length === 0, problems.join(", ") || (res.encoder ? `via ${res.encoder}` : ""));
}

console.log("\nDéplacement dans la piste (vidéo réencodée, précision attendue) :");
for (const [label, file, src, expectedSeconds] of [["MKV H.264 + AAC", F.mkvAac, "aac", 3], ["TS H.264 + AAC", F.ts, "aac", 3], ["MKV HEVC + AAC", F.mkvHevc, "aac", 3]]) {
	const res = playOnce(file, { video: "encode", audio: "copy", sourceAudio: src, start: 3 });
	if (!res) { report(`${label}, saut à 3 s`, false, "aucun flux"); continue; }
	const i = inspect(res.out);
	const seconds = i.frames / 15;
	report(`${label}, saut à 3 s`, i.ok && Math.abs(seconds - expectedSeconds) <= 0.6, `${seconds.toFixed(1)} s d'images (attendu ≈ ${expectedSeconds})`);
}

console.log("\nRésolution et ratio :");
{
	const res = playOnce(F.mkvHevc, { video: "encode", audio: "copy", sourceAudio: "aac", size: "240", aspect: "1:1" });
	const i = res ? inspect(res.out) : null;
	report("MKV HEVC → 240p, ratio 1:1", Boolean(i?.ok && i.height === 240), i ? `hauteur ${i.height}` : "aucun flux");
}

console.log("\nÉcriture des tags (copie sans réencodage) :");
const TAGS = { title: "Titre test", artist: "Artiste test", album: "Album test" };
function tagTest(label, file, ext, { jacket, withCover = false, isMp3 = false, isVideo = false }) {
	const tmp = path.join(dir, `tag-${Math.random().toString(36).slice(2)}.${ext}`);
	const args = buildTagArgs({ file, tmp, coverFile: withCover ? F.cover : null, jacket, isVideo, isMp3, id3v1: isMp3, tags: TAGS });
	const r = run(TESTED, args);
	if (r.status !== 0) return report(label, false, (r.stderr || "").trim().split("\n").pop()?.slice(0, 90));
	const i = inspect(tmp);
	// Insensible à la casse : Matroska affiche ARTIST, MP3/MP4 affichent artist.
	const readsBack = /title\s*:\s*Titre test/i.test(i.err) && /artist\s*:\s*Artiste test/i.test(i.err);
	const coverOk = withCover ? /Video: (png|mjpeg)/.test(i.err) : jacket === null ? !/Video:/.test(i.err) : true;
	report(label, i.ok && readsBack && coverOk, [!i.ok && "illisible", !readsBack && "tags non relus", !coverOk && "pochette incorrecte"].filter(Boolean).join(", "));
}
tagTest("MP3 : tags (pochette conservée)", F.mp3, "mp3", { isMp3: true });
tagTest("MP3 : tags + nouvelle pochette PNG", F.mp3, "mp3", { isMp3: true, withCover: true, jacket: "data" });
tagTest("MP3 : retrait de la pochette", F.mp3, "mp3", { isMp3: true, jacket: null });
tagTest("FLAC : tags", F.flac, "flac", {});
tagTest("M4A : tags", F.m4a, "m4a", {});
tagTest("MP4 vidéo : tags", F.mp4, "mp4", { isVideo: true });
tagTest("MKV vidéo : tags", F.mkvTags, "mkv", { isVideo: true });

// ---------- Bilan ----------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests réussis.`);
if (usedEncoders.size) console.log(`Encodeur(s) H.264 effectivement utilisé(s) : ${[...usedEncoders.keys()].join(", ")}`);
if (!KEEP) fs.rmSync(dir, { recursive: true, force: true }); else console.log(`Fichiers conservés dans ${dir}`);
process.exit(failed.length ? 1 : 0);
