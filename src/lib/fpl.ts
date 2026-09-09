import { unstable_cache } from "next/cache";
import type { Bootstrap, Player, PosId, Team } from "./types";

const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const LIVE_URL = (gw: number) => `https://fantasy.premierleague.com/api/event/${gw}/live/`;

/**
 * The raw FPL payload is about 2.3MB — over Next's 2MB response-cache limit, so
 * caching the fetch itself silently does nothing and every visitor would pull
 * the whole thing again. We fetch uncached, cut it down to the ~100KB the app
 * actually uses, and cache THAT. One upstream call per hour, for everybody.
 */
async function fetchBootstrap(): Promise<Bootstrap> {
  const res = await fetch(BOOTSTRAP_URL, {
    headers: { "User-Agent": "crowd-xi/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FPL API returned ${res.status}`);
  const raw = await res.json();

  const teams: Team[] = raw.teams.map((t: any) => ({
    id: t.id,
    sh: t.short_name,
    name: t.name,
  }));

  const players: Player[] = raw.elements
    .filter((e: any) => e.status !== "u")   // drop players who have left the league
    .map((e: any) => ({
      id: e.id,
      n: e.web_name,
      pos: e.element_type as PosId,
      team: e.team,
      cost: e.now_cost,
      pts: e.total_points,
      form: parseFloat(e.form) || 0,
      sel: parseFloat(e.selected_by_percent) || 0,
      st: e.status,
      news: e.news || "",
    }));

  const event =
    raw.events.find((e: any) => e.is_next) ??
    raw.events.find((e: any) => e.is_current) ??
    raw.events[0];

  return {
    gw: event.id,
    gwName: event.name,
    deadline: event.deadline_time,
    teams,
    players,
    fetchedAt: new Date().toISOString(),
  };
}

export const getBootstrap = unstable_cache(fetchBootstrap, ["fpl-bootstrap"], {
  revalidate: 3600,
  tags: ["fpl"],
});

/** Points scored by every player in a gameweek — used for the leaderboard. */
async function fetchLivePoints(gw: number): Promise<Record<number, number>> {
  const res = await fetch(LIVE_URL(gw), {
    headers: { "User-Agent": "crowd-xi/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FPL live API returned ${res.status}`);
  const raw = await res.json();
  const out: Record<number, number> = {};
  for (const el of raw.elements) out[el.id] = el.stats?.total_points ?? 0;
  return out;
}

export const getLivePoints = unstable_cache(fetchLivePoints, ["fpl-live"], {
  revalidate: 120,      // points move during matches, so this one stays fresh
  tags: ["fpl"],
});
