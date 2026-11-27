import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";

export type SandboxAppearance = "dark" | "light";

export interface SandboxTheme {
  readonly appearance: SandboxAppearance;
  readonly tokens: Readonly<Record<string, string>>;
}

export const SANDBOX_TOKENS = [
  ...[
    "chrome",
    "canvas",
    "panel",
    "raised",
    "hover",
    "menu",
    "selected",
    "line",
    "edge",
    "edge-strong",
    "fg",
    "fg-secondary",
    "fg-muted",
    "fg-faint",
    "primary",
    "on-primary",
    "success",
    "warning",
    "danger",
  ].map((name) => `--color-${name}`),
  "--font-sans",
  "--font-mono",
  "--radius-chip",
  "--radius-control",
  "--radius-row",
  "--radius-card",
  "--shadow-raised",
  "--wash",
  "--wash-strong",
] as const;

const THEME_MESSAGE = "scuttle-viz:theme";
const HeightMessage = Schema.Struct({
  type: Schema.Literal("scuttle-viz:height"),
  height: Schema.Finite,
});
const isHeightMessage = Schema.is(HeightMessage);

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'";

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:dark}
html[data-appearance="light"]{color-scheme:light}
body{margin:0;padding:2px;background:transparent;color:var(--color-fg);font:14px/1.55 var(--font-sans,ui-sans-serif,system-ui,sans-serif);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
h1,h2,h3,h4{margin:0 0 .5em;color:var(--color-fg);font-weight:600;line-height:1.3;letter-spacing:-.01em}
h1{font-size:18px}h2{font-size:16px}h3,h4{font-size:14px}
p{margin:0 0 .75em;color:var(--color-fg-secondary)}
small,.muted{color:var(--color-fg-muted)}
a{color:var(--color-primary);text-decoration:none}
code,pre,kbd{font-family:var(--font-mono,ui-monospace,monospace);font-size:12.5px}
code{padding:1px 4px;border-radius:var(--radius-chip,6px);background:var(--wash)}
pre{margin:0 0 .75em;padding:10px 12px;border-radius:var(--radius-row,8px);background:var(--wash);overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;color:var(--color-fg-muted);font-size:12px}
th,td{padding:7px 10px;border-bottom:1px solid var(--color-line)}
button,select,input{font:inherit;font-size:13px;color:var(--color-fg);background:var(--wash);border:0;border-radius:var(--radius-control,7px);padding:4px 10px;box-shadow:inset 0 0 0 1px var(--color-edge);outline:none}
button{cursor:pointer}button:hover{background:var(--wash-strong)}
button:focus-visible,select:focus-visible,input:focus-visible{box-shadow:inset 0 0 0 1px var(--color-edge-strong),0 0 0 2px color-mix(in oklab,var(--color-primary) 40%,transparent)}
hr{border:0;border-top:1px solid var(--color-line);margin:12px 0}
.card{background:var(--color-raised);border-radius:var(--radius-card,10px);box-shadow:var(--shadow-raised);padding:14px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.primary{color:var(--color-primary)}.success{color:var(--color-success)}.warning{color:var(--color-warning)}.danger{color:var(--color-danger)}
svg text{fill:var(--color-fg-muted)}
`;

const BOOT = `(function(){var r=document.documentElement;
addEventListener("message",function(e){if(e.source!==parent)return;var m=e.data;if(!m||m.type!=="${THEME_MESSAGE}"||typeof m.tokens!=="object")return;
for(var k in m.tokens){if(k.indexOf("--")===0&&typeof m.tokens[k]==="string")r.style.setProperty(k,m.tokens[k]);}
r.setAttribute("data-appearance",m.appearance==="light"?"light":"dark");});
var post=function(){if(document.body)parent.postMessage({type:"scuttle-viz:height",height:Math.ceil(document.body.getBoundingClientRect().height)},"*");};
addEventListener("DOMContentLoaded",function(){post();if(typeof ResizeObserver!=="undefined")new ResizeObserver(post).observe(document.body);});
addEventListener("load",post);})();`;

const cssValue = (value: string) => value.replace(/[<>{};]/g, "");

export const buildSandboxSrcDoc = (html: string, theme: SandboxTheme): string => {
  const vars = Object.entries(theme.tokens)
    .filter(([name, value]) => name.startsWith("--") && value !== "")
    .map(([name, value]) => `${name}:${cssValue(value)}`)
    .join(";");
  return `<!doctype html><html data-appearance="${theme.appearance}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>:root{${vars}}${BASE_CSS}</style><script>${BOOT}</script></head><body>${html}</body></html>`;
};

export const readSandboxTheme = (): SandboxTheme => {
  if (typeof document === "undefined") return { appearance: "dark", tokens: {} };
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const tokens = Object.fromEntries(
    SANDBOX_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]),
  );
  return { appearance: root.dataset["appearance"] === "light" ? "light" : "dark", tokens };
};

export const clampFrameHeight = (height: number): number =>
  Math.min(1_600, Math.max(80, Math.ceil(height)));

export function VizSandboxFrame({
  title,
  html,
  height,
}: {
  readonly title: string;
  readonly html: string;
  readonly height?: number | undefined;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [initialTheme] = useState(readSandboxTheme);
  const [measured, setMeasured] = useState<number | null>(null);
  const srcDoc = buildSandboxSrcDoc(html, initialTheme);

  useEffect(() => {
    const frame = ref.current;
    if (frame === null) return;
    const push = () =>
      frame.contentWindow?.postMessage({ type: THEME_MESSAGE, ...readSandboxTheme() }, "*");
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !isHeightMessage(event.data)) return;
      setMeasured(clampFrameHeight(event.data.height));
    };
    const observer = new MutationObserver(push);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-appearance"],
    });
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", push);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", push);
    };
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{ height: height ?? measured ?? 240 }}
      className="block w-full rounded-row border-0 bg-transparent transition-[height] duration-150 ease-hover"
    />
  );
}
