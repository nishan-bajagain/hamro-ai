"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  BookOpenText,
  Check,
  Copy,
  MessageSquareText,
} from "lucide-react";
import { CLIENT_API_KEY } from "@/lib/client-config";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-panel/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Hamro AI home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-blue-700 text-sm font-black text-white shadow-sm shadow-blue-500/25">
            h
          </span>
          <span className="text-[15px] font-bold tracking-tight text-zinc-900">
            Hamro <span className="text-accent">AI</span>
          </span>
          <span className="hidden rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 sm:inline">
            Free AI
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <NavLink href="/chat" icon={<MessageSquareText className="h-4 w-4" />} label="Chat" />
          <NavLink href="/docs" icon={<BookOpenText className="h-4 w-4" />} label="Docs" />
          <NavLink href="/status" icon={<Activity className="h-4 w-4" />} label="Status" />
          <ApiKeyPill />
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-panel-2 hover:text-zinc-900"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

/** The public access key — safe to show; it is the shared gateway key. */
function ApiKeyPill() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(CLIENT_API_KEY).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy public API key"
      className="ml-1 hidden items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 py-1.5 font-mono text-xs text-zinc-600 transition-colors hover:border-edge-2 hover:text-zinc-900 md:inline-flex"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-accent" />
      )}
      {copied ? "Copied" : CLIENT_API_KEY}
    </button>
  );
}
