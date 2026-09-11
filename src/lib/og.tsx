import { ImageResponse } from "next/og";

/**
 * The link preview. This product is one link pasted into a chat, so the card is
 * the first thing most viewers ever see of it — it has to look like the board.
 *
 * The fonts are fetched from Google at render time and the whole card degrades
 * to a default face if that fails, like every other outside call in the app.
 * Note the CSS request carries no browser User-Agent on purpose: Google then
 * answers with TrueType rather than woff2, which is the format Satori can read.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = "#141020";
const PAPER = "#F2EEFA";
const MUTED = "#B0A6C6";
const HOT = "#FF3D7F";

type Face = { name: string; data: ArrayBuffer; weight: 400 | 600 };

async function googleFont(family: string, weight: 400 | 600): Promise<Face | null> {
  try {
    const q = `${family.replace(/ /g, "+")}${weight === 400 ? "" : `:wght@${weight}`}`;
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${q}`).then((r) =>
      r.ok ? r.text() : "",
    );
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return { name: family, data: await res.arrayBuffer(), weight };
  } catch {
    return null;
  }
}

type Card = {
  /** The small line above the headline. Rendered in caps. */
  eyebrow: string;
  /** The headline, set in Anton like every other display line in the app. */
  title: string;
  /** The second headline line, in the accent colour. Optional. */
  accent?: string;
  /** One sentence under the headline. */
  note: string;
};

export async function ogCard({ eyebrow, title, accent, note }: Card) {
  const faces = (await Promise.all([googleFont("Anton", 400), googleFont("Barlow", 600)])).filter(
    (f): f is Face => f !== null,
  );
  const display = faces.some((f) => f.name === "Anton") ? "Anton" : undefined;
  const body = faces.some((f) => f.name === "Barlow") ? "Barlow" : undefined;

  // A host names their pool whatever they like. Step the headline down rather
  // than let a long name run off the card.
  const longest = Math.max(title.length, accent?.length ?? 0);
  const titleSize = longest > 30 ? 58 : longest > 20 ? 70 : 84;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          color: PAPER,
          padding: 64,
          fontFamily: body,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 20, height: 20, borderRadius: 20, background: HOT }} />
          <div style={{ fontSize: 25, letterSpacing: 5, color: MUTED }}>
            {eyebrow.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", fontFamily: display, lineHeight: 0.94 }}>
            <div style={{ fontSize: titleSize }}>{title.toUpperCase()}</div>
            {accent && <div style={{ fontSize: titleSize, color: HOT }}>{accent.toUpperCase()}</div>}
          </div>
          <div style={{ fontSize: 29, color: MUTED, marginTop: 26, maxWidth: 860, lineHeight: 1.4 }}>
            {note}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 24, letterSpacing: 2, color: MUTED }}>
            £100.0M · 15 PLAYERS · 3 PER CLUB
          </div>
          <div style={{ flexGrow: 1 }} />
          {/* The eleven, the same shape the home page draws them in. */}
          <div style={{ display: "flex", gap: 9 }}>
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} style={{ width: 22, height: 27, borderRadius: 4, background: HOT }} />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: faces.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: "normal" as const })) },
  );
}
