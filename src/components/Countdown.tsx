"use client";

import { useEffect, useState } from "react";

function label(msLeft: number): string {
  if (msLeft <= 0) return "Locked";
  const mins = Math.floor(msLeft / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${m}m`;
  return `${m}m`;
}

/** Time left until the pool closes on its own — the FPL deadline, or the earlier
 *  one the host set. A host who shuts the pool by hand ends it before that, so
 *  the clock gives way to the fact. */
export function Countdown({ deadline, closed = false }: { deadline: string; closed?: boolean }) {
  const target = new Date(deadline).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(target - Date.now());
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [target]);

  if (closed) return <span className="chip warn">Closed by the host</span>;

  // Rendered empty on the server so the markup matches until the clock starts.
  if (left === null) return <span className="chip">Deadline</span>;

  const soon = left > 0 && left < 3 * 3600 * 1000;
  return (
    <span className={`chip${soon ? " warn" : ""}`}>
      {left <= 0 ? "Deadline passed" : `Closes in ${label(left)}`}
    </span>
  );
}
