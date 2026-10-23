/** Platform helpers for rendering keyboard hints (⌘ vs Ctrl). */

export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(
    (navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent || '',
  );

/** Label for the primary modifier key. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';
