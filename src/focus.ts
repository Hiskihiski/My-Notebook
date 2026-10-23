// Keyboard focus helpers: keep focus on the same logical control when a list
// is re-rendered with innerHTML, and keep Tab inside an open dialog.
// No Firebase or app state here, so it is unit-testable in jsdom.

// Describes a list whose items are rebuilt from scratch (the note grid).
export interface ListFocusConfig {
  item:    string;            // selector of one list item, e.g. ".card"
  primary: string;            // selector of an item's main control, e.g. ".card-open"
  keyed:   readonly string[]; // classes of per-item controls that carry data-id
}

// Enough about a focused control to find its replacement after a re-render.
export interface SavedFocus {
  el:    HTMLElement;
  cls:   string | null; // one of ListFocusConfig.keyed
  id:    string | null; // its data-id
  elId:  string | null; // its id attribute (e.g. a retry button)
  href:  string | null; // its href (links in the list footer)
  index: number;        // position of its list item, -1 if not inside one
}

export function saveFocus(el: Element | null, list: ParentNode, cfg: ListFocusConfig): SavedFocus | null {
  if (!(el instanceof HTMLElement) || el === el.ownerDocument.body) return null;
  const cls  = cfg.keyed.find((c) => el.classList.contains(c)) ?? null;
  const item = el.closest(cfg.item);
  return {
    el, cls,
    id:    cls ? el.dataset.id ?? null : null,
    elId:  el.id || null,
    href:  el.getAttribute("href"),
    index: item ? [...list.querySelectorAll(cfg.item)].indexOf(item) : -1,
  };
}

function sameControl(saved: SavedFocus, el: HTMLElement): boolean {
  if (saved.cls) return el.classList.contains(saved.cls) && el.dataset.id === saved.id;
  if (saved.elId) return el.id === saved.elId;
  if (saved.href !== null) return el.getAttribute("href") === saved.href;
  return false;
}

function tryFocus(el: HTMLElement | null | undefined, opts?: FocusOptions): el is HTMLElement {
  if (!el) return false;
  el.focus(opts);
  return el.ownerDocument.activeElement === el;
}

// Focuses, in order: the saved element if it is still in the document, the
// same control in the rebuilt list, the main control of the item now at the
// same position (or the last item), then `fallback`. Returns what got focus.
export function restoreFocus(
  list: ParentNode, saved: SavedFocus, cfg: ListFocusConfig,
  fallback: HTMLElement | null, opts?: FocusOptions,
): HTMLElement | null {
  if (saved.el.isConnected && tryFocus(saved.el, opts)) return saved.el;
  const same = [...list.querySelectorAll<HTMLElement>("*")].find((el) => sameControl(saved, el));
  if (tryFocus(same, opts)) return same;
  if (saved.index >= 0) {
    const items = list.querySelectorAll(cfg.item);
    const item  = items[Math.min(saved.index, items.length - 1)];
    const main  = item?.querySelector<HTMLElement>(cfg.primary);
    if (tryFocus(main, opts)) return main;
  }
  return tryFocus(fallback, opts) ? fallback : null;
}

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

function rendered(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

// Controls inside `root` that Tab can reach, in DOM order.
export function tabbables(root: ParentNode, isVisible: (el: HTMLElement) => boolean = rendered): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)]
    .filter((el) => el.tabIndex >= 0 && !el.closest("[inert]") && isVisible(el));
}

// Where Tab (or Shift+Tab when `backwards`) must go to stay inside `dialog`,
// or null to let the browser move focus normally.
export function trapTarget(
  dialog: Element, items: readonly HTMLElement[], active: Element | null, backwards: boolean,
): HTMLElement | null {
  if (!items.length) return null;
  const first = items[0], last = items[items.length - 1];
  if (!active || !dialog.contains(active)) return backwards ? last : first;
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return null;
}
