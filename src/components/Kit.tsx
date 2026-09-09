"use client";

import { BADGE_ASSETS, FALLBACK_KIT, KIT_ASSETS, KIT_COLORS, badgeSrc, kitSrc } from "./assets";
import type { Team } from "@/lib/types";

/**
 * A shirt. Uses your artwork when the club is listed in the manifest, and
 * otherwise draws one — the drawn version is a single SVG path tinted with the
 * club's colours, so all twenty look right with no files at all.
 */
export function Kit({ team, className = "kit" }: { team?: Team | null; className?: string }) {
  const short = team?.sh;

  if (short && KIT_ASSETS.has(short)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={kitSrc(short)} alt={`${team!.name} shirt`} />;
  }

  const [body, trim] = (short && KIT_COLORS[short]) || FALLBACK_KIT;
  return (
    <svg className={className} viewBox="0 0 64 62" aria-hidden="true">
      <path
        d="M20 6 C24 12 40 12 44 6 L56 11 L62 26 L50 31 L50 57 C42 59.5 22 59.5 14 57 L14 31 L2 26 L8 11 Z"
        fill={body} stroke="rgba(0,0,0,.28)" strokeWidth="1.4"
      />
      <path
        d="M20 6 C24 12 40 12 44 6 L40 4 C36 8 28 8 24 4 Z"
        fill={trim} stroke="rgba(0,0,0,.18)" strokeWidth="1"
      />
      <path
        d="M14 31 L2 26 L4.5 20 L14 24 Z M50 31 L62 26 L59.5 20 L50 24 Z"
        fill={trim} opacity=".85"
      />
    </svg>
  );
}

/** A club badge where artwork exists, otherwise the three-letter code. */
export function TeamMark({ team }: { team?: Team | null }) {
  if (!team) return null;
  if (BADGE_ASSETS.has(team.sh)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="club-badge" src={badgeSrc(team.sh)} alt={team.name} />;
  }
  return <>{team.sh}</>;
}
