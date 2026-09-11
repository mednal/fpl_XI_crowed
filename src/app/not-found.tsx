import Link from "next/link";

/** A mistyped URL lands here. `PoolMissing` handles the narrower "no such pool". */
export default function NotFound() {
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
            Nothing here
          </h1>
          <p className="lede" style={{ margin: "18px auto 26px", color: "var(--frame-text-2)" }}>
            That address does not match a page. If you were sent a pool link, check it was
            copied whole — the id is short and easy to clip.
          </p>
          <Link className="btn btn-primary btn-lg" href="/">Create a pool</Link>
        </div>
      </main>
    </div>
  );
}
