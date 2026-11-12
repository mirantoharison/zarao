import fs from "node:fs";

/**
 * Écriture d'une vraie trame USLT (paroles) dans un MP3 déjà passé par ffmpeg (ID3v2.3).
 *
 * IMPORTANT : ffmpeg ne sait pas écrire USLT. Avec `-metadata lyrics=…` il produit une trame TXXX de description « USLT »,
 * qu'aucun lecteur ni music-metadata ne reconnaît comme des paroles. On injecte donc la trame nous-mêmes : on retire toute
 * trame USLT existante, on ajoute la nouvelle (UTF-16 avec BOM, norme ID3v2.3) et on réécrit l'en-tête ; l'audio n'est pas touché.
 * Texte vide = paroles retirées.
 */

/** Taille « synchsafe » (7 bits par octet) de l'en-tête ID3v2. */
const readSyncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const writeSyncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** Trame USLT : encodage 1 (UTF-16 + BOM), langue « eng », description vide, puis le texte. */
function usltFrame(text) {
	const utf16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
	const body = Buffer.concat([
		Buffer.from([0x01]), Buffer.from("eng", "latin1"),
		utf16(""), Buffer.from([0x00, 0x00]), // description vide : BOM + terminateur
		utf16(text),
	]);
	const head = Buffer.alloc(10);
	head.write("USLT", 0, "latin1");
	head.writeUInt32BE(body.length, 4); // ID3v2.3 : taille classique, pas synchsafe
	return Buffer.concat([head, body]);
}

/**
 * Remplace (ou retire, si `text` est vide) les paroles du fichier MP3 `file`, en place.
 * @returns {boolean} false si le fichier n'a pas de tag ID3v2.3 exploitable (rien n'est alors modifié).
 */
export function writeMp3Lyrics(file, text) {
	const buf = fs.readFileSync(file);
	// Seulement ID3v2.3 sans drapeaux (ni désynchronisation ni en-tête étendu) : c'est ce qu'écrit ffmpeg ici.
	if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3" || buf[3] !== 3 || buf[5] !== 0) return false;
	const tagSize = readSyncsafe(buf, 6);
	const end = 10 + tagSize;
	if (end > buf.length) return false;

	// Parcours des trames : on garde tout sauf USLT, jusqu'au remplissage (octets nuls).
	const kept = [];
	let pos = 10;
	while (pos + 10 <= end && buf[pos] !== 0x00) {
		const id = buf.toString("latin1", pos, pos + 4);
		const size = buf.readUInt32BE(pos + 4);
		if (size < 0 || pos + 10 + size > end) return false; // tag incohérent : on ne touche à rien
		if (id !== "USLT") kept.push(buf.subarray(pos, pos + 10 + size));
		pos += 10 + size;
	}
	const frames = Buffer.concat([...kept, ...(text ? [usltFrame(text)] : [])]);
	const padding = Buffer.alloc(256); // marge pour de futures retouches sans réécrire tout le fichier
	const header = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]), writeSyncsafe(frames.length + padding.length)]);
	fs.writeFileSync(file, Buffer.concat([header, frames, padding, buf.subarray(end)]));
	return true;
}
