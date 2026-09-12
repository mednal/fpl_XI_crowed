"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SquadPitch, { type Decorate } from "./SquadPitch";
import SlotMenu, { MenuButton } from "./SlotMenu";
import { Kit, TeamMark } from "./Kit";
import { poolLock } from "@/lib/lock";
import {
  MAXCLUB, POS, POSLONG, applySwap, money, swapFormation, type SlotRef,
} from "@/lib/squad";
import {
  applyTransfers, clubCounts, crowdTransfers, fromSlots, fundsLeft, hostIds,
  movesAllowed, movesLabel, squadValue, toSlots, transferChecklist, validateHostSquad,
} from "@/lib/transfers";
import type { SwapRank } from "@/lib/transfers";
import type { Bootstrap, HostSquad, Player, PosId, Pool, TransferRow } from "@/lib/types";

type Row = Pick<TransferRow, "out_ids" | "in_ids" | "captain">;

/** One player on the way out, whoever is replacing him, and the armbands he was
 *  wearing — so putting him back puts the team exactly as it was. */
type Pair = { out: number; in: number | null; wasCaptain: boolean; wasVice: boolean };

type Menu = { id: number; anchor: HTMLElement } | null;

const LIST_CAP = 200;
/** How far down the crowd's list is worth offering as a one-tap transfer. Past
 *  this they are single votes, and a button for one is a suggestion nobody made. */
const CROWD_ROWS = 5;

const SORTS: [string, string][] = [
  ["sel", "Sort: selected %"],
  ["pts", "Sort: points"],
  ["form", "Sort: form"],
  ["cost", "Sort: price high"],
  ["cheap", "Sort: price low"],
];

const one = (pos: PosId | undefined) => POSLONG[pos ?? 1].toLowerCase().replace(/s$/, "");

/**
 * The host's own team, and the only screen where it changes. The crowd votes;
 * the host decides — so this is where the verdict actually gets made, with the
 * transfers the host set as the crowd's allowance holding them to the same
 * number they asked the crowd for.
 *
 * Two different edits live here and the difference matters more than it looks:
 *
 *  - **A substitution** moves eleven of the same fifteen around. Every vote
 *    still points at a player who is there, so it can be saved whenever.
 *  - **A transfer** changes who is in the squad. Save one while the crowd is
 *    still voting and every vote cast so far is about a player who has gone, so
 *    the route refuses it until voting is shut. This screen says so up front
 *    rather than letting the host find out at the Save button.
 *
 * The rules are `transfers.ts` and `squad.ts` — the same modules the viewer's
 * picker and the route use, so a host cannot build something on this screen
 * that the server would then reject as illegal.
 */
export default function HostTeam({
  pool,
  squad,
  boot,
  votes,
}: {
  pool: Pool;
  squad: HostSquad;
  boot: Bootstrap;
  votes: Row[];
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);

  // The working team: always fifteen real players. A player on the way out
  // keeps his shirt until someone is chosen to replace him, and the pitch draws
  // it as the gap he left — the same way the viewer's picker does it.
  const [team, setTeam] = useState<HostSquad>(squad);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [aimAt, setAimAt] = useState<number | null>(null);
  const [subbing, setSubbing] = useState<SlotRef | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [q, setQ] = useState("");
  const [filterTeam, setFilterTeam] = useState(0);
  const [sort, setSort] = useState("sel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shutMenu = useCallback(() => setMenu(null), []);

  const lock = poolLock(pool);
  const cap = movesAllowed(pool.moves);
  const slots = useMemo(() => toSlots(team, byId), [team, byId]);

  const done = pairs.filter((p) => p.in) as (Pair & { in: number })[];
  const outIds = done.map((p) => p.out);
  const inIds = done.map((p) => p.in);
  const allOut = pairs.map((p) => p.out);
  const holes = pairs.filter((p) => !p.in);
  const aiming = holes.find((p) => p.out === aimAt) ?? holes[0] ?? null;
  const aimPos = aiming ? byId.get(aiming.out)?.pos : undefined;
  const incoming = new Map(done.map((p) => [p.in, p]));

  // Everyone the working team holds, minus the players still waiting to be
  // replaced: they are on the way out, so they no longer stand in anyone's way.
  const owned = useMemo(() => new Set(hostIds(team)), [team]);
  // What is actually left, which is what gets saved beside the team. Whether it
  // is allowed to run out is the pool's rule; what it holds is not.
  const bankLeft = fundsLeft(squad, allOut, inIds, byId);
  const funds = pool.budget ? bankLeft : Infinity;
  const value = squadValue(team, byId);
  const clubs = clubCounts(hostIds(team), byId);
  const stacked = Object.entries(clubs)
    .map(([t, n]) => [Number(t), n] as [number, number])
    .filter(([, n]) => n > MAXCLUB);

  /** What the crowd has asked for, for the host to take or leave. Only the
   *  swaps this team can still make: one already done is not a suggestion. */
  const crowd = useMemo(
    () => crowdTransfers(votes, team, byId, pool.moves).swaps
      .filter((s) => owned.has(s.out.id) && !owned.has(s.in.id))
      .slice(0, CROWD_ROWS),
    [votes, team, byId, pool.moves, owned],
  );

  /* ================= transfers ================= */

  function takeOut(id: number) {
    setMenu(null);
    setSubbing(null);
    setPairs((prev) => (prev.some((p) => p.out === id)
      ? prev
      : [...prev, { out: id, in: null, wasCaptain: team.captain === id, wasVice: team.vice === id }]));
    setAimAt(id);
    setQ("");
  }

  /** The signing lands in the slot the sale left, so the shape never moves.
   *  An armband does not transfer with it: buying a player is not a decision to
   *  captain him, which is `applyTransfers`' rule and this is the same one. */
  function bringIn(p: Player) {
    if (!aiming || blockedReason(p)) return;
    const out = aiming.out;
    setTeam((prev) => applyTransfers(prev, [out], [p.id], prev.captain === out ? null : prev.captain));
    setPairs((prev) => prev.map((x) => (x.out === out ? { ...x, in: p.id } : x)));
    setAimAt(null);
    setQ("");
  }

  /** Undo one transfer, filled or not, and give back the armbands it took. */
  function putBack(out: number) {
    setMenu(null);
    const pair = pairs.find((p) => p.out === out);
    if (pair?.in) {
      const back = pair.in;
      setTeam((prev) => {
        const restored = applyTransfers(prev, [back], [out], prev.captain === back ? null : prev.captain);
        return {
          ...restored,
          captain: pair.wasCaptain ? out : restored.captain,
          vice: pair.wasVice ? out : restored.vice,
        };
      });
    }
    setPairs((prev) => prev.filter((p) => p.out !== out));
    setAimAt((cur) => (cur === out ? null : cur));
  }

  /** Change your mind about the signing without changing your mind about the
   *  sale — the gap reopens and the rail aims at it again. */
  function clearIn(out: number) {
    setMenu(null);
    const pair = pairs.find((p) => p.out === out);
    if (!pair?.in) return;
    const back = pair.in;
    setTeam((prev) => applyTransfers(prev, [back], [out], prev.captain === back ? null : prev.captain));
    setPairs((prev) => prev.map((p) => (p.out === out ? { ...p, in: null } : p)));
    setAimAt(out);
    setQ("");
  }

  /** One of the crowd's swaps, taken whole. */
  function takeCrowd(s: SwapRank) {
    if (pairs.length >= cap || !owned.has(s.out.id) || owned.has(s.in.id)) return;
    setMenu(null);
    setSubbing(null);
    setTeam((prev) => applyTransfers(
      prev, [s.out.id], [s.in.id], prev.captain === s.out.id ? null : prev.captain,
    ));
    setPairs((prev) => [...prev, {
      out: s.out.id,
      in: s.in.id,
      wasCaptain: team.captain === s.out.id,
      wasVice: team.vice === s.out.id,
    }]);
    setAimAt(null);
  }

  /* ================= the arrangement ================= */

  /** Where a player stands in the picker's slot model, which is what decides
   *  whether he may swap with anybody. */
  function refOf(id: number): SlotRef | null {
    const pos = byId.get(id)?.pos;
    if (!pos) return null;
    const index = slots.p[pos].indexOf(id);
    return index < 0 ? null : { pos, index };
  }

  function sub(a: SlotRef, b: SlotRef) {
    setTeam((prev) => fromSlots(applySwap(toSlots(prev, byId), a, b), prev));
    setSubbing(null);
  }

  function setArmband(id: number, which: "captain" | "vice") {
    setTeam((prev) => ({
      ...prev,
      // The two cannot be the same player, so taking one hands back the other.
      captain: which === "captain" ? id : prev.captain === id ? 0 : prev.captain,
      vice: which === "vice" ? id : prev.vice === id ? 0 : prev.vice,
    }));
    setMenu(null);
  }

  /* ================= what is left to do ================= */

  const checks = transferChecklist(
    { out: outIds, in: inIds, captain: null },
    squad,
    byId,
    { moves: pool.moves, budget: pool.budget },
  );
  // The armband rows are the viewer's question, asked of a team whose shape
  // cannot move. This screen moves it, so the arrangement is checked whole.
  const todo = checks.filter((c) => !c.ok && c.key !== "captain" && c.key !== "capxi")
    .map((c) => ({ key: c.key, label: c.label }));
  const squadErrs = validateHostSquad(team, byId).map((label, i) => ({ key: `sq${i}`, label }));
  const pending = holes.length
    ? [{
        key: "holes",
        label: holes.length === 1
          ? `Choose a ${one(byId.get(holes[0].out)?.pos)} to come in for ${byId.get(holes[0].out)?.n ?? "him"}.`
          : `${holes.length} gaps still to fill.`,
      }]
    : [];
  const over = pairs.length > cap
    ? [{
        key: "cap",
        label: `That is ${pairs.length} transfers and you set this pool to ${movesLabel(pool.moves).toLowerCase()}. Put ${pairs.length - cap} back.`,
      }]
    : [];

  // Changing the fifteen under votes already cast would leave every one of them
  // pointing at a player who is no longer there, so the route refuses it until
  // voting is shut. Rearranging the same fifteen is always safe.
  const votesIn = votes.length;
  const transferBlocked = done.length > 0 && votesIn > 0 && !lock.locked;
  const blocked = [
    ...over,
    ...pending,
    ...todo,
    ...squadErrs,
    ...(transferBlocked
      ? [{
          key: "voting",
          label: `${votesIn === 1 ? "Someone has" : `${votesIn} viewers have`} voted on this team, so close the voting on the board before you make the transfer.`,
        }]
      : []),
  ];
  const changed = done.length > 0
    || team.captain !== squad.captain
    || team.vice !== squad.vice
    || team.xi.join() !== squad.xi.join()
    || team.bench.join() !== squad.bench.join();

  /* ================= the rail's list ================= */

  function blockedReason(p: Player): string | null {
    if (!aiming) return "Take a player out first";
    if (p.pos !== aimPos) return `You are replacing a ${POS[aimPos ?? 1]}`;
    if (owned.has(p.id)) return "Already in your team";
    if (pool.budget && p.cost > funds) return `More than the ${money(funds)} you have to spend`;

    // Counted against the team as it would stand: everyone on the way out, the
    // open gaps included, has already left it.
    const gone = new Set(allOut);
    const trial = clubCounts([...hostIds(team).filter((id) => !gone.has(id)), p.id], byId);
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

  /* ================= the pitch ================= */

  const decorate: Decorate = (id, starter) => {
    const player = byId.get(id);
    const ref = refOf(id);
    const pair = pairs.find((p) => p.out === id);

    // Mid-substitution the whole pitch answers one question: who does this
    // player swap with? Everything that is not a legal partner goes quiet.
    if (subbing && ref) {
      const chosen = subbing.pos === ref.pos && subbing.index === ref.index;
      const target = !chosen && !!swapFormation(slots, subbing, ref);
      return {
        className: chosen ? "chosen" : target ? "target" : "dim",
        title: chosen
          ? "Tap again to cancel the substitution"
          : target
            ? `Swap with ${player?.n ?? "him"}`
            : "This swap would not leave a legal team",
        onClick: chosen
          ? () => setSubbing(null)
          : target
            ? () => sub(subbing, ref)
            : undefined,
      };
    }

    if (pair && !pair.in) {
      const active = aiming?.out === pair.out;
      return {
        player: null,
        badge: null,
        className: `gap${active ? " aim" : ""}`,
        sub: player?.n ?? "out",
        subClass: "went",
        title: active
          ? `Choose a ${one(player?.pos)} to come in for ${player?.n ?? "him"}`
          : `Fill the gap ${player?.n ?? "he"} left`,
        onClick: () => setAimAt(pair.out),
        onRemove: () => putBack(pair.out),
      };
    }

    const arriving = incoming.get(id);
    return {
      className: arriving ? "arriving" : undefined,
      sub: arriving ? `for ${byId.get(arriving.out)?.n ?? "—"}` : money(player?.cost ?? 0),
      subClass: arriving ? "pct" : undefined,
      title: `${player?.n ?? "This player"}${starter ? "" : " (bench)"} — tap for the armband, a substitution or a transfer.`,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => setMenu({ id, anchor: e.currentTarget }),
      onRemove: arriving ? () => clearIn(arriving.out) : () => takeOut(id),
    };
  };

  const menuPlayer = menu ? byId.get(menu.id) : undefined;
  const menuStarter = menu ? team.xi.includes(menu.id) : false;
  const menuRef = menu ? refOf(menu.id) : null;
  const menuArriving = menu ? incoming.get(menu.id) : undefined;

  /* ================= saving ================= */

  async function save() {
    if (blocked.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pools/${pool.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ squad: { ...team, bank: Math.max(0, bankLeft) } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That team could not be saved.");
      router.push(`/p/${pool.id}/live`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That team could not be saved.");
      setBusy(false);
    }
  }

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
            <span className="lab">In the bank</span>
            <b className="num">{money(funds)}</b>
          </span>
        )}
        <span className="sep" />
        <span className={`meter${pairs.length > cap ? " over" : ""}`}>
          <span className="lab">Transfers</span>
          <b className="num">{pairs.length}/{cap}</b>
        </span>
        <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Back to the board</Link>
      </header>

      <main className="frame">
        {aiming ? (
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
        ) : subbing ? (
          <div className="subbar">
            <span>Tap the player to swap with — the shape follows.</span>
            <button className="btn btn-sm" onClick={() => setSubbing(null)}>Cancel</button>
          </div>
        ) : null}

        <SquadPitch
          squad={team}
          byId={byId}
          teams={teams}
          decorate={decorate}
          benchLabel={squad.entryName ? `${squad.entryName} · bench` : "Bench"}
        />
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">Squad</dt>
          <dd className="sm num">{money(value)}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Bank</dt>
          <dd className={`sm num${bankLeft < 0 ? " over" : ""}`}>{money(bankLeft)}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Shape</dt>
          <dd className="sm">{team.formation}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Captain</dt>
          <dd className="sm">{byId.get(team.captain)?.n ?? "—"}</dd>
        </dl>
        <span className="spacer" />
        {stacked.length > 0 && (
          <span className="chip warn">
            {stacked.map(([t, n]) => `${n} ${teams.get(t)?.sh ?? "?"}`).join(" · ")}
          </span>
        )}
        <span className="chip">Prices are today&apos;s, not your selling prices</span>
      </div>

      <aside className={`churn${sort === "pts" || sort === "form" ? " ptsort" : ""}`}>
        {crowd.length > 0 && !aiming && (
          <section className="mod">
            <h2>
              What the crowd wants
              <span className="spacer" />
              <span className="hint" style={{ letterSpacing: 0, textTransform: "none" }}>
                {votesIn === 1 ? "1 vote" : `${votesIn} votes`}
              </span>
            </h2>
            <div className="modbody">
              <ul className="swaplist">
                {crowd.map((s) => (
                  <li key={s.key}>
                    <span className="off">{s.out.n}</span>
                    <span className="arrow" aria-label="becomes">→</span>
                    <span className="on">{s.in.n}</span>
                    <button
                      className="btn btn-sm"
                      disabled={pairs.length >= cap}
                      title={pairs.length >= cap
                        ? `You have already made ${movesLabel(pool.moves).toLowerCase()}.`
                        : `Make it: ${s.out.n} out, ${s.in.n} in`}
                      onClick={() => takeCrowd(s)}
                    >
                      Make it
                    </button>
                  </li>
                ))}
              </ul>
              <p className="hint">
                Their vote, not your team. Nothing here happens until you tap it.
              </p>
            </div>
          </section>
        )}

        <section className="mod grow">
          <h2 className="vh">{aiming ? `Choose a ${POS[aimPos ?? 1]}` : "Players"}</h2>

          {pairs.length > 0 && (
            <div className="outband">
              <ul className="swaplist">
                {pairs.map((p) => {
                  const went = byId.get(p.out);
                  return (
                    <li key={p.out} className={aiming?.out === p.out ? "aim" : undefined}>
                      <span className="off">{went?.n}</span>
                      <span className="arrow" aria-label="becomes">→</span>
                      {p.in ? (
                        <span className="on">{byId.get(p.in)?.n}</span>
                      ) : (
                        <button className="on open" onClick={() => setAimAt(p.out)}>
                          Choose a {one(went?.pos)}
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-ghost"
                        aria-label={`Put ${went?.n ?? "him"} back`}
                        onClick={() => putBack(p.out)}
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
            {!aiming && (
              <p className="empty-note">
                Tap a shirt for the armband or a substitution. The × takes a player out, and this
                list becomes the players who could fill the gap he leaves.
              </p>
            )}
            {rows.map((p) => {
              const reason = blockedReason(p);
              return (
                <button
                  className="prow" key={p.id} disabled={!!reason}
                  title={reason ?? undefined} onClick={() => bringIn(p)}
                >
                  <Kit team={teams.get(p.team)} className="kit kitmini" mark={false} />
                  <span className="who">
                    <span className="n" title={reason ? undefined : p.n}>{p.n}</span>
                    <span className="m"><TeamMark team={teams.get(p.team)} /></span>
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
          <h2 className="vh">Save your team</h2>
          <div className="modbody">
            <p className="todo-note" id="host-ready" aria-live="polite">
              {blocked.map((c) => (
                <span key={c.key} className="tk bad">
                  <span aria-hidden="true">{c.label}</span>
                  <span className="said">{c.label}</span>
                </span>
              ))}
            </p>
            {error && <p className="err">{error}</p>}
            <button
              className="btn btn-primary btn-lg"
              onClick={save}
              disabled={busy || blocked.length > 0 || !changed}
              aria-describedby="host-ready"
              title={blocked.length ? blocked.map((c) => c.label).join(" ") : undefined}
            >
              {busy
                ? "Saving…"
                : blocked.length
                  ? blocked.length === 1
                    ? "One thing left before you can save"
                    : `${blocked.length} things left before you can save`
                  : changed
                    ? "Save my team"
                    : "Nothing changed yet"}
            </button>
            <p className="hint">
              This is the team your viewers see. Their votes stay on the board beside it.
            </p>
          </div>
        </section>
      </aside>

      {menu && menuPlayer && menuRef && !subbing && (
        <SlotMenu anchor={menu.anchor} onClose={shutMenu}>
          <div className="slotmenu-head">
            <b>{menuPlayer.n}</b>
            <div className="hint">
              {teams.get(menuPlayer.team)?.name} · {money(menuPlayer.cost)}
            </div>
          </div>
          {menuStarter && team.captain !== menuPlayer.id && (
            <MenuButton onClick={() => setArmband(menuPlayer.id, "captain")}>
              Make captain
            </MenuButton>
          )}
          {menuStarter && team.vice !== menuPlayer.id && (
            <MenuButton onClick={() => setArmband(menuPlayer.id, "vice")}>
              Make vice-captain
            </MenuButton>
          )}
          <MenuButton onClick={() => { setSubbing(menuRef); setMenu(null); }}>
            {menuStarter ? "Substitute" : "Bring on"}
          </MenuButton>
          {menuArriving ? (
            <MenuButton onClick={() => putBack(menuArriving.out)}>
              Undo this transfer
            </MenuButton>
          ) : (
            <MenuButton onClick={() => takeOut(menuPlayer.id)}>Transfer out</MenuButton>
          )}
        </SlotMenu>
      )}
    </div>
  );
}
