import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crowd XI — the team your viewers picked",
  description:
    "Share one link with your audience. Every viewer builds a real FPL squad, and the most-picked XI and captain appear live on your results screen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
