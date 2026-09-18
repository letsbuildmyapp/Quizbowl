import { useEffect } from 'react';

/** Apply reduced motion / large text preferences to the document root. */
export function useAccessibilityPrefs(settings) {
  const reduced = !!settings?.reducedMotion;
  const large = !!settings?.largeText;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reducedMotion = reduced ? 'true' : 'false';
    root.dataset.largeText = large ? 'true' : 'false';
  }, [reduced, large]);
}

export function prefersReducedMotion(settings) {
  if (settings?.reducedMotion) return true;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
