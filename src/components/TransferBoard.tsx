"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SquadPitch from "./SquadPitch";
import { TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import HostBar, { ViewerPreview } from "./HostBar";
import { poolLock } from "@/lib/lock";
import { getBrowserClient } from "@/lib/supabase";
import { MAXCLUB, money, pctText } from "@/lib/squad";
import {
  DEFAULT_MOVES, applyTransfers, clubCounts, crowdCaptain, crowdTransfers,
  fundsLeft, hostIds, movesAllowed, squadValue,
} from "@/lib/transfers";
import type { SwapRank } from "@/lib/transfers";
import type { Bootstrap, HostSquad, Pool, Ranked, Team, TransferRow } from "@/lib/types";

type Row = Pick<TransferRow, "id" | "nick" | "out_ids" | "in_ids" | "captain" | "updated_at">;

/** The same coalescing the XI board does, for the same reason: one fetch per
 *  burst of arrivals rather than one per vote, times every screen watching. */
const COALESCE_MS = 1500;
const POLL_MS = 15000;
const CROSS_MS = 1400;

/** How deep each rail list goes before it stops being a vote and starts being
 *  noise — the same judgement `ALSO_PER_POS` makes on the XI board. */
const LIST_ROWS = 6;

/** How far down the crowd's proposals the host can reach. Past this they are
 *  single votes, and a switch for one is a switch nobody asked for. */
const TRY_ROWS = 8;

export default function TransferBoard({
  pool,
  squad,
  boot,
  initialTransfers,
  isHost = false,
}: {
  pool: Pool;
  squad: HostSquad;
  boot: Bootstrap;
  initialTransfers: Row[];
  isHost?: boolean;
}) {
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);

  const gwDeadline = useMemo(
    () => boot.events.find((e) => e.id === pool.gw)?.deadline ?? boot.deadline ?? null,
    [boot.events, boot.deadline, pool.gw],
  );

  const [rows, setRows] = useState<Row[]>(initialTransfers);
  const [deadline, setDeadline] = useState(pool.deadline);
  const [closedAt, setClosedAt] = useState(pool.closed_at);
  // The host may change the allowance while the board is up, so the crowd
  // maths reads it from here rather than from the row this page was drawn with.
  const [moves, setMoves] = useState(pool.moves ?? DEFAULT_MOVES);
  const [locked, setLocked] = useState(false);
  // Which of the crowd's transfers the host is trying on the pitch. The team on
  // the board is the host's own — the crowd voting for a transfer does not make
  // it, and a board that quietly made it would be showing a team the host never
  // picked. Trying one is this browser's state and nothing else: nothing is
  // written to the pool, and no viewer's screen moves.
  const [tried, setTried] = useState<string[]>([]);
  const [deckOpen, setDeckOpen] = useState(false);
  // The host checking what the crowd's screen looks like. Nothing about the pool
  // changes — this browser is still the host and the server still knows it — so
  // it is state and not a round trip.
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState<"" | "done" | "manual">("");
  const [link, setLink] = useState("");
  const linkRef = useRef<HTMLElement | null>(null);

  useEffect(() => { setLink(`${window.location.origin}/p/${pool.id}`); }, [pool.id]);

  useEffect(() => {
    const check = () => setLocked(poolLock({ deadline, closed_at: closedAt }).locked);
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [deadline, closedAt]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = Date.now();

    const run = async () => {
      timer = null;
      if (stopped) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      try {
        const res = await fetch(`/api/pools/${pool.id}/transfers`);
        if (res.ok && !stopped) {
          const data = await res.json();
          setRows(data.transfers ?? []);
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
      ?.channel(`transfers-${pool.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transfers", filter: `pool_id=eq.${pool.id}` },
        schedule,
      )
      .subscribe();

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

  const cx = useMemo(
    () => crowdTransfers(rows, squad, byId, moves),
    [rows, squad, byId, moves],
  );
  const cap = movesAllowed(moves);

  // A transfer the crowd has stopped proposing cannot stay on the pitch: the
  // votes behind it went somewhere else while the board was up.
  const proposed = useMemo(() => new Set(cx.swaps.map((s) => s.key)), [cx.swaps]);
  useEffect(() => {
    setTried((prev) => (prev.every((k) => proposed.has(k)) ? prev : prev.filter((k) => proposed.has(k))));
  }, [proposed]);

  /** The transfers being tried, in the order the host turned them on. Two that
   *  need the same player cannot both be on — nobody is sold or signed twice,
   *  which is `crowdTransfers`' own rule, applied to a hand-picked set. */
  const trial = useMemo(() => {
    // A viewer's board never shows a trial, so the preview must not either.
    if (preview) return [];
    const byKey = new Map(cx.swaps.map((s) => [s.key, s]));
    const picked: SwapRank[] = [];
    const used = new Set<number>();
    for (const key of tried) {
      const s = byKey.get(key);
      if (!s || used.has(s.out.id) || used.has(s.in.id)) continue;
      used.add(s.out.id);
      used.add(s.in.id);
      picked.push(s);
    }
    return picked;
  }, [tried, cx.swaps, preview]);

  const outIds = useMemo(() => trial.map((s) => s.out.id), [trial]);
  const inIds = useMemo(() => trial.map((s) => s.in.id), [trial]);

  // What is actually on the pitch: the host's fifteen, plus whatever they are
  // trying. Every number in the foot is read off this and not off the crowd's
  // result, so the shirts and the figures under them are the same team.
  const shown = useMemo(
    () => (trial.length
      ? applyTransfers(squad, outIds, inIds, crowdCaptain(squad, outIds, cx.captain))
      : squad),
    [squad, trial.length, outIds, inIds, cx.captain],
  );
  const bank = trial.length ? fundsLeft(squad, outIds, inIds, byId) : squad.bank ?? 0;
  const value = squadValue(shown, byId);
  const stacked = useMemo(
    () => Object.entries(clubCounts(hostIds(shown), byId))
      .map(([team, n]) => [Number(team), n] as [number, number])
      .filter(([, n]) => n > MAXCLUB)
      .sort((a, b) => b[1] - a[1]),
    [shown, byId],
  );

  // A signing crossing into the team is the moment worth watching, exactly as a
  // shirt arriving on the XI board is — and now it happens when the host tries
  // one, which is the only thing that moves a shirt on this board.
  const inNow = inIds.join(",");
  const prevIn = useRef<Set<number> | null>(null);
  const [crossed, setCrossed] = useState<Set<number>>(new Set());
  useEffect(() => {
    const now = new Set(inNow ? inNow.split(",").map(Number) : []);
    const before = prevIn.current;
    prevIn.current = now;
    if (!before) return;
    const fresh = [...now].filter((id) => !before.has(id));
    if (!fresh.length) return;
    setCrossed(new Set(fresh));
    const t = setTimeout(() => setCrossed(new Set()), CROSS_MS);
    return () => clearTimeout(t);
  }, [inNow]);

  const incoming = new Map(trial.map((s) => [s.in.id, s]));

  /** A transfer that needs a player one already being tried has taken. */
  const taken = new Set(trial.flatMap((s) => [s.out.id, s.in.id]));
  const clashes = (s: SwapRank) =>
    !tried.includes(s.key) && (taken.has(s.out.id) || taken.has(s.in.id));

  function toggleTry(key: string) {
    setTried((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const decorate = (id: number) => {
    const swap = incoming.get(id);
    if (!swap) return {};
    return {
      className: crossed.has(id) ? "arriving" : "chosen",
      sub: `for ${swap.out.n} · ${pctText(swap.pct)}`,
      subClass: "pct",
      title: `${swap.count} of ${cx.n} viewers want ${swap.out.n} replaced by ${swap.in.n}`,
    };
  };

  async function copy() {
    const text = link || `${window.location.origin}/p/${pool.id}`;
    const flash = (state: "done" | "manual") => {
      setCopied(state);
      setTimeout(() => setCopied(""), state === "done" ? 2000 : 6000);
    };
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

  const captainNow = byId.get(shown.captain);
  const capVote = cx.captain[0];

  // What this browser may do, and what it is currently being shown. The first is
  // the pool's answer; the second is the host's own choice of screen.
  const hostView = isHost && !preview;

  return (
    <div className={`board fixed${hostView ? " hosted" : ""}`}>
      <header className="strip">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="sep" />
        <span className="chip live">Live</span>
        <span className="chip name">{pool.name}</span>
        <span className="spacer" />
        {deadline && <Countdown deadline={deadline} closed={Boolean(closedAt)} />}
        <span className="sep" />
        <span className="meter">
          <span className="lab">Votes in</span>
          <b className="num">{cx.n}</b>
        </span>
        <Link className="btn btn-sm" href={`/p/${pool.id}`}>Vote</Link>
      </header>

      {hostView && (
        <HostBar
          poolId={pool.id}
          deadline={deadline}
          closedAt={closedAt}
          fplDeadline={gwDeadline}
          moves={moves}
          onChange={(next) => {
            setDeadline(next.deadline);
            setClosedAt(next.closed_at);
            if (next.moves != null) setMoves(next.moves);
          }}
          onPreview={() => setPreview(true)}
        />
      )}

      {isHost && preview && <ViewerPreview onExit={() => setPreview(false)} />}

      <main className="frame">
        {cx.swaps.length === 0 && (
          <p className="locked-note">
            {cx.n === 0
              ? "No votes yet. Share the link and the transfers appear here as they arrive."
              : cx.hold === cx.n
                ? `All ${cx.n} so far would keep the team exactly as it is.`
                : "No transfer has a vote behind it yet."}
          </p>
        )}
        {hostView && cx.swaps.length > 0 && (
          <TryDeck
            swaps={cx.swaps}
            tried={tried}
            trial={trial}
            cap={cap}
            open={deckOpen}
            clashes={clashes}
            onOpen={() => setDeckOpen((o) => !o)}
            onToggle={toggleTry}
            onVerdict={() => setTried(cx.applied.map((s) => s.key))}
            onClear={() => setTried([])}
          />
        )}
        <SquadPitch
          squad={shown}
          byId={byId}
          teams={teams}
          decorate={decorate}
          benchLabel={squad.entryName ? `${squad.entryName} · bench` : "Bench"}
        />
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">The verdict</dt>
          <dd className="sm">
            {cx.applied.length
              ? cx.applied.map((s) => `${s.out.n} → ${s.in.n}`).join(" · ")
              : cx.n ? "Keep the team" : "—"}
          </dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Armband</dt>
          <dd className="sm">
            {captainNow
              ? capVote && capVote.id === captainNow.id
                ? `${captainNow.n} · ${pctText(capVote.pct)}`
                : `${captainNow.n} · the host's`
              : "—"}
          </dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Squad</dt>
          <dd className="sm num">{money(value)}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Bank</dt>
          <dd className={`sm num${bank < 0 ? " over" : ""}`}>{money(bank)}</dd>
        </dl>
        <span className="spacer" />
        {/* Which team the shirts are: the host's, or the host's with something
            tried on it. A board on camera never leaves that to be guessed. */}
        {trial.length > 0 && (
          <span className="chip try">
            Trying {trial.length === 1 ? "one transfer" : `${trial.length} transfers`}
          </span>
        )}
        {bank < 0 && (
          <span className="chip warn" title="Priced at today's prices. Nobody was dropped to make it fit.">
            {money(-bank)} short
          </span>
        )}
        {stacked.length > 0 && (
          <span className="chip warn">
            {stacked.map(([id, n]) => `${n} ${teams.get(id)?.sh ?? "?"}`).join(" · ")}
          </span>
        )}
      </div>

      <aside className="churn still">
        <section className="mod arrivemod">
          <h2>Votes in</h2>
          <div className="countline">
            <span className="big">{cx.n}</span>
            <span className="who">
              {cx.n
                ? cx.hold
                  ? `${pctText(cx.holdPct)} would make no transfer`
                  : cap === 1 ? "one transfer each" : `up to ${cap} each`
                : "nobody has voted yet"}
            </span>
          </div>
        </section>

        <section className="mod">
          <h2>
            The transfer
            <span className="spacer" />
            <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
              {cx.swaps.length ? `${cx.swaps.length} proposed` : "none yet"}
            </span>
          </h2>
          {cx.swaps.length ? (
            cx.swaps.slice(0, LIST_ROWS).map((s, i) => (
              <div
                className={`rank swap${i < cap ? " in" : ""}${tried.includes(s.key) ? " tried" : ""}${crossed.has(s.in.id) ? " crossing" : ""}`}
                key={s.key}
                title={`${s.count} of ${cx.n} viewers${tried.includes(s.key) ? " · on the pitch" : ""}`}
              >
                <div className="top">
                  <span className="pos">{i + 1}</span>
                  <span className="nm">
                    {s.out.n} <span className="arrow">→</span> {s.in.n}
                  </span>
                  <span className="pc num">{pctText(s.pct)}</span>
                </div>
                <div className="barline">
                  <div className="bar">
                    <i style={{ transform: `scaleX(${Math.max(0.02, s.pct / 100)})` }} />
                  </div>
                  <span className="gap">{money(s.in.cost - s.out.cost)}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-note">
              {cx.n ? "Everyone so far would keep the team as it is." : "No transfers proposed yet."}
            </p>
          )}
        </section>

        <section className="mod">
          <h2>
            Out
            <span className="spacer" />
            <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
              most wanted gone
            </span>
          </h2>
          {cx.out.length ? (
            <VoteList rows={cx.out.slice(0, LIST_ROWS)} teams={teams} n={cx.n} verb="want out" />
          ) : (
            <p className="empty-note">Nobody has been voted out yet.</p>
          )}
        </section>

        <section className="mod">
          <h2>
            In
            <span className="spacer" />
            <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
              most wanted signing
            </span>
          </h2>
          {cx.in.length ? (
            <VoteList rows={cx.in.slice(0, LIST_ROWS)} teams={teams} n={cx.n} verb="want in" />
          ) : (
            <p className="empty-note">No signings proposed yet.</p>
          )}
        </section>

        {cx.captain.length > 0 && (
          <section className="mod armbandmod">
            <h2>
              Armband
              <span className="spacer" />
              <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
                {`${cx.captain.reduce((s, r) => s + r.count, 0)} would move it`}
              </span>
            </h2>
            <VoteList rows={cx.captain.slice(0, 3)} teams={teams} n={cx.n} verb="for the armband" />
          </section>
        )}

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
                Voting is closed. The link still works — it shows a viewer the team, locked.
              </p>
            )}
            {copied === "manual" && (
              <p className="hint">
                Your browser blocked the copy — the link is selected, press Ctrl+C (⌘C on a Mac).
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

/**
 * The host's way of seeing an idea without taking it. The crowd's proposed
 * transfers, each one a switch that puts it on the pitch and takes it off
 * again — the board's team stays the host's own until they say otherwise, and
 * even then only on this screen.
 *
 * It floats at the frame's left edge and starts shut, because the frame holds
 * 100dvh and nothing may push the eleven. The same reason the deadline dial
 * floats rather than growing the strip it sits in.
 */
function TryDeck({
  swaps,
  tried,
  trial,
  cap,
  open,
  clashes,
  onOpen,
  onToggle,
  onVerdict,
  onClear,
}: {
  swaps: SwapRank[];
  tried: string[];
  trial: SwapRank[];
  cap: number;
  open: boolean;
  clashes: (s: SwapRank) => boolean;
  onOpen: () => void;
  onToggle: (key: string) => void;
  onVerdict: () => void;
  onClear: () => void;
}) {
  return (
    <div className={`trydeck${open ? " open" : ""}`}>
      <button className="trytrig" onClick={onOpen} aria-expanded={open}>
        <span className="lab">On the pitch</span>
        <b className="num">{trial.length}</b>
        <span className="of">of {swaps.length}</span>
        <svg className="dialcaret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8 9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>

      {open && (
        <div className="trypanel">
          <p className="dialsay">
            The team on the board is yours. Put a transfer on the pitch to see it — nothing is
            saved, and nobody&apos;s vote moves.
          </p>
          <ul className="trylist">
            {swaps.slice(0, TRY_ROWS).map((s, i) => {
              const on = tried.includes(s.key);
              const blocked = clashes(s);
              return (
                <li key={s.key}>
                  <button
                    className={`tryrow${on ? " on" : ""}`}
                    disabled={blocked}
                    aria-pressed={on}
                    onClick={() => onToggle(s.key)}
                    title={blocked
                      ? "Another transfer on the pitch already needs one of these two."
                      : on ? "Take it back off the pitch" : "Put it on the pitch"}
                  >
                    <span className="pos">{i + 1}</span>
                    <span className="nm">
                      {s.out.n} <span className="arrow">→</span> {s.in.n}
                    </span>
                    <span className="pc num">{pctText(s.pct)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="tryfoot">
            <button className="btn btn-sm" onClick={onVerdict}>
              {cap === 1 ? "Try the crowd's pick" : `Try the crowd's top ${cap}`}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={onClear} disabled={trial.length === 0}>
              Back to my team
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VoteList({
  rows,
  teams,
  n,
  verb,
}: {
  rows: Ranked[];
  teams: Map<number, Team>;
  n: number;
  verb: string;
}) {
  return (
    <ul className="votelist">
      {rows.map((r) => (
        <li className="voterow" key={r.id} title={`${r.count} of ${n} ${verb}`}>
          <i style={{ transform: `scaleX(${Math.max(0.015, r.pct / 100)})` }} />
          <span className="nm">{r.player.n}</span>
          <span className="tm"><TeamMark team={teams.get(r.player.team)} /></span>
          <span className="pc num">{pctText(r.pct)}</span>
        </li>
      ))}
    </ul>
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
