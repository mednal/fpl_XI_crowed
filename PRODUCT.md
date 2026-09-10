# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the FPL content creator.** A YouTube or Twitch channel with an audience in
the hundreds to low thousands, running a pool as a recurring gameweek segment. They
create the pool minutes before going live, drop the link in the description or chat,
and put the results screen on stream. They are mid-broadcast when they use it: talking
to camera, one hand on a scene switcher, unable to debug anything.

**Secondary: the viewer.** Arrives from a link, on a phone, mid-video, with no account
and no intention of making one. Builds a real squad and leaves. Their attention is
borrowed from the stream they were already watching, so every second the picker costs
is a second the creator is not being watched.

Small private groups (WhatsApp, work leagues, Discord) use the same product without a
stream. Supported, never allowed to break — but where the two conflict, the creator's
screen wins.

## Product Purpose

One host shares one link; every viewer builds a real FPL squad; the most-picked XI and
captain assemble live on a results screen the host puts on stream. After the gameweek
settles, a leaderboard shows what the crowd's XI actually scored against the people who
voted for it.

Success is a creator running it every gameweek without being asked to, because it
reliably produces a segment: a team nobody chose that everybody chose, and an argument
about whether the crowd is wiser than the individuals in it.

## Positioning

**A real squad under real rules, not a poll.** Viewers pick under the actual FPL
constraints — £100.0m, 15 players, maximum three per club, a legal formation — which a
poll, a Google Form, or a chat command cannot enforce. The output is therefore a team
that could genuinely be entered into FPL, and the crowd's aggregate is meaningful
because every input was legal. The scoring, the crowd-vs-field leaderboard, and the
realtime screen all rest on that: they are only interesting because the squad rules
were real.

## Operating Context

The results screen has to survive four viewing scenes at once, all of them confirmed
in use:

1. **OBS/Streamlabs browser source** — captured as a layer at a fixed size, often
   cropped or composited over a busy scene.
2. **Full-screen screen share** — owning a 1920×1080 frame, read at TV distance on a
   compressed stream.
3. **Second monitor, host reading aloud** — the audience may never see it; the host
   scans it and narrates, so detail and density earn their place here.
4. **Viewer phones** — the audience opens the live link themselves at ~390px.

These pull against each other: (2) wants scale and few elements, (3) wants density,
(1) wants the layout to hold when scaled and cropped, (4) wants a genuine small-screen
layout rather than a shrunken one. This tension is a permanent product fact, not a
problem to be solved once.

The pool itself is pinned to a single gameweek and dies at its deadline. Creation
happens under time pressure; picking happens during a live broadcast; the leaderboard
is read days later, once the gameweek has settled.

## Capabilities and Constraints

- Three surfaces: create a pool (`/`), pick a squad (`/p/[id]`), and the two host
  screens — the live crowd XI (`/p/[id]/live`) and the leaderboard (`/p/[id]/scores`).
- **No accounts.** Identity is a random id in a signed httpOnly cookie. This stops
  casual double-voting, not a determined person with private windows; counts are
  indicative, never exact, and must not be presented as exact.
- **Player data comes from the unauthenticated FPL API,** which can and does go down.
  Every screen must degrade to something explainable rather than crash or show zeros.
- **Deadlines are hard.** Once the gameweek deadline passes, no entry can be submitted
  or changed. The picker after the deadline is a read-only artifact.
- **The formation is an output.** Left alone, the crowd's shape falls out of the votes.
  A host may fix a shape when creating the pool, which changes the board only — never
  what a viewer may pick. No shape may be assumed anywhere.
- **Scoring is provisional until the gameweek settles.** Mid-gameweek, a player on nil
  minutes has usually just not kicked off; auto-subs and the vice-captain fallback only
  apply once FPL marks the event finished and checked. The board must say which state
  it is in.
- Terminology is FPL's own and must not be softened: gameweek, XI, bench, armband,
  captain, vice, GKP/DEF/MID/FWD, auto-subs, price in millions.
- Money is FPL tenths internally (`1000` = £100.0m) and always displayed as millions.

## Brand Commitments

- **Name: Crowd XI.**
- **No official club artwork, ever.** Premier League club badges and kit designs are
  licensed IP this product will not ship. **Club colours only** — identity on the pitch
  comes from accurate colour pairs and drawn shirt patterns. Milestone 4's kit and badge
  PNG manifests exist, but the shipped default is the code-drawn shirt, and it has to
  look deliberate rather than like artwork that failed to load.
- A host may set their own channel logo (`CHANNEL_LOGO`). The product's identity has to
  hold with and without it, and must not fight a creator's brand when it is present.

## Evidence on Hand

- Live FPL data — real players, prices, deadlines, points and minutes — is available at
  runtime and is the only real content the product has.
- **No logo, no artwork, no photography, no illustration in `public/` (it is empty).**
- **No users, no testimonials, no case studies, no press, no usage numbers, no channel
  partners.** Nothing downstream may invent a creator name, a viewer count, a quote, or
  a screenshot of a stream that never happened.
- Not deployed; no public URL and no pricing. It is free with no billing of any kind,
  and no plan or tier may be implied.

## Product Principles

1. **The rules are the product.** Anything that makes the squad less real — a relaxed
   constraint, a friendlier shortcut — removes the reason the crowd's XI is worth
   showing.
2. **The stream screen is the deliverable.** The picker exists to feed it. When the two
   compete for effort or clarity, the screen going on camera wins.
3. **A borrowed minute.** The viewer is mid-video and came from someone else's content.
   Picking must be fast, fun and finishable on a phone in one sitting.
4. **Degrade, never crash.** The FPL API, the network, and the deadline all fail in
   public, in front of an audience. Every failure state gets a real designed answer
   that says what is happening and what to do next.
5. **Say which state you are in.** Provisional versus settled, live versus locked,
   indicative versus exact — a number on stream that the host cannot explain is worse
   than no number.

## Accessibility & Inclusion

- The live board must be legible at TV distance on a compressed stream *and* at ~390px
  on a phone. Both are shipped scenes, not a primary and a fallback.
- Light and dark are both real: hosts run OBS scenes of either polarity, and viewers
  arrive with their own system setting.
- Colour alone can never carry meaning. Club identity is colour-only by constraint, so
  every club, state and score signal needs a second, non-colour cue.
- Reduced motion is honoured; the live screen animates in front of an audience that did
  not choose to watch it.
