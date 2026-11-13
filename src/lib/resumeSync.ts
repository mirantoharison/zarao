import { ONLINE_BASE } from "@/lib/api";
import { mergeOnlineResume, onlineResumeEntries, setOnlineResumeListener } from "@/lib/resume";

/** Délai avant d'envoyer au serveur : la position change toutes les 3 s, on regroupe les envois. */
const PUSH_DELAY_MS = 10_000;

type Entries = Record<string, { t: number; at: number }>;

/**
 * Synchronise la reprise des vidéos EN LIGNE avec le compte : à l'ouverture on récupère les positions du serveur (fusion, la plus récente
 * l'emporte) puis on lui envoie les nôtres ; ensuite chaque changement est envoyé en différé. Retourne la fonction d'arrêt, qui envoie
 * ce qui reste en attente. Aucun échec réseau ne se voit : la reprise locale continue de fonctionner, et la prochaine synchro rattrape.
 */
export function startResumeSync(userId: string): () => void {
  let timer: number | undefined;
  let pending = false;

  async function push(): Promise<void> {
    pending = false;
    try {
      const r = await fetch(`${ONLINE_BASE}/account/resume`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: userId, entries: onlineResumeEntries() }) });
      const d = (await r.json()) as { saved?: boolean; entries?: Entries };
      if (d.saved && d.entries) mergeOnlineResume(d.entries);
    } catch { /* hors ligne : renvoyé à la prochaine modification ou à la prochaine ouverture */ }
  }

  setOnlineResumeListener(() => {
    pending = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void push(), PUSH_DELAY_MS);
  });

  void (async () => {
    try {
      const r = await fetch(`${ONLINE_BASE}/account/resume?id=${encodeURIComponent(userId)}`);
      const d = (await r.json()) as { found?: boolean; entries?: Entries };
      if (d.found && d.entries) mergeOnlineResume(d.entries);
      await push();
    } catch { /* serveur injoignable : on garde les positions locales */ }
  })();

  return () => {
    window.clearTimeout(timer);
    setOnlineResumeListener(null);
    if (pending) void push();
  };
}
