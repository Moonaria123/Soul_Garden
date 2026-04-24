'use client';

import { useEffect, useState } from 'react';

/** 仅在客户端订阅 matchMedia；首屏 SSR 为 `false`。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);

  return matches;
}
