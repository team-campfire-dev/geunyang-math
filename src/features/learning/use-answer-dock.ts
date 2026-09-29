'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Coarse input includes tablets in both orientations; a mouse interaction can override it. */
export function useTouchAnswerInput() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(any-pointer: coarse)');
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return [touch, setTouch] as const;
}

/** Reserve actual dock height, including safe areas, and follow the visible viewport on rotation. */
export function useAnswerDock(open: boolean, panel: RefObject<HTMLDivElement | null>, field: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (!open || !panel.current) return;
    const root = document.documentElement;
    const oldHeight = root.style.getPropertyValue('--answer-dock-height');
    const oldOpen = root.getAttribute('data-answer-dock');
    root.setAttribute('data-answer-dock', 'open');
    let frame = 0;
    const update = () => {
      const dock = panel.current;
      if (!dock) return;
      const viewport = window.visualViewport;
      dock.style.bottom = `${Math.max(0, window.innerHeight - (viewport ? viewport.height + viewport.offsetTop : window.innerHeight))}px`;
      dock.style.maxHeight = `${(viewport?.height ?? window.innerHeight) * 0.65}px`;
      root.style.setProperty('--answer-dock-height', `${dock.getBoundingClientRect().height}px`);
    };
    const reveal = () => {
      update();
      const input = field.current, dock = panel.current;
      if (!input || !dock) return;
      const bottom = dock.getBoundingClientRect().top;
      const top = window.visualViewport?.offsetTop ?? 0;
      const card = input.closest('.problem-card, .lesson-sheet');
      const area = (card ?? input).getBoundingClientRect();
      // Keep the question too when it fits; long questions remain scrollable above the dock.
      // Include the format note and local error so the keyboard cannot cover the way to fix it.
      const inputRect = (input.closest('.math-answer') ?? input).getBoundingClientRect();
      const target = inputRect.bottom - area.top < bottom - top - 32 ? area : inputRect;
      if (target.top < top + 12) window.scrollBy({ top: target.top - top - 12, behavior: 'instant' });
      else if (inputRect.bottom > bottom - 12) window.scrollBy({ top: inputRect.bottom - bottom + 12, behavior: 'instant' });
    };
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    const observer = new ResizeObserver(resize);
    observer.observe(panel.current);
    if (field.current) observer.observe(field.current.closest('.math-answer') ?? field.current);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', resize);
      if (oldHeight) root.style.setProperty('--answer-dock-height', oldHeight);
      else root.style.removeProperty('--answer-dock-height');
      if (oldOpen) root.setAttribute('data-answer-dock', oldOpen);
      else root.removeAttribute('data-answer-dock');
    };
  }, [open, panel, field]);
}
