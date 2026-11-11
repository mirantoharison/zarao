import { useEffect, useMemo, useState } from "react";
import { Camera, Check } from "lucide-react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, type TKey } from "@/i18n";
import { registerAccount, type Account, type RegisterError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = { onCreated: (user: Account) => void; onCancel: () => void };

const USERNAME_RE = /^[\w.-]{3,32}$/;
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AVATAR = 2 * 1024 * 1024;
const STEPS = 3;

/** Code d'erreur (serveur ou local) → clé de traduction. */
const ERROR_KEYS: Record<RegisterError | "mismatch" | "terms" | "avatarType" | "generic", TKey> = {
  username: "err.username", password: "err.password", name: "err.name", surname: "err.surname", age: "err.age", mail: "err.mail",
  usernameTaken: "err.usernameTaken", mailTaken: "err.mailTaken", avatarTooBig: "reg.avatarTooBig", avatarType: "reg.avatarType",
  mismatch: "err.mismatch", terms: "err.terms", generic: "err.generic",
};

/**
 * Assistant d'inscription en 3 étapes (identifiants, informations, validation).
 * IMPORTANT : mêmes règles que le serveur (validateRegistration) pour guider l'utilisateur sans aller-retour,
 * mais seul le serveur fait foi.
 */
export function Register({ onCreated, onCancel }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [age, setAge] = useState("");
  const [mail, setMail] = useState("");
  const [terms, setTerms] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_KEYS | null>(null);
  const [busy, setBusy] = useState(false);

  // Aperçu de l'avatar : l'URL objet doit être libérée, sinon la mémoire de l'image reste occupée.
  const preview = useMemo(() => (avatar ? URL.createObjectURL(avatar) : null), [avatar]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("avatarType");
    if (file.size > MAX_AVATAR) return setError("avatarTooBig");
    setError(null);
    setAvatar(file);
  }

  /** Vérifie l'étape courante ; retourne le code de la première erreur ou null. */
  function check(n: number): keyof typeof ERROR_KEYS | null {
    if (n === 1) {
      if (!USERNAME_RE.test(username.trim())) return "username";
      if (password.length < 8) return "password";
      if (password !== confirm) return "mismatch";
    }
    if (n === 2) {
      if (name.trim().length < 2) return "name";
      if (surname.trim().length < 2) return "surname";
      const a = Number(age);
      if (!Number.isInteger(a) || a < 13 || a > 120) return "age";
      if (!MAIL_RE.test(mail.trim())) return "mail";
    }
    if (n === 3 && !terms) return "terms";
    return null;
  }

  function next() {
    const e = check(step);
    setError(e);
    if (!e) setStep((s) => s + 1);
  }

  async function create() {
    const e = check(3);
    setError(e);
    if (e) return;
    setBusy(true);
    try {
      const res = await registerAccount({ username: username.trim(), password, name: name.trim(), surname: surname.trim(), age, mail: mail.trim(), newsletter, avatar });
      if (res.user) return onCreated(res.user);
      const code = res.error ?? "mail";
      setError(code);
      // Retour à l'étape du champ fautif : l'utilisateur voit tout de suite quoi corriger.
      if (code === "username" || code === "usernameTaken" || code === "password") setStep(1);
      else if (code !== "avatarTooBig") setStep(2);
    } catch {
      setError("generic"); // serveur injoignable ou réponse invalide
    } finally {
      setBusy(false);
    }
  }

  const titles = [t("reg.s1"), t("reg.s2"), t("reg.s3")];
  const field = (id: string, label: TKey, value: string, set: (v: string) => void, extra?: { type?: string; hint?: TKey; autoFocus?: boolean; min?: number; max?: number }) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(label)}</Label>
      <Input id={id} value={value} onChange={(e) => set(e.target.value)} type={extra?.type} autoFocus={extra?.autoFocus} min={extra?.min} max={extra?.max} />
      {extra?.hint && <p className="text-xs text-muted-foreground">{t(extra.hint)}</p>}
    </div>
  );

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <LanguageSwitch className="absolute right-4 top-4" />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("reg.title")}</CardTitle>
          <CardDescription>{t("reg.step", { n: step, t: STEPS })} — {titles[step - 1]}</CardDescription>
          <div className="flex gap-1.5 pt-2" aria-hidden>
            {Array.from({ length: STEPS }, (_, i) => <span key={i} className={cn("h-1 flex-1 rounded-full", i < step ? "bg-primary" : "bg-muted")} />)}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <div className="flex flex-col items-center gap-2">
                <label className="group relative grid size-24 cursor-pointer place-items-center overflow-hidden rounded-full border bg-muted">
                  {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <Camera className="size-8 text-muted-foreground" />}
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickAvatar(e.target.files?.[0])} />
                </label>
                <span className="text-xs text-muted-foreground">{t("reg.avatar")}</span>
              </div>
              {field("reg-username", "reg.username", username, setUsername, { autoFocus: true, hint: "reg.usernameHint" })}
              {field("reg-password", "reg.password", password, setPassword, { type: "password", hint: "reg.passwordHint" })}
              {field("reg-confirm", "reg.confirm", confirm, setConfirm, { type: "password" })}
            </>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {field("reg-name", "reg.name", name, setName, { autoFocus: true })}
              {field("reg-surname", "reg.surname", surname, setSurname)}
              {field("reg-age", "reg.age", age, setAge, { type: "number", min: 13, max: 120 })}
              {field("reg-mail", "reg.mail", mail, setMail, { type: "email" })}
            </div>
          )}

          {step === 3 && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
                <dt className="text-muted-foreground">{t("reg.username")}</dt><dd>{username}</dd>
                <dt className="text-muted-foreground">{t("reg.name")}</dt><dd>{name} {surname}</dd>
                <dt className="text-muted-foreground">{t("reg.age")}</dt><dd>{age}</dd>
                <dt className="text-muted-foreground">{t("reg.mail")}</dt><dd className="truncate">{mail}</dd>
              </dl>
              <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={terms} onCheckedChange={(v) => setTerms(v === true)} /> {t("reg.terms")}</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={newsletter} onCheckedChange={(v) => setNewsletter(v === true)} /> {t("reg.newsletter")}</label>
            </>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{t(ERROR_KEYS[error])}</p>}
        </CardContent>

        <CardFooter className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={step === 1 ? onCancel : () => { setError(null); setStep((s) => s - 1); }}>
            {step === 1 ? t("reg.cancel") : t("reg.prev")}
          </Button>
          {step < STEPS
            ? <Button type="button" onClick={next}>{t("reg.next")}</Button>
            : <Button type="button" disabled={busy} onClick={() => void create()}><Check /> {busy ? t("reg.creating") : t("reg.create")}</Button>}
        </CardFooter>
      </Card>
    </div>
  );
}
