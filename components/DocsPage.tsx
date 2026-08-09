"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Hash, Menu, X } from "lucide-react";
import "highlight.js/styles/github.css";

interface TocItem {
  level: number;
  text: string;
  id: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractText(node: ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as object)) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export function DocsPage({ markdown }: { markdown: string }) {
  const toc = useMemo<TocItem[]>(() => {
    const items: TocItem[] = [];
    for (const line of markdown.split("\n")) {
      const m = /^(#{1,3})\s+(.*)$/.exec(line);
      if (!m) continue;
      const text = m[2].trim();
      items.push({ level: m[1].length, text, id: slugify(text) });
    }
    return items;
  }, [markdown]);

  const [active, setActive] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);

  // Track which section is currently in view for the sidebar highlight.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const item of toc) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [toc]);

  return (
    <div className="mx-auto flex max-w-7xl gap-8 px-4 py-8 sm:px-6">
      {/* Sidebar TOC — desktop */}
      <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-60 shrink-0 overflow-y-auto pr-2 lg:block">
        <div className="mb-3 flex items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-wider text-faint">
          <Hash className="h-3.5 w-3.5" /> On this page
        </div>
        <nav className="space-y-0.5 border-l border-edge">
          {toc.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
              className={`block border-l-2 py-1 text-[13px] transition-colors ${
                active === item.id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-zinc-700"
              }`}
            >
              {item.text}
            </a>
          ))}
        </nav>
      </aside>

      {/* Mobile TOC toggle */}
      <div className="fixed bottom-4 right-4 z-50 lg:hidden">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-edge-2 bg-panel text-zinc-700 shadow-lg shadow-zinc-900/10"
          aria-label="Table of contents"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {menuOpen && (
          <div className="absolute bottom-14 right-0 max-h-80 w-64 overflow-y-auto rounded-xl border border-edge bg-panel p-2 shadow-xl shadow-zinc-900/10">
            {toc.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setMenuOpen(false)}
                style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                className="block rounded-md py-1.5 text-[13px] text-muted hover:bg-panel-2 hover:text-zinc-900"
              >
                {item.text}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <article className="min-w-0 flex-1 pb-24">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={{
            h1: (props) => (
              <Heading level={1} {...props} />
            ),
            h2: (props) => (
              <Heading level={2} {...props} />
            ),
            h3: (props) => (
              <Heading level={3} {...props} />
            ),
            p: (props) => <p {...props} className="my-3 text-[14.5px] leading-relaxed text-zinc-300" />,
            ul: (props) => <ul {...props} className="my-3 list-disc space-y-1.5 pl-6 text-[14.5px] leading-relaxed text-zinc-300" />,
            ol: (props) => <ol {...props} className="my-3 list-decimal space-y-1.5 pl-6 text-[14.5px] leading-relaxed text-zinc-300" />,
            li: (props) => <li {...props} className="marker:text-faint" />,
            strong: (props) => <strong {...props} className="font-semibold text-zinc-100" />,
            em: (props) => <em {...props} className="text-zinc-200" />,
            hr: () => <hr className="my-8 border-edge" />,
            a: (props) => (
              <a
                {...props}
                target={props.href?.startsWith("#") ? undefined : "_blank"}
                rel="noreferrer"
                className="text-accent underline decoration-accent/40 underline-offset-2 hover:text-blue-700"
              />
            ),
            blockquote: (props) => (
              <blockquote
                {...props}
                className="my-4 rounded-r-lg border-l-2 border-blue-200 bg-blue-50 px-4 py-2 text-[14px] text-zinc-700"
              />
            ),
            table: (props) => (
              <div className="my-4 overflow-x-auto rounded-lg border border-edge">
                <table {...props} className="w-full border-collapse text-left text-[13px]" />
              </div>
            ),
            thead: (props) => (
              <thead {...props} className="bg-panel-2 text-[11px] uppercase tracking-wider text-faint" />
            ),
            th: (props) => <th {...props} className="border-b border-edge px-3 py-2 font-semibold" />,
            td: (props) => <td {...props} className="border-b border-edge/60 px-3 py-2 text-zinc-300" />,
            code: CodeBlock,
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function Heading({
  level,
  id,
  children,
  ...props
}: {
  level: 1 | 2 | 3;
  id?: string;
  children?: ReactNode;
}) {
  const text = extractText(children);
  const slug = id ?? slugify(text);
  const sizes: Record<number, string> = {
    1: "mt-2 mb-4 text-3xl font-bold tracking-tight text-zinc-50",
    2: "mt-10 mb-3 scroll-mt-20 text-2xl font-bold tracking-tight text-zinc-100",
    3: "mt-6 mb-2 scroll-mt-20 text-lg font-semibold text-zinc-100",
  };
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return (
    <Tag id={slug} className={`group flex items-center gap-2 ${sizes[level]}`}>
      <span {...props}>{children}</span>
      <a
        href={`#${slug}`}
        aria-label="Link to section"
        className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
      >
        <Hash className="h-4 w-4" />
      </a>
    </Tag>
  );
}

function CodeBlock({
  className,
  children,
  inline,
}: {
  className?: string;
  children?: ReactNode;
  inline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1] ?? "text";

  if (inline) {
    return (
      <code className="rounded-md border border-edge bg-panel px-1.5 py-0.5 font-mono text-[12.5px] text-accent">
        {children}
      </code>
    );
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-edge bg-[#f7f8fa]">
      <div className="flex items-center justify-between border-b border-edge bg-panel px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          {lang}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted opacity-0 transition-all hover:bg-panel-2 hover:text-zinc-700 group-hover:opacity-100"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" /> copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-800">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}
