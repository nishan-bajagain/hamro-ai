"use client";

import { useEffect, useRef } from "react";
import {
  BookOpen,
  Database,
  ExternalLink,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

export interface ChatSettings {
  enterToSend: boolean;
  compact: boolean;
  autoScroll: boolean;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: ChatSettings;
  onChange: (patch: Partial<ChatSettings>) => void;
  onClearChats: () => void;
  onClearCache: () => void;
  health: "ok" | "degraded" | "offline" | null;
}

const VERSION = "0.2.0";

export function SettingsDialog({
  open,
  onClose,
  settings,
  onChange,
  onClearChats,
  onClearCache,
  health,
}: SettingsDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/30 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="fade-up w-full max-w-md overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl shadow-zinc-900/15 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-zinc-900">Settings</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:bg-panel-2 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {/* General */}
          <SectionTitle>General</SectionTitle>
          <ToggleRow
            label="Enter to send"
            hint="Enter sends, Shift+Enter inserts a new line"
            checked={settings.enterToSend}
            onChange={(v) => onChange({ enterToSend: v })}
          />
          <ToggleRow
            label="Compact mode"
            hint="Tighter spacing between messages"
            checked={settings.compact}
            onChange={(v) => onChange({ compact: v })}
          />
          <ToggleRow
            label="Auto-scroll"
            hint="Follow new tokens while streaming"
            checked={settings.autoScroll}
            onChange={(v) => onChange({ autoScroll: v })}
          />

          {/* Data */}
          <SectionTitle>Data</SectionTitle>
          <div className="mb-2 flex items-center justify-between rounded-xl border border-edge bg-panel-2 px-3 py-2.5">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
                <Database className="h-3.5 w-3.5 text-faint" /> Conversations
              </div>
              <p className="mt-0.5 text-[11px] text-faint">
                Stored in data.json via the gateway, with a local cache
              </p>
            </div>
            <button
              onClick={() => {
                if (confirm("Delete ALL saved conversations? This cannot be undone.")) {
                  onClearChats();
                }
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-edge bg-panel-2 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-zinc-800">Local cache</div>
              <p className="mt-0.5 text-[11px] text-faint">
                Offline copy of chats + your model preference
              </p>
            </div>
            <button
              onClick={onClearCache}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-panel-2"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>

          {/* About */}
          <SectionTitle>About</SectionTitle>
          <div className="rounded-xl border border-edge bg-panel-2 px-3 py-2.5">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-zinc-800">Hamro AI</span>
              <span className="font-mono text-[11px] text-faint">v{VERSION}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px] text-zinc-600">
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    health === "ok"
                      ? "bg-emerald-500"
                      : health === "degraded"
                        ? "bg-amber-500"
                        : "bg-zinc-300"
                  }`}
                />
                API {health === "ok" ? "online" : health === "degraded" ? "degraded" : "checking…"}
              </span>
              <a
                href="/docs"
                className="flex items-center gap-1 text-accent hover:underline"
              >
                <BookOpen className="h-3 w-3" /> Docs
              </a>
              <a
                href="/status"
                className="flex items-center gap-1 text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Status
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-faint first:mt-0">
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between rounded-xl border border-edge bg-panel-2 px-3 py-2.5">
      <div>
        <div className="text-[13px] font-medium text-zinc-800">{label}</div>
        <p className="mt-0.5 text-[11px] text-faint">{hint}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5.5 w-10 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-zinc-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
