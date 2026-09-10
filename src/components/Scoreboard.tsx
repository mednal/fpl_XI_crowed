"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Scoreboard as Board, ScoresResult } from "@/lib/scores";
import type { Pool } from "@/lib/types";

/** Scores keep moving while matches are on, so an unsettled board refreshes itself. */
const POLL_MS = 60000;

export default function Scoreboard({ pool, initial }: { pool: Pool; initial: ScoresResult }) {
  const [result, setResult] = useState<ScoresResult>(initial);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/pools/${pool.id}/scores`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setResult({ kind: "error", status: res.status, error: data.error ?? "Scores could not be read." });
      } else if (data.pending) {
        setResult({ kind: "pending", reason: data.reason });
      } else {
        setResult({ kind: "ok", data });
      }
    } catch {
      /* a dropped refresh is harmless — what is on screen is still the last good board */
    } finally {
      setBusy(false);
    }
  }, [pool.id]);

  const running = result.kind === "ok" && !result.data.settled;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [running, refresh]);

  return (
    <div className="board app table">
      <header className="strip">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="sep" />
        {result.kind === "ok" && (
          <span className={`chip${result.data.settled ? " good" : " live"}`}>
            {result.data.settled ? "Final" : "Provisional"}
          </span>
        )}
        <span className="chip name">{pool.name}</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Checking" : "Refresh"}
        </button>
        <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Live board</Link>
      </header>

      {result.kind === "pending" && <Waiting pool={pool} reason={result.reason} />}
      {result.kind === "error" && <Failed error={result.error} onRetry={() => void refresh()} />}
      {result.kind === "ok" && <Table pool={pool} data={result.data} />}
    </div>
  );
}

function Table({ pool, data }: { pool: Pool; data: Board }) {
  const { crowd, board, settled } = data;

  // The crowd's XI is dropped into the field it is being measured against,
  // at the rank it would have taken. Seeing it sit between two real viewers is
  // the whole argument the leaderboard exists to settle.
  const before = board.filter((r) => r.rank < crowd.rank);
  const after = board.filter((r) => r.rank >= crowd.rank);

  return (
    <>
      <main className="frame">
        <div className="tablehead">
          <h1>{data.gwName}</h1>
          <span className="spacer" />
          <span className="chip">
            {board.length} {board.length === 1 ? "team" : "teams"}
          </span>
        </div>

        {board.length ? (
          <table className="lb">
            <thead>
              <tr>
                <th className="rk">#</th>
                <th>Viewer</th>
                <th>Captain</th>
                <th style={{ textAlign: "right" }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {before.map((r, i) => <Row key={`b-${r.nick}-${i}`} r={r} lead={r.rank === 1} />)}
              <tr className="crowdrow">
                <td className="rk">{ordinal(crowd.rank)}</td>
                <td><b>The crowd XI</b></td>
                <td className="sm">
                  {crowd.captain ?? "—"}
                  <span className="tag">{crowd.formation}</span>
                </td>
                <td className="n">{crowd.points}</td>
              </tr>
              {after.map((r, i) => <Row key={`a-${r.nick}-${i}`} r={r} lead={r.rank === 1} />)}
            </tbody>
          </table>
        ) : (
          <p className="empty-note">Nobody submitted a team to this pool.</p>
        )}
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">Top score</dt>
          <dd className="num">{board.length ? board[0].points : "—"}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Crowd</dt>
          <dd className="num">{crowd.points}</dd>
        </dl>
        <span className="spacer" />
        <span className="chip">{settled ? "Gameweek settled" : "Refreshes every minute"}</span>
      </div>

      <aside className="churn">
        <section className="mod">
          <h2>The crowd XI</h2>
          <div className="bigscore">
            <b className="num">{crowd.points}</b>
            <span className="lab">points</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="chip">{crowd.formation}</span>
          </div>
          <p className="verdict">
            {board.length ? (
              <>
                The crowd beat <em>{crowd.beat}</em> of {crowd.of}{" "}
                {crowd.of === 1 ? "viewer" : "viewers"}, which puts it{" "}
                <em>{ordinal(crowd.rank)}</em> in the table.
              </>
            ) : (
              <>No teams were submitted, so there is nothing to measure the crowd XI against.</>
            )}
          </p>
          <div className="stats">
            <div className="stat">
              <span className="lab">Armband</span>
              <b className="sm">{crowd.captain ?? "—"}</b>
            </div>
            <div className="stat">
              <span className="lab">Beaten</span>
              <b className="num">{crowd.beat}/{crowd.of}</b>
            </div>
          </div>
        </section>

        <section className="mod grow">
          <h2>How this is scored</h2>
          <div className="modbody">
            <p className="hint">
              Every XI is scored the way FPL scores it: the captain doubled, the bench not
              counted unless it comes on.
            </p>
            {settled ? (
              <p className="hint">
                The gameweek is settled. A starter who played no minutes has been replaced by the
                first bench player who did play and who keeps the formation legal, and the armband
                has passed to the vice wherever a captain did not play. Both are marked against
                the row.
              </p>
            ) : (
              <p className="hint">
                The gameweek is still running, so these scores are provisional and refresh every
                minute. Auto-subs and the vice-captain switch are applied once FPL settles the
                gameweek — before then a player on nil is usually one who has not kicked off yet.
              </p>
            )}
          </div>
        </section>

        <section className="mod" style={{ marginTop: "auto", borderBottom: 0 }}>
          <div className="modbody">
            <Link className="btn" href={`/p/${pool.id}/live`}>See the crowd XI on the pitch</Link>
          </div>
        </section>
      </aside>
    </>
  );
}

function Row({ r, lead }: { r: Board["board"][number]; lead: boolean }) {
  return (
    <tr className={lead ? "lead" : undefined}>
      <td className="rk">{r.rank}</td>
      <td>{r.nick}</td>
      <td className="sm">
        {r.captain ?? "—"}
        {r.armbandMoved && <span className="tag">vice</span>}
        {r.subs > 0 && <span className="tag">{r.subs} sub{r.subs === 1 ? "" : "s"}</span>}
      </td>
      <td className="n">{r.points}</td>
    </tr>
  );
}

function Waiting({ pool, reason }: { pool: Pool; reason: string }) {
  return (
    <main className="frame wide">
      <div className="pagepad center">
        <h1 className="display" style={{ fontSize: "clamp(38px,6vw,68px)" }}>No scores yet</h1>
        <p className="lede" style={{ margin: "18px auto 24px", color: "var(--frame-text-2)" }}>
          {reason} The leaderboard fills in once the first match kicks off.
        </p>
        <div className="rowline" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href={`/p/${pool.id}/live`}>Watch the crowd XI</Link>
          <Link className="btn" href={`/p/${pool.id}`}>Pick your team</Link>
        </div>
      </div>
    </main>
  );
}

function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <main className="frame wide">
      <div className="banner">
        {error}
        <button className="btn btn-sm" onClick={onRetry}>Try again</button>
      </div>
      <div className="pagepad center">
        <p className="lede" style={{ margin: "0 auto", color: "var(--frame-text-2)" }}>
          Scores come from the official FPL API, which goes down from time to time. Nothing is
          lost — the teams are safe, and the board fills in when it answers again.
        </p>
      </div>
    </main>
  );
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
