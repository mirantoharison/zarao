import { useCallback, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { open as openFile } from "@tauri-apps/plugin-fs";
import { downloadUrl, prepareDownload } from "@/lib/api";
import { tr } from "@/i18n";

export type DownloadEntry = {
  id: string;
  name: string;
  status: "running" | "done" | "error" | "canceled";
  /** 0–100 */
  progress: number;
  path?: string;
  error?: string;
};

/**
 * Téléchargements de la session.
 * IMPORTANT : écriture en flux (chunk par chunk) vers le fichier choisi — jamais le fichier entier en mémoire,
 * un film de plusieurs Go ferait planter la webview.
 */
export function useDownloads() {
  const [entries, setEntries] = useState<DownloadEntry[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, p: Partial<DownloadEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...p } : e)));
  }, []);

  const start = useCallback(async (remoteId: string, fallbackName: string) => {
    const info = await prepareDownload(remoteId);
    if (!info) throw new Error("not-found");
    const target = await save({ title: tr("dl.saveTitle"), defaultPath: info.name || fallbackName });
    if (!target) return; // annulé par l'utilisateur dans la boîte de dialogue

    const id = crypto.randomUUID();
    const ctrl = new AbortController();
    controllers.current.set(id, ctrl);
    setEntries((prev) => [{ id, name: info.name || fallbackName, status: "running", progress: 0, path: target }, ...prev]);

    let handle: Awaited<ReturnType<typeof openFile>> | null = null;
    try {
      const res = await fetch(downloadUrl(info.token), { signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || info.size || 0;
      handle = await openFile(target, { write: true, create: true, truncate: true });
      const reader = res.body.getReader();
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await handle.write(value);
        loaded += value.byteLength;
        if (total) patch(id, { progress: Math.min(99, Math.round((loaded / total) * 100)) });
      }
      patch(id, { status: "done", progress: 100 });
    } catch (err) {
      const canceled = (err as Error).name === "AbortError";
      patch(id, { status: canceled ? "canceled" : "error", error: canceled ? undefined : String(err) });
    } finally {
      await handle?.close().catch(() => undefined);
      controllers.current.delete(id);
    }
  }, [patch]);

  const cancel = useCallback((id: string) => controllers.current.get(id)?.abort(), []);

  return { entries, start, cancel };
}
