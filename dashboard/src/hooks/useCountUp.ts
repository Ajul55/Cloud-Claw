import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 → target using ease-out cubic over `duration` ms.
 * Returns a float so callers can format (round, toFixed, etc.) themselves.
 */
export function useCountUp(target: number, duration = 900, delay = 150): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setValue(0);
    let startTime: number | null = null;

    const timeoutId = setTimeout(() => {
      const tick = (now: number) => {
        if (startTime === null) startTime = now;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(target * eased);
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setValue(target);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, delay]);

  return value;
}
