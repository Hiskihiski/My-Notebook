import { marked } from "marked";
import DOMPurify from "dompurify";

// breaks:true keeps the old behavior where a single newline becomes a <br>.
marked.use({ breaks: true, gfm: true });

// Full markdown rendering for the view modal. marked's output is sanitized so
// note content can never inject scripts or event handlers.
export function renderMd(raw: string): string {
  const html = marked.parse(raw, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

// Plain-ish single-line preview for cards: strips markdown syntax, keeps
// bold/italic so the preview hints at formatting.
export function previewMd(raw: string): string {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "&#x1F5BC;&#xFE0F; $1")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#{1,6} /gm, "")
    .replace(/^[-*] /gm, "");
}
