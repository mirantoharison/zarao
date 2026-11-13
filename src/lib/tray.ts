import { useEffect, useRef } from "react";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { usePlayer } from "@/hooks/usePlayer";
import { tr } from "@/i18n";

type Player = ReturnType<typeof usePlayer>;

/** Affiche la fenêtre (même réduite ou cachée) ou la cache si elle est déjà visible. */
async function toggleWindow(): Promise<void> {
  const win = getCurrentWindow();
  if ((await win.isVisible()) && !(await win.isMinimized())) { await win.hide(); return; }
  await win.show();
  await win.unminimize();
  await win.setFocus();
}

/**
 * Icône dans la zone de notification : clic gauche = afficher / cacher la fenêtre, menu = lecture, piste précédente / suivante, quitter.
 * L'info-bulle indique la piste en cours. Créée à l'ouverture d'un lecteur et retirée à sa fermeture ; sans effet hors Tauri.
 * IMPORTANT : les actions lisent le lecteur par une ref, car la fonction `p` change à chaque rendu et l'icône n'est créée qu'une fois.
 */
export function useTray(p: Player): void {
  const ref = useRef(p);
  ref.current = p;
  const trayRef = useRef<TrayIcon | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const menu = await Menu.new({
          items: [
            await MenuItem.new({ id: "toggle", text: tr("tray.show"), action: () => void toggleWindow() }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({ id: "play", text: tr("tray.play"), action: () => ref.current.togglePlay() }),
            await MenuItem.new({ id: "prev", text: tr("tray.prev"), action: () => ref.current.previous() }),
            await MenuItem.new({ id: "next", text: tr("tray.next"), action: () => ref.current.next() }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({ id: "quit", text: tr("tray.quit"), action: () => void getCurrentWindow().close() }),
          ],
        });
        const tray = await TrayIcon.new({
          icon: (await defaultWindowIcon()) ?? undefined,
          tooltip: "Zarao",
          menu,
          showMenuOnLeftClick: false,
          action: (event) => { if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") void toggleWindow(); },
        });
        if (cancelled) { await tray.close(); return; }
        trayRef.current = tray;
      } catch { /* hors Tauri ou icône indisponible : l'application fonctionne sans */ }
    })();
    return () => {
      cancelled = true;
      const tray = trayRef.current;
      trayRef.current = null;
      void tray?.close().catch(() => undefined);
    };
  }, []);

  // Info-bulle : « Titre — Artiste » de la piste en cours.
  const title = p.current ? [p.current.title, p.current.artist].filter(Boolean).join(" — ") : "";
  useEffect(() => { void trayRef.current?.setTooltip(title ? `Zarao — ${title}` : "Zarao").catch(() => undefined); }, [title]);
}
