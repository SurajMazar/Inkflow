import * as React from 'react';

export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = React.useState(get);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Phones and narrow tablets get the compact editor layout. */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
