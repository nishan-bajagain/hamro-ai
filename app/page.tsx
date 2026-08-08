import Link from "next/link";
import {
  Code2,
  GitBranch,
  KeyRound,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { getConfiguredProviders, canonicalModelId } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const models = getConfiguredProviders().flatMap((p) =>
    p.models.map((m) => ({ id: canonicalModelId(p.id, m.id), provider: p.label })),
  );

  return (
    <main className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_-10%,rgba(52,211,153,0.14),transparent),radial-gradient(50%_40%_at_85%_10%,rgba(34,211,238,0.10),transparent)]"
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <div className="fade-up">
            <Badge tone="green" className="mb-5 px-2.5 py-1 text-xs">
              <Sparkles className="h-3.5 w-3.5" /> Free · Open access · No signup
            </Badge>
            <h1 className="text-4xl font-black tracking-tight text-zinc-50 sm:text-6xl">
              One API key for{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                free AI coding
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
              hamro.site is a high-performance, OpenAI-compatible AI gateway.
              Point Claude Code, Cursor, Aider or any OpenAI client at it and get
              smart routing across {models.length} free models with automatic
              failover when a provider hiccups.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/chat"
                className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-6 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                <Terminal className="h-4 w-4" /> Try the playground
              </Link>
              <Link
                href="/status"
                className="flex h-11 items-center gap-2 rounded-xl border border-edge bg-panel px-6 text-sm font-medium text-zinc-200 transition-colors hover:border-edge-2"
              >
                <ActivityIcon /> View status
              </Link>
            </div>

            {/* Model chips */}
            <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-2">
              {models.map((m) => (
                <span
                  key={m.id}
                  className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 py-1 font-mono text-xs text-zinc-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {m.id}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* API key box */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="rounded-2xl border border-edge bg-panel p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <KeyRound className="h-4 w-4 text-emerald-400" /> Your public access key
          </div>
          <p className="mt-1 text-xs text-muted">
            This is the shared public key — use it in any OpenAI-compatible client:
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 rounded-lg border border-edge bg-panel-2 px-3 py-2 font-mono text-sm text-emerald-300">
              nishan-bajagain
            </code>
            <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 font-mono text-xs text-amber-300">
              Bearer token
            </span>
          </div>
          <p className="mt-3 font-mono text-[11px] text-faint">
            $ export OPENAI_API_KEY=nishan-bajagain · $ export OPENAI_BASE_URL=https://hamro.site/v1
          </p>
        </div>
      </section>

      {/* How to use */}
      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 className="text-center text-xl font-bold text-zinc-50">Works with any OpenAI client</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <CodeCard
            title="Claude Code"
            desc="Point it at the gateway and use free models."
            code={["claude", "$ claude --model openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"]}
          />
          <CodeCard
            title="curl"
            desc="Stream a completion right from the terminal."
            code={[
              "curl https://hamro.site/v1/chat/completions \\",
              "  -H \"Authorization: Bearer nishan-bajagain\" \\",
              "  -H \"Content-Type: application/json\" \\",
              "  -d '{\"model\":\"groq/llama-3.3-70b-versatile\",",
              "       \"messages\":[{\"role\":\"user\",",
              "       \"content\":\"hi\"}],\"stream\":true}'",
            ]}
          />
          <CodeCard
            title="Any SDK"
            desc="OpenAI SDKs talk to /v1 natively."
            code={[
              "from openai import OpenAI",
              "client = OpenAI(",
              "  base_url=\"https://hamro.site/v1\",",
              "  api_key=\"nishan-bajagain\")",
              "print(client.models.list())",
            ]}
          />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<Radio className="h-4 w-4" />}
            title="Smart routing"
            desc="Sticky-success routing picks the fastest healthy provider and remembers it."
            tone="text-emerald-400"
          />
          <FeatureCard
            icon={<GitBranch className="h-4 w-4" />}
            title="Automatic failover"
            desc="429, 5xx, timeouts and disconnects fall through the chain mid-stream."
            tone="text-cyan-400"
          />
          <FeatureCard
            icon={<Code2 className="h-4 w-4" />}
            title="Agent-tuned"
            desc="Tool calling, code fences and SSE chunks pass through verbatim."
            tone="text-violet-400"
          />
          <FeatureCard
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Telemetry"
            desc="Token counts, cost estimates and a live event log on /status."
            tone="text-amber-400"
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-edge py-6 text-center">
        <p className="font-mono text-xs text-faint">
          hamro.site — free AI gateway · <Link href="/status" className="text-emerald-400/80 hover:text-emerald-300">status</Link> ·{" "}
          <Link href="/chat" className="text-emerald-400/80 hover:text-emerald-300">playground</Link>
        </p>
      </footer>
    </main>
  );
}

function ActivityIcon() {
  return <Server className="h-4 w-4" />;
}

function CodeCard({ title, desc, code }: { title: string; desc: string; code: string[] }) {
  return (
    <div className="flex flex-col rounded-xl border border-edge bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-panel-2">
          <Zap className="h-3.5 w-3.5 text-emerald-400" />
        </span>
        <div>
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <div className="text-[11px] text-muted">{desc}</div>
        </div>
      </div>
      <pre className="mt-3 flex-1 overflow-x-auto rounded-lg border border-edge bg-[#0d1117] p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
        {code.join("\n")}
      </pre>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-panel-2 ${tone}`}>
        {icon}
      </span>
      <div className="mt-3 text-sm font-semibold text-zinc-100">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>
    </div>
  );
}
