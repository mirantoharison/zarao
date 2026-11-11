import { useEffect, useState } from "react";
import { isServerUp, type SessionUser } from "@/lib/api";
import { ModeSelect, type Mode } from "@/screens/ModeSelect";
import { Connect } from "@/screens/Connect";
import { Register } from "@/screens/Register";
import { OnlineLibrary } from "@/screens/OnlineLibrary";
import { Splash } from "@/screens/Splash";
import { LocalPlayer } from "@/screens/LocalPlayer";

type View = "mode" | "splash" | "local" | "connect" | "register" | "online";
const SESSION_KEY = "zarao.session";

/** Session conservée seulement si l'utilisateur a coché « Rester connecté » (localStorage) ; sinon durée de vie de l'onglet. */
function readSession(): SessionUser | null {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw) as SessionUser;
    } catch { /* stockage indisponible ou JSON invalide : pas de session */ }
  }
  return null;
}
function writeSession(user: SessionUser, stay: boolean) {
  try { (stay ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(user)); } catch { /* non bloquant */ }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch { /* non bloquant */ }
}

export default function App() {
  // IMPORTANT : l'écran de choix de mode est la vue initiale, quoi qu'il arrive au backend.
  const [view, setView] = useState<View>("mode");
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  // Destination différée : le splash s'affiche entre le choix du mode et l'interface cible.
  const [next, setNext] = useState<View>("mode");
  const [user, setUser] = useState<SessionUser | null>(readSession);

  // Le backend démarre en parallèle de la fenêtre : on réessaie brièvement avant de conclure qu'il est absent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        if (await isServerUp()) return setServerUp(true);
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) setServerUp(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Une session mémorisée évite l'écran de connexion.
  const select = (mode: Mode) => {
    setNext(mode === "local" ? "local" : user ? "online" : "connect");
    setView("splash");
  };
  const logout = () => { clearSession(); setUser(null); setView("mode"); };
  /** Profil modifié (photo, nom…) : la session en mémoire suit, et celle déjà stockée (local ou session) est réécrite au même endroit. */
  const updateUser = (u: SessionUser) => {
    setUser(u);
    for (const store of [localStorage, sessionStorage]) {
      try { if (store.getItem(SESSION_KEY)) store.setItem(SESSION_KEY, JSON.stringify(u)); } catch { /* non bloquant */ }
    }
  };

  if (view === "splash") return <Splash mode={next === "local" ? "local" : "online"} onDone={() => setView(next)} />;
  if (view === "local") return <LocalPlayer onBack={() => setView("mode")} />;
  if (view === "connect") return <Connect onBack={() => setView("mode")} onRegister={() => setView("register")} onConnected={(u, stay) => { writeSession(u, stay); setUser(u); setView("online"); }} />;
  // Le compte créé est actif tout de suite (pas de mail de confirmation en local) : on connecte directement.
  if (view === "register") return <Register onCancel={() => setView("connect")} onCreated={(u) => { writeSession(u, false); setUser(u); setView("online"); }} />;
  if (view === "online" && user) return <OnlineLibrary user={user} onLogout={logout} onBack={() => setView("mode")} onUserChange={updateUser} />;
  return <ModeSelect onSelect={select} serverUp={serverUp} />;
}
