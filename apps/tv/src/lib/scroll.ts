/**
 * Compatibilité défilement pour les vieilles TV webOS (webOS 4.x = Chromium 53).
 *
 * Chromium 53 ne connaît que `scrollIntoView(alignToTop: boolean)` : passer un
 * objet d'options le rend « truthy », l'élément est donc collé en haut du
 * conteneur — les rangées disparaissent sous la navbar et le centrage
 * horizontal des cartes ne se fait jamais. `scrollTo({ … })` y est également
 * ignoré. On détecte le support et on replie sur un calcul manuel.
 */

/** True si le navigateur lit bien le dictionnaire d'options de scrollIntoView. */
const SUPPORTS_SCROLL_OPTIONS = (() => {
  let read = false;
  try {
    const probe = Object.defineProperty({}, 'behavior', {
      get() { read = true; return 'auto'; },
    });
    document.createElement('div').scrollIntoView(probe as ScrollIntoViewOptions);
  } catch {
    return false;
  }
  return read;
})();

function isScrollable(el: HTMLElement, axis: 'x' | 'y'): boolean {
  const style = getComputedStyle(el);
  const overflow = axis === 'x' ? style.overflowX : style.overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false;
  return axis === 'x' ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight;
}

function scrollableAncestor(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (isScrollable(node, axis)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Position de défilement amenant `el` au centre de `box`, bornée à la plage valide. */
function centerOffset(elStart: number, elSize: number, boxSize: number, current: number, max: number): number {
  return Math.max(0, Math.min(max, current + elStart - (boxSize - elSize) / 2));
}

/** Position minimale amenant `el` entièrement dans `box` (« nearest » : ne bouge pas si déjà visible). */
function nearestOffset(elStart: number, elSize: number, boxSize: number, current: number, max: number): number {
  if (elStart >= 0 && elStart + elSize <= boxSize) return current;
  const target = elStart < 0 ? current + elStart : current + elStart + elSize - boxSize;
  return Math.max(0, Math.min(max, target));
}

function fallbackScroll(el: HTMLElement, options: ScrollIntoViewOptions) {
  const { block = 'start', inline = 'nearest' } = options;

  const vertical = scrollableAncestor(el, 'y');
  if (vertical) {
    const box = vertical.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const max = vertical.scrollHeight - vertical.clientHeight;
    const start = rect.top - box.top;
    vertical.scrollTop = block === 'center'
      ? centerOffset(start, rect.height, vertical.clientHeight, vertical.scrollTop, max)
      : block === 'start'
        ? Math.max(0, Math.min(max, vertical.scrollTop + start))
        : nearestOffset(start, rect.height, vertical.clientHeight, vertical.scrollTop, max);
  }

  const horizontal = scrollableAncestor(el, 'x');
  if (horizontal) {
    const box = horizontal.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const max = horizontal.scrollWidth - horizontal.clientWidth;
    const start = rect.left - box.left;
    horizontal.scrollLeft = inline === 'center'
      ? centerOffset(start, rect.width, horizontal.clientWidth, horizontal.scrollLeft, max)
      : inline === 'start'
        ? Math.max(0, Math.min(max, horizontal.scrollLeft + start))
        : nearestOffset(start, rect.width, horizontal.clientWidth, horizontal.scrollLeft, max);
  }
}

/** Remplace `el.scrollIntoView(options)`, avec repli manuel sur Chromium 53. */
export function scrollIntoView(el: HTMLElement | null | undefined, options: ScrollIntoViewOptions) {
  if (!el) return;
  if (SUPPORTS_SCROLL_OPTIONS) el.scrollIntoView(options);
  else fallbackScroll(el, options);
}

/** Remplace `el.scrollTo({ top, left })`, avec repli manuel sur Chromium 53. */
export function scrollTo(el: HTMLElement | null | undefined, options: ScrollToOptions) {
  if (!el) return;
  if (SUPPORTS_SCROLL_OPTIONS) el.scrollTo(options);
  else {
    if (options.top !== undefined) el.scrollTop = options.top;
    if (options.left !== undefined) el.scrollLeft = options.left;
  }
}
