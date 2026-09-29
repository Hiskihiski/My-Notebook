import type { Draft } from "./types";

// Parses a stored new-note draft. localStorage can hold anything (corrupt
// JSON, older formats, hand-edited values), so fall back to safe defaults.
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.title !== "string" || typeof d.body !== "string") return null;
    return {
      title:  d.title,
      body:   d.body,
      tag:    d.tag === "ideas" || d.tag === "personal" ? d.tag : "work",
      pinned: d.pinned === true,
    };
  } catch { return null; }
}
