import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Unlink } from "lucide-react";
import { ProviderIcon, PROVIDER_LABEL } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOAuthFlow, type OAuthFailure } from "@/hooks/useOAuthFlow";
import { useI18n, type TKey } from "@/i18n";
import { getOAuthLinks, getOAuthProviders, OAUTH_PROVIDERS, unlinkOAuth, type OAuthLink, type OAuthProvider, type OAuthProviderInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

type Notice = { kind: "ok" | "error"; text: string };
type Props = { userId: string; onLinksChange?: (links: OAuthLink[]) => void };

/** Message d'erreur d'un échec OAuth ; les clés inconnues retombent sur le message générique. */
const ERROR_KEYS: Partial<Record<OAuthFailure, TKey>> = {
  denied: "ac.oerr.denied", exchange: "ac.oerr.exchange", alreadyLinked: "ac.oerr.alreadyLinked", expired: "ac.oerr.expired",
  busy: "ac.oerr.busy", notConfigured: "ac.oerr.notConfigured", notLinked: "ac.oerr.notLinked", unreachable: "ac.oerr.unreachable",
};
export const oauthErrorKey = (e: OAuthFailure): TKey => ERROR_KEYS[e] ?? "ac.oerr.generic";

/** Comptes reliés (Google, GitHub) : liaison via le navigateur système, suivi du résultat, déliaison avec confirmation. */
export function ConnectedAccounts({ userId, onLinksChange }: Props) {
  const { t, lang } = useI18n();
  const flow = useOAuthFlow();
  const [links, setLinks] = useState<OAuthLink[] | null>(null);
  const [providers, setProviders] = useState<Record<OAuthProvider, OAuthProviderInfo> | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<OAuthProvider | null>(null);
  const [copied, setCopied] = useState<OAuthProvider | null>(null);

  const reload = useCallback(async () => {
    try { const l = await getOAuthLinks(userId); setLinks(l); onLinksChange?.(l); } catch { setLinks([]); }
  }, [onLinksChange, userId]);

  useEffect(() => {
    void reload();
    getOAuthProviders().then(setProviders).catch(() => setProviders(null));
  }, [reload]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  async function link(provider: OAuthProvider) {
    setNotice(null);
    const r = await flow.run(provider, userId);
    if (r.ok) { await reload(); setNotice({ kind: "ok", text: t("ac.linked", { p: PROVIDER_LABEL[provider] }) }); }
    else if (r.error !== "cancelled") setNotice({ kind: "error", text: t(oauthErrorKey(r.error)) });
  }

  async function confirmUnlink() {
    const provider = unlinkTarget;
    setUnlinkTarget(null);
    if (!provider) return;
    const ok = await unlinkOAuth(provider, userId).catch(() => false);
    if (ok) { await reload(); setNotice({ kind: "ok", text: t("ac.unlinked", { p: PROVIDER_LABEL[provider] }) }); }
    else setNotice({ kind: "error", text: t("ac.unlinkFailed") });
  }

  const copy = (provider: OAuthProvider, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(provider);
    window.setTimeout(() => setCopied((c) => (c === provider ? null : c)), 2000);
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">{t("ac.connTitle")}</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("ac.connDesc")}</p>
      </div>

      {notice && <p role="status" className={cn("text-sm", notice.kind === "ok" ? "text-emerald-400" : "text-destructive")}>{notice.text}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {OAUTH_PROVIDERS.map((provider) => {
          const name = PROVIDER_LABEL[provider];
          const info = providers?.[provider];
          const linked = links?.find((l) => l.provider === provider);
          const waiting = flow.pending === provider;
          const configured = info?.configured ?? false;
          const up = provider.toUpperCase();
          return (
            <div key={provider} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md border bg-background"><ProviderIcon provider={provider} className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {linked ? <>{t("ac.linkedAs", { n: linked.label })}{linked.email && ` · ${linked.email}`} · {t("ac.linkedSince", { d: new Date(linked.linkedAt).toLocaleDateString(lang) })}</>
                      : providers && !configured ? t("ac.notConfigured") : t("ac.notLinked")}
                  </p>
                </div>
                {linked ? (
                  <Button size="sm" variant="outline" disabled={waiting} onClick={() => setUnlinkTarget(provider)}><Unlink /> {t("ac.disconnect")}</Button>
                ) : (
                  <Button size="sm" disabled={!configured || flow.pending !== null || links === null} onClick={() => void link(provider)}>
                    {waiting ? <Loader2 className="animate-spin" /> : <Link2 />} {t("ac.connect")}
                  </Button>
                )}
              </div>

              {waiting && (
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <span><strong className="text-foreground">{t("ac.waiting")}</strong> {t("ac.waitingHint")}</span>
                  <Button size="sm" variant="ghost" onClick={flow.cancel}>{t("ac.cancelWait")}</Button>
                </div>
              )}

              {providers && !configured && info && (
                <details className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">{t("ac.setupTitle")}</summary>
                  <p className="mt-2 leading-relaxed">{t("ac.setupBody", { p: name, id: `ZARAO_${up}_CLIENT_ID`, secret: `ZARAO_${up}_CLIENT_SECRET` })}</p>
                  <p className="mt-2 font-medium text-foreground">{t("ac.redirectUri")}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono">{info.redirectUri}</code>
                    <Button size="sm" variant="outline" onClick={() => copy(provider, info.redirectUri)}>{copied === provider ? <Check /> : <Copy />} {copied === provider ? t("ac.copied") : t("ac.copy")}</Button>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={unlinkTarget !== null} onOpenChange={(o) => !o && setUnlinkTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ac.unlinkTitle", { p: unlinkTarget ? PROVIDER_LABEL[unlinkTarget] : "" })}</DialogTitle>
            <DialogDescription>{t("ac.unlinkBody", { p: unlinkTarget ? PROVIDER_LABEL[unlinkTarget] : "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkTarget(null)}>{t("ac.cancel")}</Button>
            <Button variant="destructive" onClick={() => void confirmUnlink()}><Unlink /> {t("ac.disconnect")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
