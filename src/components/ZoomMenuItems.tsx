import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { MenubarItem, MenubarShortcut } from "@/components/ui/menubar";
import { useI18n } from "@/i18n";
import { useZoom } from "@/lib/zoom";

/** Entrées de menu de zoom général (avant, arrière, taille normale), à placer dans un MenubarContent. */
export function ZoomMenuItems() {
  const { t } = useI18n();
  const { level, canZoomIn, canZoomOut, zoomIn, zoomOut, reset } = useZoom();
  return (
    <>
      <MenubarItem disabled={!canZoomIn} onSelect={(e) => { e.preventDefault(); zoomIn(); }}><ZoomIn /> {t("zoom.in")} <MenubarShortcut>Ctrl + Alt + =</MenubarShortcut></MenubarItem>
      <MenubarItem disabled={!canZoomOut} onSelect={(e) => { e.preventDefault(); zoomOut(); }}><ZoomOut /> {t("zoom.out")} <MenubarShortcut>Ctrl + Alt + −</MenubarShortcut></MenubarItem>
      <MenubarItem disabled={level === 100} onSelect={(e) => { e.preventDefault(); reset(); }}><RotateCcw /> {t("zoom.reset", { v: level })} <MenubarShortcut>Ctrl + Alt + 0</MenubarShortcut></MenubarItem>
    </>
  );
}
