import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Overlays that are open right now; only the top one reacts to Tab and Esc. */
const stack: HTMLElement[] = [];

/**
 * While `active`: focus moves into `ref` (first `[data-autofocus]`, else the first field),
 * Tab / Shift+Tab cycle inside it, Esc calls `onEscape`, the page behind does not scroll,
 * and on close focus returns to whatever was focused before.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    stack.push(root);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusables = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    const first =
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      focusables().find((el) => el.tagName !== 'BUTTON') ??
      focusables()[0];
    (first ?? root).focus();

    function onKey(e: KeyboardEvent): void {
      if (stack[stack.length - 1] !== root) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        escape.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0] as HTMLElement;
      const lastEl = items[items.length - 1] as HTMLElement;
      if (
        e.shiftKey &&
        (document.activeElement === firstEl || !root?.contains(document.activeElement))
      ) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(root), 1);
      if (stack.length === 0) document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [active, ref]);
}
