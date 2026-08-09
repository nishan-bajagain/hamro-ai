"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  MessageSquarePlus,
  Pencil,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { ApiChatSummary } from "@/lib/api/types";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  conversations: ApiChatSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  health: "ok" | "degraded" | "offline" | null;
  loading: boolean;
}

export function Sidebar({
  open,
  onClose,
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onOpenSettings,
  health,
  loading,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const groups = useMemo(() => groupByDay(conversations, query), [conversations, query]);

  const startRename = (c: ApiChatSummary) => {
    setRenamingId(c.id);
    setRenameValue(c.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-edge bg-panel transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Conversations"
      >
        {/* Brand */}
        <div className="flex h-14 items-center justify-between border-b border-edge px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-blue-500 text-sm font-black text-white shadow-sm shadow-blue-500/25">
              h
            </span>
            <span className="text-[15px] font-bold tracking-tight text-zinc-900">
              Hamro <span className="text-accent">AI</span>
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:bg-panel-2 hover:text-zinc-700 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 pt-3">
          <button
            onClick={onNew}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-colors hover:bg-blue-700"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-panel-2 px-2.5 py-1.5 focus-within:border-blue-300">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="h-5 w-full bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-faint"
            />
          </div>
        </div>

        {/* History */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <div className="space-y-2 pt-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-9" />
              ))}
            </div>
          )}

          {!loading && groups.length === 0 && (
            <p className="px-2 pt-6 text-center text-xs leading-relaxed text-faint">
              {query
                ? `No conversations match “${query}”.`
                : "No conversations yet.\nStart a new chat to begin."}
            </p>
          )}

          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                {g.label}
              </div>
              <div className="space-y-0.5">
                {g.items.map((c) => (
                  <div
                    key={c.id}
                    className={`group relative flex items-center rounded-lg transition-colors ${
                      c.id === activeId
                        ? "bg-blue-50"
                        : "hover:bg-panel-2"
                    }`}
                  >
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        aria-label="Rename conversation"
                        className="mx-1.5 my-1 h-7 w-[calc(100%-12px)] rounded-md border border-blue-300 bg-panel px-2 text-[13px] text-zinc-800 outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => onSelect(c.id)}
                        className={`min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[13px] ${
                          c.id === activeId
                            ? "font-medium text-accent"
                            : "text-zinc-700"
                        }`}
                        title={c.title}
                      >
                        {c.title}
                      </button>
                    )}
                    {renamingId !== c.id && (
                      <div className="absolute right-1.5 hidden items-center gap-0.5 group-hover:flex">
                        <IconBtn
                          label="Rename"
                          onClick={() => startRename(c)}
                          icon={<Pencil className="h-3 w-3" />}
                        />
                        <IconBtn
                          label="Delete"
                          onClick={() => {
                            if (confirm(`Delete “${c.title}”?`)) onDelete(c.id);
                          }}
                          icon={<Trash2 className="h-3 w-3" />}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-edge p-3">
          <button
            onClick={onOpenSettings}
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-zinc-600 transition-colors hover:bg-panel-2 hover:text-zinc-900"
          >
            <Settings className="h-4 w-4" /> Settings
          </button>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-edge bg-panel-2 px-2.5 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600">
              <StatusDot health={health} />
              {health === "ok"
                ? "API online"
                : health === "degraded"
                  ? "API degraded"
                  : health === "offline"
                    ? "API offline"
                    : "Checking API…"}
            </span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-faint">
              <Activity className="h-3 w-3" /> free gateway
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

function IconBtn({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-panel hover:text-zinc-700"
    >
      {icon}
    </button>
  );
}

function StatusDot({ health }: { health: "ok" | "degraded" | "offline" | null }) {
  const cls =
    health === "ok"
      ? "bg-emerald-500"
      : health === "degraded"
        ? "bg-amber-500"
        : health === "offline"
          ? "bg-red-500"
          : "bg-zinc-300";
  return <span className={`h-1.5 w-1.5 rounded-full ${cls} ${health === "ok" ? "pulse-dot" : ""}`} />;
}

function groupByDay(list: ApiChatSummary[], query: string): { label: string; items: ApiChatSummary[] }[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      )
    : list;

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const buckets: { label: string; items: ApiChatSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of sorted) {
    const t = new Date(c.updatedAt).getTime();
    if (t >= startOfToday) buckets[0].items.push(c);
    else if (t >= startOfYesterday) buckets[1].items.push(c);
    else if (t >= startOfWeek) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  }

  return buckets.filter((b) => b.items.length > 0);
}
