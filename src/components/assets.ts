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
 * Club colours for the drawn shirts: [body, trim]. These are only used while a
 * club has no artwork, and are safe to tweak.
 */
export const KIT_COLORS: Record<string, [string, string]> = {
  ARS: ["#EF0107", "#FFFFFF"], AVL: ["#670E36", "#95BFE5"], BOU: ["#DA291C", "#000000"],
  BRE: ["#E30613", "#FFFFFF"], BHA: ["#0057B8", "#FFFFFF"], CHE: ["#034694", "#FFFFFF"],
  COV: ["#7BD3F0", "#1D1D48"], CRY: ["#1B458F", "#C4122E"], EVE: ["#003399", "#FFFFFF"],
  FUL: ["#F2F2F2", "#151515"], HUL: ["#F5A12D", "#151515"], IPS: ["#3A64A3", "#FFFFFF"],
  LEE: ["#F5F5F5", "#1D428A"], LIV: ["#C8102E", "#F6EB61"], MCI: ["#6CABDD", "#FFFFFF"],
  MUN: ["#DA291C", "#FBE122"], NEW: ["#2B2B2B", "#FFFFFF"], NFO: ["#DD0000", "#FFFFFF"],
  TOT: ["#F5F5F5", "#132257"], SUN: ["#EB172B", "#FFFFFF"],
  LUT: ["#F78F1E", "#1C2233"], SHU: ["#EE2737", "#000000"], BUR: ["#6C1D45", "#99D6EA"],
  WHU: ["#7A263A", "#1BB1E7"], WOL: ["#FDB913", "#231F20"], SOU: ["#D71920", "#FFFFFF"],
  NOR: ["#FFF200", "#00A650"], WAT: ["#FBEE23", "#ED2127"], LEI: ["#003090", "#FDBE11"],
};
export const FALLBACK_KIT: [string, string] = ["#B9B1C9", "#E6E1EE"];
