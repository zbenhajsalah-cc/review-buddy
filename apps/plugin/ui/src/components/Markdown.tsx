import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders agent-authored (and PR) markdown prose with the app's own tokens, so
 * it reads as native UI rather than a generic markdown dump.
 *
 * Safety: react-markdown never emits raw HTML (we don't add rehype-raw), so the
 * untrusted PR description can't inject markup. Links open in a new tab with
 * noopener; images are dropped entirely (they'd be an attacker-controlled fetch).
 *
 * Variants:
 *   block  — full flow: paragraphs, lists, headings, code fences, tables.
 *   inline — collapses the single wrapping paragraph so short fields
 *            (risk_reason, a key-change detail) drop into surrounding sentences,
 *            keeping only inline marks (bold, code, links).
 */
export function Markdown({
  value,
  variant = "block",
  className,
}: {
  value: string;
  variant?: "block" | "inline";
  className?: string;
}) {
  if (!value?.trim()) return null;

  const components = variant === "inline" ? INLINE_COMPONENTS : BLOCK_COMPONENTS;

  return (
    <div className={cn("wrap-anywhere", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        // Never render <img>: an agent/PR-controlled URL would be an outbound fetch.
        skipHtml
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

const link: Components["a"] = ({ children, href }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="underline underline-offset-2 text-primary"
  >
    {children}
  </a>
);

// One `code` node type covers both inline `x` and fenced blocks. Fenced code
// carries a `language-*` class (or a trailing newline); render those bare so the
// wrapping <pre> supplies the panel styling — only true inline code gets a pill.
const code: Components["code"] = ({ className, children }) => {
  const isBlock =
    (className?.includes("language-") ?? false) ||
    (typeof children === "string" && children.includes("\n"));
  if (isBlock) return <code className={className}>{children}</code>;
  return (
    <code className="rounded border border-[var(--rb-code-border)] bg-[var(--rb-code-bg)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--rb-code-fg)]">
      {children}
    </code>
  );
};

const strong: Components["strong"] = ({ children }) => (
  <strong className="font-semibold">{children}</strong>
);

const em: Components["em"] = ({ children }) => <em className="italic">{children}</em>;

const del: Components["del"] = ({ children }) => (
  <del className="text-muted-foreground">{children}</del>
);

/** Shared inline marks — identical across both variants. */
const INLINE_MARKS = { a: link, code, strong, em, del, img: () => null } as const;

/** Inline: unwrap the block-level <p> so text flows into its container. */
const INLINE_COMPONENTS: Components = {
  ...INLINE_MARKS,
  p: ({ children }) => <>{children}</>,
};

const BLOCK_COMPONENTS: Components = {
  ...INLINE_MARKS,
  p: ({ children }) => <p className="mb-2.5 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h3 className="mt-4 mb-1.5 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-1.5 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2.5 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  // Fenced code blocks: styled monospace panel (inline code is handled above; a
  // fenced block arrives here as a <pre> wrapping a <code>, so keep <pre> plain).
  pre: ({ children }) => (
    <pre className="mb-2.5 overflow-x-auto rounded-md border border-border bg-card p-3 font-mono text-[0.8rem] leading-relaxed last:mb-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="mb-2.5 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-card px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-border px-2.5 py-1.5">{children}</td>,
};
