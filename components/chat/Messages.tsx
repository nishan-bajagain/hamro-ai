"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  Code,
  Copy,
  Gauge,
  Lightbulb,
  RefreshCw,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { ApiChatMessage, StreamMeta } from "@/lib/api/types";

interface MessagesProps {
  messages: ApiChatMessage[];
  streaming: boolean;
  error: string | null;
  meta: StreamMeta | null;
  autoScroll: boolean;
  compact: boolean;
  onRegenerate: () => void;
  onRetry: () => void;
  onNewChat: () => void;
  onPickSuggestion: (text: string) => void;
}

export function Messages({
  messages,
  streaming,
  error,
  meta,
  autoScroll,
  compact,
  onRegenerate,
  onRetry,
  onNewChat,
  onPickSuggestion,
}: MessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  const last = messages[messages.length - 1];
  const thinking = streaming && (!last || last.role !== "assistant" || !last.content);

  // Auto-scroll only while the user is already near the bottom — never yank
  // the page away when they scrolled up to read an earlier reply.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoScroll && nearBottomRef.current) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: streaming ? "auto" : "smooth",
      });
    }
  }, [messages, streaming, error, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className={`mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 ${compact ? "space-y-3" : "space-y-6"}`}>
        {messages.length === 0 && !streaming ? (
          <EmptyState onPick={onPickSuggestion} />
        ) : (
          <>
            {messages.map((m, i) => (
              <MessageItem
                key={i}
                msg={m}
                isLastAssistant={
                  m.role === "assistant" && i === messages.length - 1
                }
                streaming={
                  streaming && i === messages.length - 1 && m.role === "assistant"
                }
                meta={i === messages.length - 1 && !streaming ? meta : null}
                compact={compact}
                onRegenerate={onRegenerate}
              />
            ))}

            {thinking && <Thinking />}

            {error && !streaming && (
              <ErrorCard message={error} onRetry={onRetry} onNewChat={onNewChat} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── message row ─────────────────────────── */

function MessageItem({
  msg,
  isLastAssistant,
  streaming,
  meta,
  compact,
  onRegenerate,
}: {
  msg: ApiChatMessage;
  isLastAssistant: boolean;
  streaming: boolean;
  meta: StreamMeta | null;
  compact: boolean;
  onRegenerate: () => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="fade-up flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2.5 sm:max-w-[75%]">
          <div className="rounded-2xl rounded-br-md border border-blue-100 bg-blue-50 px-3.5 py-2.5">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-800">
              {msg.content}
            </p>
          </div>
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-panel text-zinc-500">
            <User className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fade-up group flex items-start gap-2.5 ${compact ? "gap-2" : ""}`}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-blue-500 text-white shadow-sm shadow-blue-500/20">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={streaming ? "caret-blink" : ""}>
          {msg.content ? (
            <Markdown content={msg.content} />
          ) : streaming ? (
            <span className="text-sm text-faint">…</span>
          ) : (
            <p className="text-sm text-faint">_(empty response)_</p>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton text={msg.content} />
          {isLastAssistant && !streaming && (
            <button
              onClick={onRegenerate}
              aria-label="Regenerate response"
              title="Regenerate"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-edge bg-panel text-faint transition-colors hover:border-edge-2 hover:text-zinc-700"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>

        {meta && meta.provider && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
            <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-panel px-1.5 py-0.5 font-mono">
              <Zap className="h-2.5 w-2.5 text-accent" /> {meta.provider}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-panel px-1.5 py-0.5 font-mono">
              {shortModel(meta.sessionModel ?? meta.model)}
            </span>
            {meta.ttftMs > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-panel px-1.5 py-0.5 font-mono">
                <Gauge className="h-2.5 w-2.5" /> {meta.ttftMs.toFixed(0)}ms
              </span>
            )}
            {meta.failovers > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-amber-700">
                ↷ {meta.failovers} failover{meta.failovers > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label="Copy message"
      title="Copy"
      className="flex h-6 w-6 items-center justify-center rounded-md border border-edge bg-panel text-faint transition-colors hover:border-edge-2 hover:text-zinc-700"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Thinking() {
  return (
    <div className="fade-up flex items-center gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-blue-500 text-white">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1.5 px-2 py-3" aria-label="Thinking">
        <span className="think-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
        <span className="think-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
        <span className="think-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
  onNewChat,
}: {
  message: string;
  onRetry: () => void;
  onNewChat: () => void;
}) {
  return (
    <div className="fade-up flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600">
        <AlertTriangle className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
        <p className="text-[13.5px] leading-relaxed text-red-700">{message}</p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={onRetry}
            className="flex h-7 items-center gap-1.5 rounded-lg bg-red-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
          <button
            onClick={onNewChat}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-red-200 bg-panel px-2.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
          >
            New chat
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    {
      icon: <Sparkles className="h-4 w-4" />,
      title: "Explain something",
      prompt:
        "Explain a concept I'm curious about — keep it clear and give a concrete example.",
    },
    {
      icon: <Code className="h-4 w-4" />,
      title: "Write code",
      prompt:
        "Write a Python function that fetches data from an API and retries on failure.",
    },
    {
      icon: <Lightbulb className="h-4 w-4" />,
      title: "Brainstorm ideas",
      prompt:
        "Brainstorm five creative ideas for a side project about local food delivery.",
    },
    {
      icon: <BookOpen className="h-4 w-4" />,
      title: "Help me learn",
      prompt: "Teach me something new today — pick a topic and give me a quick lesson.",
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center py-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-blue-500 text-white shadow-lg shadow-blue-500/25">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
        How can I help you today?
      </h2>
      <p className="mt-1.5 max-w-md text-center text-[13.5px] leading-relaxed text-muted">
        Ask anything — explore ideas, write code, learn something new, or solve
        a problem. Free models, routed with automatic failover.
      </p>
      <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="group flex items-center gap-2.5 rounded-xl border border-edge bg-panel px-3.5 py-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-sm"
          >
            <span className="text-accent">{s.icon}</span>
            <span className="text-[13px] font-medium text-zinc-700 group-hover:text-accent">
              {s.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function shortModel(id: string): string {
  if (!id) return "";
  return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}
