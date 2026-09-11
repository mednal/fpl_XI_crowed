"use client";

import { useEffect, useRef, useState } from "react";
import DeadlineDial from "./DeadlineDial";
import { poolLock } from "@/lib/lock";
import { MOVE_CHOICES, movesLabel } from "@/lib/transfers";

/** How long the close button waits for its second press before giving up. This
 *  bar sits on the screen the host is streaming, so closing takes two. */
const CONFIRM_MS = 6000;

/**
 * The host's own strip on the results board: move the closing time, or shut the
 * pool the moment the segment ends. Only the browser that opened the pool is
 * shown it, and the server checks that again on every change.
 */
export default function HostBar({
  poolId,
  deadline,
  closedAt,
  fplDeadline,
  moves,
  onChange,
  onPreview,
}: {
  poolId: string;
  deadline: string | null;
  closedAt: string | null;
  /** The gameweek's own lock, which is as late as a pool may run. */
  fplDeadline: string | null;
  /** A transfer pool's allowance. Left out by a crowd pool, which has none. */
  moves?: number;
  onChange: (next: {
    deadline: string | null;
    closed_at: string | null;
    moves?: number | null;
  }) => void;
  /** Drop the host's own furniture and show the board the crowd gets. */
  onPreview?: () => void;
}) {
  // What the dial is showing. Null is "at the deadline", which is what the server
  // reads an empty closing time as.
  const at = deadline && deadline !== fplDeadline ? deadline : null;
  const [draft, setDraft] = useState<string | null>(at);
  useEffect(() => { setDraft(at); }, [at]);

  const [busy, setBusy] = useState<"" | "time" | "close" | "moves">("");
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The deadline can pass while the board sits there, which changes what this
  // bar is allowed to offer.
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const check = () => setPassed(poolLock({ deadline, closed_at: null }).locked);
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [deadline]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function flash(text: string) {
    setNote(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(""), 4000);
  }

  async function patch(
    body: { deadline?: string | null; closed?: boolean; moves?: number },
    kind: "time" | "close" | "moves",
  ) {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(`/api/pools/${poolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That change did not go through.");
      onChange({
        deadline: data.deadline ?? null,
        closed_at: data.closed_at ?? null,
        moves: data.moves ?? null,
      });
      flash(
        kind === "close"
          ? body.closed ? "Pool closed." : "Pool reopened."
          : kind === "moves"
            ? `${movesLabel(body.moves)}. Viewers see it when their screen next loads.`
            : "Closing time saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change did not go through.");
      // The board keeps showing what the server actually holds, not the drag
      // that failed.
      setDraft(at);
    } finally {
      setBusy("");
      setConfirming(false);
    }
  }

  function closeNow() {
    if (!confirming) {
      setConfirming(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirming(false), CONFIRM_MS);
      return;
    }
    patch({ closed: true }, "close");
  }

  const shut = Boolean(closedAt);
  const state = shut
    ? "Closed. No more teams are going in."
    : passed
      ? "The deadline has passed, so teams are locked."
      : "Open. Teams are going in.";

  return (
    <div className="hostbar">
      <span className="lab">Host</span>
      <span className="state">{state}</span>

      <span className="lab">Closes</span>
      <DeadlineDial
        label="Voting closes"
        value={draft}
        deadline={fplDeadline}
        endLabel="Gameweek deadline"
        disabled={busy !== "" || passed}
        onChange={setDraft}
        onCommit={(iso) => patch({ deadline: iso }, "time")}
      />

      {moves !== undefined && (
        <>
          <span className="lab">Crowd gets</span>
          <select
            className="hostsel"
            aria-label="Transfers each viewer may vote for"
            value={moves}
            disabled={busy !== "" || passed}
            onChange={(e) => patch({ moves: Number(e.target.value) }, "moves")}
          >
            {(MOVE_CHOICES.includes(moves) ? MOVE_CHOICES : [moves, ...MOVE_CHOICES]).map((m) => (
              <option key={m} value={m}>{movesLabel(m)}</option>
            ))}
          </select>
        </>
      )}

      <span className="spacer" />

      {onPreview && (
        <button className="btn btn-sm btn-ghost" onClick={onPreview}>
          Preview as viewer
        </button>
      )}

      {(busy === "time" || busy === "moves") && <span className="chip">Saving…</span>}
      {note && <span className="chip good">{note}</span>}
      {error && <span className="err">{error}</span>}

      {!passed && (shut ? (
        <button className="btn btn-sm" disabled={busy !== ""} onClick={() => patch({ closed: false }, "close")}>
          {busy === "close" ? "Reopening…" : "Reopen voting"}
        </button>
      ) : (
        <button
          className={`btn btn-sm${confirming ? " btn-primary" : ""}`}
          disabled={busy !== ""}
          onClick={closeNow}
        >
          {busy === "close" ? "Closing…" : confirming ? "Press again to close" : "Close voting now"}
        </button>
      ))}
    </div>
  );
}

/**
 * The way back out of the viewer preview. It floats rather than taking a band of
 * its own, because the whole point of the preview is that the board underneath
 * is laid out exactly as the crowd's is — a strip here would move the pitch and
 * the host would be checking the wrong screen.
 */
export function ViewerPreview({ onExit }: { onExit: () => void }) {
  return (
    <div className="vpreview">
      <span>This is the board your viewers get. None of your controls are on it.</span>
      <button className="btn btn-sm" onClick={onExit}>Back to host controls</button>
    </div>
  );
}
