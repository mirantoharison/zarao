import { useRef, useState, type FormEvent } from "react";
import { Calendar, Camera, Loader2, Mail, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { removePhoto, updateProfile, uploadPhoto, type Account, type ProfileError } from "@/lib/api";

const MAX_PHOTO = 2 * 1024 * 1024;
const PHOTO_RE = /^image\/(png|jpeg|gif|webp)$/;

type Props = { account: Account; onChange: (a: Account) => void; onNotice: (kind: "ok" | "error", text: string) => void };
type Draft = { name: string; surname: string; age: string; bio: string; city: string; country: string; newsletter: boolean };

const toDraft = (a: Account): Draft => ({
  name: a.name ?? "", surname: a.surname ?? "", age: a.age ? String(a.age) : "", bio: a.bio ?? "",
  city: a.city ?? "", country: a.country ?? "", newsletter: a.newsletter === true,
});

/** Carte d'identité du compte (photo, nom, e-mail, lieu, ancienneté), présentation et formulaire de modification. */
export function ProfileSection({ account, onChange, onNotice }: Props) {
  const { t, lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [fieldError, setFieldError] = useState<ProfileError | null>(null);

  const initials = (account.name?.[0] ?? account.username[0] ?? "?").toUpperCase();
  const place = [account.city, account.country].filter(Boolean).join(", ");
  const since = account.registeredat ? new Date(account.registeredat).toLocaleDateString(lang, { month: "long", year: "numeric" }) : "";
  const fullName = [account.surname, account.name].filter(Boolean).join(" ") || account.username;

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PHOTO) return onNotice("error", t("ac.photoTooBig"));
    if (!PHOTO_RE.test(file.type)) return onNotice("error", t("ac.photoType"));
    setPhotoBusy(true);
    try {
      const r = await uploadPhoto(account._id, file);
      if (r.user) { onChange(r.user); onNotice("ok", t("ac.photoChanged")); }
      else onNotice("error", r.error === "tooBig" ? t("ac.photoTooBig") : r.error === "type" ? t("ac.photoType") : t("ac.photoFailed"));
    } catch { onNotice("error", t("ac.photoFailed")); } finally { setPhotoBusy(false); }
  }

  async function dropPhoto() {
    setPhotoBusy(true);
    try {
      const u = await removePhoto(account._id);
      if (u) { onChange(u); onNotice("ok", t("ac.photoRemoved")); } else onNotice("error", t("ac.photoFailed"));
    } catch { onNotice("error", t("ac.photoFailed")); } finally { setPhotoBusy(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setFieldError(null);
    try {
      const r = await updateProfile(account._id, draft);
      if (r.user) { onChange(r.user); setDraft(null); onNotice("ok", t("ac.saved")); }
      else if (r.error && r.error !== "notfound") setFieldError(r.error);
      else onNotice("error", t("ac.saveFailed"));
    } catch { onNotice("error", t("on.serverDown")); } finally { setBusy(false); }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start gap-6 rounded-lg border p-5">
        <div className="flex flex-col items-center gap-2">
          {account.profilphoto
            ? <img src={account.profilphoto} alt="" className="size-24 rounded-full object-cover" />
            : <div className="grid size-24 place-items-center rounded-full bg-muted text-3xl font-semibold text-muted-foreground">{initials}</div>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" aria-label={t("ac.addPhoto")} onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? <Loader2 className="animate-spin" /> : <Camera />} {account.profilphoto ? t("ac.changePhoto") : t("ac.addPhoto")}
            </Button>
            {account.profilphoto && <Button type="button" size="icon" variant="outline" className="size-8" disabled={photoBusy} onClick={() => void dropPhoto()} title={t("ac.removePhoto")} aria-label={t("ac.removePhoto")}><Trash2 /></Button>}
          </div>
          {/* Taille en style direct : la classe arbitraire text-[11px] ne se retrouvait pas dans le CSS généré et le texte héritait de la taille du parent. */}
          <p className="max-w-[9rem] text-center leading-tight text-muted-foreground" style={{ fontSize: "11px" }}>{t("ac.photoHint")}</p>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-2xl font-semibold">{fullName}</p>
          <p className="text-sm text-muted-foreground">@{account.username}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1 text-sm text-muted-foreground">
            {account.usermail && <span className="flex items-center gap-1.5"><Mail className="size-4" /> {account.usermail}</span>}
            {place && <span className="flex items-center gap-1.5"><MapPin className="size-4" /> {place}</span>}
            {account.age ? <span>{t("ac.ageYears", { n: account.age })}</span> : null}
            {since && <span className="flex items-center gap-1.5"><Calendar className="size-4" /> {t("ac.memberSince", { d: since })}</span>}
          </div>
        </div>

        {!draft && <Button type="button" onClick={() => { setFieldError(null); setDraft(toDraft(account)); }}><Pencil /> {t("ac.editProfile")}</Button>}
      </section>

      {draft ? (
        <form onSubmit={submit} className="space-y-4 rounded-lg border p-5">
          <div>
            <h3 className="font-semibold">{t("ac.editTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("ac.editDesc")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="pf-name">{t("reg.name")}</Label><Input id="pf-name" value={draft.name} maxLength={80} disabled={busy} onChange={(e) => set("name", e.target.value)} aria-invalid={fieldError === "name" || undefined} /></div>
            <div className="space-y-1.5"><Label htmlFor="pf-surname">{t("reg.surname")}</Label><Input id="pf-surname" value={draft.surname} maxLength={80} disabled={busy} onChange={(e) => set("surname", e.target.value)} aria-invalid={fieldError === "surname" || undefined} /></div>
            <div className="space-y-1.5"><Label htmlFor="pf-age">{t("reg.age")}</Label><Input id="pf-age" inputMode="numeric" value={draft.age} maxLength={3} disabled={busy} onChange={(e) => set("age", e.target.value.replace(/\D/g, ""))} aria-invalid={fieldError === "age" || undefined} /></div>
            <div className="space-y-1.5"><Label htmlFor="pf-city">{t("ac.city")}</Label><Input id="pf-city" value={draft.city} maxLength={80} disabled={busy} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pf-country">{t("ac.country")}</Label><Input id="pf-country" value={draft.country} maxLength={80} disabled={busy} onChange={(e) => set("country", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-bio">{t("ac.bio")}</Label>
            <Textarea id="pf-bio" rows={4} value={draft.bio} maxLength={500} disabled={busy} placeholder={t("ac.bioPlaceholder")} onChange={(e) => set("bio", e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("ac.bioCount", { n: draft.bio.length })}</p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="pf-news" checked={draft.newsletter} disabled={busy} onCheckedChange={(v) => set("newsletter", v === true)} />
            <Label htmlFor="pf-news" className="cursor-pointer text-sm">{t("reg.newsletter")}</Label>
          </div>
          {fieldError && fieldError !== "notfound" && <p className="text-sm text-destructive" role="alert">{t(`ac.err.${fieldError}` as const)}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>{t("ac.cancel")}</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null} {busy ? t("ac.saving") : t("ac.save")}</Button>
          </div>
        </form>
      ) : (
        <section className="space-y-2">
          <h3 className="font-semibold">{t("ac.aboutTitle")}</h3>
          {account.bio ? <p className="whitespace-pre-line text-sm">{account.bio}</p> : <p className="max-w-3xl text-sm text-muted-foreground">{t("ac.noBio")}</p>}
        </section>
      )}
    </div>
  );
}
