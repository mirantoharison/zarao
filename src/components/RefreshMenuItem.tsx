import { RefreshCw } from "lucide-react";
import { MenubarItem, MenubarShortcut } from "@/components/ui/menubar";
import { useI18n } from "@/i18n";
import { refreshScreen } from "@/lib/refresh";

/** Entrée « Rafraîchir l'écran » du menu Affichage (recharge l'interface), à placer dans un MenubarContent. */
export function RefreshMenuItem() {
  const { t } = useI18n();
  return <MenubarItem onSelect={refreshScreen}><RefreshCw /> {t("view.refresh")} <MenubarShortcut>F5</MenubarShortcut></MenubarItem>;
}
