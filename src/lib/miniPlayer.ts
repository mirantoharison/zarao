import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** Taille de la fenêtre en mode mini, et taille minimale de la fenêtre normale (cf. tauri.conf.json : minWidth / minHeight). */
const MINI = { width: 480, height: 200 };
const NORMAL_MIN = { width: 800, height: 600 };
const NORMAL_DEFAULT = { width: 1100, height: 700 };
let saved: { width: number; height: number } | null = null;

/**
 * Réduit la fenêtre en mini-lecteur, au-dessus des autres fenêtres. La taille actuelle est mémorisée pour `leaveMini`.
 * Hors Tauri (navigateur de dev) l'appel échoue : l'appelant continue, seul l'écran compact change.
 */
export async function enterMini(): Promise<void> {
  const win = getCurrentWindow();
  if (!saved) {
    const size = (await win.innerSize()).toLogical(await win.scaleFactor());
    saved = { width: size.width, height: size.height };
  }
  // Une fenêtre maximisée ignore le redimensionnement : on la ramène d'abord à sa taille normale.
  if (await win.isMaximized()) await win.unmaximize();
  // IMPORTANT : la taille minimale de la fenêtre normale (800 x 600) doit être levée AVANT de réduire, sinon la taille est ignorée.
  await win.setMinSize(new LogicalSize(MINI.width, MINI.height));
  await win.setSize(new LogicalSize(MINI.width, MINI.height));
  // Taille figée : ni redimensionnement (bords, coins) ni maximisation (bouton, double-clic sur la barre de titre). Après le `setSize`,
  // qui lui reste possible par programme.
  await win.setMaximizable(false);
  await win.setResizable(false);
  await win.setAlwaysOnTop(true);
}

/** Rend la fenêtre à sa taille d'avant (ou par défaut) et la remet au niveau normal. */
export async function leaveMini(): Promise<void> {
  const win = getCurrentWindow();
  await win.setAlwaysOnTop(false);
  // La fenêtre doit redevenir redimensionnable et maximisable AVANT de reprendre sa taille.
  await win.setResizable(true);
  await win.setMaximizable(true);
  await win.setMinSize(new LogicalSize(NORMAL_MIN.width, NORMAL_MIN.height));
  const size = saved ?? NORMAL_DEFAULT;
  saved = null;
  await win.setSize(new LogicalSize(Math.max(NORMAL_MIN.width, size.width), Math.max(NORMAL_MIN.height, size.height)));
}
