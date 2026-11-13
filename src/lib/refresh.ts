/**
 * Rafraîchit l'écran : recharge l'interface (webview) comme un F5 de navigateur.
 * IMPORTANT : l'état en mémoire (lecture en cours, mode choisi) est perdu et l'on revient à l'écran de choix du mode ;
 * ce qui est mémorisé (session « Rester connecté », palette, zoom, réglages, langue) est conservé.
 */
export function refreshScreen(): void {
  window.location.reload();
}

/**
 * À appeler une fois au démarrage : installe le raccourci F5.
 * Géré ici (et non laissé à la webview) pour que le raccourci affiché dans le menu corresponde toujours à ce qui se passe,
 * y compris dans une version empaquetée où les raccourcis natifs de la webview peuvent être désactivés.
 */
export function initRefresh(): void {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F5" || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    e.preventDefault();
    refreshScreen();
  });
}
