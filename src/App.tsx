import { lazy, Suspense, useState } from "react";
import { Splash } from "@/screens/Splash";
import { LocalPlayer } from "@/screens/LocalPlayer";

/**
 * Édition « local » : lecteur seul, sans comptes ni catalogue en ligne (build `--mode localonly`, cf. .env.localonly).
 * IMPORTANT : la condition est écrite en toutes lettres sur `import.meta.env` (pas via une constante importée) : Vite la remplace
 * par un littéral au build, et le `import()` d'AppFull, devenu inatteignable, est éliminé avec tout le code en ligne.
 */
const AppFull = import.meta.env.VITE_ZARAO_EDITION === "local" ? null : lazy(() => import("./AppFull"));

/** Splash au démarrage (identité + astuce), puis lecteur local directement : plus d'écran de choix de mode. */
function LocalApp() {
  const [ready, setReady] = useState(false);
  if (!ready) return <Splash mode="local" onDone={() => setReady(true)} />;
  return <LocalPlayer />;
}

export default function App() {
  if (AppFull === null) return <LocalApp />;
  return <Suspense fallback={null}><AppFull /></Suspense>;
}
