import { useEffect, useState } from 'react';

const readVisibility = () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden');

export function usePageVisibility(throttleMs = 500): boolean {
  const [isVisible, setIsVisible] = useState(readVisibility);

  useEffect(() => {
    let pending = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const onVisibilityChange = () => {
      if (pending) {
        return;
      }
      pending = true;
      timeoutId = setTimeout(() => {
        pending = false;
        timeoutId = undefined;
        setIsVisible(readVisibility());
      }, throttleMs);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [throttleMs]);

  return isVisible;
}
