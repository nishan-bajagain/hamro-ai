"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Cpu,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { ApiModel } from "@/lib/api/types";

interface ModelPickerProps {
  models: ApiModel[];
  selected: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

const AUTO_ID = "random";

export function ModelPicker({ models, selected, onChange, disabled, loading }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Exclude the API's virtual `random` entry — it is pinned as the Auto row
    // at the top of this picker, so showing it again would duplicate it.
    const source = models.filter((m) => m.id !== AUTO_ID);
    const list = q
      ? source.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            (m.owned_by || "").toLowerCase().includes(q),
        )
      : source;
    const map = new Map<string, ApiModel[]>();
    for (const m of list) {
      const key = m.owned_by || "Other";
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()].map(([provider, items]) => ({
      provider,
      items: items.sort((a, b) => a.id.localeCompare(b.id)),
    }));
  }, [models, query]);

  const label =
    loading && models.length === 0
      ? "Loading models…"
      : selected === AUTO_ID
        ? "Auto"
        : shortName(selected);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select model"
        className="flex h-9 max-w-[220px] items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 text-sm text-zinc-700 transition-colors hover:border-edge-2 hover:bg-panel-2 disabled:opacity-50"
      >
        {selected === AUTO_ID ? (
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        ) : (
          <Cpu className="h-3.5 w-3.5 shrink-0 text-accent" />
        )}
        <span className="truncate font-medium">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Available models"
          className="fade-up absolute right-0 z-50 mt-1.5 w-[300px] overflow-hidden rounded-xl border border-edge bg-panel shadow-xl shadow-zinc-900/10"
        >
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <Search className="h-3.5 w-3.5 text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="h-6 flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-faint"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-faint hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto p-1.5">
            <ModelRow
              title="Auto"
              sub="Best available model, picked per session"
              free
              selected={selected === AUTO_ID}
              onPick={() => {
                onChange(AUTO_ID);
                setOpen(false);
              }}
            />
            {groups.map((g) => (
              <div key={g.provider}>
                <div className="px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {g.provider}
                </div>
                {g.items.map((m) => (
                  <ModelRow
                    key={m.id}
                    title={shortName(m.id)}
                    sub={contextLabel(m)}
                    free={isFree(m)}
                    selected={selected === m.id}
                    onPick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-faint">
                No models match “{query}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({
  title,
  sub,
  free,
  selected,
  onPick,
}: {
  title: string;
  sub: string;
  free?: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-blue-50" : "hover:bg-panel-2"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`truncate font-mono text-[12.5px] ${selected ? "font-semibold text-accent" : "text-zinc-800"}`}>
            {title}
          </span>
          {free && (
            <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
              free
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] text-faint">{sub}</span>
      </span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
    </button>
  );
}

function shortName(id: string): string {
  if (id === AUTO_ID) return "Auto";
  return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}

function isFree(m: ApiModel): boolean {
  return m.pricing?.input === "0" && m.pricing?.output === "0";
}

function contextLabel(m: ApiModel): string {
  const ctx = m.context_length;
  const pricing = m.pricing;
  let label = "free";
  if (pricing && (pricing.input !== "0" || pricing.output !== "0")) {
    // /v1/models reports pricing per 1M tokens already (e.g. "0.5900" = $0.59/M).
    label = `$${Number(pricing.input)}/M in`;
  }
  return ctx ? `${formatCtx(ctx)} · ${label}` : label;
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k ctx`;
  return `${n} ctx`;
}
