---
version: 1
slug: "src-app-p-id-live-page-tsx"
primary_target: "src/app/p/[id]/live/page.tsx"
related_targets: ["src/app/p/[id]/page.tsx","src/app/p/[id]/scores/page.tsx","src/app/page.tsx"]
---

Scope: the four Crowd XI surfaces — live board (lead), picker, leaderboard, home.
Visitor mode: Experience on the live board; Operate on the picker and leaderboard; Persuade on the home page.
Audience and job: an FPL content creator putting the board on stream, and viewers picking a squad from a link.
Pinned by the user: type stack and palette unchanged; FPL vocabulary unchanged.
Drawn shirts: no longer pinned. The user asked for them to be made distinguishable (2026-09-10); the kit system in DESIGN.md is now the authority.
Copy is open to rewriting; factual statements and FPL terms stay.

## Direction contract

THESIS: The board owns the split between what the crowd has settled and what is still
moving. It refuses the arrangement this category always ships — one static pitch
graphic that looks identical whether four people have voted or four hundred.

OWN-WORLD: The incumbent palette and type, committed harder. Anton uppercase for every
number that matters, Barlow Condensed for rail labels, tabular numerals throughout.
Hot pink is the live signal and nothing else; mint marks what has settled. Hairline
rules separate frame from rail. Drawn kits unchanged, drawn larger. Broadcast strips
top and bottom, content bleeding to the frame edge — no page margins, no cards.

STORY: The viewer understands within seconds that this is a live result rather than a
poll, sees which players are about to cross in, and shares the pool code.

FIRST VIEWPORT: Twelve columns, no scroll at 1920x1080. A full-width strip carries pool
code, countdown and entry count. Columns 0-7 hold the eleven at broadcast scale on the
drawn pitch, percentages under each shirt. Columns 8-11 are the rail: "arriving now"
above, "on the bubble" below, share link anchored at its foot as the primary action.
Formation and captain sit in a bottom strip under the frame.

SIGNATURE INTERACTION: a player crossing the cut travels from the rail into the frame —
one orchestrated position transition, not a fade. The rail ticks as entries land.
Motion grammar: everything moves on the same 320ms cubic-bezier(.2,.8,.2,1); nothing
else animates.

FORM: Result and Churn, index 4 of 7 on the ordered list, dealt lead. Seed key 9cf35df1.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
