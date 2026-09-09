"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bench, PitchRows, type SlotView } from "./Pitch";
import { Kit, TeamMark } from "./Kit";
import { Countdown } from "./Countdown";
import {
  BUDGET, FORMS, MAXCLUB, POS, POSITIONS, POSLONG, SQUAD,
  benchIds, cheapestPerPos, clubCount, money, newSquad, reserve,
  spent, squadIds, startCount, validateSquad, xiIds, type Squad,
} from "@/lib/squad";
import type { Bootstrap, Player, PosId, Pool } from "@/lib/types";

type Menu = { pos: PosId; index: number; x: number; y: number } | null;

const SORTS: [string, string][] = [
  ["sel", "Sort: ownership"],
  ["pts", "Sort: total points"],
  ["form", "Sort: form"],
  ["cost", "Sort: most expensive"],
  ["cheap", "Sort: cheapest"],
];

function voterId(): string {
  const KEY = "cxi.voter";
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2);
  }
}

export default function TeamPicker({ pool, boot }: { pool: Pool; boot: Bootstrap }) {
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);
  const minCost = useMemo(() => cheapestPerPos(boot.players), [boot.players]);

  const [sq, setSq] = useState<Squad>(newSquad);
  const [picking, setPicking] = useState<{ pos: PosId; index: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [q, setQ] = useState("");
  const [filterPos, setFilterPos] = useState<0 | PosId>(0);
  const [filterTeam, setFilterTeam] = useState(0);
  const [sort, setSort] = useState("sel");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const sc = startCount(sq.formation);
  const ids = squadIds(sq);
  const bank = BUDGET - spent(sq, byId);
  const clubs = clubCount(sq, byId);
  const errs = validateSquad(sq, byId, pool.budget);
  const taken = new Set(ids);

  function update(fn: (draft: Squad) => void) {
    setSq((prev) => {
      const next: Squad = {
        formation: prev.formation,
        p: { 1: [...prev.p[1]], 2: [...prev.p[2]], 3: [...prev.p[3]], 4: [...prev.p[4]] },
        captain: prev.captain,
        vice: prev.vice,
      };
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
    return {
      player,
      pos,
      sub: player ? money(player.cost) : "Add",
      badge: player && onPitch
        ? (player.id === sq.captain ? "C" : player.id === sq.vice ? "V" : null)
        : null,
      onClick: locked
        ? undefined
        : (e: React.MouseEvent<HTMLButtonElement>) => {
            if (player) {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ pos, index, x: r.left + r.width / 2, y: r.bottom + 6 });
            } else {
              setPicking((cur) =>
                cur && cur.pos === pos && cur.index === index ? null : { pos, index });
              setQ("");
            }
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
  const list = useMemo(() => {
    const sorters: Record<string, (a: Player, b: Player) => number> = {
      sel: (a, b) => b.sel - a.sel,
      pts: (a, b) => b.pts - a.pts,
      form: (a, b) => b.form - a.form,
      cost: (a, b) => b.cost - a.cost,
      cheap: (a, b) => a.cost - b.cost,
    };
    const needle = q.trim().toLowerCase();
    return boot.players
      .filter((p) => (!wantPos || p.pos === wantPos)
        && (!filterTeam || p.team === filterTeam)
        && (!needle || p.n.toLowerCase().includes(needle)))
      .sort(sorters[sort] ?? sorters.sel)
      .slice(0, 120);
  }, [boot.players, wantPos, filterTeam, q, sort]);

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
    setBusy(true);
    setError(null);
    try {
      const body = {
        voter: voterId(),
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
      setSent(true);
      window.location.href = `/p/${pool.id}/live`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your team.");
      setBusy(false);
    }
  }

  const menuPlayer = menu ? byId.get(sq.p[menu.pos][menu.index] ?? -1) : undefined;
  const menuIsStarter = menu ? menu.index < sc[menu.pos] : false;

  return (
    <>
      <div className="topbar">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
        <span className="chip">{pool.name}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {pool.budget && (
          <span className={`meter${bank < 0 ? " over" : ""}`}>
            <span className="eyebrow">Money left</span>
            <b>{money(bank)}</b>
          </span>
        )}
        <span className="meter">
          <span className="eyebrow">Picked</span>
          <b>{ids.length}/15</b>
        </span>
        <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Results</Link>
      </div>

      {locked && (
        <p className="locked-note">
          The deadline has passed — teams for this gameweek are locked.
        </p>
      )}
      {!locked && sent && (
        <div className="banner">
          Your team is in. Change it any time before the deadline.
          <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>See the crowd XI</Link>
        </div>
      )}

      <div className="shell">
        <div className="pitchwrap">
          <div className="pitchbar">
            <span className="eyebrow">Formation</span>
            <select
              value={sq.formation}
              disabled={locked}
              onChange={(e) => update((d) => { d.formation = e.target.value; })}
            >
              {Object.keys(FORMS).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            {pool.budget
              ? <span className={`chip${bank < 0 ? " warn" : ""}`}>Squad {money(spent(sq, byId))}</span>
              : <span className="chip">No budget</span>}
            {pool.deadline && <Countdown deadline={pool.deadline} />}
          </div>

          <PitchRows rows={pitchRows} teams={teams} />
          <Bench cells={benchCells} teams={teams} />
        </div>

        <div className="rail">
          <section className="panel">
            <header><h3>{sent ? "Update your team" : "Send your team"}</h3></header>
            <div className="panelbody">
              {locked ? (
                <div className="err">Voting is closed for this gameweek.</div>
              ) : errs.length ? (
                errs.map((e) => <div className="err" key={e}>{e}</div>)
              ) : (
                <div className="chip good">Legal squad — ready to send</div>
              )}
              {!locked && pool.budget && ids.length < 15 && bank < reserve(sq, minCost) && (
                <div className="err">
                  Only {money(bank)} left for {15 - ids.length} more —
                  you need at least {money(reserve(sq, minCost))} to fill the squad.
                </div>
              )}
              {error && <div className="err">{error}</div>}
              <div className="field">
                <label htmlFor="nick">Your name on the leaderboard</label>
                <input
                  id="nick" type="text" value={nick} disabled={locked}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="e.g. Sam from Leeds"
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={locked || busy || errs.length > 0}
              >
                {busy ? "Sending…" : sent ? "Update my team" : "Submit my team"}
              </button>
              <p className="hint">
                Tap a player in the list to add them. Tap a shirt on the pitch to make that
                player captain, move them to the bench, or take them out.
              </p>
            </div>
          </section>

          <section className="panel">
            <header>
              <h3>{picking ? `Choose a ${POS[picking.pos]}` : "Players"}</h3>
              {picking
                ? <button className="btn btn-sm btn-ghost" onClick={() => setPicking(null)}>Show all</button>
                : <span className="hint">Tap a player to add them</span>}
            </header>

            <div className="tools">
              <input
                type="search" placeholder="Search player" value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select
                value={wantPos}
                onChange={(e) => {
                  setPicking(null);
                  setFilterPos(Number(e.target.value) as 0 | PosId);
                }}
              >
                <option value={0}>All positions</option>
                {POSITIONS.map((k) => <option key={k} value={k}>{POSLONG[k]}</option>)}
              </select>
              <select value={filterTeam} onChange={(e) => setFilterTeam(Number(e.target.value))}>
                <option value={0}>All clubs</option>
                {boot.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>

            <div className="plist">
              {list.length === 0 && <div className="empty-note">No player matches that search.</div>}
              {list.map((p) => {
                const reason = blockedReason(p);
                const disabled = locked || !!reason;
                return (
                  <button
                    className="prow" key={p.id} disabled={disabled}
                    title={reason ?? undefined} onClick={() => place(p)}
                  >
                    <Kit team={teams.get(p.team)} className="kit kitmini" />
                    <span className="who">
                      <span className="n">{p.n}</span>
                      <span className="m">
                        <TeamMark team={teams.get(p.team)} /> · {POS[p.pos]}
                        {p.st !== "a" ? " · doubt" : ""}
                      </span>
                    </span>
                    <span className="price">{money(p.cost)}</span>
                    <span className="pts">{p.pts}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {menu && menuPlayer && (
        <div
          ref={menuRef}
          className="panel"
          style={{
            position: "fixed", zIndex: 80, width: 210, padding: 5,
            left: Math.min(Math.max(8, menu.x - 105), (typeof window !== "undefined" ? window.innerWidth : 400) - 218),
            top: menu.y,
          }}
        >
          <div style={{ padding: "6px 9px 7px", borderBottom: "1px solid var(--line-soft)", marginBottom: 4 }}>
            <div style={{ fontWeight: 700 }}>{menuPlayer.n}</div>
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
          {menuIsStarter && sc[menu.pos] < SQUAD[menu.pos] && sq.p[menu.pos][sc[menu.pos]] && (
            <MenuButton onClick={() => {
              update((d) => {
                const b = sc[menu.pos];
                [d.p[menu.pos][menu.index], d.p[menu.pos][b]] = [d.p[menu.pos][b], d.p[menu.pos][menu.index]];
              });
              setMenu(null);
            }}>Swap to the bench</MenuButton>
          )}
          {!menuIsStarter && (
            <MenuButton onClick={() => {
              update((d) => {
                const last = sc[menu.pos] - 1;
                [d.p[menu.pos][menu.index], d.p[menu.pos][last]] = [d.p[menu.pos][last], d.p[menu.pos][menu.index]];
              });
              setMenu(null);
            }}>Move into the XI</MenuButton>
          )}
          <MenuButton onClick={() => {
            update((d) => {
              d.p[menu.pos][menu.index] = null;
              const packed = d.p[menu.pos].filter(Boolean);
              while (packed.length < SQUAD[menu.pos]) packed.push(null);
              d.p[menu.pos] = packed;
              if (d.captain === menuPlayer.id) d.captain = null;
              if (d.vice === menuPlayer.id) d.vice = null;
            });
            setMenu(null);
          }}>Take out of the squad</MenuButton>
        </div>
      )}
    </>
  );
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      style={{ width: "100%", justifyContent: "flex-start", border: 0 }}
    >
      {children}
    </button>
  );
}
