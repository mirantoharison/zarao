import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Police embarquée (pas de Google Fonts) : l'app Tauri doit rendre pareil hors-ligne.
import '@fontsource-variable/outfit'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { initZoom } from './lib/zoom.ts'
import { initPalette } from './lib/palette.ts'

// Zoom mémorisé appliqué avant le premier rendu : évite un saut de taille visible au démarrage.
initZoom()
// Palette mémorisée appliquée avant le premier rendu (même raison).
initPalette()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider><App /></I18nProvider>
  </StrictMode>,
)
