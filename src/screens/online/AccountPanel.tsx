import { LoadingState } from "@/components/LoadingState";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, User } from "lucide-react";
import { useI18n } from "@/i18n";
import { getAccount, getOAuthLinks, type Account, type OAuthLink, type SessionUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConnectedAccounts } from "@/screens/online/ConnectedAccounts";
import { ProfileSection } from "@/screens/online/ProfileSection";
import { SecuritySection } from "@/screens/online/SecuritySection";

type Tab = "account" | "security";
type Notice = { kind: "ok" | "error"; text: string };

/**
 * Mon compte, en deux onglets (comme sur Nemo) : « Compte » (profil modifiable, comptes reliés)
 * et « Sécurité » (mot de passe, moyens de connexion). `onUserChange` répercute photo et nom sur la session.
 */
export function AccountPanel({ user, onUserChange }: { user: SessionUser; onUserChange: (a: Account) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("account");
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [links, setLinks] = useState<OAuthLink[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccount(user._id).then((a) => { if (!cancelled) setAccount(a); }).catch(() => { if (!cancelled) setAccount(null); });
    return () => { cancelled = true; };
  }, [user._id]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const changed = useCallback((a: Account) => { setAccount(a); onUserChange(a); }, [onUserChange]);
  const flash = useCallback((kind: Notice["kind"], text: string) => setNotice({ kind, text }), []);

  const tabs: [Tab, string, typeof User][] = [["account", t("ac.tabAccount"), User], ["security", t("ac.tabSecurity"), ShieldCheck]];

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("acc.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("ac.subtitle")}</p>
      </div>

      <div role="tablist" className="flex gap-1 border-b">
        {tabs.map(([value, label, Icon]) => (
          <button
            key={value} role="tab" type="button" aria-selected={tab === value} onClick={() => setTab(value)}
            className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {notice && <p role="status" className={cn("text-sm", notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{notice.text}</p>}

      {account === undefined && <LoadingState title={t("ld.account")} description={t("ld.accountBody")} />}
      {account === null && <p className="text-sm text-destructive">{t("ac.readFailed")}</p>}

      {account && tab === "account" && (
        <div className="space-y-8">
          <ProfileSection account={account} onChange={changed} onNotice={flash} />
          <ConnectedAccounts userId={user._id} onLinksChange={setLinks} />
        </div>
      )}
      {account && tab === "security" && <SecuritySectionLoader userId={user._id} links={links} onLinks={setLinks} />}
    </div>
  );
}

/** Les moyens de connexion se lisent même si l'onglet Compte n'a jamais été ouvert : on recharge les liens à l'entrée. */
function SecuritySectionLoader({ userId, links, onLinks }: { userId: string; links: OAuthLink[]; onLinks: (l: OAuthLink[]) => void }) {
  useEffect(() => {
    getOAuthLinks(userId).then(onLinks).catch(() => undefined);
  }, [userId, onLinks]);
  return <SecuritySection userId={userId} links={links} />;
}
