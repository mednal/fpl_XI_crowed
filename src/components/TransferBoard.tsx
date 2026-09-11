"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SquadPitch from "./SquadPitch";
import { TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import HostBar from "./HostBar";
import { poolLock } from "@/lib/lock";
import { getBrowserClient } from "@/lib/supabase";
import { money, pctText } from "@/lib/squad";
import { DEFAULT_MOVES, crowdTransfers, movesAllowed, squadValue } from "@/lib/transfers";
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
  const value = squadValue(cx.squad, byId);

  // A signing crossing into the team is the moment worth watching, exactly as a
  // shirt arriving on the XI board is.
  const inNow = cx.applied.map((s) => s.in.id).join(",");
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

  const incoming = new Map(cx.applied.map((s) => [s.in.id, s]));

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

  const captainNow = byId.get(cx.squad.captain);
  const capVote = cx.captain[0];

  return (
    <div className={`board fixed${isHost ? " hosted" : ""}`}>
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

      {isHost && (
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
        />
      )}

      <main className="frame">
        {cx.applied.length === 0 && (
          <p className="locked-note">
            {cx.n === 0
              ? "No votes yet. Share the link and the transfers appear here as they arrive."
              : cx.hold === cx.n
                ? `All ${cx.n} so far would keep the team exactly as it is.`
                : "No transfer has a vote behind it yet."}
          </p>
        )}
        <SquadPitch
          squad={cx.squad}
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
          <dd className={`sm num${cx.bank < 0 ? " over" : ""}`}>{money(cx.bank)}</dd>
        </dl>
        <span className="spacer" />
        {cx.bank < 0 && (
          <span className="chip warn" title="The crowd's choice, priced up. Nobody was dropped to make it fit.">
            {money(-cx.bank)} short
          </span>
        )}
        {cx.stacked.length > 0 && (
          <span className="chip warn">
            {cx.stacked.map(([id, n]) => `${n} ${teams.get(id)?.sh ?? "?"}`).join(" · ")}
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
                className={`rank swap${i < cap ? " in" : ""}${crossed.has(s.in.id) ? " crossing" : ""}`}
                key={s.key}
                title={`${s.count} of ${cx.n} viewers`}
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
