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

/** Time left until the real FPL deadline, which is when voting closes. */
export function Countdown({ deadline }: { deadline: string }) {
  const target = new Date(deadline).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(target - Date.now());
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [target]);

  // Rendered empty on the server so the markup matches until the clock starts.
  if (left === null) return <span className="chip">Deadline</span>;

  const soon = left > 0 && left < 3 * 3600 * 1000;
  return (
    <span className={`chip${soon ? " warn" : ""}`}>
      {left <= 0 ? "Deadline passed" : `Closes in ${label(left)}`}
    </span>
  );
}
