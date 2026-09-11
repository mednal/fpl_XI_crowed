"use client";

import { Bench, PitchRows, type SlotView } from "./Pitch";
import { POSITIONS, money } from "@/lib/squad";
import type { HostSquad, Player, PosId, Team } from "@/lib/types";

/**
 * How a screen wants one shirt to look. The pitch itself only knows where the
 * players stand; whether a shirt is being sold, arriving, or simply sitting
 * there is the caller's business — the transfer picker, the board and the setup
 * preview all draw the same fifteen and mean different things by them.
 */
export type Decorate = (id: number, starter: boolean) => Partial<SlotView>;

/**
 * A whole squad on the pitch, drawn from the players rather than from a stored
 * formation: after an import the two can disagree, and what is actually in the
 * XI is the thing worth trusting.
 */
export default function SquadPitch({
  squad,
  byId,
  teams,
  decorate,
  showBench = true,
  benchLabel,
}: {
  squad: HostSquad;
  byId: Map<number, Player>;
  teams: Map<number, Team>;
  decorate?: Decorate;
  showBench?: boolean;
  benchLabel?: string;
}) {
  const cell = (id: number, starter: boolean): SlotView => {
    const player = byId.get(id) ?? null;
    const base: SlotView = {
      player,
      pos: (player?.pos ?? 1) as PosId,
      sub: player ? money(player.cost) : "—",
      badge: id === squad.captain ? "C" : id === squad.vice ? "V" : null,
    };
    return { ...base, ...(decorate?.(id, starter) ?? {}) };
  };

  const rows: SlotView[][] = POSITIONS.map((k) =>
    (squad.xi ?? [])
      .filter((id) => byId.get(id)?.pos === k)
      .map((id) => cell(id, true)),
  ).filter((row) => row.length > 0);

  return (
    <>
      <PitchRows rows={rows} teams={teams} />
      {showBench && (
        <Bench
          cells={(squad.bench ?? []).map((id) => cell(id, false))}
          teams={teams}
          label={benchLabel}
        />
      )}
    </>
  );
}
