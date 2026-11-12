import { MenubarLabel, MenubarRadioGroup, MenubarRadioItem } from "@/components/ui/menubar";
import { useI18n } from "@/i18n";
import { PALETTES, usePalette, type PaletteId } from "@/lib/palette";

/** Groupe « Couleurs » du menu Affichage : une pastille fond/accent + le nom de chaque palette. À placer dans un MenubarContent. */
export function PaletteMenuItems() {
  const { t } = useI18n();
  const [palette, setPalette] = usePalette();
  return (
    <>
      <MenubarLabel>{t("pal.menu")}</MenubarLabel>
      <MenubarRadioGroup value={palette} onValueChange={(v) => setPalette(v as PaletteId)}>
        {PALETTES.map(({ id, swatch }) => (
          <MenubarRadioItem key={id} value={id}>
            <span className="relative size-4 shrink-0 overflow-hidden rounded-full border" style={{ background: swatch[0] }}>
              <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: swatch[1] }} />
            </span>
            {t(`pal.${id}`)}
          </MenubarRadioItem>
        ))}
      </MenubarRadioGroup>
    </>
  );
}
