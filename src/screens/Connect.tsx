import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n } from "@/i18n";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { ProviderIcon, PROVIDER_LABEL } from "@/components/ProviderIcon";
import { useOAuthFlow } from "@/hooks/useOAuthFlow";
import { connect, OAUTH_PROVIDERS, type OAuthProvider, type SessionUser } from "@/lib/api";
import { oauthErrorKey } from "@/screens/online/ConnectedAccounts";

type Props = { onConnected: (user: SessionUser, stay: boolean) => void; onBack: () => void; onRegister: () => void };

export function Connect({ onConnected, onBack, onRegister }: Props) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stay, setStay] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const flow = useOAuthFlow();

  /** Connexion par un compte déjà relié depuis « Mon compte » ; le navigateur système sert à autoriser, l'app attend le résultat. */
  async function signInWith(provider: OAuthProvider) {
    setError(null);
    const r = await flow.run(provider);
    if (r.ok && r.user) onConnected(r.user, stay);
    else if (!r.ok && r.error !== "cancelled") setError(t(oauthErrorKey(r.error)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await connect(username.trim(), password);
      if (user) onConnected(user, stay);
      else setError(t("conn.bad"));
    } catch {
      setError(t("conn.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <LanguageSwitch className="absolute right-4 top-4" />
      {/* Design d'origine Zarao : bannière illustrée à gauche + formulaire à droite, dans une seule carte shadcn. */}
      <Card className="w-full max-w-3xl flex-row gap-0 overflow-hidden py-0">
        <div
          className="relative hidden w-72 shrink-0 bg-cover bg-center md:block"
          style={{ backgroundImage: "url('/connect-banner.jpg')" }}
        >
          {/* Dégradé : garantit la lisibilité du texte quelle que soit l'image. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 text-white">
            <h2 className="text-lg font-semibold">{t("conn.bannerTitle")}</h2>
            <p className="text-sm text-white/80">{t("conn.bannerText")}</p>
            <ul className="space-y-1.5 text-xs text-white/80">
              {(["conn.feat1", "conn.feat2", "conn.feat3"] as const).map((k) => (
                <li key={k} className="flex items-start gap-2"><Check className="mt-0.5 size-3 shrink-0" /> {t(k)}</li>
              ))}
            </ul>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-1 flex-col justify-center py-8">
          <CardHeader>
            <CardTitle className="text-xl">{t("conn.title")}</CardTitle>
            <CardDescription>{t("conn.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="mt-6 space-y-6">
            {/* Labels flottants sur la bordure (signature du design d'origine), fond = card pour masquer le trait. */}
            <div className="relative">
              <Label htmlFor="username" className="absolute -top-2 left-3 z-10 gap-1.5 bg-card px-2 text-xs">
                <User className="size-3" /> {t("conn.user")}
              </Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" className="h-10" aria-describedby="username-hint" />
              <p id="username-hint" className="mt-1.5 px-1 text-xs text-muted-foreground">{t("conn.hintUser")}</p>
            </div>
            <div className="relative">
              <Label htmlFor="password" className="absolute -top-2 left-3 z-10 gap-1.5 bg-card px-2 text-xs">
                <Lock className="size-3" /> {t("conn.password")}
              </Label>
              <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="h-10 pr-10" aria-describedby="password-hint" />
              <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 size-8" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t("conn.hide") : t("conn.show")}>
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
              <p id="password-hint" className="mt-1.5 px-1 text-xs text-muted-foreground">{t("conn.hintPassword")}</p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="stay" className="mt-0.5" checked={stay} onCheckedChange={(v) => setStay(v === true)} />
              <div>
                <Label htmlFor="stay" className="cursor-pointer text-sm">{t("conn.stay")}</Label>
                <p className="text-xs text-muted-foreground">{t("conn.stayHint")}</p>
              </div>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </CardContent>
          <CardFooter className="mt-6 flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onBack}>{t("conn.back")}</Button>
            <Button type="submit" className="flex-1" disabled={busy}>{busy ? t("conn.busy") : t("conn.submit")}</Button>
            <div className="basis-full space-y-2 pt-3">
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t("conn.or")}<span className="h-px flex-1 bg-border" /></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {OAUTH_PROVIDERS.map((p) => (
                  <Button key={p} type="button" variant="outline" disabled={busy || flow.pending !== null} onClick={() => void signInWith(p)}>
                    {flow.pending === p ? <Loader2 className="animate-spin" /> : <ProviderIcon provider={p} className="size-4" />} {t("conn.with", { p: PROVIDER_LABEL[p] })}
                  </Button>
                ))}
              </div>
              {flow.pending && (
                <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("conn.oauthWaiting", { p: PROVIDER_LABEL[flow.pending] })}</span>
                  <button type="button" className="underline" onClick={flow.cancel}>{t("conn.oauthCancel")}</button>
                </p>
              )}
            </div>
            <p className="basis-full pt-2 text-center text-sm text-muted-foreground">{t("conn.noAccount")} <button type="button" className="text-foreground underline" onClick={onRegister}>{t("conn.create")}</button></p>
            <p className="basis-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> {t("conn.secure")}</p>
          </CardFooter>
          {/* Mention neutre (pas d'i18n) : identique quelle que soit la langue. */}
          <p className="mt-6 border-t px-6 pt-4 text-center text-xs text-muted-foreground">
            Zarao © 2026 - made with <span aria-label="arc-en-ciel, avocat, éléphant, poulet">🌈🥑🐘🐔</span> by Miranto Harison [mirantohrs@mail.com]
          </p>
        </form>
      </Card>
    </div>
  );
}
