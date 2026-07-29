import { useEffect, useState } from 'react';

/** Ticking `Date.now()` re-rendered every `intervalMs` — freshness ages,
 * countdowns, staleness gates. One shared ticker instead of a copy-pasted
 * setInterval/useState pair per consumer. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
