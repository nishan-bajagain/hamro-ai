import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

// Self-hosted variable fonts (vendored under app/fonts/) so `next build`
// never needs network access to fonts.googleapis.com. Geist is OFL-licensed.
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "hamro.site — AI Gateway",
  description:
    "Free, open-access OpenAI-compatible AI gateway. One API key, four free coding models, automatic failover.",
  metadataBase: new URL("https://hamro.site"),
  openGraph: {
    title: "hamro.site — AI Gateway",
    description:
      "Free OpenAI-compatible AI gateway for coding agents with automatic failover.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#0a0c10] text-zinc-100">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
