import type { Metadata } from "next";
import "./globals.css";

/**
 * Where a shared link resolves from. Absolute URLs are what a chat client needs
 * to fetch the preview card, and it cannot ask us — so the deployment has to
 * know its own address. Vercel supplies its own; a custom domain sets
 * NEXT_PUBLIC_SITE_URL.
 */
const site =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Crowd XI — the team your viewers picked",
  description:
    "Share one link with your audience. Every viewer builds a real FPL squad, and the most-picked XI and captain appear live on your results screen.",
  openGraph: {
    type: "website",
    siteName: "Crowd XI",
    title: "Crowd XI — the team your viewers picked",
    description:
      "Share one link with your audience. Every viewer builds a real FPL squad, and the most-picked XI and captain appear live on your results screen.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* The rule this silences is about the pages router, where a font link
            in a page loaded on one page only. In the app router this sits in the
            root layout, so it applies to every route — which is the fix it asks
            for. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
