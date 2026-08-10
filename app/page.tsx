import Link from "next/link";
import {
  ArrowRight,
  Bot,
  ChevronRight,
  Code2,
  Copy,
  GitBranch,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { getConfiguredProviders, canonicalModelId } from "@/lib/config";
import { CLIENT_API_KEY } from "@/lib/client-config";

export const dynamic = "force-dynamic";

export default function Home() {
  const providers = getConfiguredProviders().filter((p) => p.models.length > 0);
  const modelCount = providers.reduce((n, p) => n + p.models.length, 0);

  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_-5%,rgba(37,99,235,0.10),transparent),radial-gradient(40%_35%_at_90%_15%,rgba(59,130,246,0.07),transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-12 sm:px-6 sm:pt-16 lg:pt-20">
          <div className="fade-up text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Free · Open access · No signup
            </span>
            <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight text-zinc-900 sm:text-6xl">
              AI, Made{" "}
              <span className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
                Simple.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Hamro AI is a free AI chat and gateway — one public key, dozens of
              free models across twelve providers, routed with automatic failover.
              Ask questions, write code, or point your coding agent at it.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/chat"
                className="flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition-colors hover:bg-blue-700"
              >
                Start Chatting
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#models"
                className="flex h-11 items-center gap-2 rounded-xl border border-edge bg-panel px-6 text-sm font-medium text-zinc-700 transition-colors hover:border-edge-2 hover:bg-panel-2"
              >
                Explore Models
                <ChevronRight className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Chat mock */}
          <div className="fade-up mx-auto mt-12 max-w-2xl">
            <ChatMock />
          </div>
        </div>
      </section>

      {/* ── Models ───────────────────────────────────────────────── */}
      <section id="models" className="scroll-mt-20 border-t border-edge bg-panel">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
              {modelCount} free models, one key
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              Llama, Nemotron, DeepSeek, GLM and more — every request routes to
              a healthy provider automatically, so a hiccup never stops you.
            </p>
          </div>
          <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-edge bg-bg p-4 transition-colors hover:border-blue-200"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-800">{p.label}</span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    {p.models.length} free
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {p.models.slice(0, 6).map((m) => (
                    <span
                      key={m.id}
                      className="rounded-md border border-edge bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-600"
                    >
                      {canonicalModelId(p.id, m.id).split("/").pop()}
                    </span>
                  ))}
                  {p.models.length > 6 && (
                    <span className="px-1 py-0.5 font-mono text-[10.5px] text-faint">
                      +{p.models.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Works with any client ───────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Built for people and for coding agents
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            Native OpenAI and Anthropic protocols — the same key powers this
            chat, Claude Code, OpenCode, Cursor and any OpenAI SDK.
          </p>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          <CodeCard
            title="Claude Code"
            desc="One command — the gateway starts itself."
            code={[
              "$ npm run claude",
              "",
              "# opens Claude Code on",
              "# Hamro AI's free models",
            ]}
            icon={<Bot className="h-4 w-4" />}
          />
          <CodeCard
            title="OpenCode / any OpenAI client"
            desc="Point OPENAI_BASE_URL at the gateway."
            code={[
              "export OPENAI_API_KEY=" + CLIENT_API_KEY,
              'export OPENAI_BASE_URL="https://hamro.site/v1"',
              "opencode",
            ]}
            icon={<Terminal className="h-4 w-4" />}
          />
          <CodeCard
            title="curl"
            desc="Stream a completion in one line."
            code={[
              'curl -N https://hamro.site/v1/chat/completions \\',
              '  -H "Authorization: Bearer ' + CLIENT_API_KEY + '" \\',
              "  -H \"Content-Type: application/json\" \\",
              "  -d '{\"model\":\"random\",\"messages\":",
              '    [{\"role\":\"user\",\"content\":\"hi\"}],',
              '    \"stream\":true}',
            ]}
            icon={<Code2 className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section className="border-t border-edge bg-panel">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Radio className="h-4 w-4" />}
              title="Smart routing"
              desc="Sticky-success routing picks the fastest healthy provider and remembers it."
            />
            <FeatureCard
              icon={<GitBranch className="h-4 w-4" />}
              title="Automatic failover"
              desc="429s, 5xx, timeouts and disconnects fall through the chain mid-stream."
            />
            <FeatureCard
              icon={<Zap className="h-4 w-4" />}
              title="Agent-ready"
              desc="Tool calling, code fences and SSE streaming pass through verbatim."
            />
            <FeatureCard
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Private by design"
              desc="One public key, per-key namespaced history, no account required."
            />
          </div>
        </div>
      </section>

      {/* ── CTA band ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 px-6 py-12 text-center shadow-lg shadow-blue-500/25">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(255,255,255,0.18),transparent)]"
          />
          <h2 className="relative text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Start chatting — it&apos;s free
          </h2>
          <p className="relative mx-auto mt-2 max-w-md text-sm text-blue-100">
            No signup, no credit card. Just open the chat and ask anything.
          </p>
          <Link
            href="/chat"
            className="relative mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
          >
            Open the chat
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-edge py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-6">
          <p className="font-mono text-xs text-faint">
            Hamro AI · free AI gateway
          </p>
          <div className="flex items-center gap-4 text-xs text-muted">
            <Link href="/chat" className="transition-colors hover:text-accent">
              Chat
            </Link>
            <Link href="/docs" className="transition-colors hover:text-accent">
              Docs
            </Link>
            <Link href="/status" className="transition-colors hover:text-accent">
              Status
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function ChatMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-panel shadow-xl shadow-zinc-900/[0.06]">
      {/* Mock window chrome */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-accent to-blue-700 text-[9px] font-black text-white">
            h
          </span>
          <span className="text-xs font-semibold text-zinc-800">Hamro AI</span>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-700">
          Auto
        </span>
      </div>

      {/* Mock messages */}
      <div className="space-y-4 px-4 py-5">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md border border-blue-100 bg-blue-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-800">
            Write a Python function that fetches data from an API and retries on
            failure.
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-blue-700 text-white">
            <Bot className="h-3 w-3" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-relaxed text-zinc-700">
              Here&apos;s a resilient fetch with exponential backoff:
            </p>
            <div className="mt-2 overflow-hidden rounded-lg border border-edge bg-[#f7f8fa]">
              <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                  python
                </span>
                <Copy className="h-3 w-3 text-faint" />
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-relaxed text-zinc-700">
{`import time, requests

def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            return requests.get(url, timeout=10).json()
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)  # backoff`}
              </pre>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-700 caret-blink">
              Want me to add rate-limit handling too?
            </p>
          </div>
        </div>
      </div>

      {/* Mock composer */}
      <div className="border-t border-edge px-4 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-bg px-3 py-2">
          <span className="flex-1 text-[13px] text-faint">Message Hamro AI…</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
            <Send className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
}

function CodeCard({
  title,
  desc,
  code,
  icon,
}: {
  title: string;
  desc: string;
  code: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-edge bg-panel p-4 transition-colors hover:border-blue-200">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-accent">
          {icon}
        </span>
        <div>
          <div className="text-sm font-semibold text-zinc-900">{title}</div>
          <div className="text-[11px] text-muted">{desc}</div>
        </div>
      </div>
      <pre className="mt-3 flex-1 overflow-x-auto rounded-lg border border-edge bg-[#f7f8fa] p-3 font-mono text-[11px] leading-relaxed text-zinc-700">
        {code.map((line, i) =>
          line === "" ? (
            "\n"
          ) : line.startsWith("#") ? (
            <span key={i} className="text-faint">
              {line}
              {"\n"}
            </span>
          ) : (
            <span key={i}>
              {line}
              {"\n"}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-bg p-4 transition-colors hover:border-blue-200">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-accent">
        {icon}
      </span>
      <div className="mt-3 text-sm font-semibold text-zinc-900">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>
    </div>
  );
}
