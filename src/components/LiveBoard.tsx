"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PitchRows, type SlotView } from "./Pitch";
import { TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import { getBrowserClient } from "@/lib/supabase";
import { POSITIONS, POSLONG, crowdXI, money, pctText, ranked, tally } from "@/lib/squad";
import type { Bootstrap, Entry, PosId, Pool, Ranked } from "@/lib/types";

type Row = Pick<Entry, "id" | "nick" | "xi" | "bench" | "captain" | "vice">;

export default function LiveBoard({
  pool,
  boot,
  initialEntries,
}: {
  pool: Pool;
  boot: Bootstrap;
  initialEntries: Row[];
}) {
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);

  const [entries, setEntries] = useState<Row[]>(initialEntries);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  // Off until the browser says so: the server does not know the viewer's clock,
  // and a link that appears mid-render would not match the markup sent down.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setLink(`${window.location.origin}/p/${pool.id}`);
  }, [pool.id]);

  const deadline = pool.deadline;
  useEffect(() => {
    if (!deadline) return;
    const check = () => setLocked(new Date(deadline).getTime() <= Date.now());
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [deadline]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/pools/${pool.id}/entries`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch { /* a dropped poll is harmless; the next one catches up */ }
  }, [pool.id]);

  useEffect(() => {
    const supabase = getBrowserClient();

    // Realtime pushes each new team the moment it lands. Polling every 15s is
    // the backstop for viewers behind proxies that block websockets.
    const channel = supabase
      ?.channel(`pool-${pool.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `pool_id=eq.${pool.id}` },
        () => { void refresh(); },
      )
      .subscribe();

    const poll = setInterval(() => { void refresh(); }, 15000);
    return () => {
      clearInterval(poll);
      if (channel) void channel.unsubscribe();
    };
  }, [pool.id, refresh]);

  const t = useMemo(() => tally(entries as never), [entries]);
  const cx = useMemo(() => crowdXI(t, byId), [t, byId]);

  const rows: SlotView[][] = POSITIONS.map((k) => {
    const picks = cx.rows[k] ?? [];
    if (!picks.length) return [{ player: null, pos: k, sub: "—" }];
    return picks.map((r) => ({
      player: r.player,
      pos: k,
      sub: pctText(r.pct),
      subClass: "pct",
      badge: cx.captain?.id === r.id ? ("C" as const) : cx.vice?.id === r.id ? ("V" as const) : null,
      title: `${r.player.n} — picked in ${r.count} of ${t.n} starting XIs`,
    }));
  });

  const topPick = ranked(t.xi, t.n, byId)[0] ?? null;
  const capBoard = ranked(t.captain, t.n, byId).slice(0, 6);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the link is on screen to copy by hand */ }
  }

  return (
    <>
      <div className="topbar">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="chip">{pool.name}</span>
        <span className="chip live">Live</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="meter">
          <span className="eyebrow">Teams in</span>
          <b>{t.n}</b>
        </span>
        {locked && (
          <Link className="btn btn-sm" href={`/p/${pool.id}/scores`}>Scores</Link>
        )}
        <Link className="btn btn-sm" href={`/p/${pool.id}`}>My team</Link>
      </div>

      <div className="shell">
        <div className="pitchwrap">
          <div className="pitchbar">
            <span className="eyebrow">The crowd XI</span>
            <span className="chip">{t.n ? cx.formation : "—"}</span>
            <span style={{ flex: 1 }} />
            <span className="chip">{money(cx.cost)} on the pitch</span>
            {cx.clubBreaches.length > 0 && (
              <span className="chip warn">
                Breaks the 3-per-club rule:{" "}
                {cx.clubBreaches.map((id) => teams.get(Number(id))?.sh).join(", ")}
              </span>
            )}
            {pool.deadline && <Countdown deadline={pool.deadline} />}
          </div>

          {t.n ? (
            <PitchRows rows={rows} teams={teams} />
          ) : (
            <div className="pitch">
              <div className="empty-note" style={{ color: "#fff", padding: "60px 20px" }}>
                No teams yet. Share the link and the shirts fill in as votes arrive.
              </div>
            </div>
          )}

          <div className="stats">
            <div className="stat">
              <span className="eyebrow">Teams in</span>
              <b>{t.n}</b>
            </div>
            <div className="stat">
              <span className="eyebrow">Top captain</span>
              <b style={{ fontSize: 17 }}>
                {cx.captain ? `${cx.captain.player.n} ${pctText(cx.captain.pct)}` : "—"}
              </b>
            </div>
            <div className="stat">
              <span className="eyebrow">Most picked</span>
              <b style={{ fontSize: 17 }}>
                {topPick ? `${topPick.player.n} ${pctText(topPick.pct)}` : "—"}
              </b>
            </div>
          </div>
        </div>

        <div className="rail">
          <section className="panel">
            <header><h3>Share with your viewers</h3></header>
            <div className="panelbody">
              <div className="sharebox">
                <code>{link || `/p/${pool.id}`}</code>
                <button className="btn btn-sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <p className="hint">
                Anyone with this link can pick a team — no account needed. Teams lock at the
                official FPL deadline.
              </p>
            </div>
          </section>

          <section className="panel">
            <header>
              <h3>Captain vote</h3>
              <span className="chip">{t.n} voted</span>
            </header>
            {capBoard.length ? (
              capBoard.map((r, i) => <RankRow key={r.id} r={r} i={i} highlight={i === 0} teams={teams} />)
            ) : (
              <div className="empty-note">No captain votes yet.</div>
            )}
          </section>

          <section className="panel">
            <header>
              <h3>Most picked</h3>
              <span className="hint">share of starting XIs</span>
            </header>
            {POSITIONS.map((k) => {
              const list = ranked(t.xi, t.n, byId, k).slice(0, 7);
              const inXI = new Set((cx.rows[k] ?? []).map((r) => r.id));
              return (
                <div key={k}>
                  <div className="grouphead">
                    <span className="eyebrow">{POSLONG[k]}</span>
                    <span className="hint">{(cx.rows[k] ?? []).length} in the XI</span>
                  </div>
                  {list.length ? (
                    list.map((r, i) => (
                      <RankRow key={r.id} r={r} i={i} highlight={inXI.has(r.id)} teams={teams} />
                    ))
                  ) : (
                    <div className="empty-note">No votes yet.</div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </>
  );
}

function RankRow({
  r, i, highlight, teams,
}: {
  r: Ranked; i: number; highlight: boolean; teams: Map<number, { id: number; sh: string; name: string }>;
}) {
  return (
    <div className={`rank${highlight ? " in" : ""}`}>
      <div className="top">
        <span className="pos">{i + 1}</span>
        <span className="nm">{r.player.n}</span>
        <span className="tm"><TeamMark team={teams.get(r.player.team)} /></span>
        <span className="pc">{pctText(r.pct)}</span>
      </div>
      <div className="bar">
        <i style={{ width: `${Math.max(2, r.pct)}%` }} />
      </div>
    </div>
  );
}
