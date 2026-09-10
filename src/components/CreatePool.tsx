"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FORMS } from "@/lib/squad";

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
  const [formation, setFormation] = useState("");   // empty: the crowd decides
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
    setDeadlineText(`${gwName} locks ${when}.`);
  }, [deadline, gwName]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), host: host.trim(), budget, formation }),
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
    <>
      <section className="mod">
        <h2>Open a pool</h2>
        <div className="modbody">
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
            <label htmlFor="phost">Your name, shown as the host</label>
            <input
              id="phost"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Your channel"
            />
          </div>

          <div className="field">
            <label htmlFor="pform">Shape of the results board</label>
            <select id="pform" value={formation} onChange={(e) => setFormation(e.target.value)}>
              <option value="">Let the crowd decide</option>
              {Object.keys(FORMS).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <p className="hint">
              {formation
                ? `Your crowd XI is always ${formation}: the most-picked players fill each row.`
                : "The shape follows the votes, so a crowd that loves defenders can end up 5-4-1."}
            </p>
          </div>

          <label className="switch">
            <input type="checkbox" checked={budget} onChange={(e) => setBudget(e.target.checked)} />
            <span>
              <b>Full FPL rules</b>
              <span>
                £100.0m budget, 15 players, max 3 per club. Turn off for a fast pool with no
                budget.
              </span>
            </span>
          </label>

          {error && <p className="err">{error}</p>}

          <button className="btn btn-primary btn-lg" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create pool"}
          </button>

          <p className="hint">
            {deadlineText} You get the results screen straight away, and a link to share.
          </p>
        </div>
      </section>

      <section className="mod" style={{ marginTop: "auto", borderBottom: 0 }}>
        <div className="modbody">
          <p className="hint">
            No account for you, none for your viewers. A pool covers one gameweek and locks at
            the official FPL deadline.
          </p>
        </div>
      </section>
    </>
  );
}
