import Link from "next/link";

/** The same dead end on all three pool routes, so a bad link always reads the same. */
export default function PoolMissing({ note }: { note?: string }) {
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
            Pool not found
          </h1>
          <p className="lede" style={{ margin: "18px auto 26px", color: "var(--frame-text-2)" }}>
            {note ?? "That link does not match any pool."}
          </p>
          <Link className="btn btn-primary btn-lg" href="/">Create a pool</Link>
        </div>
      </main>
    </div>
  );
}
