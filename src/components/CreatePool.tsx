"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import DeadlineDial from "./DeadlineDial";
import { FORMS } from "@/lib/squad";
import { DEFAULT_MOVES, MOVE_CHOICES, movesLabel } from "@/lib/transfers";
import type { PoolKind } from "@/lib/types";

export default function CreatePool({
  gwName,
  deadline,
}: {
  gwName: string;
  deadline: string | null;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<PoolKind>("crowd");
  const [name, setName] = useState(() => suggestion("crowd", gwName));
  const [host, setHost] = useState("");
  const [budget, setBudget] = useState(true);
  const [formation, setFormation] = useState("");   // empty: the crowd decides
  const [moves, setMoves] = useState(DEFAULT_MOVES);
  const [closes, setCloses] = useState<string | null>(null);   // null: the FPL deadline
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The suggested name follows the mode, until the host has typed their own. */
  function pickKind(next: PoolKind) {
    setName((cur) => (cur === suggestion(kind, gwName) ? suggestion(next, gwName) : cur));
    setKind(next);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), host: host.trim(), budget, formation,
          deadline: closes, kind, moves,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the pool.");
      // A transfer pool has nothing to show until the host puts their team up,
      // so it opens on the setup screen rather than on an empty board.
      router.push(kind === "transfer" ? `/p/${data.id}/setup` : `/p/${data.id}/live`);
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
            <span className="fieldlab">What you are asking your viewers</span>
            <div className="kindpick" role="radiogroup" aria-label="What you are asking your viewers">
              <button
                type="button" role="radio" aria-checked={kind === "crowd"}
                className={`kindcard${kind === "crowd" ? " on" : ""}`}
                onClick={() => pickKind("crowd")}
              >
                <b>Build the XI</b>
                <span>Everyone picks a whole squad. The most-picked eleven goes on your screen.</span>
              </button>
              <button
                type="button" role="radio" aria-checked={kind === "transfer"}
                className={`kindcard${kind === "transfer" ? " on" : ""}`}
                onClick={() => pickKind("transfer")}
              >
                <b>Transfer my team</b>
                <span>
                  Your own team goes up — imported from FPL or built here — and they vote on
                  who to sell and who to sign.
                </span>
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="pname">Pool name</label>
            <input
              id="pname"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestion(kind, gwName)}
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

          {kind === "crowd" ? (
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
          ) : (
            <div className="field">
              <label htmlFor="pmoves">Transfers each viewer may make</label>
              <select id="pmoves" value={moves} onChange={(e) => setMoves(Number(e.target.value))}>
                {MOVE_CHOICES.map((m) => (
                  <option key={m} value={m}>{movesLabel(m)}</option>
                ))}
              </select>
              <p className="hint">
                {moves === 1
                  ? "One each is the real game, and it gives you the cleanest number on screen: the share of your audience who want a particular player gone."
                  : moves === 0
                    ? "A wildcard vote. Expect a busier board — the one popular swap gets harder to pick out."
                    : `Each viewer proposes up to ${moves}, and the board draws the ${moves} with the most votes behind them.`}
              </p>
            </div>
          )}

          <div className="field">
            <span className="fieldlab">Voting closes</span>
            <DeadlineDial
              label="Voting closes"
              variant="inline"
              value={closes}
              deadline={deadline}
              endLabel={`${gwName} deadline`}
              onChange={setCloses}
            />
            <p className="hint">
              Drag the runway to close earlier than the official deadline. You can move
              it again, or close the pool by hand, from the results screen.
            </p>
          </div>

          <label className="switch">
            <input type="checkbox" checked={budget} onChange={(e) => setBudget(e.target.checked)} />
            <span>
              <b>Full FPL rules</b>
              <span>
                {kind === "transfer"
                  ? "Transfers have to be affordable out of your bank. Turn it off and viewers can propose anything they like — the 3-per-club limit holds either way."
                  : "£100.0m budget, 15 players, max 3 per club. Turn off for a fast pool with no budget."}
              </span>
            </span>
          </label>

          {error && <p className="err">{error}</p>}

          <button className="btn btn-primary btn-lg" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create pool"}
          </button>

          <p className="hint">
            {kind === "transfer"
              ? "Next you put your team up — paste your FPL team ID, or build it here. Then you get the link to share."
              : "You get the results screen straight away, and a link to share."}
          </p>
        </div>
      </section>

      <section className="mod" style={{ marginTop: "auto", borderBottom: 0 }}>
        <div className="modbody">
          <p className="hint">
            No account for you, none for your viewers. A pool covers one gameweek and never runs
            past the official FPL deadline — but it is yours to close whenever you like.
          </p>
        </div>
      </section>
    </>
  );
}

/** The name a host is offered. It says what the pool is for, so it changes with
 *  the mode — but only while it is still the offer and not their own words. */
function suggestion(kind: PoolKind, gwName: string): string {
  return kind === "transfer"
    ? `${gwName} — you pick my transfers`
    : `${gwName} — the people's XI`;
}
