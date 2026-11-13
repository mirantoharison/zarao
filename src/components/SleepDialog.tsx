import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { usePlayer } from "@/hooks/usePlayer";
import { useI18n } from "@/i18n";
import { formatTime } from "@/lib/media";

type Props = { p: ReturnType<typeof usePlayer>; open: boolean; onClose: () => void };

const PRESETS = [15, 30, 45, 60, 90];

/**
 * Interprète la saisie de la minuterie et renvoie un nombre de minutes, ou null si elle n'est pas reconnue.
 *  - « 45 », « 45 min », « 1h », « 1h30 », « 1 h 30 » : une DURÉE à partir de maintenant ;
 *  - « 23:30 » (avec deux-points) : une HEURE de la journée, la prochaine occurrence (demain si elle est déjà passée).
 * IMPORTANT : la présence des deux-points départage heure et durée : « 1:30 » est donc 01 h 30 du matin, pas une heure et demie.
 */
export function parseSleepInput(raw: string, now = new Date()): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (clock) {
    const h = Number(clock[1]), m = Number(clock[2]);
    if (h > 23 || m > 59) return null;
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return (at.getTime() - now.getTime()) / 60_000;
  }
  const dur = /^(?:(\d+)h)?(?:(\d+)(?:min|m)?)?$/.exec(s);
  if (dur && (dur[1] || dur[2])) {
    const minutes = Number(dur[1] ?? 0) * 60 + Number(dur[2] ?? 0);
    return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
  }
  return null;
}

/** Minuterie d'arrêt libre : durée (« 45 », « 1h30 ») ou heure précise (« 23:30 »), en plus des préréglages du bouton de la barre. */
export function SleepDialog({ p, open, onClose }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => { if (open) { setValue(""); setError(false); } }, [open]);

  const arm = (minutes: number | null) => {
    if (minutes === null) { setError(true); return; }
    p.setSleep(minutes);
    onClose();
  };
  const active = typeof p.sleepMode === "number";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Moon className="size-5 text-primary" /> {t("slp.title")}</DialogTitle>
          <DialogDescription>{active ? t("slp.running", { d: formatTime(p.sleepLeft) }) : t("slp.desc")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); arm(parseSleepInput(value)); }}>
          <div className="flex gap-2">
            <Input autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(false); }} placeholder={t("slp.placeholder")} aria-label={t("slp.title")} aria-invalid={error} />
            <Button type="submit" disabled={!value.trim()}>{t("slp.set")}</Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{t("slp.err")}</p>}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((m) => <Button key={m} type="button" size="sm" variant="outline" onClick={() => arm(m)}>{m} min</Button>)}
            {active && <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => { p.setSleep("off"); onClose(); }}>{t("slp.cancel")}</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
