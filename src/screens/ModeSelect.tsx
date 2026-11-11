import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n, type TKey } from "@/i18n";
import { Check, Globe, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type Mode = "local" | "online";

type Props = { onSelect: (mode: Mode) => void; serverUp: boolean | null };

const OFFLINE_FEATURES: TKey[] = ["mode.offF1", "mode.offF2", "mode.offF3", "mode.offF4"];
const ONLINE_FEATURES: TKey[] = ["mode.onF1", "mode.onF2", "mode.onF3", "mode.onF4"];

function FeatureList({ keys }: { keys: TKey[] }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-2 text-sm text-muted-foreground">
      {keys.map((k) => (
        <li key={k} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-foreground" /> {t(k)}</li>
      ))}
    </ul>
  );
}

/** Écran affiché par défaut au démarrage : choix entre lecteur local et version en ligne. */
export function ModeSelect({ onSelect, serverUp }: Props) {
  const { t } = useI18n();
  // IMPORTANT : l'état du serveur est affiché par un point coloré + texte (jamais la couleur seule, pour l'accessibilité).
  const dotClass = serverUp === null ? "bg-muted-foreground animate-pulse" : serverUp ? "bg-emerald-500" : "bg-destructive";
  const cardClass = "transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-lg";

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <LanguageSwitch className="absolute right-4 top-4" />
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">Zarao</h1>
        <p className="mt-3 text-muted-foreground">{t("mode.tagline")}</p>
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <Card className={cardClass}>
          <CardHeader>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex size-12 items-center justify-center rounded-lg bg-muted"><HardDrive className="size-6" /></span>
              <Badge variant="secondary">{t("mode.badgeOffline")}</Badge>
            </div>
            <CardTitle className="text-lg">{t("mode.offline")}</CardTitle>
            <CardDescription>{t("mode.offlineDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <FeatureList keys={OFFLINE_FEATURES} />
          </CardContent>
          <CardFooter className="mt-auto">
            <Button className="w-full" onClick={() => onSelect("local")}>{t("mode.offlineBtn")}</Button>
          </CardFooter>
        </Card>

        <Card className={cardClass}>
          <CardHeader>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex size-12 items-center justify-center rounded-lg bg-muted"><Globe className="size-6" /></span>
              <Badge variant="outline">{t("mode.badgeOnline")}</Badge>
            </div>
            <CardTitle className="text-lg">{t("mode.online")}</CardTitle>
            <CardDescription>{t("mode.onlineDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <FeatureList keys={ONLINE_FEATURES} />
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <span className={cn("size-2 rounded-full", dotClass)} />
              {serverUp === null ? t("mode.checking") : serverUp ? t("mode.up") : t("mode.down")}
            </p>
          </CardContent>
          <CardFooter className="mt-auto">
            <Button className="w-full" variant="secondary" disabled={serverUp !== true} onClick={() => onSelect("online")}>
              {t("mode.connect")}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <p className="max-w-md text-center text-xs text-muted-foreground">{t("mode.hint")}</p>
    </div>
  );
}
