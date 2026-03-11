import { useRef, useEffect } from 'react';

/**
 * Runs a 60fps game loop via requestAnimationFrame.
 * Passes delta time (in seconds, capped at 50ms) to the callback.
 * The callback ref is kept current so the effect doesn't need to re-run on changes.
 */
export function useGameLoop(callback: (dt: number) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let lastTime = performance.now();
    let rafId: number;

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      callbackRef.current(dt);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
