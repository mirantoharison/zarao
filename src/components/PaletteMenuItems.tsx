import { Palette } from "lucide-react";
import { MenubarRadioGroup, MenubarRadioItem, MenubarSub, MenubarSubContent, MenubarSubTrigger } from "@/components/ui/menubar";
import { useI18n } from "@/i18n";
import { PALETTES, usePalette, type PaletteId } from "@/lib/palette";

/**
 * Entrée « Couleurs » du menu Affichage : un sous-menu (ouvert au survol, côté droit) listant les palettes,
 * chacune avec une pastille fond/accent. À placer dans un MenubarContent.
 */
export function PaletteMenuItems() {
  const { t } = useI18n();
  const [palette, setPalette] = usePalette();
  return (
    <MenubarSub>
      <MenubarSubTrigger><Palette className="mr-2 size-4 text-muted-foreground" /> {t("pal.menu")}</MenubarSubTrigger>
      <MenubarSubContent sideOffset={7} alignOffset={-4} className="min-w-[16rem] rounded-tl-none">
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
      </MenubarSubContent>
    </MenubarSub>
  );
}
