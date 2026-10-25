import { marked } from "marked";
import DOMPurify from "dompurify";

// breaks:true keeps the old behavior where a single newline becomes a <br>.
marked.use({ breaks: true, gfm: true });

// Web links in a note open in a new tab rather than navigating the app away.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") ?? "")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Full markdown rendering for the view modal. marked's output is sanitized so
// note content can never inject scripts or event handlers. The rendered note
// stays in the page after the view closes, so its ids are prefixed (an
// id="toast" would otherwise capture every later toast), forms are dropped
// (Enter in one would reload the app) and so are inline styles (a fixed,
// full-screen element could cover the app's own controls).
export function renderMd(raw: string): string {
  const html = marked.parse(raw, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }, SANITIZE_NAMED_PROPS: true, FORBID_TAGS: ["form"], FORBID_ATTR: ["style"],
  });
}

// A link/image destination: "(url)", allowing one level of parentheses inside
// it as in "(https://en.wikipedia.org/wiki/Foo_(bar))".
const DEST = String.raw`\((?:[^()]|\([^()]*\))*\)`;
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]` + DEST, "g");
const LINK  = new RegExp(String.raw`\[([^\]]+)\]` + DEST, "g");

// Plain-ish single-line preview for cards: strips markdown syntax, keeps
// bold/italic so the preview hints at formatting.
export function previewMd(raw: string): string {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Line markers first, so a "* " bullet can't pair up with an emphasis star.
    .replace(/^#{1,6} /gm, "")
    .replace(/^&gt; ?/gm, "")
    .replace(/^[-*] /gm, "")
    .replace(IMAGE, "&#x1F5BC;&#xFE0F; $1")
    .replace(LINK, "$1")
    // As in CommonMark, emphasis can't start or end next to a space ("2 * 3").
    .replace(/\*\*([^\s*](?:.*?[^\s*])?)\*\*/g, "<b>$1</b>")
    .replace(/\*([^\s*](?:.*?[^\s*])?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, "$1");
}

// The text a note shows once rendered, for search: markdown syntax removed,
// link and image targets dropped (their text kept).
export function markdownText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, "")
    .replace(/\*\*|__|~~|[*_`]/g, "");
}
