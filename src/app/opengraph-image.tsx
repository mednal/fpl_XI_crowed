import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Crowd XI — the team your viewers picked";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogCard({
    eyebrow: "Crowd XI",
    title: "A whole audience,",
    accent: "one eleven.",
    note: "Share one link. Every viewer builds a real FPL squad, and the most-picked XI appears live on your stream.",
  });
}
