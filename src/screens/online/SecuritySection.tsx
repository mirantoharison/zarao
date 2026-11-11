import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { ProviderIcon, PROVIDER_LABEL } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { changePassword, type OAuthLink } from "@/lib/api";

type Result = { kind: "ok" } | { kind: "error"; message: string };

/** Champ mot de passe avec bouton afficher / masquer. */
function PasswordField({ id, label, hint, value, onChange, autoComplete, disabled }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; autoComplete: string; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} disabled={disabled} className="pr-10" onChange={(e) => onChange(e.target.value)} required />
        <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 size-7" onClick={() => setShown((s) => !s)} aria-label={shown ? t("ac.hidePw") : t("ac.showPw")} title={shown ? t("ac.hidePw") : t("ac.showPw")}>
          {shown ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Changement de mot de passe et récapitulatif des moyens de connexion (mot de passe + comptes reliés). */
export function SecuritySection({ userId, links }: { userId: string; links: OAuthLink[] }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setResult({ kind: "error", message: t("err.password") });
    if (next !== confirm) return setResult({ kind: "error", message: t("err.mismatch") });
    setBusy(true);
    setResult(null);
    try {
      const r = await changePassword(userId, current, next);
      if (r.changed) { setResult({ kind: "ok" }); setCurrent(""); setNext(""); setConfirm(""); }
      else setResult({ kind: "error", message: r.error === "wrong" ? t("acc.wrong") : r.error === "weak" ? t("err.password") : t("acc.notFound") });
    } catch {
      setResult({ kind: "error", message: t("on.serverDown") });
    } finally {
      setBusy(false);
    }
  }

  const row = (icon: React.ReactNode, title: string, desc: string) => (
    <li className="flex items-center gap-3 rounded-lg border p-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-background">{icon}</div>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p><p className="truncate text-xs text-muted-foreground">{desc}</p></div>
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">{t("ac.methodActive")}</span>
    </li>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" /> {t("ac.secTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("ac.secDesc")}</p>
        </div>
        <PasswordField id="sec-current" label={t("acc.current")} value={current} onChange={setCurrent} autoComplete="current-password" disabled={busy} />
        <PasswordField id="sec-new" label={t("acc.new")} hint={t("ac.newHint")} value={next} onChange={setNext} autoComplete="new-password" disabled={busy} />
        <PasswordField id="sec-confirm" label={t("acc.confirmNew")} hint={t("ac.confirmHint")} value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} />
        {result?.kind === "error" && <p className="text-sm text-destructive" role="alert">{result.message}</p>}
        {result?.kind === "ok" && <p className="text-sm text-emerald-400" role="status">{t("acc.changed")}</p>}
        <Button type="submit" disabled={busy}>{busy ? t("ac.pwSaving") : t("acc.change")}</Button>
      </form>

      <section className="space-y-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4" /> {t("ac.methodsTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("ac.methodsDesc")}</p>
        </div>
        <ul className="space-y-2">
          {row(<KeyRound className="size-4" />, t("ac.methodPassword"), t("ac.methodPasswordDesc"))}
          {links.map((l) => row(<ProviderIcon key={l.provider} provider={l.provider} className="size-4" />, PROVIDER_LABEL[l.provider], t("ac.linkedAs", { n: l.label })))}
        </ul>
        {links.length === 0 && <p className="text-xs text-muted-foreground">{t("ac.methodOne")}</p>}
      </section>
    </div>
  );
}
