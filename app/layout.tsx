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
  title: "Hamro AI — AI, Made Simple",
  description:
    "Free, open-access AI chat and gateway. One public key, dozens of free models across ten providers, automatic failover — for people and for coding agents.",
  metadataBase: new URL("https://hamro.site"),
  applicationName: "Hamro AI",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Hamro AI — AI, Made Simple",
    description:
      "Chat with free AI models or point your coding agent at the gateway — one key, automatic failover.",
    type: "website",
    siteName: "Hamro AI",
  },
  twitter: {
    card: "summary",
    title: "Hamro AI — AI, Made Simple",
    description:
      "Free AI chat and gateway with automatic failover across ten providers.",
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
      <body className="min-h-full bg-[#fafafa] text-zinc-900">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
