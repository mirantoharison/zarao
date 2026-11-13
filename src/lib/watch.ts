import { scanFolder } from "@/lib/files";

/**
 * Surveillance de dossiers par scrutation : on relit périodiquement les dossiers choisis et on signale les fichiers nouveaux.
 *
 * IMPORTANT : pas d'API de notification du système (plugin fs « watch ») : elle exige une fonctionnalité Cargo et une permission
 * supplémentaires, donc une recompilation de la partie Rust. La scrutation fonctionne partout, au prix d'un délai (réglable).
 *
 * Mémoire des fichiers déjà vus, par dossier : sans elle, chaque lancement ré-ajouterait tout, et un fichier déposé pendant que
 * l'application était fermée ne serait jamais détecté. Premier passage sur un dossier = simple état de référence (rien n'est ajouté),
 * pour ne pas inonder la liste de lecture avec toute une bibliothèque.
 */
const KNOWN_KEY = "zarao.watch.known";
/** Plafond de chemins mémorisés par dossier (le scan lui-même est déjà plafonné à 5000). */
const MAX_KNOWN = 5000;

function readKnown(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [folder, list] of Object.entries(raw)) if (Array.isArray(list)) out[folder] = list.filter((p): p is string => typeof p === "string");
    return out;
  } catch {
    return {};
  }
}

function writeKnown(known: Record<string, string[]>): void {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify(known)); } catch { /* quota atteint : on repartira d'un état de référence */ }
}

/** Fichiers apparus depuis le dernier passage dans ces dossiers. Un dossier illisible (disque débranché) est ignoré, sans perdre sa mémoire. */
export async function findNewFiles(folders: string[]): Promise<string[]> {
  const known = readKnown();
  const fresh: string[] = [];
  const next: Record<string, string[]> = {};
  for (const folder of folders) {
    let files: string[];
    try { files = await scanFolder(folder); } catch { if (known[folder]) next[folder] = known[folder]; continue; }
    const before = known[folder];
    if (before) {
      const seen = new Set(before);
      fresh.push(...files.filter((f) => !seen.has(f)));
    }
    next[folder] = files.slice(0, MAX_KNOWN);
  }
  // Un dossier retiré de la liste perd sa mémoire : s'il est ajouté de nouveau, ce sera un nouvel état de référence.
  writeKnown(next);
  return fresh;
}
