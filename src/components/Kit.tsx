"use client";

import { useId } from "react";
import {
  BADGE_ASSETS, FALLBACK_KIT, KIT_ASSETS, KIT_COLORS, badgeSrc, kitSrc,
  type KitDef,
} from "./assets";
import type { Team } from "@/lib/types";

/* The shirt, in one coordinate system. Every x is mirrored about 32 so it hangs
   straight, and the sleeves are separate paths from the torso because that seam
   is where a club's identity usually lives: Arsenal's white sleeves and
   Newcastle's stripes are the same shirt with the cut read differently. */
const SHIRT =
  "M25.6 5C27.4 9.2 36.6 9.2 38.4 5L45.5 6.6L58.4 12.2L63 26.4L51.6 31.2L50.6 57.4" +
  "C43 59.6 21 59.6 13.4 57.4L12.4 31.2L1 26.4L5.6 12.2L18.5 6.6Z";
const TORSO =
  "M25.6 5C27.4 9.2 36.6 9.2 38.4 5L45.5 6.6L51.6 31.2L50.6 57.4" +
  "C43 59.6 21 59.6 13.4 57.4L12.4 31.2L18.5 6.6Z";
const SLEEVES = ["M45.5 6.6L58.4 12.2L63 26.4L51.6 31.2Z", "M18.5 6.6L5.6 12.2L1 26.4L12.4 31.2Z"];
const CUFFS = ["M63 26.4L51.6 31.2L50.8 27.9L62.2 23.1Z", "M1 26.4L12.4 31.2L13.2 27.9L1.8 23.1Z"];
const SEAMS = "M45.5 6.6L51.6 31.2M18.5 6.6L12.4 31.2";
const COLLAR = "M25.6 5C27.4 9.2 36.6 9.2 38.4 5L38.4 2.8C36.5 6.4 27.5 6.4 25.6 2.8Z";
/* The seams a shirt is actually sewn along. Without them the trim floats: a
   white collar on white sleeves has no edge of its own to be seen by. */
const NECKLINE = "M25.6 5C27.4 9.2 36.6 9.2 38.4 5";
const CUFF_SEAMS = "M50.8 27.9L62.2 23.1M13.2 27.9L1.8 23.1";
const HEM = "M13.3 55C21 57.2 43 57.2 50.7 55";

/** The torso, in the band coordinates a pattern is laid out across. */
const TORSO_X = 12.2, TORSO_W = 39.6, TORSO_Y = 4, TORSO_H = 55;

/** Perceived lightness, so ink and outlines can be picked rather than guessed. */
function lum(hex: string): number {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(((n >> 16) & 255) / 255)
    + 0.7152 * f(((n >> 8) & 255) / 255)
    + 0.0722 * f((n & 255) / 255);
}

/** The odd bands of a striped or hooped torso. The even ones are the body. */
function bands(kit: KitDef) {
  const n = Math.max(2, kit.n ?? 6);
  const vertical = kit.p === "bars";
  const step = (vertical ? TORSO_W : TORSO_H) / n;
  const out = [];
  for (let i = 1; i < n; i += 2) {
    out.push(
      vertical
        ? { x: TORSO_X + i * step, y: TORSO_Y, width: step, height: TORSO_H }
        : { x: TORSO_X, y: TORSO_Y + i * step, width: TORSO_W, height: step },
    );
  }
  return out;
}

/**
 * A shirt. Uses your artwork when the club is listed in the manifest, and
 * otherwise draws one from the club's colours and the cut of its kit — stripes,
 * hoops, contrast sleeves — so twenty clubs read as twenty clubs with no files
 * at all. `mark` prints the club's code across the chest, which is what tells
 * three plain red shirts apart; it is hidden by CSS below the size where it
 * would only be a smudge.
 */
export function Kit({
  team,
  className = "kit",
  mark = true,
}: {
  team?: Team | null;
  className?: string;
  mark?: boolean;
}) {
  const short = team?.sh;
  const uid = useId().replace(/:/g, "");

  if (short && KIT_ASSETS.has(short)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={kitSrc(short)} alt={`${team!.name} shirt`} />;
  }

  const kit = (short && KIT_COLORS[short]) || FALLBACK_KIT;
  const light = lum(kit.b) > 0.62;
  // A white shirt on a lit pitch needs a firmer edge than a claret one, or it
  // dissolves into the grass behind it.
  const edge = light ? "rgba(20,16,32,.42)" : "rgba(0,0,0,.3)";
  const ink = lum(kit.b) > 0.45 ? "#141020" : "#FFFFFF";
  const halo = ink === "#FFFFFF" ? "rgba(10,8,16,.55)" : "rgba(255,255,255,.6)";

  return (
    <svg className={className} viewBox="0 0 64 62" aria-hidden="true">
      <defs>
        <clipPath id={`t${uid}`}><path d={TORSO} /></clipPath>
        <linearGradient id={`s${uid}`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset=".2" stopColor="#fff" stopOpacity=".04" />
          <stop offset=".48" stopColor="#000" stopOpacity="0" />
          <stop offset=".8" stopColor="#000" stopOpacity=".1" />
          <stop offset="1" stopColor="#000" stopOpacity=".24" />
        </linearGradient>
      </defs>

      <path d={TORSO} fill={kit.b} />
      {kit.p && (
        <g clipPath={`url(#t${uid})`} fill={kit.a ?? kit.t}>
          {bands(kit).map((b, i) => <rect key={i} {...b} />)}
        </g>
      )}

      <g fill={kit.s ?? kit.b}>
        {SLEEVES.map((d, i) => <path d={d} key={i} />)}
      </g>
      <g fill={kit.t}>
        {CUFFS.map((d, i) => <path d={d} key={i} />)}
        <path d={COLLAR} />
      </g>

      <path d={SEAMS} fill="none" stroke="rgba(0,0,0,.16)" strokeWidth=".9" />
      <path d={CUFF_SEAMS} fill="none" stroke="rgba(0,0,0,.2)" strokeWidth=".8" />
      <path d={NECKLINE} fill="none" stroke="rgba(0,0,0,.24)" strokeWidth=".9" />
      <path d={HEM} fill="none" stroke="rgba(0,0,0,.13)" strokeWidth="2.4" />

      {mark && short && (
        <text
          className="mark" x="32" y="28.2" textAnchor="middle"
          fontFamily="'Barlow Condensed',sans-serif" fontSize="9.6" fontWeight="700"
          letterSpacing=".3" fill={ink} stroke={halo} strokeWidth="1.5"
          paintOrder="stroke" strokeLinejoin="round" opacity=".92"
        >
          {short}
        </text>
      )}

      <path d={SHIRT} fill={`url(#s${uid})`} />
      <path d={SHIRT} fill="none" stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
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
