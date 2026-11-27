import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { marked, type Token, type Tokens } from "marked";
import { useReducedMotion } from "motion/react";
import { memo, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { isSoftwareRenderer } from "@/lib/renderMode.ts";
import {
  createMarkdownStreamCache,
  lexStreamingMarkdown,
  type MarkdownStreamCache,
} from "./markdownStream.ts";

const MIN_CHARS_PER_SECOND = 90;
const CATCHUP_PER_SECOND = 7;
const MAX_LAG_CHARS = 480;
const MAX_FRAME_SECONDS = 0.05;
const STREAM_PAINT_INTERVAL_MS = 33;
const MAX_STREAM_CACHES = 128;

const streamCaches = new Map<string, MarkdownStreamCache>();

export function useSmoothedStream(content: string, streaming: boolean) {
  const reducedMotion = useReducedMotion() === true;
  const animate = streaming && !reducedMotion && !isSoftwareRenderer();
  const target = content.length;
  const positionRef = useRef(target);
  const lastPaintRef = useRef(0);
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (!animate) {
      positionRef.current = target;
      lastPaintRef.current = 0;
      return;
    }
    positionRef.current = Math.min(Math.max(positionRef.current, target - MAX_LAG_CHARS), target);
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      const backlog = target - positionRef.current;
      const velocity = Math.max(MIN_CHARS_PER_SECOND, backlog * CATCHUP_PER_SECOND);
      positionRef.current = Math.min(target, positionRef.current + velocity * elapsed);
      const done = positionRef.current >= target;
      if (done || now - lastPaintRef.current >= STREAM_PAINT_INTERVAL_MS) {
        lastPaintRef.current = now;
        setShown(Math.floor(positionRef.current));
      }
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, target]);

  return animate ? content.slice(0, Math.min(shown, target)) : content;
}

function CodeBlock({ code, lang }: { readonly code: string; readonly lang?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-card bg-chrome/90 shadow-raised">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-meta text-fg-muted">{lang || "text"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-meta text-fg-muted transition-colors hover:bg-white/6 hover:text-fg"
        >
          <Icon icon={copied ? Tick02Icon : Copy01Icon} className="size-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[13.5px] leading-[1.6] text-fg-secondary">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const renderInline = (tokens: ReadonlyArray<Token> | undefined, keyPrefix: string): ReactNode => {
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        return t.tokens ? <span key={key}>{renderInline(t.tokens, key)}</span> : t.text;
      }
      case "strong":
        return (
          <strong key={key} className="font-semibold text-fg">
            {renderInline((token as Tokens.Strong).tokens, key)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic">
            {renderInline((token as Tokens.Em).tokens, key)}
          </em>
        );
      case "del":
        return (
          <del key={key} className="text-fg-muted line-through">
            {renderInline((token as Tokens.Del).tokens, key)}
          </del>
        );
      case "codespan":
        return (
          <code
            key={key}
            className="rounded-[5px] bg-white/7 px-1.5 py-0.5 font-mono text-[13.5px] text-fg"
          >
            {(token as Tokens.Codespan).text}
          </code>
        );
      case "link": {
        const link = token as Tokens.Link;
        return (
          <a
            key={key}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-input underline decoration-input/40 underline-offset-2 transition-colors hover:decoration-input"
          >
            {renderInline(link.tokens, key)}
          </a>
        );
      }
      case "br":
        return <br key={key} />;
      default:
        return "raw" in token && typeof token.raw === "string" ? token.raw : null;
    }
  });
};

const renderBlock = (token: Token, key: string): ReactNode => {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return (
        <p key={key} className="my-2.5 leading-[1.65] text-fg first:mt-0 last:mb-0">
          {renderInline((token as Tokens.Paragraph).tokens, key)}
        </p>
      );
    case "heading": {
      const h = token as Tokens.Heading;
      const sizeClass =
        h.depth === 1
          ? "mt-5 mb-2 text-[18px] font-semibold tracking-tight text-fg"
          : h.depth === 2
            ? "mt-4 mb-2 text-[16px] font-semibold tracking-tight text-fg"
            : "mt-3.5 mb-1.5 text-[15px] font-semibold text-fg";
      return (
        <div key={key} className={sizeClass}>
          {renderInline(h.tokens, key)}
        </div>
      );
    }
    case "code": {
      const c = token as Tokens.Code;
      return <CodeBlock key={key} code={c.text} {...(c.lang ? { lang: c.lang } : {})} />;
    }
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="my-3 border-l-2 border-edge-strong pl-3.5 text-fg-secondary"
        >
          {renderBlocks((token as Tokens.Blockquote).tokens, key)}
        </blockquote>
      );
    case "list": {
      const list = token as Tokens.List;
      const Tag = list.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={`my-2.5 space-y-1.5 pl-5 text-fg ${list.ordered ? "list-decimal" : "list-disc"} marker:text-fg-muted`}
        >
          {list.items.map((item, itemIdx) => (
            <li key={`${key}-li-${itemIdx}`} className="leading-[1.6] pl-0.5">
              {renderBlocks(item.tokens, `${key}-li-${itemIdx}`)}
            </li>
          ))}
        </Tag>
      );
    }
    case "hr":
      return <hr key={key} className="my-4 border-line" />;
    case "table": {
      const tbl = token as Tokens.Table;
      return (
        <div key={key} className="my-3 overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-left text-label">
            <thead>
              <tr className="border-b border-line bg-panel">
                {tbl.header.map((cell, ci) => (
                  <th key={`${key}-th-${ci}`} className="px-3 py-2 font-medium text-fg-secondary">
                    {renderInline(cell.tokens, `${key}-th-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tbl.rows.map((row, ri) => (
                <tr key={`${key}-tr-${ri}`} className="border-b border-line/60 last:border-b-0">
                  {row.map((cell, ci) => (
                    <td key={`${key}-td-${ri}-${ci}`} className="px-3 py-2 text-fg">
                      {renderInline(cell.tokens, `${key}-td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "text": {
      const t = token as Tokens.Text;
      return t.tokens ? (
        <span key={key}>{renderInline(t.tokens, key)}</span>
      ) : (
        <span key={key}>{t.text}</span>
      );
    }
    default:
      return "raw" in token && typeof token.raw === "string" ? (
        <p key={key} className="my-2 whitespace-pre-wrap text-fg">
          {token.raw}
        </p>
      ) : null;
  }
};

const renderBlocks = (tokens: ReadonlyArray<Token>, keyPrefix: string): ReactNode =>
  tokens.map((token, idx) => renderBlock(token, `${keyPrefix}-${idx}`));

const MarkdownBlock = memo(function MarkdownBlock({
  token,
  blockKey,
}: {
  readonly token: Token;
  readonly blockKey: string;
}) {
  return renderBlock(token, blockKey);
});

const getStreamCache = (cacheId: string): MarkdownStreamCache => {
  let cache = streamCaches.get(cacheId);
  if (!cache) {
    if (streamCaches.size >= MAX_STREAM_CACHES) {
      const oldest = streamCaches.keys().next().value;
      if (oldest !== undefined) streamCaches.delete(oldest);
    }
    cache = createMarkdownStreamCache();
    streamCaches.set(cacheId, cache);
  }
  return cache;
};

function StreamingMarkdownBody({ content }: { readonly content: string }) {
  const shown = useSmoothedStream(content, true);
  const cacheId = useId();

  useEffect(
    () => () => {
      streamCaches.delete(cacheId);
    },
    [cacheId],
  );

  const cache = getStreamCache(cacheId);
  const { settled, tail } = lexStreamingMarkdown(shown, cache);

  return (
    <div className="text-[15px] leading-[1.65] text-fg">
      {settled.map((token, idx) =>
        token.type === "space" ? null : (
          <MarkdownBlock key={`s-${idx}`} token={token} blockKey={`s-${idx}`} />
        ),
      )}
      {tail.map((token, idx) =>
        token.type === "space" ? null : (
          <MarkdownBlock key={`t-${idx}`} token={token} blockKey={`t-${idx}`} />
        ),
      )}
    </div>
  );
}

const StaticMarkdownBody = memo(function StaticMarkdownBody({
  content,
}: {
  readonly content: string;
}) {
  const tokens = marked.lexer(content);
  return (
    <div className="text-[15px] leading-[1.65] text-fg">
      {tokens.map((token, idx) =>
        token.type === "space" ? null : (
          <MarkdownBlock key={`m-${idx}`} token={token} blockKey={`m-${idx}`} />
        ),
      )}
    </div>
  );
});

interface MarkdownViewProps {
  readonly content: string;
  readonly streaming?: boolean;
}

export const MarkdownView = memo(function MarkdownView({
  content,
  streaming = false,
}: MarkdownViewProps) {
  return streaming ? (
    <StreamingMarkdownBody content={content} />
  ) : (
    <StaticMarkdownBody content={content} />
  );
});
