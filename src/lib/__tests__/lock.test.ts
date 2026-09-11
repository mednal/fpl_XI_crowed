import { describe, expect, it } from "vitest";
import { parseDeadline, poolLock } from "@/lib/lock";

const NOW = Date.parse("2026-09-12T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const HOUR = 3600_000;

describe("poolLock — the closing time", () => {
  it("is open before the deadline", () => {
    expect(poolLock({ deadline: iso(HOUR), closed_at: null }, NOW)).toEqual({
      locked: false, why: "open", deadline: iso(HOUR),
    });
  });

  it("locks once the deadline has passed", () => {
    expect(poolLock({ deadline: iso(-1), closed_at: null }, NOW).locked).toBe(true);
    expect(poolLock({ deadline: iso(-1), closed_at: null }, NOW).why).toBe("deadline");
  });

  it("locks exactly on the deadline, not a moment after", () => {
    expect(poolLock({ deadline: iso(0), closed_at: null }, NOW).locked).toBe(true);
  });

  it("stays open when there is no deadline at all", () => {
    expect(poolLock({ deadline: null, closed_at: null }, NOW).locked).toBe(false);
  });

  it("stays open rather than throwing on a deadline it cannot read", () => {
    expect(poolLock({ deadline: "not a date", closed_at: null }, NOW).locked).toBe(false);
  });
});

describe("poolLock — the host's own close", () => {
  it("locks a pool the host closed, however far off the deadline is", () => {
    const lock = poolLock({ deadline: iso(48 * HOUR), closed_at: iso(-60_000) }, NOW);
    expect(lock).toEqual({ locked: true, why: "closed", deadline: iso(48 * HOUR) });
  });

  // A host closes a pool now; a viewer whose clock runs slow must not keep
  // sending teams into it, so the close is presence and never a comparison.
  it("locks even when the closing stamp reads as the future", () => {
    expect(poolLock({ deadline: iso(HOUR), closed_at: iso(5 * 60_000) }, NOW).locked).toBe(true);
  });

  it("reopens when the stamp is cleared", () => {
    expect(poolLock({ deadline: iso(HOUR), closed_at: null }, NOW).locked).toBe(false);
  });
});

describe("parseDeadline", () => {
  const fpl = iso(24 * HOUR);

  it("falls back to the FPL deadline when the host leaves it empty", () => {
    expect(parseDeadline("", fpl, NOW)).toEqual({ ok: true, iso: fpl });
    expect(parseDeadline(null, fpl, NOW)).toEqual({ ok: true, iso: fpl });
  });

  it("takes an earlier time and normalises it to an instant", () => {
    const got = parseDeadline(iso(2 * HOUR), fpl, NOW);
    expect(got).toEqual({ ok: true, iso: iso(2 * HOUR) });
  });

  it("takes the FPL deadline itself", () => {
    expect(parseDeadline(fpl, fpl, NOW)).toEqual({ ok: true, iso: fpl });
  });

  it("refuses a time past the FPL deadline — the game has started by then", () => {
    const got = parseDeadline(iso(24 * HOUR + 1000), fpl, NOW);
    expect(got.ok).toBe(false);
  });

  it("refuses a time already gone", () => {
    expect(parseDeadline(iso(-1000), fpl, NOW).ok).toBe(false);
    expect(parseDeadline(iso(0), fpl, NOW).ok).toBe(false);
  });

  it("refuses something that is not a date", () => {
    expect(parseDeadline("soon", fpl, NOW).ok).toBe(false);
  });

  it("accepts any future time when the FPL deadline is unknown", () => {
    expect(parseDeadline(iso(400 * HOUR), null, NOW)).toEqual({ ok: true, iso: iso(400 * HOUR) });
  });

  it("says what to do next in every refusal", () => {
    for (const bad of ["soon", iso(-1000), iso(48 * HOUR)]) {
      const got = parseDeadline(bad, fpl, NOW);
      expect(got.ok).toBe(false);
      if (!got.ok) expect(got.error).toMatch(/\.$/);
    }
  });
});
