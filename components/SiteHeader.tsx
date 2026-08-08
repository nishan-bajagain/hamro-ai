import Link from "next/link";
import { Activity, BookOpenText, MessageSquareText, TerminalSquare } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-black text-black">
            h
          </span>
          <span className="font-mono text-sm font-bold tracking-tight text-zinc-100">
            hamro<span className="text-emerald-400">.site</span>
          </span>
          <span className="hidden rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 sm:inline">
            Free Gateway
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <NavLink href="/chat" icon={<MessageSquareText className="h-4 w-4" />} label="Playground" />
          <NavLink href="/docs" icon={<BookOpenText className="h-4 w-4" />} label="Docs" />
          <NavLink href="/status" icon={<Activity className="h-4 w-4" />} label="Status" />
          <a
            href="/v1/models"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-edge-2 hover:text-zinc-100 md:inline-flex"
          >
            <TerminalSquare className="h-3.5 w-3.5 text-emerald-400" />
            /v1/models
          </a>
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
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-panel hover:text-zinc-100"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
