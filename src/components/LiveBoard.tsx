"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PitchRows, type SlotView } from "./Pitch";
import { TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import { getBrowserClient } from "@/lib/supabase";
import { POS, POSITIONS, crowdXI, money, pctText, ranked, tally } from "@/lib/squad";
import type { Bootstrap, Entry, Pool, Ranked, Team } from "@/lib/types";

type Row = Pick<Entry, "id" | "nick" | "xi" | "bench" | "captain" | "vice" | "updated_at">;

/** How long a crossing stays lit on the pitch and in the rail. */
const CROSS_MS = 1400;

/**
 * Realtime tells every open board about every team that lands, and a board
 * answers by refetching the whole pool. On a stream with a real audience that
 * is the entire entry list sent to everybody once per submission — the cost
 * grows with viewers times teams, and it is invisible until the night it is
 * not. So a burst of arrivals is collapsed into one fetch rather than one
 * each. Long enough to swallow a rush at the deadline, short enough that the
 * board still reads as live.
 */
const COALESCE_MS = 1500;

/** The websocket backstop, and the longest the board can sit on stale teams. */
const POLL_MS = 15000;

/** How many outside-the-XI names per position reach the rail. Past the fifth at
 *  a position the support is a viewer or two each — noise rather than a vote.
 *  The list scrolls, so this is a judgement about what is worth showing, not
 *  about what fits. */
const ALSO_PER_POS = 5;

/** How many captain candidates the armband rail shows, and how many of those get
 *  the full rank row. Two names told the host who was winning but hid the field
 *  behind them; five is the contest they would actually talk over. Past the
 *  challenger the rest is a field rather than a race, so it takes the rail's
 *  compact list voice — otherwise the extra names come out of the "Also picked"
 *  list, which is the one module here that has to stay reachable. */
const CAP_ROWS = 5;
const CAP_LEAD = 2;

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
  const [copied, setCopied] = useState<"" | "done" | "manual">("");
  const linkRef = useRef<HTMLElement | null>(null);
  const [link, setLink] = useState("");
  // Off until the browser says so: the server does not know the viewer's clock,
  // and a link that appeared mid-render would not match the markup sent down.
  const [locked, setLocked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = Date.now();

    const run = async () => {
      timer = null;
      if (stopped) return;
      // A fetch already on the wire will return the newer team anyway, so a
      // second one alongside it would ask the same question twice.
      if (inFlight) { queued = true; return; }
      inFlight = true;
      try {
        const res = await fetch(`/api/pools/${pool.id}/entries`);
        if (res.ok && !stopped) {
          const data = await res.json();
          setEntries(data.entries ?? []);
        }
      } catch {
        /* a dropped refresh is harmless; the backstop below catches up */
      } finally {
        inFlight = false;
        lastAt = Date.now();
        if (queued && !stopped) { queued = false; schedule(); }
      }
    };

    const schedule = () => {
      if (stopped || timer) return;
      timer = setTimeout(run, COALESCE_MS);
    };

    const supabase = getBrowserClient();
    const channel = supabase
      ?.channel(`pool-${pool.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `pool_id=eq.${pool.id}` },
        schedule,
      )
      .subscribe();

    // The backstop for viewers behind proxies that block websockets. It asks
    // only when realtime has gone quiet, so a board that is receiving events
    // never spends a request on it.
    const poll = setInterval(() => {
      if (Date.now() - lastAt >= POLL_MS) schedule();
    }, POLL_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      if (channel) void channel.unsubscribe();
    };
  }, [pool.id]);

  const t = useMemo(() => tally(entries as never), [entries]);
  const cx = useMemo(() => crowdXI(t, byId, pool.formation), [t, byId, pool.formation]);

  // A club filling half the XI is the crowd showing its hand, not a rule being
  // broken — the crowd XI is a hall of fame, so it has no club cap to break.
  const stacked = useMemo(
    () => Object.entries(cx.clubs)
      .map(([team, n]) => [Number(team), n] as const)
      .filter(([, n]) => n >= 4)
      .sort((a, b) => b[1] - a[1]),
    [cx.clubs],
  );

  /**
   * The whole point of the board: a player crossing into the XI is the moment
   * worth watching. Diffing the previous XI against the current one is what
   * drives both halves of that — the shirt arriving on the pitch, and the rail
   * row it left behind.
   */
  const xiNow = useMemo(
    () => POSITIONS.flatMap((k) => (cx.rows[k] ?? []).map((r) => r.id)).join(","),
    [cx],
  );
  const prevXI = useRef<Set<number> | null>(null);
  const [crossed, setCrossed] = useState<Set<number>>(new Set());
  useEffect(() => {
    const now = new Set(xiNow ? xiNow.split(",").map(Number) : []);
    const before = prevXI.current;
    prevXI.current = now;
    // The first render is the state of the world, not a change to it.
    if (!before) return;
    const fresh = [...now].filter((id) => !before.has(id));
    if (!fresh.length) return;
    setCrossed(new Set(fresh));
    const timer = setTimeout(() => setCrossed(new Set()), CROSS_MS);
    return () => clearTimeout(timer);
  }, [xiNow]);

  const rows: SlotView[][] = POSITIONS.map((k) => {
    const picks: SlotView[] = (cx.rows[k] ?? []).map((r) => ({
      player: r.player,
      pos: k,
      sub: pctText(r.pct),
      subClass: "pct",
      badge: cx.captain?.id === r.id ? ("C" as const) : cx.vice?.id === r.id ? ("V" as const) : null,
      className: crossed.has(r.id) ? "arriving" : undefined,
      title: `${r.player.n} — picked in ${r.count} of ${t.n} starting XIs`,
    }));
    // A shape the host fixed keeps its slots even before the votes fill them, so
    // the board on stream is the same eleven positions all evening.
    while (picks.length < Math.max(cx.shape[k], 1)) {
      picks.push({ player: null, pos: k, sub: "—" });
    }
    return picks;
  });

  /**
   * Everyone the crowd picked who did not make the pitch, best-supported first.
   * Position-tagged rather than grouped, because sorting the whole lot by
   * support puts the names a host would actually mention at the top, and the
   * pitch alongside is what each percentage is being compared against.
   */
  const also = useMemo(() => POSITIONS.flatMap((k) => {
    const all = ranked(t.xi, t.n, byId, k);
    const inCount = (cx.rows[k] ?? []).length;
    return all.slice(inCount, inCount + ALSO_PER_POS).map((r) => ({ r, k }));
  }).sort((a, b) => b.r.pct - a.r.pct), [t, cx, byId]);

  const capBoard = ranked(t.captain, t.n, byId).slice(0, CAP_ROWS);
  // The vice race is the rest of the armband story, and the only one that
  // matters if the captain does not play. A crowd that agrees on a captain
  // leaves the rail with a single 100% row otherwise.
  const viceBoard = ranked(t.vice, t.n, byId)
    .filter((r) => r.id !== cx.captain?.id)
    .slice(0, 3);
  const unanimous = capBoard.length === 1 && t.n > 1;

  const recent = useMemo(
    () => [...entries]
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, 6),
    [entries],
  );

  /**
   * `navigator.clipboard` only exists on a secure origin, and a host running the
   * board from another machine on the LAN is on plain http — so the old
   * one-liner failed silently there. Fall back to the legacy copy, and if even
   * that is refused, select the link so the host can hit Ctrl+C.
   */
  async function copy() {
    const text = link || `${window.location.origin}/p/${pool.id}`;
    const flash = (state: "done" | "manual") => {
      setCopied(state);
      setTimeout(() => setCopied(""), state === "done" ? 2000 : 6000);
    };

    // The promise can also sit pending forever — an unfocused window, or a
    // permission prompt nobody answers — so it races a timer rather than
    // leaving the button doing nothing at all.
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      const wrote = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1200)),
      ]);
      if (wrote) { flash("done"); return; }
    }

    if (execCopy(text)) { flash("done"); return; }

    selectNode(linkRef.current);
    flash("manual");
  }

  return (
    <div className="board fixed">
      <header className="strip">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="sep" />
        <span className="chip live">Live</span>
        <span className="chip name">{pool.name}</span>
        <span className="spacer" />
        {pool.deadline && <Countdown deadline={pool.deadline} />}
        <span className="sep" />
        <span className="meter">
          <span className="lab">Teams in</span>
          <b className="num">{t.n}</b>
        </span>
        {locked && <Link className="btn btn-sm" href={`/p/${pool.id}/scores`}>Scores</Link>}
        <Link className="btn btn-sm" href={`/p/${pool.id}`}>My team</Link>
      </header>

      <main className="frame">
        {t.n ? (
          <PitchRows rows={rows} teams={teams} />
        ) : (
          <div className="pitch">
            <p className="empty-note" style={{ color: "var(--frame-text-2)", maxWidth: "34ch", margin: "0 auto" }}>
              Nobody has picked yet. Share the link and the shirts fill in as teams arrive.
            </p>
          </div>
        )}
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">Shape</dt>
          <dd>{t.n || pool.formation ? cx.formation : "—"}</dd>
        </dl>
        {pool.formation && <span className="chip">Set by the host</span>}
        <span className="sep" />
        <dl>
          <dt className="lab">Armband</dt>
          <dd className="sm">
            {cx.captain ? `${cx.captain.player.n} · ${pctText(cx.captain.pct)}` : "—"}
          </dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">XI value</dt>
          <dd className="sm num">{money(cx.cost)}</dd>
        </dl>
        <span className="spacer" />
        {stacked.length > 0 && (
          <span className="chip">
            {stacked.map(([id, n]) => `${n} ${teams.get(id)?.sh ?? "?"}`).join(" · ")}
          </span>
        )}
      </div>

      <aside className="churn still">
        <section className="mod arrivemod">
          <h2>Arriving now</h2>
          <div className="countline">
            <span className="big">{t.n}</span>
            <span className="who">
              {recent.length ? `latest ${recent[0].nick || "Anonymous"}` : "no teams in yet"}
            </span>
          </div>
        </section>

        <section className="mod armbandmod">
          <h2>
            Armband vote
            <span className="spacer" />
            <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
              {unanimous ? "unanimous" : `${t.n} in`}
            </span>
          </h2>
          {capBoard.length ? (
            <>
              {capBoard.map((r, i) => (
                <RankRow
                  key={r.id}
                  r={r}
                  teams={teams}
                  rank={i + 1}
                  slim={i >= CAP_LEAD}
                  highlight={cx.captain?.id === r.id}
                  crossing={crossed.has(r.id)}
                />
              ))}
              {viceBoard.length > 0 && (
                <>
                  <div className="grouphead">
                    <span className="lab">Vice</span>
                    <span className="hint">scores if the captain sits out</span>
                  </div>
                  {viceBoard.slice(0, 1).map((r) => (
                    <RankRow
                      key={r.id}
                      r={r}
                      teams={teams}
                      label="V"
                      highlight={cx.vice?.id === r.id}
                    />
                  ))}
                </>
              )}
            </>
          ) : (
            <p className="empty-note">No captain votes yet.</p>
          )}
        </section>

        <section className="mod alsomod">
          <h2>
            Also picked
            <span className="spacer" />
            <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
              {`${also.length} outside the eleven`}
            </span>
          </h2>
          {also.length ? (
            <ul className="votelist">
              {[...POSITIONS].reverse().flatMap((k) => {
                const g = also.filter((x) => x.k === k);
                if (!g.length) return [];
                return [
                  <li className="votehead" key={`h${k}`}>
                    <span className="lab">{POS[k]}</span>
                    <span className="cnt num">{g.length}</span>
                  </li>,
                  ...g.map(({ r }) => (
                    <li className="voterow" key={r.id} title={`${r.player.n} — picked in ${r.count} of ${t.n} starting XIs`}>
                      <i style={{ transform: `scaleX(${Math.max(0.015, r.pct / 100)})` }} />
                      <span className="nm">{r.player.n}</span>
                      <span className="tm"><TeamMark team={teams.get(r.player.team)} /></span>
                      <span className="pc num">{pctText(r.pct)}</span>
                    </li>
                  )),
                ];
              })}
            </ul>
          ) : (
            <p className="empty-note">
              Everyone picked so far is already in the eleven.
            </p>
          )}
        </section>

        <section className="mod sharemod" style={{ borderBottom: 0 }}>
          <h2>Share with your viewers</h2>
          <div className="modbody">
            <div className="shrow">
              <span className="poolcode">{pool.id}</span>
              <div className="sharebox">
                <code ref={linkRef} onClick={() => selectNode(linkRef.current)}>
                  {link || `/p/${pool.id}`}
                </code>
                <button className="btn btn-sm btn-primary" onClick={copy}>
                  {copied === "done" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            {/* The standing explainer is gone from the rail, but the copy
                failure still has to reach the host — it is the one thing here
                they must act on. */}
            {copied === "manual" && (
              <p className="hint">
                Your browser blocked the copy — the link is selected, press Ctrl+C
                (⌘C on a Mac).
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

/** `slim` keeps the row to one line and moves its support bar onto the row's
 *  bottom edge, where it costs no height and still reads as a bar — the same
 *  trade the vote list underneath already makes. */
function RankRow({
  r, rank, highlight, crossing, teams, label, right, slim,
}: {
  r: Ranked;
  rank?: number;
  highlight?: boolean;
  crossing?: boolean;
  teams: Map<number, Team>;
  label?: string;
  right?: string;
  slim?: boolean;
}) {
  const bar = <i style={{ transform: `scaleX(${Math.max(0.02, r.pct / 100)})` }} />;
  return (
    <div className={`rank${slim ? " slim" : ""}${highlight ? " in" : ""}${crossing ? " crossing" : ""}`}>
      <div className="top">
        <span className="pos">{rank ?? label ?? ""}</span>
        <span className="nm">{r.player.n}</span>
        <span className="tm"><TeamMark team={teams.get(r.player.team)} /></span>
        <span className="pc num">{pctText(r.pct)}</span>
      </div>
      {slim ? (
        <div className="bar edge">{bar}</div>
      ) : (
        <div className="barline">
          <div className="bar">{bar}</div>
          {right && <span className="gap">{right}</span>}
        </div>
      )}
    </div>
  );
}

/** How long ago a team landed, in the shortest form that still reads. */
function ago(iso?: string): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** The pre-clipboard-API copy. Deprecated, but it works on a plain-http origin. */
function execCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Last resort: highlight the link so the host only has to press Ctrl+C. */
function selectNode(el: HTMLElement | null) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
