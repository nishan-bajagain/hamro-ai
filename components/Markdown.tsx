"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import "highlight.js/styles/github.css";

/**
 * Renders assistant markdown with GitHub-flavored tables/lists and
 * syntax-highlighted, copyable code blocks. Typography lives in
 * .markdown-body (globals.css); this component layers on the code blocks.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:text-blue-700"
            />
          ),
          table: (props) => (
            <div className="overflow-x-auto">
              <table
                {...props}
                className="my-2 w-full border-collapse text-left text-xs"
              />
            </div>
          ),
          th: (props) => (
            <th {...props} className="border-b border-edge bg-panel-2 px-3 py-2 font-semibold text-zinc-900" />
          ),
          td: (props) => (
            <td {...props} className="border-b border-edge/60 px-3 py-2 align-top" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-edge bg-[#f7f8fa]">
      <div className="flex items-center justify-between border-b border-edge bg-panel px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          code
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-faint opacity-0 transition-all hover:bg-panel-2 hover:text-zinc-700 group-hover:opacity-100"
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
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        {children}
      </pre>
    </div>
  );
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
