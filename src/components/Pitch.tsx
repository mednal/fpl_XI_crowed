"use client";

import { Kit } from "./Kit";
import { POS } from "@/lib/squad";
import type { Player, PosId, Team } from "@/lib/types";

export type SlotView = {
  player: Player | null;
  pos: PosId;
  sub?: string;            // the line under the name — a price, or a percentage
  subClass?: string;
  badge?: "C" | "V" | null;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

export function Slot({ view, teams }: { view: SlotView; teams: Map<number, Team> }) {
  const p = view.player;
  const team = p ? teams.get(p.team) ?? null : null;
  const className = `slot${p ? "" : " empty"}`;

  const inner = (
    <>
      {view.badge ? (
        <span className={`badge${view.badge === "V" ? " v" : ""}`}>{view.badge}</span>
      ) : null}
      <Kit team={team} />
      <span className="plate">
        <span className="nm">{p ? p.n : POS[view.pos]}</span>
        <span className={`sub${view.subClass ? " " + view.subClass : ""}`}>
          {view.sub ?? " "}
        </span>
      </span>
    </>
  );

  // A slot is a button only when it does something — results screens are read-only.
  if (!view.onClick) {
    return <div className={className} title={view.title}>{inner}</div>;
  }
  return (
    <button type="button" className={className} title={view.title} onClick={view.onClick}>
      {inner}
    </button>
  );
}

export function PitchRows({
  rows,
  teams,
}: {
  rows: SlotView[][];
  teams: Map<number, Team>;
}) {
  return (
    <div className="pitch">
      {rows.map((cells, i) => (
        <div className="row" key={i}>
          {cells.map((c, j) => (
            <Slot view={c} teams={teams} key={j} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Bench({ cells, teams }: { cells: SlotView[]; teams: Map<number, Team> }) {
  return (
    <div className="bench">
      <div className="benchlabel eyebrow">Bench · substitutes in order</div>
      <div className="row">
        {cells.map((c, j) => (
          <Slot view={c} teams={teams} key={j} />
        ))}
      </div>
    </div>
  );
}
