"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, MessageSquarePlus } from "lucide-react";
import { Sidebar } from "@/components/chat/Sidebar";
import { Messages } from "@/components/chat/Messages";
import { Composer } from "@/components/chat/Composer";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { SettingsDialog, type ChatSettings } from "@/components/chat/SettingsDialog";
import {
  checkHealth,
  clearChats,
  deleteChat,
  getChat,
  listChats,
  listModels,
  saveChat,
  streamChat,
} from "@/lib/api/client";
import type {
  ApiChatMessage,
  ApiChatSummary,
  ApiModel,
  StreamMeta,
} from "@/lib/api/types";

const LS_MODEL = "hamro.model";
const LS_SETTINGS = "hamro.settings";
const LS_ACTIVE = "hamro.active-chat";
const LS_CACHE = "hamro.chats.v1";
const MAX_LOCAL_CHATS = 10;
const MAX_MESSAGE_CHARS = 8_000;

const DEFAULT_SETTINGS: ChatSettings = {
  enterToSend: true,
  compact: false,
  autoScroll: true,
};

interface LocalChat extends ApiChatSummary {
  messages: ApiChatMessage[];
}

function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ChatSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readLocalCache(): Record<string, LocalChat> {
  try {
    return JSON.parse(localStorage.getItem(LS_CACHE) ?? "{}") as Record<string, LocalChat>;
  } catch {
    return {};
  }
}

function writeLocalCache(chats: Record<string, LocalChat>) {
  try {
    const trimmed: Record<string, LocalChat> = {};
    for (const [id, c] of Object.entries(chats).slice(-MAX_LOCAL_CHATS)) trimmed[id] = c;
    localStorage.setItem(LS_CACHE, JSON.stringify(trimmed));
  } catch {
    /* storage full/unavailable — server is the source of truth */
  }
}

function titleFromMessages(messages: ApiChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
  const clean = first.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

export function ChatApp() {
  /* ── models ── */
  const [models, setModels] = useState<ApiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelId, setModelId] = useState<string>(
    () => (typeof localStorage !== "undefined" ? localStorage.getItem(LS_MODEL) ?? "random" : "random"),
  );

  /* ── conversations ── */
  const [conversations, setConversations] = useState<ApiChatSummary[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiChatMessage[]>([]);

  /* ── turn state ── */
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<StreamMeta | null>(null);
  const [composerFocus, setComposerFocus] = useState(0);

  /* ── ui state ── */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(loadSettings);
  const [health, setHealth] = useState<"ok" | "degraded" | "offline" | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef("");
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ApiChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ── boot: models, conversations, health ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [modelList, convList] = await Promise.all([listModels(), listChats()]);
        if (cancelled) return;
        setModels(modelList);
        setConversations(convList);
        setConvsLoading(false);
        // Restore the last active chat, falling back to the local cache when
        // the server is unreachable.
        const lastId = localStorage.getItem(LS_ACTIVE);
        const restore = lastId && convList.some((c) => c.id === lastId) ? lastId : null;
        if (restore) {
          setActiveId(restore);
          activeIdRef.current = restore;
          try {
            const chat = await getChat(restore);
            if (!cancelled) setMessages(chat.messages);
          } catch {
            const local = readLocalCache()[restore];
            if (local && !cancelled) setMessages(local.messages);
          }
        }
      } catch {
        // Server unreachable — serve the local cache so the UI still works.
        if (cancelled) return;
        const cache = readLocalCache();
        const list = Object.values(cache)
          .map((c) => ({
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            messageCount: c.messages.length,
          }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setConversations(list);
        setConvsLoading(false);
        const lastId = localStorage.getItem(LS_ACTIVE);
        if (lastId && cache[lastId]) {
          setActiveId(lastId);
          activeIdRef.current = lastId;
          setMessages(cache[lastId].messages);
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      const h = await checkHealth();
      if (!disposed) setHealth(h?.status ?? "offline");
    };
    void poll();
    const t = setInterval(() => void poll(), 30_000);
    return () => {
      disposed = true;
      clearInterval(t);
    };
  }, []);

  const persistModel = useCallback((id: string) => {
    setModelId(id);
    try {
      localStorage.setItem(LS_MODEL, id);
    } catch {
      /* ignore */
    }
  }, []);

  /* ── persistence ── */

  const applySettings = useCallback((patch: Partial<ChatSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const saveCurrent = useCallback(async (): Promise<string | null> => {
    if (!dirtyRef.current) return activeIdRef.current;
    dirtyRef.current = false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const msgs = messagesRef.current;
    if (msgs.length === 0) return activeIdRef.current;

    // The gateway caps each message at MAX_MESSAGE_CHARS and a chat at 200
    // messages — clamp before sending so saves never 400.
    const safe: ApiChatMessage[] = msgs
      .slice(-200)
      .map((m) => ({ ...m, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
    const title = titleFromMessages(msgs);
    const id = activeIdRef.current ?? undefined;

    try {
      const summary = await saveChat({ id, title, messages: safe });
      if (activeIdRef.current === null) {
        activeIdRef.current = summary.id;
      }
      setActiveId(activeIdRef.current);
      try {
        localStorage.setItem(LS_ACTIVE, activeIdRef.current ?? "");
      } catch {
        /* ignore */
      }
      setConversations((prev) => {
        const rest = prev.filter((c) => c.id !== summary.id);
        return [summary, ...rest].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
      });
      return summary.id;
    } catch {
      // Offline / server rejected: the local mirror below still keeps the chat.
      return activeIdRef.current;
    } finally {
      // Local mirror always (offline fallback / cache). Use the server-assigned
      // id when available so the cache stays keyed like the server list.
      const cacheId =
        activeIdRef.current ?? id ?? `local_${Date.now().toString(36)}`;
      const cache = readLocalCache();
      cache[cacheId] = {
        id: cacheId,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: safe.length,
        messages: safe,
      };
      writeLocalCache(cache);
    }
  }, []);

  /** Schedule a debounced server save + always mirror to the local cache. */
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void saveCurrent(), 1000);
  }, [saveCurrent]);

  /** Flush pending saves before switching chats / deleting. */
  const flushSave = useCallback(async () => {
    if (dirtyRef.current) {
      await saveCurrent();
    }
  }, [saveCurrent]);

  /* ── chat operations ── */

  const newChat = useCallback(async () => {
    await flushSave();
    abortRef.current?.abort();
    setActiveId(null);
    activeIdRef.current = null;
    setMessages([]);
    setStreaming(false);
    setStreamingText("");
    setError(null);
    setMeta(null);
    try {
      localStorage.removeItem(LS_ACTIVE);
    } catch {
      /* ignore */
    }
    setComposerFocus((n) => n + 1);
  }, [flushSave]);

  const selectChat = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      await flushSave();
      abortRef.current?.abort();
      setError(null);
      setMeta(null);
      setStreaming(false);
      setStreamingText("");
      setActiveId(id);
      activeIdRef.current = id;
      try {
        localStorage.setItem(LS_ACTIVE, id);
      } catch {
        /* ignore */
      }
      try {
        const chat = await getChat(id);
        setMessages(chat.messages);
      } catch {
        const local = readLocalCache()[id];
        setMessages(local?.messages ?? []);
      }
      setSidebarOpen(false);
    },
    [flushSave],
  );

  const renameChat = useCallback(
    async (id: string, title: string) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c,
        ),
      );
      try {
        const cached = readLocalCache()[id];
        await saveChat({
          id,
          title,
          messages: cached?.messages ?? messagesRef.current,
        });
      } catch {
        /* offline — the local mirror keeps the rename */
      }
    },
    [],
  );

  const removeChat = useCallback(
    async (id: string) => {
      await flushSave();
      try {
        await deleteChat(id);
      } catch {
        /* offline — remove locally anyway */
      }
      const cache = readLocalCache();
      delete cache[id];
      writeLocalCache(cache);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeIdRef.current) await newChat();
    },
    [flushSave, newChat],
  );

  const clearAllChats = useCallback(async () => {
    try {
      await clearChats();
    } catch {
      /* offline */
    }
    writeLocalCache({});
    setConversations([]);
    await newChat();
  }, [newChat]);

  const clearLocalCache = useCallback(() => {
    try {
      localStorage.removeItem(LS_CACHE);
      localStorage.removeItem(LS_ACTIVE);
    } catch {
      /* ignore */
    }
    setConversations([]);
    void newChat();
  }, [newChat]);

  /* ── send / stream ── */

  const runTurn = useCallback(
    async (history: ApiChatMessage[]) => {
      setError(null);
      setMeta(null);
      setStreaming(true);
      setStreamingText("");
      streamingTextRef.current = "";
      markDirty();

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const { full, meta: m } = await streamChat({
          model: modelId,
          messages: history,
          onDelta: (d) => {
            streamingTextRef.current += d;
            setStreamingText(streamingTextRef.current);
          },
          signal: ctrl.signal,
        });
        const content = full || "_(empty response)_";
        setMessages([...history, { role: "assistant", content }]);
        setMeta(m);
        markDirty();
      } catch (e) {
        if (ctrl.signal.aborted) {
          // User pressed Stop — keep whatever streamed so far.
          const partial = streamingTextRef.current;
          setMessages(
            partial
              ? [...history, { role: "assistant", content: partial }]
              : history,
          );
          markDirty();
        } else {
          setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
        }
      } finally {
        setStreaming(false);
        setStreamingText("");
        abortRef.current = null;
      }
    },
    [modelId, markDirty],
  );

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || streaming) return;
      setInput("");
      const history: ApiChatMessage[] = [...messagesRef.current, { role: "user", content }];
      setMessages(history);
      await runTurn(history);
    },
    [input, streaming, runTurn],
  );

  const regenerate = useCallback(() => {
    if (streaming) return;
    const msgs = messagesRef.current;
    if (msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    const history =
      last.role === "assistant" ? msgs.slice(0, -1) : msgs;
    if (history.length === 0 || history[history.length - 1].role !== "user") return;
    setMessages(history);
    void runTurn(history);
  }, [streaming, runTurn]);

  const retry = useCallback(() => {
    if (streaming) return;
    const msgs = messagesRef.current;
    const history =
      msgs.length > 0 && msgs[msgs.length - 1].role === "assistant"
        ? msgs.slice(0, -1)
        : msgs;
    if (history.length === 0) return;
    setMessages(history);
    void runTurn(history);
  }, [streaming, runTurn]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const pickSuggestion = useCallback((text: string) => {
    setInput(text);
    setComposerFocus((n) => n + 1);
  }, []);

  /* ── derived ── */

  // While streaming, only append the partial assistant message once the first
  // token arrived — before that the Thinking indicator covers the wait.
  const displayMessages = useMemo<ApiChatMessage[]>(
    () =>
      streaming && streamingText
        ? [...messages, { role: "assistant", content: streamingText }]
        : messages,
    [messages, streaming, streamingText],
  );

  const activeTitle =
    conversations.find((c) => c.id === activeId)?.title ??
    (messages.length > 0 ? titleFromMessages(messages) : "New chat");

  const modelLabel =
    modelId === "random" ? "Auto · random per session" : shortModel(modelId);

  /* ── render ── */

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => void selectChat(id)}
        onNew={() => void newChat()}
        onRename={(id, title) => void renameChat(id, title)}
        onDelete={(id) => void removeChat(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        health={health}
        loading={convsLoading}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        {/* Chat header */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-edge bg-panel px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-panel-2 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="truncate text-sm font-medium text-zinc-800">{activeTitle}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ModelPicker
              models={models}
              selected={modelId}
              onChange={persistModel}
              disabled={streaming}
              loading={modelsLoading}
            />
            <button
              onClick={() => void newChat()}
              aria-label="New chat"
              title="New chat"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel text-zinc-600 transition-colors hover:border-edge-2 hover:text-zinc-900 lg:hidden"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <Messages
          messages={displayMessages}
          streaming={streaming}
          error={error}
          meta={meta}
          autoScroll={settings.autoScroll}
          compact={settings.compact}
          onRegenerate={regenerate}
          onRetry={retry}
          onNewChat={() => void newChat()}
          onPickSuggestion={pickSuggestion}
        />

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          onStop={stop}
          streaming={streaming}
          enterToSend={settings.enterToSend}
          modelLabel={modelLabel}
          focusKey={composerFocus}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={applySettings}
        onClearChats={() => void clearAllChats()}
        onClearCache={clearLocalCache}
        health={health}
      />
    </div>
  );
}

function shortModel(id: string): string {
  if (id === "random") return "Auto";
  return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}
