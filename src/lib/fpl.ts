import { unstable_cache } from "next/cache";
import type { Bootstrap, Gameweek, LiveStat, Player, PosId, Team } from "./types";

const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const LIVE_URL = (gw: number) => `https://fantasy.premierleague.com/api/event/${gw}/live/`;

/**
 * The slice of the FPL payload we actually read. It carries far more than this;
 * naming only what we depend on is what makes a field disappearing upstream a
 * type error here rather than an undefined on the board.
 */
type RawTeam = { id: number; short_name: string; name: string };

type RawElement = {
  id: number;
  web_name: string;
  element_type: number;
  team: number;
  now_cost: number;
  total_points: number;
  form: string;
  selected_by_percent: string;
  status: string;
  news?: string;
};

type RawEvent = {
  id: number;
  name: string;
  deadline_time: string;
  finished?: boolean;
  data_checked?: boolean;
  is_next?: boolean;
  is_current?: boolean;
};

type RawBootstrap = { teams: RawTeam[]; elements: RawElement[]; events: RawEvent[] };

type RawLive = { elements: { id: number; stats?: { total_points?: number; minutes?: number } }[] };

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
  const raw = (await res.json()) as RawBootstrap;

  const teams: Team[] = raw.teams.map((t) => ({
    id: t.id,
    sh: t.short_name,
    name: t.name,
  }));

  const players: Player[] = raw.elements
    .filter((e) => e.status !== "u")   // drop players who have left the league
    .map((e) => ({
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

  // Every gameweek, not just the next one: the scores page needs to know whether
  // the gameweek a pool was pinned to has finished, which is what decides
  // whether auto-subs have been applied yet.
  const events: Gameweek[] = raw.events.map((e) => ({
    id: e.id,
    name: e.name,
    deadline: e.deadline_time,
    finished: Boolean(e.finished && e.data_checked),
  }));

  const event =
    raw.events.find((e) => e.is_next) ??
    raw.events.find((e) => e.is_current) ??
    raw.events[0];

  return {
    gw: event.id,
    gwName: event.name,
    deadline: event.deadline_time,
    teams,
    players,
    events,
    fetchedAt: new Date().toISOString(),
  };
}

export const getBootstrap = unstable_cache(fetchBootstrap, ["fpl-bootstrap"], {
  revalidate: 3600,
  tags: ["fpl"],
});

/**
 * Points and minutes for every player in a gameweek. Minutes matter as much as
 * points: a starter on zero minutes is who the bench comes on for, and a captain
 * on zero minutes hands the armband to the vice.
 */
async function fetchLiveStats(gw: number): Promise<Record<number, LiveStat>> {
  const res = await fetch(LIVE_URL(gw), {
    headers: { "User-Agent": "crowd-xi/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FPL live API returned ${res.status}`);
  const raw = (await res.json()) as RawLive;
  const out: Record<number, LiveStat> = {};
  for (const el of raw.elements) {
    out[el.id] = { pts: el.stats?.total_points ?? 0, min: el.stats?.minutes ?? 0 };
  }
  return out;
}

export const getLiveStats = unstable_cache(fetchLiveStats, ["fpl-live"], {
  revalidate: 120,      // points move during matches, so this one stays fresh
  tags: ["fpl"],
});

/* ================= importing a manager's own team ================= */

type RawEntry = {
  id: number;
  name?: string;
  player_first_name?: string;
  player_last_name?: string;
  current_event?: number | null;
  last_deadline_bank?: number | null;
};

type RawPick = {
  element: number;
  position: number;          // 1-11 the XI, 12-15 the bench in sub order
  is_captain: boolean;
  is_vice_captain: boolean;
};

type RawPicks = {
  picks: RawPick[];
  entry_history?: { bank?: number };
};

/** Why an import did not work, in the words the host should read. */
export class FplEntryError extends Error {}

/**
 * A manager's real FPL team, by their team id.
 *
 * Both endpoints are the unauthenticated ones, which means one thing is missing:
 * a player's *selling* price is only served to the manager who owns him, behind
 * his login. Everything here therefore values a player at today's price, and the
 * screens say so. The bank is real — it comes back with the picks.
 *
 * Picks only exist for a gameweek that has started, so what is imported is the
 * team as it stood at the last deadline. That is exactly the team the crowd is
 * being asked to change, so it is the right one either way.
 *
 * Not cached: a host imports once, may fix their team on FPL and import again,
 * and would not understand an hour-old answer. The route above it is rate
 * limited instead.
 */
export async function getEntrySquad(entryId: number): Promise<{
  xi: number[];
  bench: number[];
  captain: number;
  vice: number;
  bank: number;
  entry: number;
  entryName: string | null;
  manager: string | null;
  gw: number;
}> {
  const headers = { "User-Agent": "crowd-xi/1.0" };

  const entryRes = await fetch(`https://fantasy.premierleague.com/api/entry/${entryId}/`, {
    headers,
    cache: "no-store",
  });
  if (entryRes.status === 404) {
    throw new FplEntryError(
      "No FPL team has that ID. It is the number in the URL when you open your own team on the FPL site.",
    );
  }
  if (!entryRes.ok) {
    throw new FplEntryError(
      "The FPL API is not responding, so that team could not be read. Try again shortly.",
    );
  }
  const entry = (await entryRes.json()) as RawEntry;

  const gw = entry.current_event ?? 0;
  if (!gw) {
    throw new FplEntryError(
      "That team has not played a gameweek yet, so there is no squad to import. Build the team here instead.",
    );
  }

  const picksRes = await fetch(
    `https://fantasy.premierleague.com/api/entry/${entryId}/event/${gw}/picks/`,
    { headers, cache: "no-store" },
  );
  if (!picksRes.ok) {
    throw new FplEntryError(
      "That team's squad could not be read from FPL. Try again shortly, or build the team here instead.",
    );
  }
  const data = (await picksRes.json()) as RawPicks;
  const picks = [...(data.picks ?? [])].sort((a, b) => a.position - b.position);
  if (picks.length !== 15) {
    throw new FplEntryError(
      "FPL returned an incomplete squad for that team. Try again shortly, or build the team here instead.",
    );
  }

  const captain = picks.find((p) => p.is_captain)?.element ?? picks[0].element;
  const vice = picks.find((p) => p.is_vice_captain)?.element ?? picks[1].element;
  const manager = [entry.player_first_name, entry.player_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    xi: picks.slice(0, 11).map((p) => p.element),
    bench: picks.slice(11).map((p) => p.element),
    captain,
    vice,
    bank: data.entry_history?.bank ?? entry.last_deadline_bank ?? 0,
    entry: entryId,
    entryName: entry.name?.trim() || null,
    manager: manager || null,
    gw,
  };
}
