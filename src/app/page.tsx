import { getBootstrap } from "@/lib/fpl";
import { isConfigured } from "@/lib/supabase";
import CreatePool from "@/components/CreatePool";

export const revalidate = 3600;

export default async function Home() {
  let gwName = "the next gameweek";
  let deadline: string | null = null;
  let dataError = false;

  try {
    const boot = await getBootstrap();
    gwName = boot.gwName;
    deadline = boot.deadline;
  } catch {
    dataError = true;
  }

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <span className="dot" />
          Crowd XI
        </span>
      </div>

      {!isConfigured && (
        <div className="banner">
          Supabase is not connected yet, so pools cannot be saved. Add your keys to
          <code style={{ margin: "0 5px" }}>.env.local</code> — the README has the four steps.
        </div>
      )}
      {dataError && (
        <div className="banner">
          Could not reach the FPL API just now. Player prices will load once it responds.
        </div>
      )}

      <div className="home">
        <div className="hero">
          <div>
            <span className="eyebrow">Fantasy Premier League · {gwName}</span>
            <h1>
              Your viewers pick.
              <br />
              <em>One XI</em> comes out.
            </h1>
            <p className="lede">
              Share one link with your audience. Every viewer builds a real FPL squad — £100.0m,
              15 players, three per club. Your results screen shows the team the crowd actually
              chose, with the percentage next to every shirt, updating live while you stream.
            </p>
            <div className="steps">
              <div className="step">
                <span className="n">1</span>
                <span>
                  <b>Open a pool</b>
                  <span>Name it after the gameweek or the video.</span>
                </span>
              </div>
              <div className="step">
                <span className="n">2</span>
                <span>
                  <b>Drop the link in your description or chat</b>
                  <span>Viewers pick a squad and a captain — no account needed.</span>
                </span>
              </div>
              <div className="step">
                <span className="n">3</span>
                <span>
                  <b>Put the results screen on stream</b>
                  <span>
                    Most-picked keeper, then defence, midfield, attack — and the armband goes to
                    the top captain vote.
                  </span>
                </span>
              </div>
            </div>
          </div>

          <CreatePool gwName={gwName} deadline={deadline} />
        </div>
      </div>
    </>
  );
}
