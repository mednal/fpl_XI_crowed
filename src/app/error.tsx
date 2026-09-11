"use client";

import Link from "next/link";

/**
 * The last line of defence for every route below it — including the live board,
 * which is on camera when it fails. So: the brand, one sentence a host can act
 * on, and a retry that does not cost them the tab. Next's default page is a
 * stack trace, which is not something to put on stream.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="board app">
      <header className="strip">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
      </header>
      <main className="frame wide">
        <div className="pagepad center">
          <h1 className="display" style={{ fontSize: "clamp(38px,6vw,68px)" }}>
            That did not load
          </h1>
          <p className="lede" style={{ margin: "18px auto 26px", color: "var(--frame-text-2)" }}>
            Something went wrong on our side. Nothing is lost — every team that has been
            submitted is saved. Try again, and if it keeps failing, reload the page.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-lg" onClick={reset}>Try again</button>
            <Link className="btn btn-lg" href="/">Start over</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
