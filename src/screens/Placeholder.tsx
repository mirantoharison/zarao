import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Écran provisoire : les lecteurs (local et en ligne) restent à porter depuis l'ancienne app Electron. */
export function Placeholder({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-muted-foreground">{t("ph.notPorted")}</p>
      <Button variant="outline" onClick={onBack}>{t("ph.change")}</Button>
    </div>
  );
}
