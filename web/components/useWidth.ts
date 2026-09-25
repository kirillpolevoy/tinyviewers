'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * An element's width in px, kept current as it resizes. 0 until the element has been measured — on
 * the server and in the first paint — so anything drawn from it must have a sensible 0 case.
 */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
