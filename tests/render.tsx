/**
 * What a screen test needs before it can draw. Every `.test.tsx` asks for jsdom in its own first
 * line and imports this instead of `@testing-library/react`, so the browser's absences are filled
 * in one place rather than in each test that trips over them.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom answers no media queries, and a drawing asks for the reduced-motion setting before it plays.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Nothing in jsdom has a size, so the pieces that measure themselves get an observer that never fires
// and scrolling that goes nowhere. A screen test is about what is on the screen, not where it sits.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
window.scrollTo = (() => {}) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

afterEach(cleanup);

export * from '@testing-library/react';
