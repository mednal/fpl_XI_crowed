"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SquadPitch, { type Decorate } from "./SquadPitch";
import { Kit, TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import { lockNote, poolLock } from "@/lib/lock";
import { MAXCLUB, POS, POSLONG, money } from "@/lib/squad";
import {
  applyTransfers, clubCounts, fundsLeft, hostIds, movesAllowed, transferChecklist,
} from "@/lib/transfers";
import type { Bootstrap, HostSquad, Player, PosId, Pool } from "@/lib/types";

/** One player leaving, and whoever the viewer has chosen to replace them. */
type Swap = { out: number; in: number | null };

const LIST_CAP = 2000;

const SORTS: [string, string][] = [
  ["sel", "Sort: selected %"],
  ["pts", "Sort: points"],
  ["form", "Sort: form"],
  ["cost", "Sort: price high"],
  ["cheap", "Sort: price low"],
];

/** "Midfielders" is what the list is called; "a midfielder" is what you sign. */
const one = (pos: PosId | undefined) => POSLONG[pos ?? 1].toLowerCase().replace(/s$/, "");

/**
 * The viewer's side of a transfer pool. The host's team is on the pitch and it
 * is handled the way any team is picked: the corner cross takes a player out,
 * which leaves a hole where his shirt was, and the rail becomes the players who
 * could fill it. The cross on a signing reopens that hole; the cross on a hole
 * puts the original player back.
 *
 * The rules it enforces are `transfers.ts`, the same module the route checks
 * with — this copy only saves a round trip, exactly as the squad picker's does.
 */
export default function TransferPicker({
  pool,
  squad,
  boot,
}: {
  pool: Pool;
  squad: HostSquad;
  boot: Bootstrap;
}) {
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);

  const [swaps, setSwaps] = useState<Swap[]>([]);
  /** Which hole the rail is filling, when the viewer has opened more than one. */
  const [aimAt, setAimAt] = useState<number | null>(null);
  const [captain, setCaptain] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [filterTeam, setFilterTeam] = useState(0);
  const [sort, setSort] = useState("sel");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [saves, setSaves] = useState(0);
  const [nags, setNags] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const lock = poolLock(pool);
  const locked = lock.locked;
  const cap = movesAllowed(pool.moves);

  useEffect(() => {
    try {
      setNick(localStorage.getItem("cxi.nick") ?? "");
      const saved = localStorage.getItem(`cxi.moves.${pool.id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { swaps?: Swap[]; captain?: number | null };
        if (Array.isArray(parsed?.swaps)) {
          setSwaps(parsed.swaps);
          setCaptain(parsed.captain ?? null);
          setSent(true);
        }
      }
    } catch { /* a fresh browser simply starts with the host's team as it is */ }
  }, [pool.id]);

  const owned = useMemo(() => new Set(hostIds(squad)), [squad]);
  const done = swaps.filter((s) => s.in) as { out: number; in: number }[];
  const outIds = done.map((s) => s.out);
  const inIds = done.map((s) => s.in);

  /** Players taken out with nobody chosen yet — the holes in the team. */
  const holes = swaps.filter((s) => !s.in);
  const aiming = holes.find((s) => s.out === aimAt) ?? holes[0] ?? null;
  const aimPos = aiming ? byId.get(aiming.out)?.pos : undefined;

  // Money raised by everyone on the way out — the pending ones included, since
  // that is what the viewer has to spend on filling the holes they left.
  const allOut = swaps.map((s) => s.out);
  const funds = pool.budget ? fundsLeft(squad, allOut, inIds, byId) : Infinity;

  const after = applyTransfers(squad, outIds, inIds, captain);
  const clubs = clubCounts(hostIds(after), byId);

  const checks = transferChecklist(
    { out: outIds, in: inIds, captain },
    squad,
    byId,
    { moves: pool.moves, budget: pool.budget },
  );
  const todo = checks.filter((c) => !c.ok);
  // One gap is worth naming; five gaps named in full is five lines of rail
  // spent restating the ledger that is already open above the list.
  const pending = holes.length === 0
    ? []
    : holes.length === 1
      ? [{
          key: `hole-${holes[0].out}`,
          ok: false,
          label: `Choose a ${one(byId.get(holes[0].out)?.pos)} to come in for ${byId.get(holes[0].out)?.n ?? "him"}.`,
        }]
      : [{ key: "holes", ok: false, label: `${holes.length} gaps still to fill.` }];
  // Over the allowance with gaps still open, `pairs` cannot see it yet — it is
  // given the finished swaps only. Say it here so the count is never a
  // surprise that waits until the last gap is filled.
  const over = swaps.length > cap;
  const overNote = over && holes.length > 0
    ? [{
        key: "cap",
        ok: false,
        label: `That is ${swaps.length} transfers and this pool allows ${cap}. Put ${swaps.length - cap} back.`,
      }]
    : [];
  const blocking = [...overNote, ...pending, ...todo];

  /** Take a player out. His shirt leaves a hole, and the rail aims at it.
   *  Any shirt, at any time: the allowance is a thing the readiness line says
   *  out loud, not a cross that quietly disappears. Taking the eleventh player
   *  out of a one-transfer pool is a mistake worth being told about, and the
   *  squad picker treats going over budget the same way. */
  function takeOut(id: number) {
    if (locked) return;
    setSwaps((prev) => (prev.some((s) => s.out === id) ? prev : [...prev, { out: id, in: null }]));
    setAimAt(id);
    setQ("");
  }

  /** Undo one transfer, whether it was filled or still an open hole. */
  function putBack(out: number) {
    if (locked) return;
    setSwaps((prev) => prev.filter((s) => s.out !== out));
    setAimAt((cur) => (cur === out ? null : cur));
  }

  /** Drop the player chosen to come in, leaving the gap open. Changing your
   *  mind about a signing is not changing your mind about the sale: putting the
   *  original player straight back means re-selling him to look at anyone else. */
  function clearIn(out: number) {
    if (locked) return;
    setSwaps((prev) => prev.map((s) => (s.out === out ? { ...s, in: null } : s)));
    setAimAt(out);
    setQ("");
  }

  function bringIn(p: Player) {
    if (locked || !aiming || blockedReason(p)) return;
    const filling = aiming.out;
    setSwaps((prev) => prev.map((s) => (s.out === filling ? { ...s, in: p.id } : s)));
    // Let the aim fall through to whichever hole is still open, if any.
    setAimAt(null);
    setQ("");
  }

  // The ledger is capped at about three rows, so the gap being filled has to
  // come to the viewer rather than waiting to be scrolled to. Scrolled by hand
  // rather than with scrollIntoView, which counts a half-visible row as seen
  // and will scroll the rail's ancestors to get there.
  useEffect(() => {
    const band = document.querySelector<HTMLElement>(".outband");
    const row = band?.querySelector<HTMLElement>("li.aim");
    if (!band || !row) return;
    const bottom = row.offsetTop + row.offsetHeight;
    if (row.offsetTop < band.scrollTop) band.scrollTop = row.offsetTop;
    else if (bottom > band.scrollTop + band.clientHeight) {
      band.scrollTop = bottom - band.clientHeight;
    }
  }, [aiming?.out, swaps.length]);

  /** The only things that stop a signing: who they are, and what is left. */
  function blockedReason(p: Player): string | null {
    if (!aiming) return "Take a player out first";
    if (p.pos !== aimPos) return `You are replacing a ${POS[aimPos ?? 1]}`;
    if (owned.has(p.id)) return "Already in this team";
    if (inIds.includes(p.id)) return "You are already bringing them in";
    if (pool.budget && p.cost > funds) return `More than the ${money(funds)} you have to spend`;

    // The club cap holds whether or not the pool is run to the budget — the
    // same line `squadChecklist` draws, so the two pickers agree about it.
    // Counted against the team as it would stand: everyone on the way out,
    // the open holes included, has already left it.
    const gone = new Set(allOut);
    const trial = clubCounts([...hostIds(after).filter((id) => !gone.has(id)), p.id], byId);
    if ((trial[p.team] ?? 0) > MAXCLUB) {
      return `That would be ${MAXCLUB + 1} from ${teams.get(p.team)?.name ?? "one club"}`;
    }
    return null;
  }

  const { rows, total } = useMemo(() => {
    const sorters: Record<string, (a: Player, b: Player) => number> = {
      sel: (a, b) => b.sel - a.sel,
      pts: (a, b) => b.pts - a.pts,
      form: (a, b) => b.form - a.form,
      cost: (a, b) => b.cost - a.cost,
      cheap: (a, b) => a.cost - b.cost,
    };
    const needle = q.trim().toLowerCase();
    const hits = boot.players
      .filter((p) => (!aimPos || p.pos === aimPos)
        && (!filterTeam || p.team === filterTeam)
        && (!needle || p.n.toLowerCase().includes(needle)))
      .sort(sorters[sort] ?? sorters.sel);
    return { rows: hits.slice(0, LIST_CAP), total: hits.length };
  }, [boot.players, aimPos, filterTeam, q, sort]);

  /** What one shirt on the pitch is doing, which is the whole interface. */
  const decorate: Decorate = (id, starter) => {
    const player = byId.get(id);
    if (locked) {
      return { title: player ? `${player.n} — ${money(player.cost)}` : undefined };
    }
    const swap = swaps.find((s) => s.out === id || s.in === id);

    // A player taken out with nobody chosen yet is a gap in the team: the shirt
    // goes and his name stays under it, the way an unfilled slot reads in the
    // squad picker. Tapping the gap aims the rail at it.
    if (swap && !swap.in) {
      const active = aiming?.out === swap.out;
      return {
        player: null,
        badge: null,
        className: `gap${active ? " aim" : ""}`,
        sub: player?.n ?? "out",
        subClass: "went",
        title: active
          ? `Choose a ${one(player?.pos)} to come in for ${player?.n ?? "him"}`
          : `Fill the gap ${player?.n ?? "he"} left`,
        onClick: () => setAimAt(swap.out),
        onRemove: () => putBack(swap.out),
      };
    }

    if (swap?.in === id) {
      const went = byId.get(swap.out);
      return {
        className: "arriving",
        sub: `for ${went?.n ?? "—"}`,
        subClass: "pct",
        title: `${player?.n ?? "He"} comes in for ${went?.n ?? "him"}. Remove to choose a different ${one(went?.pos)}.`,
        onRemove: () => clearIn(swap.out),
      };
    }

    // Everyone still in the team keeps his cross, whether or not the allowance
    // is spent. A cross that vanishes reads as a broken screen, not as a rule:
    // the header counts the transfers and the readiness line says when there
    // are too many, which is where a rule belongs.
    //
    // Selling is the cross and only the cross. The shirt itself is not a target:
    // tapping a player to read his price should not put him on the market.
    return {
      title: `${player?.n ?? "This player"}${starter ? "" : " (bench)"} — ${money(player?.cost ?? 0)}. The × takes him out.`,
      onRemove: () => takeOut(id),
    };
  };

  async function submit() {
    if (blocking.length) { setNags((n) => n + 1); return; }
    setBusy(true);
    setError(null);
    try {
      const body = {
        nick: nick.trim() || "Anonymous",
        out: outIds,
        in: inIds,
        captain,
      };
      const res = await fetch(`/api/pools/${pool.id}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send your transfers.");
      try {
        localStorage.setItem("cxi.nick", body.nick);
        localStorage.setItem(`cxi.moves.${pool.id}`, JSON.stringify({ swaps, captain }));
      } catch { /* storage off — the vote is on the server either way */ }
      setSent(true);
      setSaves((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your transfers.");
    } finally {
      setBusy(false);
    }
  }

  const soldCaptain = allOut.includes(squad.captain);
  const captainName = byId.get(squad.captain)?.n ?? "the captain";

  return (
    <div className="board app pick">
      <header className="strip">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="sep" />
        <span className="chip name">{pool.name}</span>
        <span className="spacer" />
        {pool.budget && (
          <span className={`meter${funds < 0 ? " over" : ""}`}>
            <span className="lab">To spend</span>
            <b className="num">{money(funds)}</b>
          </span>
        )}
        <span className="sep" />
        <span className={`meter${over ? " over" : ""}`}>
          <span className="lab">Transfers</span>
          <b className="num">{swaps.length}/{cap}</b>
        </span>
        <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Results</Link>
      </header>

      <main className="frame">
        {locked && <p className="locked-note">{lockNote(lock.why)}</p>}
        {!locked && sent && (
          <div className="banner saved" key={saves} aria-live="polite">
            {saves > 1 ? "Your vote is updated." : "Your vote is in."} Change it any time
            before the deadline.
            <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>See the crowd&apos;s transfers</Link>
          </div>
        )}
        {!locked && aiming && (
          <div className="subbar">
            <span>
              <b>{byId.get(aiming.out)?.n}</b> is out. Pick the {one(aimPos)} who replaces him
              {pool.budget && <> — you have <b>{money(funds)}</b> to spend</>}
              {holes.length > 1 && <> ({holes.length} gaps to fill)</>}.
            </span>
            <button className="btn btn-sm" onClick={() => putBack(aiming.out)}>
              Put {byId.get(aiming.out)?.n ?? "him"} back
            </button>
          </div>
        )}

        <SquadPitch
          squad={after}
          byId={byId}
          teams={teams}
          decorate={decorate}
          benchLabel={`${pool.host ? `${pool.host}'s` : "The host's"} bench`}
        />
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">The team</dt>
          <dd className="sm">
            {squad.entryName ?? pool.host ?? "the host"}
          </dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Captain</dt>
          <dd className="sm">{byId.get(after.captain)?.n ?? "—"}</dd>
        </dl>
        <span className="spacer" />
        {pool.budget && (
          <span className={`chip${funds < 0 ? " warn" : ""}`}>Bank {money(funds)}</span>
        )}
        {Object.values(clubs).some((n) => n > MAXCLUB) && (
          <span className="chip warn">Over {MAXCLUB} from a club</span>
        )}
        {pool.deadline && <Countdown deadline={pool.deadline} closed={Boolean(pool.closed_at)} />}
      </div>

      <aside className={`churn${sort === "pts" || sort === "form" ? " ptsort" : ""}`}>
        <section className="mod grow">
          <h2 className="vh">
            {aiming ? `Choose a ${POS[aimPos ?? 1]}` : "Players"}
          </h2>

          {!locked && swaps.length > 0 && (
            <div className="outband">
              <ul className="swaplist">
                {swaps.map((s) => {
                  const went = byId.get(s.out);
                  return (
                    <li key={s.out} className={aiming?.out === s.out ? "aim" : undefined}>
                      <span className="off">{went?.n}</span>
                      <span className="arrow" aria-label="becomes">→</span>
                      {s.in ? (
                        <span className="on">{byId.get(s.in)?.n}</span>
                      ) : (
                        <button className="on open" onClick={() => setAimAt(s.out)}>
                          Choose a {one(went?.pos)}
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-ghost"
                        aria-label={`Put ${went?.n ?? "him"} back`}
                        onClick={() => putBack(s.out)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="searchhead">
            <input
              type="search" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search player"
              placeholder={aiming ? `Search ${POSLONG[aimPos ?? 1].toLowerCase()}` : "Take a player out to start"}
              disabled={locked}
            />
          </div>

          <div className="minirow">
            <select
              value={filterTeam} aria-label="Club"
              onChange={(e) => setFilterTeam(Number(e.target.value))}
            >
              <option value={0}>All clubs</option>
              {boot.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
            <select value={sort} aria-label="Sort" onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>

          <div className="plist">
            {!aiming && !locked && (
              <p className="empty-note">
                Hit the × on a player in the team above to transfer him out. He leaves a gap,
                and this list becomes the players who could fill it.
              </p>
            )}
            {rows.map((p) => {
              const reason = blockedReason(p);
              return (
                <button
                  className="prow" key={p.id} disabled={locked || !!reason}
                  title={reason ?? undefined} onClick={() => bringIn(p)}
                >
                  <Kit team={teams.get(p.team)} className="kit kitmini" mark={false} />
                  <span className="who">
                    <span className="n" title={reason ? undefined : p.n}>{p.n}</span>
                    <span className="m">
                      <TeamMark team={teams.get(p.team)} />
                      {!aimPos && ` ${POS[p.pos]}`}
                    </span>
                    {p.st !== "a" && <span className="doubt">Doubt</span>}
                  </span>
                  <span className="price num">{money(p.cost)}</span>
                  <span className="pts num">{p.pts}</span>
                </button>
              );
            })}
            {total > rows.length && (
              <p className="empty-note">
                Showing the top {rows.length} of {total}. Search or filter to reach the rest.
              </p>
            )}
          </div>
        </section>

        <section className="mod send">
          <h2 className="vh">{sent ? "Update your vote" : "Send your vote"}</h2>
          <div className="modbody">
            {locked ? (
              <p className="err">Voting is closed for this gameweek.</p>
            ) : (
              <>
                <div className="field inline">
                  <label htmlFor="armband">Captain</label>
                  <select
                    id="armband"
                    value={captain ?? ""}
                    onChange={(e) => setCaptain(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">
                      {soldCaptain ? "Pick a new captain" : `Keep ${captainName}`}
                    </option>
                    {(after.xi ?? []).map((id) => {
                      const p = byId.get(id);
                      return p ? <option key={id} value={id}>{p.n}</option> : null;
                    })}
                  </select>
                  {/* The default option already reads "Keep Haaland", so the only
                      thing left to say is what moving it does. */}
                  <p className="hint">
                    {soldCaptain
                      ? "Your transfer sells the captain, so the armband has to go somewhere."
                      : "Move it and your armband vote counts too."}
                  </p>
                </div>

                <input
                  id="nick" type="text" value={nick}
                  aria-label="Your name"
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="Your name, if you want it on screen"
                />

                <p className={`todo-note${nags ? " nudge" : ""}`} id="ready-list" key={nags} aria-live="polite">
                  {blocking.map((c) => (
                    <span key={c.key} className={`tk${c.key === "funds" || c.key === "clubs" ? " bad" : ""}`}>
                      <span aria-hidden="true">{c.label}</span>
                      <span className="said">{c.label}</span>
                    </span>
                  ))}
                </p>
              </>
            )}
            {error && <p className="err">{error}</p>}
            <button
              className="btn btn-primary btn-lg" onClick={submit}
              disabled={locked || busy} aria-disabled={blocking.length > 0}
              aria-describedby={locked ? undefined : "ready-list"}
              title={blocking.length ? blocking.map((c) => c.label).join(" ") : undefined}
            >
              {busy
                ? "Sending…"
                : blocking.length
                  ? blocking.length === 1
                    ? "One thing left before you can send"
                    : `${blocking.length} things left before you can send`
                  : done.length === 0
                    ? sent ? "Update: make no transfer" : "Vote to make no transfer"
                    : sent ? "Update my vote" : "Send my transfers"}
            </button>
            {swaps.length === 0 && !locked && (
              <p className="hint">
                Happy with the team as it is? Send it with no transfer — that counts as a vote too.
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
