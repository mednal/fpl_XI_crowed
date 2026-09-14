"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PitchRows, type SlotView } from "./Pitch";
import { TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import HostBar from "./HostBar";
import SlotMenu, { MenuButton } from "./SlotMenu";
import { poolLock } from "@/lib/lock";
import { getBrowserClient } from "@/lib/supabase";
import { POS, POSITIONS, XI_MAX, XI_MIN, crowdXI, money, pctText, ranked, tally } from "@/lib/squad";
import type { Bootstrap, Entry, Player, Pool, PosId, Ranked, Team } from "@/lib/types";

type Row = Pick<Entry, "id" | "nick" | "xi" | "bench" | "captain" | "vice" | "updated_at">;

/** The host's own eleven. A list rather than position slots, because a
 *  substitution across positions moves the shape, the way it does in FPL. */
type HostXI = { xi: number[]; captain: number | null; vice: number | null };

/** Half a substitution: a starter (or an empty slot) waiting for who comes on,
 *  or an "also picked" name waiting for who he replaces. */
type Subbing =
  | { side: "out"; id: number; slot?: undefined }
  | { side: "out"; id: null; slot: string }
  | { side: "in"; id: number }
  | null;

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
  isHost = false,
}: {
  pool: Pool;
  boot: Bootstrap;
  initialEntries: Row[];
  /** Whether this browser opened the pool, and so gets the host's controls. */
  isHost?: boolean;
}) {
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);

  // The gameweek's own lock. A host may bring their pool forward of it, never
  // past it, so it is the ceiling on the closing time they can set.
  const gwDeadline = useMemo(
    () => boot.events.find((e) => e.id === pool.gw)?.deadline ?? boot.deadline ?? null,
    [boot.events, boot.deadline, pool.gw],
  );

  const [entries, setEntries] = useState<Row[]>(initialEntries);
  const [copied, setCopied] = useState<"" | "done" | "manual">("");
  const linkRef = useRef<HTMLElement | null>(null);
  const [link, setLink] = useState("");
  // Off until the browser says so: the server does not know the viewer's clock,
  // and a link that appeared mid-render would not match the markup sent down.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setLink(`${window.location.origin}/p/${pool.id}`);
  }, [pool.id]);

  // The host can move either of these from the bar below without a reload, so
  // they are state rather than the props they started as.
  const [deadline, setDeadline] = useState(pool.deadline);
  const [closedAt, setClosedAt] = useState(pool.closed_at);

  // Two different questions now that a host can close early: whether the pool is
  // still taking teams, and whether there is a gameweek to score. Closing the
  // pool at half seven does not make the fixtures kick off any sooner.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const check = () => {
      setLocked(poolLock({ deadline, closed_at: closedAt }).locked);
      setStarted(poolLock({ deadline: gwDeadline, closed_at: null }).locked);
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [deadline, closedAt, gwDeadline]);

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

  /**
   * The host's own take, tried on their screen only — the same idea as a
   * transfer board's trial swaps (invariant 10), applied to a crowd pool.
   * Never written anywhere and never shown to a viewer: swapping a
   * crowd-voted starter for one of the "also picked" names would otherwise
   * put a team nobody voted for on the same pitch the crowd's XI stands on,
   * which is exactly what invariant 4 rules out. So it lives entirely in
   * this component's state, clearly labelled as the host's own view, and it
   * can only ever promote a player the crowd actually picked — never invent
   * one from outside the vote.
   *
   * It works like FPL's own pick-team screen: tap a shirt for the armband or
   * a substitution, and the "also picked" list is the bench.
   */
  const [hostMode, setHostMode] = useState(false);
  const [mine, setMine] = useState<HostXI | null>(null);
  const [subbing, setSubbing] = useState<Subbing>(null);
  const [menu, setMenu] = useState<{ id: number; anchor: HTMLElement } | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const shutMenu = useCallback(() => setMenu(null), []);

  function crowdTeam(): HostXI {
    const xi = POSITIONS.flatMap((k) => (cx.rows[k] ?? []).map((r) => r.id));
    // An armband has to sit on the pitch, and the crowd's favourite captain can
    // be a player who did not make its XI — so each goes to the best-backed
    // starter. The two tallies are separate, so the vice skips the captain.
    const onPitch = new Set(xi);
    const captain = ranked(t.captain, t.n, byId).find((r) => onPitch.has(r.id))?.id ?? null;
    const vice = ranked(t.vice, t.n, byId).find((r) => onPitch.has(r.id) && r.id !== captain)?.id ?? null;
    return { xi, captain, vice };
  }
  function openHostView() { setMine(crowdTeam()); setSubbing(null); setMenu(null); setHostMode(true); }
  function resetHostView() { setMine(crowdTeam()); setSubbing(null); setMenu(null); }
  function closeHostView() { setHostMode(false); setSubbing(null); setMenu(null); }

  function substitute(out: number | null, inId: number) {
    setMine((prev) => {
      if (!prev || !fitsXI(prev.xi, out, inId, byId)) return prev;
      const samePos = out != null && byId.get(out)?.pos === byId.get(inId)?.pos;
      // Like for like keeps his place in the row; otherwise the row he joins
      // grows and the one he left shrinks, which is the shape changing.
      const xi = samePos
        ? prev.xi.map((id) => (id === out ? inId : id))
        : [...prev.xi.filter((id) => id !== out), inId];
      // The armband goes with the shirt, as FPL does it, so the pitch is never
      // left without a captain.
      const captain = out != null && prev.captain === out ? inId : prev.captain;
      const vice = out != null && prev.vice === out ? inId : prev.vice;
      return { xi, captain, vice: vice === captain ? null : vice };
    });
    setSubbing(null);
    setLanded(inId);
  }

  function setArmband(id: number, which: "captain" | "vice") {
    setMine((prev) => prev && ({
      ...prev,
      // The two cannot be the same player, so taking one hands back the other.
      captain: which === "captain" ? id : prev.captain === id ? null : prev.captain,
      vice: which === "vice" ? id : prev.vice === id ? null : prev.vice,
    }));
    setMenu(null);
  }

  useEffect(() => {
    if (landed == null) return;
    const timer = setTimeout(() => setLanded(null), CROSS_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  useEffect(() => {
    if (!subbing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSubbing(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subbing]);

  const xiPct = (id: number) => (t.n ? ((t.xi[id] ?? 0) * 100) / t.n : 0);

  let hostRows: SlotView[][] | null = null;
  if (hostMode && mine) {
    const cells: Record<PosId, SlotView[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const id of mine.xi) {
      const player = byId.get(id);
      if (!player) continue;
      const k = player.pos;
      let className: string | undefined;
      let onClick: SlotView["onClick"];
      let title = `${player.n} — tap for the armband or a substitution`;
      if (subbing?.side === "out") {
        className = subbing.id === id ? "chosen" : "dim";
        if (subbing.id === id) { onClick = () => setSubbing(null); title = "Tap again to cancel the substitution"; }
      } else if (subbing?.side === "in") {
        const ok = fitsXI(mine.xi, id, subbing.id, byId);
        className = ok ? "target" : "dim";
        title = ok ? `Take ${player.n} off` : "This swap would not leave a legal formation";
        if (ok) onClick = () => substitute(id, subbing.id);
      } else {
        className = landed === id ? "arriving" : undefined;
        onClick = (e) => setMenu({ id, anchor: e.currentTarget });
      }
      cells[k].push({
        player,
        pos: k,
        sub: pctText(xiPct(id)),
        subClass: "hostpick",
        badge: mine.captain === id ? "C" : mine.vice === id ? "V" : null,
        className,
        title,
        onClick,
      });
    }

    // Early on the crowd may not have filled every slot yet. The gaps come
    // back as empty shirts the host can fill, legal minimum first.
    let room = 11 - mine.xi.length;
    const pad = (k: PosId, upTo: number) => {
      while (room > 0 && cells[k].length < upTo) {
        const slot = `${k}:${cells[k].length}`;
        const view: SlotView = { player: null, pos: k, sub: "empty", title: "Tap to fill this slot from the list" };
        if (subbing?.side === "out") {
          view.className = subbing.slot === slot ? "chosen" : "dim";
          if (subbing.slot === slot) view.onClick = () => setSubbing(null);
        } else if (subbing?.side === "in") {
          const ok = fitsXI(mine.xi, null, subbing.id, byId);
          view.className = ok ? "target" : "dim";
          if (ok) view.onClick = () => substitute(null, subbing.id);
        } else {
          view.onClick = () => setSubbing({ side: "out", id: null, slot });
        }
        cells[k].push(view);
        room--;
      }
    };
    for (const k of POSITIONS) pad(k, XI_MIN[k]);
    for (const k of POSITIONS) pad(k, cx.shape[k]);
    hostRows = POSITIONS.map((k) => cells[k]);
  }

  // The bench, in FPL's terms: everyone the crowd picked who is not on the
  // host's pitch. A player subbed off comes back here, and one brought on
  // leaves it — always real votes, never a name from outside them.
  const hostAlso = useMemo(() => {
    if (!hostMode || !mine) return [];
    const placed = new Set(mine.xi);
    return POSITIONS.flatMap((k) => ranked(t.xi, t.n, byId, k)
      .filter((r) => !placed.has(r.id))
      .slice(0, ALSO_PER_POS)
      .map((r) => ({ r, k })))
      .sort((a, b) => b.r.pct - a.r.pct);
  }, [hostMode, mine, t, byId]);

  const crowdNow = hostMode ? crowdTeam() : null;
  const hostChanged = Boolean(mine && crowdNow && (
    [...mine.xi].sort().join() !== [...crowdNow.xi].sort().join()
    || mine.captain !== crowdNow.captain
    || mine.vice !== crowdNow.vice
  ));

  const hostPlayers = hostMode && mine
    ? mine.xi.map((id) => byId.get(id)).filter((p): p is Player => Boolean(p))
    : null;
  const hostCaptain = mine?.captain != null && mine.xi.includes(mine.captain) ? byId.get(mine.captain) : undefined;

  // A club filling half the XI is the crowd showing its hand, not a rule being
  // broken — the crowd XI is a hall of fame, so it has no club cap to break.
  let clubs: Record<number, number> = cx.clubs;
  if (hostPlayers) {
    clubs = {};
    for (const p of hostPlayers) clubs[p.team] = (clubs[p.team] ?? 0) + 1;
  }
  const stacked = Object.entries(clubs)
    .map(([team, n]) => [Number(team), n] as const)
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1]);

  const shownAlso = hostMode ? hostAlso : also;
  const menuPlayer = menu ? byId.get(menu.id) : undefined;

  const capBoard = ranked(t.captain, t.n, byId).slice(0, CAP_ROWS);
  // The vice race is the rest of the armband story, and the only one that
  // matters if the captain does not play. A crowd that agrees on a captain
  // leaves the rail with a single 100% row otherwise.
  const viceBoard = ranked(t.vice, t.n, byId)
    .filter((r) => r.id !== cx.captain?.id)
    .slice(0, 3);
  const unanimous = capBoard.length === 1 && t.n > 1;

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
    <div className={`board fixed${isHost ? " hosted" : ""}`}>
      <header className="strip titled">
        <Link className="brand" href="/" aria-label="Crowd XI">
          <span className="dot" />
        </Link>
        <span className="sep" />
        <span className="poolname">{pool.name}</span>
        <span className="chip live">Live</span>
        <span className="spacer" />
        {deadline && <span className="clock"><Countdown deadline={deadline} closed={Boolean(closedAt)} /></span>}
        <span className="sep" />
        <span className="meter">
          <span className="lab">Teams in</span>
          <b className="num">{t.n}</b>
        </span>
        {isHost && t.n > 0 && (
          hostMode ? (
            <>
              <span className="chip warn">Your view</span>
              <button
                className="btn btn-sm"
                onClick={resetHostView}
                disabled={!hostChanged}
                title={hostChanged ? "Put back the crowd's eleven and armbands as they stand now" : "Your XI is the crowd's XI"}
              >
                Reset to the crowd&apos;s XI
              </button>
              <button className="btn btn-sm btn-primary" onClick={closeHostView}>Done</button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={openHostView}>Manage the XI</button>
          )
        )}
        {started && <Link className="btn btn-sm" href={`/p/${pool.id}/scores`}>Scores</Link>}
        <Link className="btn btn-sm" href={`/p/${pool.id}`}>My team</Link>
      </header>

      {isHost && (
        <HostBar
          poolId={pool.id}
          deadline={deadline}
          closedAt={closedAt}
          fplDeadline={gwDeadline}
          onChange={(next) => { setDeadline(next.deadline); setClosedAt(next.closed_at); }}
        />
      )}

      <main className="frame">
        {hostRows && subbing && (
          <div className="subbar">
            <span>
              {subbing.side === "in" ? (
                <>Tap the player <b>{byId.get(subbing.id)?.n}</b> replaces — the shape follows.</>
              ) : subbing.id != null ? (
                <>Pick who comes on for <b>{byId.get(subbing.id)?.n}</b> from the list on the right.</>
              ) : (
                <>Pick who fills the empty slot from the list on the right.</>
              )}
            </span>
            <button className="btn btn-sm" onClick={() => setSubbing(null)}>Cancel</button>
          </div>
        )}
        {t.n ? (
          <PitchRows rows={hostRows ?? rows} teams={teams} />
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
          <dd>
            {hostPlayers
              ? [2, 3, 4].map((k) => hostPlayers.filter((p) => p.pos === k).length).join("-")
              : t.n || pool.formation ? cx.formation : "—"}
          </dd>
        </dl>
        {pool.formation && !hostPlayers && <span className="chip">Set by the host</span>}
        <span className="sep" />
        <dl>
          <dt className="lab">Armband</dt>
          <dd className="sm">
            {hostPlayers
              ? hostCaptain?.n ?? "—"
              : cx.captain ? `${cx.captain.player.n} · ${pctText(cx.captain.pct)}` : "—"}
          </dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">XI value</dt>
          <dd className="sm num">
            {money(hostPlayers ? hostPlayers.reduce((s, p) => s + p.cost, 0) : cx.cost)}
          </dd>
        </dl>
        <span className="spacer" />
        {stacked.length > 0 && (
          <span className="chip">
            {stacked.map(([id, n]) => `${n} ${teams.get(id)?.sh ?? "?"}`).join(" · ")}
          </span>
        )}
      </div>

      <aside className="churn still">
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
              {!hostMode
                ? `${also.length} outside the eleven`
                : subbing?.side === "out"
                  ? "tap who comes on"
                  : "tap a name to bring him on"}
            </span>
          </h2>
          {shownAlso.length ? (
            <div className="posgroups">
              {[...POSITIONS].reverse().map((k) => {
                const g = shownAlso.filter((x) => x.k === k);
                if (!g.length) return null;
                return (
                  <div className="pgroup" key={k}>
                    <div className="pgut">
                      <span className="lab">{POS[k]}</span>
                      <span className="cnt num">{g.length}</span>
                    </div>
                    <ul className="prows">
                      {g.map(({ r }) => {
                        const body = (
                          <>
                            <i style={{ transform: `scaleX(${Math.max(0.015, r.pct / 100)})` }} />
                            <span className="nm">{r.player.n}</span>
                            <span className="tm"><TeamMark team={teams.get(r.player.team)} /></span>
                            <span className="pc num">{pctText(r.pct)}</span>
                          </>
                        );
                        if (!hostMode || !mine) {
                          return (
                            <li className="voterow" key={r.id} title={`${r.player.n} — picked in ${r.count} of ${t.n} starting XIs`}>
                              {body}
                            </li>
                          );
                        }
                        // On the host's view this list is the bench: a name is a
                        // button, and mid-substitution only a legal partner answers.
                        let state = "";
                        let title = `Bring ${r.player.n} on — then tap who he replaces`;
                        let onClick: (() => void) | undefined = () => setSubbing({ side: "in", id: r.id });
                        if (subbing?.side === "out") {
                          const ok = fitsXI(mine.xi, subbing.id, r.id, byId);
                          state = ok ? " target" : "";
                          title = ok
                            ? `Bring ${r.player.n} on`
                            : "He would not leave a legal formation";
                          onClick = ok ? () => substitute(subbing.id, r.id) : undefined;
                        } else if (subbing?.side === "in" && subbing.id === r.id) {
                          state = " chosen";
                          title = "Tap again to cancel the substitution";
                          onClick = () => setSubbing(null);
                        }
                        return (
                          <li key={r.id}>
                            <button
                              type="button"
                              className={`voterow pick${state}`}
                              title={title}
                              disabled={!onClick}
                              onClick={onClick}
                            >
                              {body}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="empty-note">
              {hostMode
                ? "Everyone the crowd picked is already on your pitch."
                : "Everyone picked so far is already in the eleven."}
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
            {locked && (
              <p className="hint">
                Voting is closed. The link still works — it shows a viewer the teams,
                locked.
              </p>
            )}
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

      {hostMode && mine && menu && menuPlayer && !subbing && (
        <SlotMenu anchor={menu.anchor} onClose={shutMenu}>
          <div className="slotmenu-head">
            <b>{menuPlayer.n}</b>
            <div className="hint">
              {teams.get(menuPlayer.team)?.name} · in {pctText(xiPct(menuPlayer.id))} of XIs
            </div>
          </div>
          {mine.captain !== menuPlayer.id && (
            <MenuButton onClick={() => setArmband(menuPlayer.id, "captain")}>Make captain</MenuButton>
          )}
          {mine.vice !== menuPlayer.id && (
            <MenuButton onClick={() => setArmband(menuPlayer.id, "vice")}>Make vice-captain</MenuButton>
          )}
          <MenuButton onClick={() => { setSubbing({ side: "out", id: menuPlayer.id }); setMenu(null); }}>
            Substitute
          </MenuButton>
        </SlotMenu>
      )}
    </div>
  );
}

/**
 * Whether taking `out` off (or nobody, to fill a gap) and bringing `inId` on
 * still leaves an eleven that is, or can still become, a legal formation. The
 * limits are FPL's, the same ones a viewer's XI is held to.
 */
function fitsXI(xi: number[], out: number | null, inId: number, byId: Map<number, Player>): boolean {
  const c: Record<PosId, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const id of xi) {
    const k = id === out ? undefined : byId.get(id)?.pos;
    if (k) c[k]++;
  }
  const k = byId.get(inId)?.pos;
  if (!k) return false;
  c[k]++;
  let total = 0;
  let short = 0;
  for (const p of POSITIONS) {
    if (c[p] > XI_MAX[p]) return false;
    total += c[p];
    short += Math.max(0, XI_MIN[p] - c[p]);
  }
  return total + short <= 11;
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
