/**
 * Artwork manifest.
 *
 * Everything is drawn in code until you list a club here. To use your own
 * artwork: drop the file in `public/kits/` or `public/badges/` and add the
 * club's three-letter code to the matching set below. Clubs left out keep the
 * drawn shirt, so a part-finished set is fine.
 *
 *   public/kits/ARS.png      →  add "ARS" to KIT_ASSETS
 *   public/badges/ARS.png    →  add "ARS" to BADGE_ASSETS
 *
 * Shirts: transparent PNG, about 256×248, the shirt filling the frame.
 * Badges: transparent PNG or SVG, square, about 64×64.
 */
export const KIT_ASSETS = new Set<string>([
  // "ARS", "LIV", "MCI", ...
]);

export const BADGE_ASSETS = new Set<string>([
  // "ARS", "LIV", "MCI", ...
]);

/** Your channel logo, in `public/`. Set to null to show the plain mark. */
export const CHANNEL_LOGO: string | null = null;   // e.g. "/logo.png"

export const kitSrc = (short: string) => `/kits/${short}.png`;
export const badgeSrc = (short: string) => `/badges/${short}.png`;

/**
 * Club kits for the drawn shirts. Only used while a club has no artwork in
 * `KIT_ASSETS`, and safe to tweak.
 *
 *   b  body colour
 *   t  trim — the collar band and the cuffs
 *   s  sleeves, where a club's differ from its body
 *   p  a pattern across the torso: vertical `bars` or horizontal `hoops`
 *   a  the pattern's second colour
 *   n  how many bands the pattern has, counting both colours
 *
 * The band count is doing real work. Sunderland, Southampton and Sheffield
 * United all play in red and white stripes; broad, medium and narrow is what
 * tells them apart on a pitch, so it is what tells them apart here.
 */
export type KitPattern = "bars" | "hoops";

export type KitDef = {
  b: string;
  t: string;
  s?: string;
  p?: KitPattern;
  a?: string;
  n?: number;
};

export const KIT_COLORS: Record<string, KitDef> = {
  ARS: { b: "#EF0107", t: "#FFFFFF", s: "#FFFFFF" },
  AVL: { b: "#670E36", t: "#95BFE5", s: "#95BFE5" },
  BOU: { b: "#D71920", t: "#000000", s: "#0A0A0A", p: "bars", a: "#0A0A0A", n: 9 },
  BHA: { b: "#0057B8", t: "#FFFFFF", p: "bars", a: "#FFFFFF", n: 9 },
  BRE: { b: "#E30613", t: "#FFFFFF", p: "bars", a: "#FFFFFF", n: 7 },
  BUR: { b: "#6C1D45", t: "#99D6EA", s: "#99D6EA" },
  CHE: { b: "#034694", t: "#FFFFFF" },
  COV: { b: "#7BD3F0", t: "#1D1D48", s: "#1D1D48" },
  CRY: { b: "#1B458F", t: "#C4122E", p: "bars", a: "#C4122E", n: 5 },
  EVE: { b: "#00369C", t: "#FFFFFF" },
  FUL: { b: "#F4F4F4", t: "#151515" },
  HUL: { b: "#F5A12D", t: "#151515", s: "#151515", p: "bars", a: "#151515", n: 7 },
  IPS: { b: "#3A64A3", t: "#FFFFFF", s: "#FFFFFF" },
  LEE: { b: "#F6F6F6", t: "#FFCD00" },
  LEI: { b: "#003090", t: "#FDBE11" },
  LIV: { b: "#C8102E", t: "#F6EB61" },
  LUT: { b: "#F78F1E", t: "#1C2233", s: "#1C2233" },
  MCI: { b: "#6CABDD", t: "#FFFFFF" },
  MUN: { b: "#DA291C", t: "#111111" },
  NEW: { b: "#241F20", t: "#FFFFFF", p: "bars", a: "#FFFFFF", n: 7 },
  NFO: { b: "#DD0000", t: "#FFFFFF" },
  NOR: { b: "#FFF200", t: "#00A650", s: "#00A650" },
  QPR: { b: "#FFFFFF", t: "#1D5BA4", p: "hoops", a: "#1D5BA4", n: 7 },
  SHU: { b: "#EE2737", t: "#0A0A0A", p: "bars", a: "#FFFFFF", n: 11 },
  SOU: { b: "#D71920", t: "#FFFFFF", p: "bars", a: "#FFFFFF", n: 7 },
  SUN: { b: "#EB172B", t: "#1A1A1A", p: "bars", a: "#FFFFFF", n: 5 },
  TOT: { b: "#F7F7F7", t: "#132257" },
  WAT: { b: "#FBEE23", t: "#151515", s: "#151515" },
  WHU: { b: "#7A263A", t: "#1BB1E7", s: "#1BB1E7" },
  WOL: { b: "#FDB913", t: "#231F20" },
};

/** A club the manifest has never heard of still gets a shirt. */
export const FALLBACK_KIT: KitDef = { b: "#B9B1C9", t: "#E6E1EE" };
