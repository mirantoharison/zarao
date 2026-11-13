/**
 * Vitesse de lecture mémorisée PAR MÉDIA (clé = chemin du fichier) : un podcast ou un livre audio gardent leur 1,5×,
 * sans que la musique qui suit soit jouée trop vite. 1× n'est jamais stocké (c'est la valeur par défaut).
 */
const KEY = "zarao.rates";
const MAX_ENTRIES = 1000;

function readAll(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [path, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && v > 0 && v !== 1) out[path] = v;
    return out;
  } catch { return {}; }
}

/** Vitesse mémorisée pour ce média, 1 à défaut. */
export function readRate(path: string): number {
  return readAll()[path] ?? 1;
}

export function saveRate(path: string, rate: number): void {
  const all = readAll();
  if (rate === 1) delete all[path]; else { delete all[path]; all[path] = rate; } // réinsérée en dernier : l'ordre sert à écarter les plus anciennes
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* non bloquant */ }
}
