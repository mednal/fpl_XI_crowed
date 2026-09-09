"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function CreatePool({
  gwName,
  deadline,
}: {
  gwName: string;
  deadline: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(`${gwName} — the people's XI`);
  const [host, setHost] = useState("");
  const [budget, setBudget] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Formatted after mount only: the server and the viewer are rarely in the same
  // locale or timezone, and formatting during render breaks hydration.
  const [deadlineText, setDeadlineText] = useState("");
  useEffect(() => {
    if (!deadline) return;
    const when = new Date(deadline).toLocaleString([], {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
    setDeadlineText(`Deadline for ${gwName}: ${when}. `);
  }, [deadline, gwName]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), host: host.trim(), budget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the pool.");
      router.push(`/p/${data.id}/live`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the pool.");
      setBusy(false);
    }
  }

  return (
    <div className="panel formcard">
      <div className="field">
        <label htmlFor="pname">Pool name</label>
        <input
          id="pname"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${gwName} pool`}
        />
      </div>

      <div className="field">
        <label htmlFor="phost">Your name (shown as the host)</label>
        <input
          id="phost"
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="Your channel"
        />
      </div>

      <label className="switch">
        <input type="checkbox" checked={budget} onChange={(e) => setBudget(e.target.checked)} />
        <span>
          <b>Full FPL rules</b>
          <span>
            £100.0m budget, 15 players, max 3 per club. Turn off for a fast pool with no budget.
          </span>
        </span>
      </label>

      {error && <div className="err">{error}</div>}

      <button className="btn btn-primary" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create pool →"}
      </button>

      <p className="hint">
        {deadlineText}
        Players and prices come straight from the official FPL game.
      </p>
    </div>
  );
}
