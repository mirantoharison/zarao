/**
 * Centre `el` dans `scroller` en ne faisant défiler QUE ce conteneur.
 *
 * IMPORTANT : `element.scrollIntoView()` fait défiler tous les ancêtres défilables, y compris ceux en `overflow: hidden`
 * (ils le restent programmatiquement). Utilisé dans une zone à l'intérieur de la mise en page, il décalait toute la
 * fenêtre vers la gauche ou vers le haut : panneaux rognés, barre de menus qui bouge.
 */
export function centerInScroller(scroller: HTMLElement, el: Element, axis: "x" | "y", behavior: ScrollBehavior = "smooth"): void {
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (axis === "x") scroller.scrollTo({ left: scroller.scrollLeft + (r.left - s.left) - (s.width - r.width) / 2, behavior });
  else scroller.scrollTo({ top: scroller.scrollTop + (r.top - s.top) - (s.height - r.height) / 2, behavior });
}
