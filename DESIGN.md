---
name: Crowd XI
description: A broadcast board where the crowd's Fantasy Premier League team assembles live on stream.
colors:
  ground: "#F1EFF5"
  panel: "#FFFFFF"
  panel-2: "#F7F5FA"
  line: "#DFDAE8"
  line-soft: "#EBE7F1"
  text: "#1B1526"
  text-2: "#5C5370"
  text-3: "#8E85A3"
  hot: "#E5185F"
  hot-soft: "#FDE7EF"
  mint: "#0F9E6E"
  mint-soft: "#E2F7EF"
  gold: "#B87400"
  gold-soft: "#FFF2D9"
  cool: "#4B3FA8"
  pitch-a: "#0F6B45"
  pitch-b: "#12764C"
  frame: "#141020"
  frame-2: "#1B1530"
  frame-text: "#F2EEFA"
  frame-text-2: "#B0A6C6"
  frame-text-3: "#9B90B5"
typography:
  display:
    fontFamily: "Anton, sans-serif"
    fontSize: "clamp(46px, 7.4vw, 104px)"
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: "-0.015em"
  figure:
    fontFamily: "Anton, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.01em"
  label:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.16em"
  control:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  body:
    fontFamily: "Barlow, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  lede:
    fontFamily: "Barlow, sans-serif"
    fontSize: "clamp(16px, 1.35vw, 19px)"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "7px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "15px"
  lg: "16px"
  xl: "26px"
components:
  button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  button-primary:
    backgroundColor: "{colors.hot}"
    textColor: "#FFFFFF"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.text}"
    textColor: "#FFFFFF"
  button-on-frame:
    backgroundColor: "transparent"
    textColor: "{colors.frame-text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  chip:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  chip-live:
    backgroundColor: "{colors.hot}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  input:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "9px 11px"
  input-on-frame:
    backgroundColor: "rgba(255,255,255,0.05)"
    textColor: "{colors.frame-text}"
    rounded: "{rounded.sm}"
    padding: "9px 11px"
---

# Crowd XI — Design System

## Overview

**Result and Churn.** Every screen splits into two: a **frame** holding what the crowd
has settled, and a **churn rail** holding what is still moving. Strips run along the top
and bottom carrying state — live status, counts, the countdown, the shape, the armband.

The arrangement exists because of one fact about this product: the board goes on camera
while votes are still arriving. The category default is a single static pitch graphic
that looks identical whether four people have voted or four hundred. This system refuses
that. The frame is the answer; the rail is the argument still being had.

Content bleeds to the frame edge. There are no page margins, no floating cards, no
rounded container drifting on a ground — a broadcast graphic has none of those, and the
picker and the leaderboard inherit the board's vocabulary rather than reverting to app
chrome.

The type does the shouting and the colour does the signalling. Anton, uppercase, carries
every number a host would read out loud. Barlow Condensed carries labels and controls.
Barlow carries prose. Hot pink means live and nothing else.

## Colors

Two palettes, and they are not the same axis.

**The page palette** (`ground`, `panel`, `line`, `text`) flips with the viewer's theme.
Light and dark are both real: hosts run OBS scenes of either polarity and viewers arrive
with their own system setting.

**The frame palette** (`frame`, `frame-2`, `frame-text`) stays deep in both themes. The
frame is the artifact on camera — a pitch under floodlights is dark whichever way the
host's scene is lit. Anything inside `.frame`, `.churn`, `.strip` or `.foot` reads
against the frame palette, which is why controls in those regions get their own
treatment rather than inheriting the page's.

**Signal colours carry one meaning each and never trade places.**

| Token | Means |
|---|---|
| `hot` | Live. Vote share, the live chip, the primary action, the crowd's own row. |
| `mint` | Settled. A player already in the XI, a leader, a satisfied requirement. |
| `gold` | Attention without alarm. The armband, a rule about to break, mid-substitution. |
| `pitch-a` / `pitch-b` | The mown pitch, and nothing else. |

Club identity is **colour only** — no badges, no kit artwork, ever. Because of that,
colour can never be the only carrier of meaning anywhere else in the system: every state
needs a second cue in type, position or label.

## Typography

Three faces, three jobs, no overlap.

- **Anton**, uppercase — display headlines and every figure that matters: vote
  percentages, scores, the pool code, money, counts. If a host would say the number out
  loud, it is set in Anton with tabular numerals.
- **Barlow Condensed**, uppercase, tracked `0.16em` — structural labels on values and
  columns, and every control. Condensed earns its place: rail labels have to sit beside
  a number without stealing width from it.
- **Barlow** — prose, player names, table rows, hints.

Tabular numerals (`font-variant-numeric: tabular-nums`) are mandatory on anything that
updates in place. A percentage that shifts sideways as it changes is a percentage nobody
can read on a stream.

Labels sit *beside or beneath* the value they name, never above a heading. A label over
a heading is a kicker, and this system does not have kickers.

## Layout

One grid, four regions:

```
grid-template-areas: "head  head "
                     "frame churn"
                     "foot  churn"
grid-template-columns: minmax(0,1fr) clamp(310px, 25vw, 410px);
grid-template-rows:    46px minmax(0,1fr) auto;
```

- `.strip` (head) — identity, live state, counts, countdown, navigation.
- `.frame` — the settled result: the pitch, the table, the pitch of the argument.
- `.foot` — the facts under the frame: shape, armband, totals.
- `.churn` — the rail, spanning frame and foot rows, scrolling inside itself.

**Shell variants.** `.board.fixed` (live board) holds `100dvh` and never scrolls — it is
composited into a stream. `.board.app` (picker, leaderboard) also holds the viewport, but
the frame and rail each scroll internally. `.board.home` scrolls like a page with the
rail sticky beside it.

**Breakpoints.** At `1000px` the grid collapses to one column and the rail moves below
the foot. At `620px` the strip wraps to auto height and drops the pool-name chip and its
separators — navigation survives, decoration does not.

**Rail modules.** `.mod` blocks stack in the rail separated by hairlines. Exactly one
carries `.grow` and takes the leftover height with its own scroll; a module anchored with
`margin-top: auto` sits at the rail's foot and holds the primary action. Anything a host
must be able to read without scrolling belongs above the `.grow` module, never inside it.

## Elevation & Depth

Depth comes from **shadows with an offset and a real blur**, never from a colour halo:

```css
--shadow: 0 1px 2px rgba(27,21,38,.07), 0 8px 24px -12px rgba(27,21,38,.22);
```

Elevation is declared **once** per element — a border or a shadow, not both. Regions are
separated by 1px hairlines (`--line`, `--frame-line`), not by stacked cards.

The shirts carry their own depth: `drop-shadow(0 4px 7px rgba(0,0,0,.45))` lifts a kit
off the pitch, and the name plate under it takes `0 3px 9px rgba(0,0,0,.4)`. That pairing
is what makes a code-drawn shirt read as a deliberate object rather than as artwork that
failed to load.

## Shapes

Radii are small and consistent: `7px` on inputs and small controls, `10px` on buttons,
`14px` on the rare panel. Pills (`999px`) are for chips only.

The frame itself has **no radius**. Strips, the pitch, the rail and the table are square
to their edges — the composition is a broadcast frame, not a card.

Name plates on shirts take `4px`, effectively square, because they read as printed
labels.

## Components

**Slot** — a drawn shirt with a two-line plate beneath it: the player's name in Barlow
Condensed on the frame colour, then a sub-line. On results screens the sub-line is a vote
percentage on `hot`; in the picker it is a price. Slot width is a single custom property,
`--slot`, so one declaration rescales the whole board per surface
(on the broadcast board it takes the smaller of `7.2vw` and the height four rows have
left once the strip, the foot and the pitch's padding are paid for, so the forwards
cannot fall off a frame shorter than 1080; smaller again on the picker).

**Rank row** — a ranked contender: position code, name, club, percentage on the top line;
a progress bar with an optional gap note on the second. The bar animates with
`transform: scaleX()`, never `width`.

**Tick row** — one arriving entry: name, and how long ago it landed. Newest first, and
the newest row plays the `land` animation once.

**Strip meter** — a Barlow Condensed label beside an Anton figure. The pattern for every
number the host reads aloud.

**Chip** — uppercase Barlow Condensed in a pill. `.live` adds a pulsing dot and takes the
`hot` fill; `.name` is the one chip allowed to truncate and then disappear when the strip
runs out of room.

**Browser surfaces are part of the system.** Selection (`hot` on white), the caret
(`hot`), focus rings, and scrollbars are themed from the palette, and scrollbars inside
the frame and rail switch to the frame palette.

## Motion

One grammar: `320ms cubic-bezier(.2,.8,.2,1)` (`--dur` / `--ease`), with `150ms` for
immediate control feedback. Everything eases out from an already-visible default.

There is exactly **one authored moment**: a player crossing into the XI. The shirt plays
`arrive` on the pitch while its rail row plays `cross`, driven by diffing the previous XI
against the current one. Everything else is state feedback, not choreography.

`prefers-reduced-motion` collapses every animation and transition to `0.01ms`.

## Do's and Don'ts

**Do**

- Put anything a host reads aloud in Anton with tabular numerals.
- Give every state a second cue beyond colour — club identity is colour-only by
  constraint, so colour alone is already spent.
- Say which state the screen is in: live or locked, provisional or final, indicative or
  exact.
- Let content bleed to the frame edge.
- Number a sequence only when the order is the information (the three home-page steps).

**Don't**

- Don't put a label above a heading. The heading carries its own weight.
- Don't wrap regions in cards, and never nest one card in another.
- Don't animate `width`, `height`, `padding` or `margin`.
- Don't introduce a fifth colour meaning; `hot`, `mint` and `gold` are spoken for.
- Don't ship official club badges or kit artwork — club colours only, permanently.
- Don't present participation counts as exact. There are no accounts.
- Don't let a number reach the screen that the host cannot explain.
