import { useCallback, useEffect, useRef, useState } from "react";
import { getOAuthStatus, startOAuth, type Account, type OAuthError, type OAuthProvider } from "@/lib/api";

export type OAuthFailure = OAuthError | "notConfigured" | "busy" | "notfound" | "cancelled" | "unreachable";
export type OAuthResult = { ok: true; user?: Account } | { ok: false; error: OAuthFailure };

const POLL_MS = 1500;
/** Un peu moins que la durée de vie d'une demande côté serveur (10 min) : on abandonne avant que le serveur ne l'oublie. */
const GIVE_UP_MS = 9 * 60 * 1000;

/**
 * Pilote une connexion OAuth : le serveur ouvre la page de consentement dans le navigateur système,
 * puis on interroge son état jusqu'au résultat. Sans `userId` c'est une connexion, avec c'est une liaison.
 * IMPORTANT : une seule demande à la fois ; `cancel` (ou le démontage) arrête l'attente sans prévenir le serveur,
 * dont la demande expire d'elle-même.
 */
export function useOAuthFlow() {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const runId = useRef(0);

  useEffect(() => () => { runId.current += 1; }, []);

  const cancel = useCallback(() => { runId.current += 1; setPending(null); }, []);

  const run = useCallback(async (provider: OAuthProvider, userId?: string): Promise<OAuthResult> => {
    const mine = ++runId.current;
    const alive = () => runId.current === mine;
    setPending(provider);
    try {
      const started = await startOAuth(provider, userId ?? "");
      if (!started.state) return { ok: false, error: started.error ?? "unreachable" };
      const deadline = Date.now() + GIVE_UP_MS;
      while (alive() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive()) break;
        const s = await getOAuthStatus(started.state);
        if (s.status === "done") return { ok: true, user: s.user };
        if (s.status === "error") return { ok: false, error: s.error ?? "exchange" };
        if (s.status === "expired") return { ok: false, error: "expired" };
      }
      return { ok: false, error: alive() ? "expired" : "cancelled" };
    } catch {
      return { ok: false, error: alive() ? "unreachable" : "cancelled" };
    } finally {
      if (alive()) setPending(null);
    }
  }, []);

  return { pending, run, cancel };
}
