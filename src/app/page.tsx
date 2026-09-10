import { getBootstrap } from "@/lib/fpl";
import { isConfigured } from "@/lib/supabase";
import CreatePool from "@/components/CreatePool";
import type { Bootstrap } from "@/lib/types";

export const revalidate = 3600;

export default async function Home() {
  let gwName = "the next gameweek";
  let deadline: string | null = null;
  let boot: Bootstrap | null = null;

  try {
    boot = await getBootstrap();
    gwName = boot.gwName;
    deadline = boot.deadline;
  } catch {
    boot = null;
  }

  return (
    <div className="board home">
      <header className="strip">
        <span className="brand">
          <span className="dot" />
          Crowd XI
        </span>
        <span className="sep" />
        <span className="chip name">{gwName}</span>
        <span className="spacer" />
        <a className="btn btn-sm btn-primary" href="#create">Create a pool</a>
      </header>

      <main className="frame">
        {!isConfigured && (
          <p className="banner">
            Supabase is not connected yet, so pools cannot be saved. Add your keys to
            <code style={{ margin: "0 5px" }}>.env.local</code> and restart the dev server.
          </p>
        )}
        {!boot && (
          <p className="banner">
            The official FPL API is not answering just now. Player prices and the deadline load
            as soon as it does.
          </p>
        )}

        <div className="homehead">
          <div className="band">
            <h1>
              A whole audience, <em>one eleven</em>.
            </h1>
            <p>
              Every viewer builds a real FPL squad under the real rules — £100.0m, fifteen
              players, three to a club. What they pick most becomes the team on your screen.
            </p>
          </div>
          <ol className="seq">
            <li>
              <span className="n">1</span>
              <span>Open a pool</span>
            </li>
            <li>
              <span className="n">2</span>
              <span>Share the link</span>
            </li>
            <li>
              <span className="n">3</span>
              <span>Put the board on stream</span>
            </li>
          </ol>
        </div>

        <figure className="mech">
          <svg viewBox="0 0 860 258" role="img" aria-label="Many viewers' squads converging into one eleven">
            <text className="axis" x="0" y="16">Every viewer&apos;s squad</text>
            <text className="axis" x="640" y="16">The crowd XI</text>
            <g fill="var(--frame-text-3)" opacity=".55">
              {Array.from({ length: 8 }).map((_, col) =>
                Array.from({ length: 6 }).map((__, row) => (
                  <rect key={`${col}-${row}`} x={col * 26} y={54 + row * 34} width="15" height="19" rx="2" />
                )),
              )}
            </g>
            <g stroke="var(--frame-line)" fill="none" strokeWidth="1">
              {Array.from({ length: 6 }).map((_, row) => (
                <path key={row} d={`M 218 ${63 + row * 34} C 400 ${63 + row * 34}, 440 150, 636 150`} />
              ))}
            </g>
            <g fill="var(--hot)">
              {Array.from({ length: 11 }).map((_, i) => (
                <rect key={i} x={648 + (i % 4) * 52} y={96 + Math.floor(i / 4) * 44} width="34" height="30" rx="3" />
              ))}
            </g>
          </svg>
          <figcaption>
            Every squad that arrives is counted player by player. The eleven most-picked names,
            in a legal shape, become <b>the crowd XI</b> — and it updates on your results screen
            while the votes are still coming in.
          </figcaption>
        </figure>
      </main>

      <div className="foot">
        <dl>
          <dt className="lab">Budget</dt>
          <dd className="num">£100.0m</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Squad</dt>
          <dd className="num">15</dd>
        </dl>
        <span className="sep" />
        <dl>
          <dt className="lab">Per club</dt>
          <dd className="num">3</dd>
        </dl>
        <span className="spacer" />
        <span className="chip">Players and prices from the official FPL game</span>
      </div>

      <aside className="churn" id="create">
        <CreatePool gwName={gwName} deadline={deadline} />
      </aside>
    </div>
  );
}
