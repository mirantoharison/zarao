// Copie le Node.js en cours dans src-tauri/resources/node/ pour l'embarquer avec l'application.
//
// IMPORTANT : le serveur utilise des modules natifs (better-sqlite3, bcrypt) compilés pour la version
// de Node qui a lancé `npm install`. On embarque donc CE Node-là (process.execPath), jamais un autre :
// une version différente ferait échouer le chargement des modules natifs ("NODE_MODULE_VERSION mismatch").
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src-tauri", "resources", "node");
const name = process.platform === "win32" ? "node.exe" : "node";
const target = join(dir, name);

mkdirSync(dir, { recursive: true });
// Évite de recopier 80 Mo à chaque lancement quand c'est déjà le bon binaire.
if (!existsSync(target) || statSync(target).size !== statSync(process.execPath).size) {
  copyFileSync(process.execPath, target);
  console.log(`[bundle-node] Node ${process.version} copié dans ${target}`);
} else {
  console.log(`[bundle-node] Node ${process.version} déjà en place`);
}
