"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Eraser,
  Gauge,
  Send,
  Settings2,
  Square,
  User,
  Zap,
  RefreshCw,
} from "lucide-react";
import { CLIENT_API_KEY, type PlaygroundModel } from "@/lib/client-config";
import { Badge, Card, Spinner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface StreamMeta {
  ttftMs: number;
  totalMs: number;
  provider: string;
  failovers: number;
  tokens: number;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful, concise coding assistant.";

const SUGGESTIONS = [
  "Write a Python function that fetches data from an API and retries on failure",
  "Explain the difference between useEffect and useMemo with examples",
  "Write a SQL query to find duplicate emails in a users table",
  "Help me debug: my React app crashes with 'Cannot read properties of undefined'",
];

export function ChatClient() {
  const [models, setModels] = useState<PlaygroundModel[]>([]);
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(1);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<StreamMeta | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/models", {
          headers: { Authorization: `Bearer ${CLIENT_API_KEY}` },
        });
        if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
        const data = (await res.json()) as { data: PlaygroundModel[] };
        if (!cancelled) {
          setModels(data.data);
          setModel((prev) => prev || data.data[0]?.id || "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load models");
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || streaming || !model) return;
      setInput("");
      setError(null);
      setMeta(null);

      const history: ChatMessage[] = [
        ...messages,
        { role: "user", content },
      ];
      setMessages(history);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);

      const t0 = performance.now();
      let ttft = 0;
      let full = "";
      let streamError: string | null = null;
      let provider = "";
      let failovers = 0;

      try {
        const res = await fetch("/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CLIENT_API_KEY}`,
            "x-client": "hamro-site-playground",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
            ],
            stream: true,
            temperature,
            top_p: topP,
            max_tokens: maxTokens,
          }),
          signal: ctrl.signal,
        });

        provider = res.headers.get("x-gateway-provider") ?? "";
        failovers = Number(res.headers.get("x-gateway-failovers") ?? "0");

        if (!res.ok) {
          let message = `Request failed with HTTP ${res.status}`;
          try {
            const data = await res.json();
            message = data?.error?.message ?? message;
          } catch {
            /* ignore */
          }
          throw new Error(message);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Response body missing");

        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              if (json.error) {
                streamError = json.error.message ?? "Stream error";
                continue;
              }
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) {
                if (!ttft) ttft = performance.now() - t0;
                full += delta;
                setMessages([...history, { role: "assistant", content: full }]);
              }
            } catch {
              /* ignore malformed line */
            }
          }
        }

        if (streamError) throw new Error(streamError);
        if (!full) {
          setMessages([...history, { role: "assistant", content: "_(empty response)_" }]);
        }
        setMeta({
          ttftMs: ttft,
          totalMs: performance.now() - t0,
          provider,
          failovers,
          tokens: Math.max(1, Math.round(full.length / 4)),
        });
      } catch (e) {
        if (ctrl.signal.aborted) {
          setMessages([...history, { role: "assistant", content: full || "_(stopped)_" }]);
          setMeta({
            ttftMs: ttft,
            totalMs: performance.now() - t0,
            provider,
            failovers,
            tokens: Math.max(1, Math.round(full.length / 4)),
          });
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [input, messages, model, streaming, systemPrompt, temperature, topP, maxTokens],
  );

  const clear = useCallback(() => {
    stop();
    setMessages([]);
    setError(null);
    setMeta(null);
  }, [stop]);

  const grouped = groupModels(models);

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-5xl flex-col gap-3 p-3 sm:p-4">
      {/* Control bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={streaming}
          className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-panel px-2.5 text-sm text-zinc-100 outline-none transition-colors hover:border-edge-2 focus:border-emerald-500/60 sm:max-w-sm"
        >
          {loadingModels && <option>Loading models…</option>}
          {!loadingModels && models.length === 0 && (
            <option>No models available</option>
          )}
          {grouped.map((g) => (
            <optgroup key={g.provider} label={g.provider}>
              {g.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {friendlyName(m.id)} {isFree(m) ? "· free" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <button
          onClick={() => setShowSettings((s) => !s)}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
            showSettings
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-edge bg-panel text-zinc-300 hover:border-edge-2"
          }`}
        >
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        <button
          onClick={() => {
            navigator.clipboard.writeText(buildCurl({ model, systemPrompt, temperature, topP, maxTokens, input, messages }));
            setCopiedCurl(true);
            setTimeout(() => setCopiedCurl(false), 1500);
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 text-sm text-zinc-300 transition-colors hover:border-edge-2"
          title="Copy this request as a curl command"
        >
          {copiedCurl ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{copiedCurl ? "Copied" : "Copy curl"}</span>
        </button>

        <button
          onClick={clear}
          disabled={streaming}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 text-sm text-zinc-300 transition-colors hover:border-edge-2 disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <Card className="fade-up p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                System prompt
              </span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
                className="w-full resize-y rounded-lg border border-edge bg-panel-2 px-2.5 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Temperature: {temperature.toFixed(1)}
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="mt-3 w-full accent-emerald-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Top P: {topP.toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={topP}
                onChange={(e) => setTopP(Number(e.target.value))}
                className="mt-3 w-full accent-emerald-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Max tokens: {maxTokens}
              </span>
              <input
                type="range"
                min={256}
                max={16384}
                step={256}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="mt-3 w-full accent-emerald-400"
              />
            </label>
          </div>
        </Card>
      )}

      {/* Messages */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 && !streaming && (
            <EmptyState onPick={send} />
          )}
          {messages.map((m, i) => (
            <MessageRow key={i} msg={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
          ))}
          {error && (
            <div className="fade-up mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Meta bar */}
        {(meta || streaming) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-edge bg-panel-2 px-4 py-2 text-[11px] text-muted">
            {streaming && (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Spinner className="h-3 w-3" /> streaming…
              </span>
            )}
            {meta?.ttftMs ? (
              <Badge tone="blue">
                <Zap className="h-3 w-3" /> TTFT {meta.ttftMs.toFixed(0)}ms
              </Badge>
            ) : null}
            {meta?.totalMs ? (
              <Badge tone="zinc">
                <Gauge className="h-3 w-3" /> {meta.totalMs.toFixed(0)}ms
              </Badge>
            ) : null}
            {meta?.provider ? (
              <Badge tone="green">provider · {meta.provider}</Badge>
            ) : null}
            {meta && meta.failovers > 0 ? (
              <Badge tone="amber">
                <RefreshCw className="h-3 w-3" /> {meta.failovers} failover{meta.failovers > 1 ? "s" : ""}
              </Badge>
            ) : null}
            {meta?.tokens ? (
              <Badge tone="violet">~{meta.tokens.toLocaleString()} tokens</Badge>
            ) : null}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-edge p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Ask a model… (Enter to send, Shift+Enter for newline)"
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-edge bg-panel-2 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-faint focus:border-emerald-500/60"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="flex h-11 items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/25"
              >
                <Square className="h-4 w-4 fill-current" /> Stop
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!input.trim() || !model}
                className="flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-500 px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Send className="h-4 w-4" /> Send
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-2xl font-black text-black">
        h
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-zinc-100">
          Welcome to the hamro.site playground
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted">
          Free streaming access to Llama 3.3, Nemotron 3 Ultra and DeepSeek V4
          Flash — routed with automatic failover across providers.
        </p>
      </div>
      <div className="grid w-full max-w-lg gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-lg border border-edge bg-panel px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:border-emerald-500/40 hover:bg-panel-2"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  streaming,
}: {
  msg: ChatMessage;
  streaming?: boolean;
}) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  return (
    <div className={`fade-up mb-4 flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            isSystem
              ? "bg-violet-500/15 text-violet-300"
              : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {isSystem ? (
            <Settings2 className="h-3.5 w-3.5" />
          ) : (
            <Bot className="h-3.5 w-3.5" />
          )}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl border px-3.5 py-2.5 ${
          isUser
            ? "border-emerald-500/25 bg-emerald-500/10"
            : isSystem
              ? "border-edge bg-panel-2 text-xs text-muted"
              : "border-edge bg-panel"
        }`}
      >
        {isUser && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
            <User className="h-3 w-3" /> you
          </div>
        )}
        {isSystem ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className={streaming ? "caret-blink" : ""}>
            <Markdown content={msg.content} />
          </div>
        )}
      </div>
    </div>
  );
}

function buildCurl({
  model,
  systemPrompt,
  temperature,
  topP,
  maxTokens,
  input,
  messages,
}: {
  model: string;
  systemPrompt: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  input: string;
  messages: ChatMessage[];
}): string {
  const latestUser =
    input.trim() ||
    [...messages].reverse().find((m) => m.role === "user")?.content ||
    "your message here";
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: latestUser },
    ],
    stream: true,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
  };
  const payload = JSON.stringify(body).replace(/'/g, `'\\''`);
  return [
    `curl -N http://localhost:3000/v1/chat/completions \\`,
    `  -H "Authorization: Bearer ${CLIENT_API_KEY}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${payload}'`,
  ].join("\n");
}

function friendlyName(id: string): string {
  const short = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return short;
}

function isFree(m: PlaygroundModel): boolean {
  return m.pricing?.input === "0" && m.pricing?.output === "0";
}

function groupModels(models: PlaygroundModel[]) {
  const map = new Map<string, PlaygroundModel[]>();
  for (const m of models) {
    const key = m.owned_by || "unknown";
    map.set(key, [...(map.get(key) ?? []), m]);
  }
  return [...map.entries()].map(([provider, items]) => ({ provider, items }));
}
