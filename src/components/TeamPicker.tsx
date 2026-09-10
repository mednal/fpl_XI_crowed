"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bench, PitchRows, type SlotView } from "./Pitch";
import { Kit, TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import {
  BUDGET, FORMS, MAXCLUB, POS, POSITIONS, POSLONG, SQUAD,
  applySwap, benchIds, cheapestPerPos, clubCount, cloneSquad, money, newSquad,
  removeFromSquad, spent, squadIds, squadChecklist, startCount, swapFormation,
  xiIds, type SlotRef, type Squad,
} from "@/lib/squad";
import type { Bootstrap, Player, PosId, Pool } from "@/lib/types";

type Menu = { pos: PosId; index: number; anchor: HTMLElement } | null;

const MENU_GAP = 6;
const MENU_EDGE = 8;

/**
 * Only the checks still outstanding are drawn, on one line, in two or three
 * words each. A requirement already met is not news — and the strip overhead
 * already carries the squad count and the bank, so a row of ticks restating
 * them was paying rail height to say nothing. Each one keeps its full
 * sentence in `.said`: that is what a screen reader announces, and what the
 * disabled Send button lists in its tooltip.
 */
const CHECK_LABELS: Record<string, string> = {
  squad: "Squad",
  budget: "Over by",
  clubs: "3 per club",
  captain: "Captain",
  vice: "Vice",
};

/** Budget and club limits are broken rules; the rest are simply not done yet. */
const BROKEN = new Set(["budget", "clubs"]);

// FPL ships ~700 players. The rail shows the strongest slice of whatever the
// filters leave and says so, rather than ending in silence at an invisible cut.
const LIST_CAP = 200;

const SORTS: [string, string][] = [
  ["sel", "Sort: selected %"],
  ["pts", "Sort: points"],
  ["form", "Sort: form"],
  ["cost", "Sort: price high"],
  ["cheap", "Sort: price low"],
];

export default function TeamPicker({ pool, boot }: { pool: Pool; boot: Bootstrap }) {
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);
  const minCost = useMemo(() => cheapestPerPos(boot.players), [boot.players]);

  // A host who fixed a shape for the board gets that shape on the pitch too, so
  // the link opens on the eleven positions their crowd XI is drawn in. It is a
  // starting point, not a rule: the dropdown still offers every formation.
  const [sq, setSq] = useState<Squad>(() => newSquad(pool.formation));
  const [picking, setPicking] = useState<{ pos: PosId; index: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [subbing, setSubbing] = useState<SlotRef | null>(null);
  const [q, setQ] = useState("");
  const [filterPos, setFilterPos] = useState<0 | PosId>(0);
  const [filterTeam, setFilterTeam] = useState(0);
  const [sort, setSort] = useState("sel");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Bumps on every successful save. A count and not a flag so a second save
  // replays the confirmation instead of leaving the banner looking unchanged.
  const [saves, setSaves] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Counts presses of Send made with something still missing. It is a count and
  // not a flag so that pressing again replays the nudge on the same complaint.
  const [nags, setNags] = useState(0);
  const [menuAt, setMenuAt] = useState({ left: 0, top: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  const locked = pool.deadline ? new Date(pool.deadline).getTime() < Date.now() : false;

  useEffect(() => {
    try {
      setNick(localStorage.getItem("cxi.nick") ?? "");
      const saved = localStorage.getItem(`cxi.squad.${pool.id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as Squad;
        if (parsed?.p) { setSq(parsed); setSent(true); }
      }
    } catch { /* a fresh browser simply starts empty */ }
  }, [pool.id]);

  // Narrow screens stack the send panel below the pitch, so the confirmation
  // lands off-screen above the button that was just pressed. `nearest` leaves
  // the wide layout, where both are already visible, alone.
  useEffect(() => {
    if (saves) bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [saves]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  /**
   * The menu is fixed, so it has to be re-pinned to its shirt on every scroll or
   * it drifts across the page. It flips above the shirt when there is no room
   * below — otherwise a bench player's menu opens past the bottom of the screen
   * where fixed positioning puts it out of reach.
   */
  useLayoutEffect(() => {
    const anchor = menu?.anchor;
    const el = menuRef.current;
    if (!anchor || !el) return;

    const pin = () => {
      const a = anchor.getBoundingClientRect();
      if (a.bottom < 0 || a.top > window.innerHeight) { setMenu(null); return; }
      const { width, height } = el.getBoundingClientRect();
      const below = a.bottom + MENU_GAP;
      const above = a.top - MENU_GAP - height;
      const top = below + height <= window.innerHeight - MENU_EDGE
        ? below
        : above >= MENU_EDGE
          ? above
          : Math.max(MENU_EDGE, window.innerHeight - MENU_EDGE - height);
      const left = Math.min(
        Math.max(MENU_EDGE, a.left + a.width / 2 - width / 2),
        Math.max(MENU_EDGE, window.innerWidth - MENU_EDGE - width),
      );
      setMenuAt((cur) => (cur.left === left && cur.top === top ? cur : { left, top }));
    };

    pin();
    window.addEventListener("scroll", pin, true);
    window.addEventListener("resize", pin);
    return () => {
      window.removeEventListener("scroll", pin, true);
      window.removeEventListener("resize", pin);
    };
  }, [menu]);

  const sc = startCount(sq.formation);
  const ids = squadIds(sq);
  const bank = BUDGET - spent(sq, byId);
  const clubs = clubCount(sq, byId);
  const checks = squadChecklist(sq, byId, pool.budget);
  const todo = checks.filter((c) => !c.ok);
  const taken = new Set(ids);

  function update(fn: (draft: Squad) => void) {
    setSq((prev) => {
      const next = cloneSquad(prev);
      fn(next);
      const xi = xiIds(next);
      if (next.captain && !xi.includes(next.captain)) next.captain = null;
      if (next.vice && !xi.includes(next.vice)) next.vice = null;
      return next;
    });
  }

  /**
   * FPL behaviour: the player list is always live. Tapping a player drops them
   * into the slot you are aiming at, or else into the first free slot for their
   * position, and then moves the aim on to the next gap so you can keep picking
   * without going back to the pitch between every player.
   */
  function place(player: Player) {
    if (locked || blockedReason(player)) return;
    const pos = player.pos;
    const slots = sq.p[pos];
    const aimed = picking && picking.pos === pos && !slots[picking.index] ? picking.index : -1;
    const slot = aimed >= 0 ? aimed : slots.findIndex((x) => !x);
    if (slot < 0) return;

    update((d) => { d.p[pos][slot] = player.id; });

    if (picking && picking.pos === pos) {
      const nextGap = slots.findIndex((x, i) => !x && i !== slot);
      setPicking(nextGap >= 0 ? { pos, index: nextGap } : null);
    }
  }

  function slotView(pos: PosId, index: number, onPitch: boolean): SlotView {
    const id = sq.p[pos][index];
    const player = id ? byId.get(id) ?? null : null;
    const base: SlotView = {
      player,
      pos,
      sub: player ? money(player.cost) : "Add",
      badge: player && onPitch
        ? (player.id === sq.captain ? "C" : player.id === sq.vice ? "V" : null)
        : null,
    };

    // Mid-substitution the whole pitch becomes the answer to one question: who
    // does this player swap with? Everything that is not a legal partner goes
    // quiet rather than doing something else.
    if (subbing && !locked) {
      const chosen = subbing.pos === pos && subbing.index === index;
      const target = !chosen && !!swapFormation(sq, subbing, { pos, index });
      return {
        ...base,
        className: chosen ? "chosen" : target ? "target" : "dim",
        title: chosen
          ? "Tap again to cancel the substitution"
          : target
            ? player ? `Swap with ${player.n}` : "Move into this empty slot"
            : "This swap would not leave a legal team",
        onClick: chosen
          ? () => setSubbing(null)
          : target
            ? () => { setSq((prev) => applySwap(prev, subbing, { pos, index })); setSubbing(null); }
            : undefined,
      };
    }

    return {
      ...base,
      onClick: locked
        ? undefined
        : (e: React.MouseEvent<HTMLButtonElement>) => {
            if (player) {
              setMenu({ pos, index, anchor: e.currentTarget });
            } else {
              setPicking((cur) =>
                cur && cur.pos === pos && cur.index === index ? null : { pos, index });
              setQ("");
            }
          },
      onRemove: locked || !player
        ? undefined
        : () => {
            setMenu(null);
            setSubbing(null);
            setSq((prev) => removeFromSquad(prev, { pos, index }));
          },
    };
  }

  const pitchRows: SlotView[][] = POSITIONS.map((k) =>
    Array.from({ length: sc[k] }, (_, i) => slotView(k, i, true)),
  );
  const benchCells: SlotView[] = POSITIONS.flatMap((k) =>
    Array.from({ length: SQUAD[k] - sc[k] }, (_, i) => slotView(k, sc[k] + i, false)),
  );

  const wantPos: 0 | PosId = picking ? picking.pos : filterPos;
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
      .filter((p) => (!wantPos || p.pos === wantPos)
        && (!filterTeam || p.team === filterTeam)
        && (!needle || p.n.toLowerCase().includes(needle)))
      .sort(sorters[sort] ?? sorters.sel);
    return { rows: hits.slice(0, LIST_CAP), total: hits.length };
  }, [boot.players, wantPos, filterTeam, q, sort]);

  // Every row already sits under a position filter, so repeating that position
  // on all of them is a column of the same three letters.
  const showPos = wantPos === 0;

  /** The only things FPL blocks on: duplicate, position full, 3-per-club, price. */
  function blockedReason(p: Player): string | null {
    if (taken.has(p.id)) return "Already in your squad";
    if (!sq.p[p.pos].some((x) => !x)) {
      return `You already have all ${SQUAD[p.pos]} ${POSLONG[p.pos].toLowerCase()}`;
    }
    if ((clubs[p.team] ?? 0) >= MAXCLUB) {
      return `You already have ${MAXCLUB} from ${teams.get(p.team)?.name ?? "that club"}`;
    }
    if (pool.budget && p.cost > bank) {
      return `More than the ${money(bank)} you have left`;
    }
    return null;
  }

  async function submit() {
    if (todo.length) { setNags((n) => n + 1); return; }
    setBusy(true);
    setError(null);
    try {
      const body = {
        nick: nick.trim() || "Anonymous",
        formation: sq.formation,
        xi: xiIds(sq),
        bench: benchIds(sq),
        captain: sq.captain!,
        vice: sq.vice!,
      };
      const res = await fetch(`/api/pools/${pool.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send your team.");
      try {
        localStorage.setItem("cxi.nick", body.nick);
        localStorage.setItem(`cxi.squad.${pool.id}`, JSON.stringify(sq));
      } catch { /* storage off — the team is saved on the server either way */ }
      // Sending does not take the viewer anywhere: the squad on screen is the
      // one on the server, and they can keep editing it until the deadline.
      // The crowd XI is a button away, not a destination they are pushed to.
      setSent(true);
      setSaves((n) => n + 1);
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your team.");
      setBusy(false);
    }
  }

  const menuPlayer = menu ? byId.get(sq.p[menu.pos][menu.index] ?? -1) : undefined;
  const subPlayer = subbing ? byId.get(sq.p[subbing.pos][subbing.index] ?? -1) : undefined;
  const menuIsStarter = menu ? menu.index < sc[menu.pos] : false;
  const showMenu = menu && menuPlayer && !subbing;

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
          <span className={`meter${bank < 0 ? " over" : ""}`}>
            <span className="lab">Left</span>
            <b className="num">{money(bank)}</b>
          </span>
        )}
        <span className="sep" />
        <span className="meter">
          <span className="lab">Picked</span>
          <b className="num">{ids.length}/15</b>
        </span>
        <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Results</Link>
      </header>

      <main className="frame">
        {locked && (
          <p className="locked-note">
            The deadline has passed — teams for this gameweek are locked.
          </p>
        )}
        {!locked && sent && (
          <div className="banner saved" key={saves} ref={bannerRef} aria-live="polite">
            {saves > 1 ? "Team updated." : "Your team is in."} Change it any time before
            the deadline.
            <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>See the crowd XI</Link>
          </div>
        )}
        {subbing && subPlayer && (
          <div className="subbar">
            <span>
              Tap the player <b>{subPlayer.n}</b> should swap with, or an empty slot to move
              them into it — anything greyed out would leave you without a legal team.
            </span>
            <button className="btn btn-sm" onClick={() => setSubbing(null)}>Cancel</button>
          </div>
        )}

        <PitchRows rows={pitchRows} teams={teams} />
        <Bench cells={benchCells} teams={teams} />
      </main>

      <div className="foot">
        <label className="lab" htmlFor="formation">Formation</label>
        <select
          id="formation"
          style={{ width: "auto" }}
          value={sq.formation}
          disabled={locked}
          onChange={(e) => update((d) => { d.formation = e.target.value; })}
        >
          {Object.keys(FORMS).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        {pool.formation && (
          <span
            className="chip"
            title={`The host draws the crowd XI in ${pool.formation}. Your own team can be any shape.`}
          >
            Board {pool.formation}
          </span>
        )}
        <span className="spacer" />
        {pool.budget
          ? <span className={`chip${bank < 0 ? " warn" : ""}`}>Squad {money(spent(sq, byId))}</span>
          : <span className="chip">No budget</span>}
        {pool.deadline && <Countdown deadline={pool.deadline} />}
      </div>

      <aside className={`churn${sort === "pts" || sort === "form" ? " ptsort" : ""}`}>
        <section className="mod grow">
          <h2 className="vh">{picking ? `Choose a ${POS[picking.pos]}` : "Players"}</h2>

          <div className="searchhead">
            <input
              type="search" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search player"
              placeholder={picking ? `Search ${POSLONG[picking.pos].toLowerCase()}` : "Search any player"}
            />
            {picking && (
              <button className="btn btn-sm btn-ghost" onClick={() => setPicking(null)}>Show all</button>
            )}
          </div>

          <div className="seg" role="group" aria-label="Position">
            <button
              type="button" className={`pchip${wantPos === 0 ? " on" : ""}`}
              aria-pressed={wantPos === 0}
              onClick={() => { setPicking(null); setFilterPos(0); }}
            >All</button>
            {POSITIONS.map((k) => (
              <button
                key={k} type="button" className={`pchip${wantPos === k ? " on" : ""}`}
                aria-pressed={wantPos === k} title={POSLONG[k]}
                onClick={() => { setPicking(null); setFilterPos(k); }}
              >{POS[k]}</button>
            ))}
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
            {rows.length === 0 && <p className="empty-note">No player matches that search.</p>}
            {rows.map((p) => {
              const reason = blockedReason(p);
              return (
                <button
                  className="prow" key={p.id} disabled={locked || !!reason}
                  title={reason ?? undefined} onClick={() => place(p)}
                >
                  <Kit team={teams.get(p.team)} className="kit kitmini" />
                  <span className="who">
                    {/* A long name ellipsises in a narrow rail; hovering it gives
                        the whole thing back, unless the row already owes the
                        viewer the more useful sentence about why it is dead. */}
                    <span className="n" title={reason ? undefined : p.n}>{p.n}</span>
                    <span className="m">
                      <TeamMark team={teams.get(p.team)} />
                      {showPos && ` ${POS[p.pos]}`}
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
          <h2 className="vh">{sent ? "Update your team" : "Send your team"}</h2>
          <div className="modbody">
            {locked ? (
              <p className="err">Voting is closed for this gameweek.</p>
            ) : (
              <>
                <input
                  id="nick" type="text" value={nick} disabled={locked}
                  aria-label="Your name on the leaderboard"
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="Your name on the leaderboard"
                />
                <p
                  className={`todo-note${nags ? " nudge" : ""}`}
                  id="ready-list" key={nags} aria-live="polite"
                >
                  {todo.map((c) => (
                    <span
                      key={c.key} title={c.label}
                      className={`tk${BROKEN.has(c.key) ? " bad" : ""}`}
                    >
                      <span aria-hidden="true">
                        {CHECK_LABELS[c.key] ?? c.label}
                        {c.key === "squad" && <b>{ids.length}/15</b>}
                        {c.key === "budget" && <b>{money(-bank)}</b>}
                      </span>
                      <span className="said">{c.label}</span>
                    </span>
                  ))}
                </p>
              </>
            )}
            {error && <p className="err">{error}</p>}
            <button
              className="btn btn-primary btn-lg" onClick={submit}
              disabled={locked || busy} aria-disabled={todo.length > 0}
              aria-describedby={locked ? undefined : "ready-list"}
              title={todo.length ? todo.map((c) => c.label).join(" ") : undefined}
            >
              {busy ? "Sending…" : todo.length ? sendBlurb(todo.length) : sent ? "Update my team" : "Submit my team"}
            </button>
            <p className="hint">Tap a shirt for the armband or a substitution.</p>
          </div>
        </section>
      </aside>

      {showMenu && (
        <div ref={menuRef} className="slotmenu" style={{ left: menuAt.left, top: menuAt.top }}>
          <div className="slotmenu-head">
            <b>{menuPlayer.n}</b>
            <div className="hint">
              {teams.get(menuPlayer.team)?.name} · {money(menuPlayer.cost)}
            </div>
          </div>
          {menuIsStarter && sq.captain !== menuPlayer.id && (
            <MenuButton onClick={() => {
              update((d) => { if (d.vice === menuPlayer.id) d.vice = null; d.captain = menuPlayer.id; });
              setMenu(null);
            }}>Make captain</MenuButton>
          )}
          {menuIsStarter && sq.vice !== menuPlayer.id && (
            <MenuButton onClick={() => {
              update((d) => { if (d.captain === menuPlayer.id) d.captain = null; d.vice = menuPlayer.id; });
              setMenu(null);
            }}>Make vice-captain</MenuButton>
          )}
          <MenuButton onClick={() => {
            setPicking(null);
            setSubbing({ pos: menu.pos, index: menu.index });
            setMenu(null);
          }}>{menuIsStarter ? "Substitute" : "Bring on"}</MenuButton>
          <MenuButton onClick={() => {
            setSq((prev) => removeFromSquad(prev, { pos: menu.pos, index: menu.index }));
            setMenu(null);
          }}>Take out of the squad</MenuButton>
        </div>
      )}
    </div>
  );
}

/** The button says what is missing, so a viewer never taps a dead control. */
function sendBlurb(n: number): string {
  return n === 1 ? "One thing left before you can send" : `${n} things left before you can send`;
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="btn btn-ghost btn-sm" onClick={onClick}>
      {children}
    </button>
  );
}
