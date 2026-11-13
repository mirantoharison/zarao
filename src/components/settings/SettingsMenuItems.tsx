import { MenubarItem } from "@/components/ui/menubar";
import { useI18n } from "@/i18n";
import { SETTINGS_SECTIONS, type SettingsSection } from "./sections";

/** Une entrée de menu par page des Paramètres : à placer dans le contenu du menu « Paramètres ». */
export function SettingsMenuItems({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  const { t } = useI18n();
  return (
    <>
      {SETTINGS_SECTIONS.map(({ id, icon: Icon, label }) => (
        <MenubarItem key={id} onClick={() => onOpen(id)}><Icon /> {t(label)}</MenubarItem>
      ))}
    </>
  );
}
