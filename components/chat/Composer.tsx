"use client";

import { useEffect, useRef } from "react";
import { Send, Square, X } from "lucide-react";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  enterToSend: boolean;
  modelLabel: string;
  /** Increment to refocus the composer (e.g. after picking a suggestion). */
  focusKey?: number;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  enterToSend,
  modelLabel,
  focusKey = 0,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);

  const canSend = !streaming && !disabled && value.trim().length > 0;

  const submit = () => {
    if (canSend) onSend();
  };

  return (
    <div className="border-t border-edge bg-panel/80 px-3 py-3 sm:px-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-end gap-2 rounded-xl border border-edge bg-panel p-2 shadow-sm shadow-zinc-900/[0.03] transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && enterToSend) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Message Hamro AI…"
            aria-label="Message"
            className="max-h-[220px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-relaxed text-zinc-800 outline-none placeholder:text-faint"
          />
          <div className="flex shrink-0 items-center gap-1">
            {value && !streaming && (
              <button
                onClick={() => onChange("")}
                aria-label="Clear input"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-faint transition-colors hover:bg-panel-2 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {streaming ? (
              <button
                onClick={onStop}
                aria-label="Stop generating"
                className="flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span className="hidden sm:inline">Stop</span>
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Send className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Send</span>
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
          <span className="max-w-[60%] truncate font-mono text-[10.5px] text-faint">
            {modelLabel}
          </span>
          <span className="shrink-0 text-[10.5px] text-faint">
            {enterToSend ? "Enter to send · Shift+Enter for new line" : "Enter for new line"}
          </span>
        </div>
      </div>
    </div>
  );
}
