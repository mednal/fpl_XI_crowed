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
    <>
      <div className="topbar">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="chip">{pool.name}</span>
        {result.kind === "ok" && (
          <span className={`chip${result.data.settled ? " good" : " live"}`}>
            {result.data.settled ? "Final" : "Provisional"}
          </span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Checking" : "Refresh"}
        </button>
        <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Live board</Link>
      </div>

      {result.kind === "pending" && <Waiting pool={pool} reason={result.reason} />}
      {result.kind === "error" && <Failed error={result.error} onRetry={() => void refresh()} />}
      {result.kind === "ok" && <Table pool={pool} data={result.data} />}
    </>
  );
}

function Table({ pool, data }: { pool: Pool; data: Board }) {
  const { crowd, board, settled } = data;

  return (
    <div className="shell">
      <section className="panel">
        <header>
          <h3>{data.gwName} leaderboard</h3>
          <span className="chip">
            {board.length} {board.length === 1 ? "team" : "teams"}
          </span>
        </header>

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
              {board.map((r, i) => (
                <tr key={`${r.nick}-${i}`}>
                  <td className="rk">{r.rank}</td>
                  <td>{r.nick}</td>
                  <td className="sm">
                    {r.captain ?? "—"}
                    {r.armbandMoved && <span className="tag">vice</span>}
                    {r.subs > 0 && (
                      <span className="tag">
                        {r.subs} sub{r.subs === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="n">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-note">Nobody submitted a team to this pool.</div>
        )}
      </section>

      <div className="rail">
        <section className="panel">
          <header><h3>The crowd XI</h3></header>
          <div className="bigscore">
            <b className="num">{crowd.points}</b>
            <span className="eyebrow">points</span>
            <span style={{ flex: 1 }} />
            <span className="chip">{crowd.formation}</span>
          </div>
          <p className="verdict">
            {board.length ? (
              <>
                The crowd beat <em>{crowd.beat}</em> of {crowd.of}{" "}
                {crowd.of === 1 ? "viewer" : "viewers"}, which would put it{" "}
                <em>{ordinal(crowd.rank)}</em> in the table.
              </>
            ) : (
              <>No teams were submitted, so there is nothing to measure the crowd XI against.</>
            )}
          </p>
          <div className="stats">
            <div className="stat">
              <span className="eyebrow">Captain</span>
              <b style={{ fontSize: 17 }}>{crowd.captain ?? "—"}</b>
            </div>
            <div className="stat">
              <span className="eyebrow">Top score</span>
              <b>{board.length ? board[0].points : "—"}</b>
            </div>
          </div>
        </section>

        <section className="panel">
          <header><h3>How this is scored</h3></header>
          <div className="panelbody">
            <p className="hint">
              Every XI is scored the way FPL scores it: the captain doubled, the bench not
              counted unless it comes on.
            </p>
            {settled ? (
              <p className="hint">
                The gameweek is settled. A starter who played no minutes has been replaced by
                the first bench player who did play and who keeps the formation legal, and the
                armband has passed to the vice wherever a captain did not play. Both are marked
                against the row.
              </p>
            ) : (
              <p className="hint">
                The gameweek is still running, so these scores are provisional and refresh every
                minute. Auto-subs and the vice-captain switch are applied once FPL settles the
                gameweek — before then a player on nil is usually one who has not kicked off yet.
              </p>
            )}
            <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>
              See the crowd XI on the pitch
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Waiting({ pool, reason }: { pool: Pool; reason: string }) {
  return (
    <div className="pagepad center">
      <h1 className="display" style={{ fontSize: 40 }}>No scores yet</h1>
      <p className="lede" style={{ margin: "14px auto" }}>
        {reason} The leaderboard fills in once the first match kicks off.
      </p>
      <div className="rowline" style={{ justifyContent: "center" }}>
        <Link className="btn btn-primary" href={`/p/${pool.id}/live`}>Watch the crowd XI</Link>
        <Link className="btn" href={`/p/${pool.id}`}>Pick your team</Link>
      </div>
    </div>
  );
}

function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <>
      <div className="banner">
        {error}
        <button className="btn btn-sm" onClick={onRetry}>Try again</button>
      </div>
      <div className="pagepad center">
        <p className="lede" style={{ margin: "14px auto" }}>
          Scores come from the official FPL API, which goes down from time to time. Nothing is
          lost — the teams are safe, and the board fills in when it answers again.
        </p>
      </div>
    </>
  );
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
