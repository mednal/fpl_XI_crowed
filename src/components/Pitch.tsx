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
  /** Extra state class — how a slot looks mid-substitution. */
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Given only where a player can be taken out; draws the corner cross. */
  onRemove?: () => void;
};

export function Slot({ view, teams }: { view: SlotView; teams: Map<number, Team> }) {
  const p = view.player;
  const team = p ? teams.get(p.team) ?? null : null;
  const className = `slot${p ? "" : " empty"}${view.className ? " " + view.className : ""}`;

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
  const body = view.onClick ? (
    <button type="button" className={className} title={view.title} onClick={view.onClick}>
      {inner}
    </button>
  ) : (
    <div className={className} title={view.title}>{inner}</div>
  );

  if (!view.onRemove) return body;
  // The cross has to sit outside the slot: a button cannot contain a button.
  return (
    <div className="slotwrap">
      {body}
      <button
        type="button"
        className="slotx"
        title={p ? `Take ${p.n} out of the squad` : "Take out of the squad"}
        aria-label={p ? `Take ${p.n} out of the squad` : "Take out of the squad"}
        onClick={view.onRemove}
      >
        &times;
      </button>
    </div>
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

export function Bench({
  cells,
  teams,
  label,
}: {
  cells: SlotView[];
  teams: Map<number, Team>;
  /** What the row is, when it is not the viewer's own bench. */
  label?: string;
}) {
  return (
    <div className="bench">
      <div className="benchlabel lab">{label ?? "Bench · substitutes in order"}</div>
      <div className="row">
        {cells.map((c, j) => (
          <Slot view={c} teams={teams} key={j} />
        ))}
      </div>
    </div>
  );
}
