/**
 * When a pool takes teams. Two things shut one: the closing time — the official
 * FPL deadline unless the host picked an earlier one — and the host closing it
 * by hand, which is the button they reach for when the segment is over and the
 * board has to stop moving. Pure, and read by the picker, the board and the
 * route that actually decides, so the three cannot disagree about whether a
 * pool is open.
 */

export type LockFields = { deadline: string | null; closed_at: string | null };

export type Lock = {
  locked: boolean;
  /** Why it is shut, which is the sentence the reader gets. */
  why: "open" | "closed" | "deadline";
  /** When it shuts on its own, if the host has not shut it first. */
  deadline: string | null;
};

export function poolLock(pool: LockFields, now: number = Date.now()): Lock {
  // Presence, not a comparison against the clock: the host closes a pool *now*,
  // and a browser running a minute slow must not go on taking teams.
  if (pool.closed_at) return { locked: true, why: "closed", deadline: pool.deadline };

  const t = pool.deadline ? new Date(pool.deadline).getTime() : NaN;
  if (Number.isFinite(t) && t <= now) {
    return { locked: true, why: "deadline", deadline: pool.deadline };
  }
  return { locked: false, why: "open", deadline: pool.deadline };
}

/** What a viewer is told when their team will not go in. */
export function lockNote(why: Lock["why"]): string {
  if (why === "closed") return "The host has closed this pool, so teams are locked.";
  if (why === "deadline") return "The deadline for this gameweek has passed, so teams are locked.";
  return "";
}

export type Parsed = { ok: true; iso: string | null } | { ok: false; error: string };

/**
 * A host's own closing time. Empty means the official FPL deadline, which is
 * both the default and the latest a pool may run: past it the real game has
 * started and prices have moved, so a team arriving then is not one anybody
 * could have fielded.
 */
export function parseDeadline(
  input: string | null | undefined,
  fplDeadline: string | null,
  now: number = Date.now(),
): Parsed {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, iso: fplDeadline };

  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) {
    return { ok: false, error: "That closing time is not a date. Pick one from the calendar." };
  }
  if (t <= now) {
    return {
      ok: false,
      error: "Pick a closing time in the future. To stop the pool right now, close it by hand instead.",
    };
  }

  const cap = fplDeadline ? new Date(fplDeadline).getTime() : NaN;
  if (Number.isFinite(cap) && t > cap) {
    return {
      ok: false,
      error:
        "The gameweek locks at the official FPL deadline and the pool cannot run past it. Pick an earlier time.",
    };
  }
  return { ok: true, iso: new Date(t).toISOString() };
}
