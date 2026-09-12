"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SquadPitch from "./SquadPitch";
import TeamPicker from "./TeamPicker";
import { TeamMark } from "./Kit";
import { money } from "@/lib/squad";
import { DEFAULT_MOVES, MOVE_CHOICES, movesLabel, squadValue } from "@/lib/transfers";
import type { Bootstrap, HostSquad, Pool } from "@/lib/types";

/** The team ID is the number in the URL of a manager's own FPL page. Hosts
 *  paste the whole URL as often as they paste the number, so both work. */
function readEntryId(input: string): number | null {
  const digits = input.match(/\d{1,9}/g);
  if (!digits) return null;
  // A pasted URL is .../entry/1234567/event/5 — the team is the first number.
  const n = Number(digits[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Where a transfer pool gets its team. Two ways in, because a host either has
 * an FPL side already — which is the whole point of the mode — or wants to put
 * up a team they have only imagined. The second reuses the picker viewers use,
 * so there is one set of squad rules on the site and not two.
 */
export default function HostSetup({ pool, boot }: { pool: Pool; boot: Bootstrap }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(boot.players.map((p) => [p.id, p])), [boot.players]);
  const teams = useMemo(() => new Map(boot.teams.map((t) => [t.id, t])), [boot.teams]);

  const [mode, setMode] = useState<"import" | "build">("import");
  const [entry, setEntry] = useState("");
  const [preview, setPreview] = useState<HostSquad | null>(pool.squad);
  const [busy, setBusy] = useState<"" | "import" | "save">("");
  const [error, setError] = useState("");
  const [moves, setMoves] = useState(pool.moves ?? DEFAULT_MOVES);

  // A pool that already has a team is being changed rather than set up, and
  // the wording has to say so — the host has a link out in circulation.
  const already = Boolean(pool.squad);

  async function importTeam() {
    const id = readEntryId(entry);
    if (!id) {
      setError("That is not an FPL team ID. Open your team on the FPL site and copy the number from the address bar.");
      return;
    }
    setBusy("import");
    setError("");
    try {
      const res = await fetch(`/api/fpl/entry/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That team could not be imported.");
      setPreview(data.squad as HostSquad);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That team could not be imported.");
    } finally {
      setBusy("");
    }
  }

  /** How many transfers the crowd gets. The host chose a number when they
   *  opened the pool; this is where they think about it again, with the team
   *  they are putting up in front of them. */
  async function saveMoves(next: number) {
    const before = moves;
    setMoves(next);            // the select must not lag the pointer
    setError("");
    try {
      const res = await fetch(`/api/pools/${pool.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That allowance could not be saved.");
    } catch (e) {
      setMoves(before);
      setError(e instanceof Error ? e.message : "That allowance could not be saved.");
    }
  }

  async function save(squad: HostSquad) {
    setBusy("save");
    setError("");
    try {
      const res = await fetch(`/api/pools/${pool.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ squad }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That team could not be saved.");
      router.push(`/p/${pool.id}/live`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That team could not be saved.");
      setBusy("");
      // Thrown on so the picker, which has its own error line, shows it too.
      throw e;
    }
  }

  if (mode === "build") {
    return (
      <>
        <div className="setupback">
          <button className="btn btn-sm" onClick={() => setMode("import")}>
            ← Import from FPL instead
          </button>
          {error && <span className="err">{error}</span>}
        </div>
        <TeamPicker pool={pool} boot={boot} onHostSave={save} />
      </>
    );
  }

  const value = preview ? squadValue(preview, byId) : 0;

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
        <label className="chipsel">
          <span className="lab">Crowd gets</span>
          <select
            aria-label="Transfers each viewer may vote for"
            value={moves}
            disabled={busy !== ""}
            onChange={(e) => void saveMoves(Number(e.target.value))}
          >
            {MOVE_CHOICES.map((m) => <option key={m} value={m}>{movesLabel(m)}</option>)}
          </select>
        </label>
        {already && (
          <Link className="btn btn-sm" href={`/p/${pool.id}/live`}>Back to the board</Link>
        )}
      </header>

      <main className="frame">
        {preview ? (
          <>
            <div className="banner">
              <span>
                {preview.entryName
                  ? <>Imported <b>{preview.entryName}</b>{preview.manager ? ` — ${preview.manager}` : ""}.</>
                  : <>Your team, ready to go up.</>}
                {" "}Worth {money(value)}, with {money(preview.bank)} in the bank.
              </span>
            </div>
            <SquadPitch
              squad={preview}
              byId={byId}
              teams={teams}
              benchLabel="Bench"
            />
          </>
        ) : (
          <div className="pitch">
            <p className="empty-note" style={{ color: "var(--frame-text-2)", maxWidth: "38ch", margin: "0 auto" }}>
              Put your team up and your viewers vote on what to change about it. Import it from
              FPL, or build it here.
            </p>
          </div>
        )}
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">Squad</dt>
          <dd className="num">{preview ? money(value) : "—"}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Bank</dt>
          <dd className="num">{preview ? money(preview.bank) : "—"}</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Shape</dt>
          <dd className="sm">{preview?.formation ?? "—"}</dd>
        </dl>
        <span className="spacer" />
        <span className="chip">Prices are today&apos;s, not your selling prices</span>
      </div>

      <aside className="churn">
        <section className="mod">
          <h2>{already ? "Change the team" : "Your team"}</h2>
          <div className="modbody">
            <div className="field">
              <label htmlFor="entryid">Your FPL team ID</label>
              <div className="searchhead">
                <input
                  id="entryid"
                  type="text"
                  inputMode="numeric"
                  value={entry}
                  placeholder="e.g. 1234567"
                  onChange={(e) => setEntry(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void importTeam(); }}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={importTeam}
                  disabled={busy !== ""}
                >
                  {busy === "import" ? "Importing…" : "Import"}
                </button>
              </div>
              <p className="hint">
                Open your team on the official FPL site — the number in the address bar, after
                <code style={{ margin: "0 4px" }}>/entry/</code>, is your ID. Pasting the whole
                address works too.
              </p>
            </div>

            {error && <p className="err">{error}</p>}

            <button className="btn" onClick={() => setMode("build")} disabled={busy !== ""}>
              Build the team here instead
            </button>
          </div>
        </section>

        {preview && (
          <section className="mod">
            <h2>Squad</h2>
            <div className="modbody">
              <ul className="votelist">
                {[...(preview.xi ?? []), ...(preview.bench ?? [])].map((id, i) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  return (
                    <li className="voterow flat" key={id}>
                      <span className="nm">
                        {p.n}
                        {id === preview.captain && <b className="tag">C</b>}
                        {id === preview.vice && <b className="tag">V</b>}
                        {i >= 11 && <span className="hint"> sub</span>}
                      </span>
                      <span className="tm"><TeamMark team={teams.get(p.team)} /></span>
                      <span className="pc num">{money(p.cost)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <section className="mod send" style={{ borderBottom: 0 }}>
          <div className="modbody">
            <button
              className="btn btn-primary btn-lg"
              disabled={!preview || busy !== ""}
              onClick={() => preview && void save(preview).catch(() => {})}
            >
              {busy === "save" ? "Saving…" : already ? "Replace the team" : "Put this team up"}
            </button>
            <p className="hint">
              {already
                ? "A whole new team can go up while nobody has voted, or once you have closed the voting. To change the team you already have — a transfer, the armband, the bench — manage it from the board instead."
                : "Then you get the link to share. Viewers see this team and vote on the transfers you should make."}
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}
