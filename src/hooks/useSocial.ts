import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getSocial, reactToMedia, sendView, type Reaction, type Social } from "@/lib/api";

/** Écoute minimale (secondes) pour compter une vue : un passage de quelques secondes (titre sauté) n'en est pas une. */
const MIN_VIEW_SECONDS = 5;

/**
 * Réactions (j'aime / je n'aime pas) et compteurs du média `remoteId`.
 * `react` bascule : choisir la réaction déjà posée la retire ; l'autre la remplace.
 */
export function useSocial(remoteId: string | undefined, userid: string) {
  const [social, setSocial] = useState<Social | null>(null);

  const reload = useCallback(() => {
    if (!remoteId) { setSocial(null); return; }
    getSocial(remoteId, userid).then((s) => setSocial(s.ok ? s : null)).catch(() => setSocial(null));
  }, [remoteId, userid]);

  useEffect(() => {
    setSocial(null);
    reload();
  }, [reload]);

  const react = useCallback(async (kind: Reaction) => {
    if (!remoteId || !social) return;
    const next = social.mine === kind ? null : kind;
    // Mise à jour immédiate de l'interface ; le serveur confirme (ou on revient à son état) juste après.
    const before = social;
    const optimistic: Social = {
      ...social, mine: next,
      like: social.like - (social.mine === "like" ? 1 : 0) + (next === "like" ? 1 : 0),
      dislike: social.dislike - (social.mine === "dislike" ? 1 : 0) + (next === "dislike" ? 1 : 0),
    };
    setSocial(optimistic);
    try {
      const res = await reactToMedia(remoteId, userid, next);
      if (res.ok) setSocial(res); else setSocial(before);
    } catch {
      setSocial(before);
    }
  }, [remoteId, userid, social]);

  return { social, react, reload };
}

/**
 * Comptabilise le temps réellement écouté de chaque média en ligne et l'envoie au serveur quand on change de piste,
 * qu'une piste se termine ou qu'on quitte l'écran. Remplace l'ancien stockage de session + envoi groupé à la déconnexion.
 */
export function useViewTracker(mediaRef: RefObject<HTMLVideoElement | null>, currentRemoteId: string | undefined, userid: string) {
  const idRef = useRef(currentRemoteId);
  const secondsRef = useRef(0);
  const lastTimeRef = useRef(0);
  idRef.current = currentRemoteId;

  const flush = useCallback((id: string | undefined) => {
    if (id && secondsRef.current >= MIN_VIEW_SECONDS) sendView(id, userid, secondsRef.current);
    secondsRef.current = 0;
    lastTimeRef.current = 0;
  }, [userid]);

  // Changement de piste : on envoie ce qui a été écouté de la précédente.
  const previousId = useRef(currentRemoteId);
  useEffect(() => {
    if (previousId.current !== currentRemoteId) {
      flush(previousId.current);
      previousId.current = currentRemoteId;
    }
  }, [currentRemoteId, flush]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onTime = () => {
      const delta = el.currentTime - lastTimeRef.current;
      lastTimeRef.current = el.currentTime;
      // Seuls les petits pas comptent : un déplacement dans la barre de progression n'est pas de l'écoute.
      if (delta > 0 && delta <= 1.5) secondsRef.current += delta;
    };
    const onEnded = () => flush(idRef.current);
    const onLoad = () => { lastTimeRef.current = 0; };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("loadstart", onLoad);
    const onUnload = () => flush(idRef.current);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("loadstart", onLoad);
      window.removeEventListener("beforeunload", onUnload);
      flush(idRef.current); // quitter l'écran (changement de mode, déconnexion) envoie aussi l'écoute en cours
    };
  }, [mediaRef, flush]);
}
