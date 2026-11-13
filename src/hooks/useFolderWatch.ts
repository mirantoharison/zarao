import { useEffect } from "react";
import { useScanSettings } from "@/lib/settings";
import { findNewFiles } from "@/lib/watch";

/**
 * Relit les dossiers surveillés (Paramètres › Bibliothèque) et confie les nouveaux fichiers à `onNew`.
 * Premier passage immédiat (état de référence ou rattrapage de ce qui est arrivé application fermée), puis un passage par intervalle.
 * IMPORTANT : un passage ne démarre pas tant que le précédent n'est pas fini (gros dossier, disque lent), et rien ne tourne en arrière-plan
 * quand la fenêtre est masquée.
 */
export function useFolderWatch(onNew: (paths: string[]) => void): void {
  const { watchFolders, watchInterval } = useScanSettings();
  const key = watchFolders.join("\n");
  useEffect(() => {
    if (watchFolders.length === 0) return;
    let busy = false;
    let cancelled = false;
    const run = async () => {
      if (busy || cancelled || document.hidden) return;
      busy = true;
      try {
        const fresh = await findNewFiles(watchFolders);
        if (!cancelled && fresh.length > 0) onNew(fresh);
      } catch { /* dossier inaccessible : réessayé au prochain passage */ }
      finally { busy = false; }
    };
    void run();
    const id = setInterval(() => void run(), watchInterval * 1000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, watchInterval, onNew]);
}
