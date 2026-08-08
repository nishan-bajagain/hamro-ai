import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
