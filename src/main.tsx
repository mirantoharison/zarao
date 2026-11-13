import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Police embarquée (pas de Google Fonts) : l'app Tauri doit rendre pareil hors-ligne.
import '@fontsource-variable/outfit'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { initZoom } from './lib/zoom.ts'
import { initPalette } from './lib/palette.ts'
import { initRefresh } from './lib/refresh.ts'

// Zoom mémorisé appliqué avant le premier rendu : évite un saut de taille visible au démarrage.
initZoom()
// Palette mémorisée appliquée avant le premier rendu (même raison).
initPalette()
// Raccourci F5 (Rafraîchir l'écran) actif sur tous les écrans.
initRefresh()

// Menu natif du WebView (Retour, Recharger, Inspecter…) supprimé en production : l'app a ses propres menus contextuels.
// IMPORTANT : on garde le menu natif dans les champs de texte (Copier/Coller) et en dev (Inspecter).
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, [contenteditable=true]")) return;
    e.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider><App /></I18nProvider>
  </StrictMode>,
)
