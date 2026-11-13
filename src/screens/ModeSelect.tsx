import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n } from "@/i18n";
import { Globe, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Mode = "local" | "online";

type Props = { onSelect: (mode: Mode) => void; serverUp: boolean | null };

/** Écran affiché par défaut au démarrage : choix entre lecteur local et version en ligne. */
export function ModeSelect({ onSelect, serverUp }: Props) {
  const { t } = useI18n();
  // IMPORTANT : l'état du serveur est affiché par un point coloré + texte (jamais la couleur seule, pour l'accessibilité).
  const dotClass = serverUp === null ? "bg-muted-foreground animate-pulse" : serverUp ? "bg-emerald-500" : "bg-destructive";
  const cardClass = "transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-lg";

  return (
    // Hauteur fixe + overflow caché : cet écran tient toujours dans la fenêtre, sans barre de défilement.
    <div className="relative flex h-screen flex-col overflow-hidden p-6">
      <LanguageSwitch className="absolute right-4 top-4" />

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
        <header className="flex items-center gap-4">
          <img src="/zarao-logo.png" alt="" className="size-16 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Zarao</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("mode.tagline")}</p>
          </div>
        </header>

        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <Card className={cardClass}>
            <CardHeader>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg bg-muted"><HardDrive className="size-5" /></span>
                <Badge variant="secondary">{t("mode.badgeOffline")}</Badge>
              </div>
              <CardTitle className="text-lg">{t("mode.offline")}</CardTitle>
              <CardDescription>{t("mode.offlineDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{t("mode.offNote")}</CardContent>
            <CardFooter className="mt-auto">
              <Button className="w-full" onClick={() => onSelect("local")}>{t("mode.offlineBtn")}</Button>
            </CardFooter>
          </Card>

          <Card className={cardClass}>
            <CardHeader>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg bg-muted"><Globe className="size-5" /></span>
                <Badge variant="outline">{t("mode.badgeOnline")}</Badge>
              </div>
              <CardTitle className="text-lg">{t("mode.online")}</CardTitle>
              <CardDescription>{t("mode.onlineDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
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
      </main>

      {/* Mention neutre (pas d'i18n) : identique quelle que soit la langue. */}
      <footer className="shrink-0 border-t pt-4 text-center text-xs text-muted-foreground">
        Zarao © 2026 - made with <span aria-label="arc-en-ciel, avocat, éléphant, poulet">🌈🥑🐘🐔</span> by Miranto Harison [mirantohrs@mail.com]
      </footer>
    </div>
  );
}
