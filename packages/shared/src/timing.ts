export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  const invoke = () => {
    timer = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };
  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  }) as Debounced<A>;
  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    invoke();
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
}

/** Leading + trailing edge throttle. */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): Throttled<A> {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailing: A | null = null;
  const run = (args: A) => {
    last = Date.now();
    fn(...args);
  };
  const throttled = ((...args: A) => {
    const now = Date.now();
    const remaining = intervalMs - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      trailing = null;
      run(args);
    } else {
      trailing = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (trailing) {
            const t = trailing;
            trailing = null;
            run(t);
          }
        }, remaining);
      }
    }
  }) as Throttled<A>;
  throttled.flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (trailing) {
      const t = trailing;
      trailing = null;
      run(t);
    }
  };
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    trailing = null;
  };
  return throttled;
}
