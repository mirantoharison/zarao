import { Palette, RefreshCw, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  ContextMenuItem, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuShortcut,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useI18n } from "@/i18n";
import { PALETTES, usePalette, type PaletteId } from "@/lib/palette";
import { refreshScreen } from "@/lib/refresh";
import { useZoom } from "@/lib/zoom";

/**
 * Zoom, palette et rafraîchissement pour le menu contextuel du fond de l'écran.
 * IMPORTANT : doublon volontaire de ZoomMenuItems / PaletteMenuItems / RefreshMenuItem, qui sont typés sur les primitives de la
 * Menubar (Radix refuse un MenubarItem hors d'un Menubar). La logique reste dans lib/zoom, lib/palette et lib/refresh.
 */
export function ContextViewItems() {
  const { t } = useI18n();
  const { level, canZoomIn, canZoomOut, zoomIn, zoomOut, reset } = useZoom();
  const [palette, setPalette] = usePalette();
  return (
    <>
      <ContextMenuItem disabled={!canZoomIn} onSelect={(e) => { e.preventDefault(); zoomIn(); }}><ZoomIn /> {t("zoom.in")} <ContextMenuShortcut>Ctrl + Alt + =</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem disabled={!canZoomOut} onSelect={(e) => { e.preventDefault(); zoomOut(); }}><ZoomOut /> {t("zoom.out")} <ContextMenuShortcut>Ctrl + Alt + −</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem disabled={level === 100} onSelect={(e) => { e.preventDefault(); reset(); }}><RotateCcw /> {t("zoom.reset", { v: level })} <ContextMenuShortcut>Ctrl + Alt + 0</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Palette /> {t("pal.menu")}</ContextMenuSubTrigger>
        <ContextMenuSubContent sideOffset={7} alignOffset={-4} className="min-w-[16rem]">
          <ContextMenuRadioGroup value={palette} onValueChange={(v) => setPalette(v as PaletteId)}>
            {PALETTES.map(({ id, swatch }) => (
              <ContextMenuRadioItem key={id} value={id}>
                <span className="relative size-4 shrink-0 overflow-hidden rounded-full border" style={{ background: swatch[0] }}>
                  <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: swatch[1] }} />
                </span>
                {t(`pal.${id}`)}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={refreshScreen}><RefreshCw /> {t("view.refresh")} <ContextMenuShortcut>F5</ContextMenuShortcut></ContextMenuItem>
    </>
  );
}
