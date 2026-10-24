import { useEffect, useRef } from "react";

/** Re-fetch `load` at most once per `ms` while `trigger` keeps changing. */
export function useThrottledReload<T>(
  load: () => Promise<T>,
  trigger: unknown,
  ms: number,
  apply: (v: T) => void,
) {
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const run = () => {
      last.current = Date.now();
      load().then(apply).catch(() => undefined);
    };
    const wait = ms - (Date.now() - last.current);
    window.clearTimeout(timer.current);
    if (wait <= 0) run();
    else timer.current = window.setTimeout(run, wait);
    return () => window.clearTimeout(timer.current);
  }, [trigger]); // load/apply are intentionally read from the latest render
}
