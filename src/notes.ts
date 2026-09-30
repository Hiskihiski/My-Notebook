import {
  serverTimestamp, type DocumentData, type QueryDocumentSnapshot, type Timestamp,
} from "firebase/firestore";
import { type FilterType, type Note, type SortOrder, toTag } from "./types";

// Note logic that doesn't need a live Firebase, kept out of app.ts (which
// initializes Firebase on import) so it can be unit-tested.

// Must match validTitle/validBody in firestore.rules (checked in notes.test.ts).
export const TITLE_MAX = 200;
export const BODY_MAX  = 20_000;

const isTimestamp = (v: unknown): v is Timestamp =>
  typeof (v as Timestamp | null)?.toMillis === "function";

const millis = (t: Timestamp | null | undefined): number => t?.toMillis() ?? 0;

// Stored notes are only as tidy as the oldest app version that wrote them, so
// coerce every field to the shape the UI relies on instead of trusting it.
// Unknown tag strings are kept so the card can still show them.
export function toNote(id: string, d: DocumentData): Note {
  return {
    id,
    uid:       typeof d.uid   === "string" ? d.uid   : "",
    title:     typeof d.title === "string" ? d.title : "",
    body:      typeof d.body  === "string" ? d.body  : "",
    tag:       typeof d.tag   === "string" ? d.tag as Note["tag"] : "work",
    pinned:    d.pinned === true,
    createdAt: isTimestamp(d.createdAt) ? d.createdAt : null,
    updatedAt: isTimestamp(d.updatedAt) ? d.updatedAt : null,
  };
}

// A pending serverTimestamp() reads as null by default, which sorted a
// just-added note last until the server confirmed it (never, while offline).
export function noteFromSnapshot(d: QueryDocumentSnapshot): Note {
  return toNote(d.id, d.data({ serverTimestamps: "estimate" }));
}

// Filter, search and sort for the card grid. Pinned notes always come first.
export function visibleNotes(notes: Note[], filter: FilterType, search: string, sort: SortOrder): Note[] {
  const q = search.trim().toLowerCase();
  return notes
    .filter((n) =>
      (filter === "pinned" ? n.pinned : filter === "all" ? true : n.tag === filter) &&
      (!q || `${n.title} ${n.body}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "oldest") return millis(a.createdAt) - millis(b.createdAt);
      if (sort === "az")     return a.title.localeCompare(b.title, undefined, { numeric: true }); // 2 before 10
      return millis(b.createdAt) - millis(a.createdAt);
    });
}

// Shortens to at most `max` UTF-16 units without splitting a surrogate pair,
// which would leave half an emoji behind.
export function clip(s: string, max: number): string {
  const c = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(c) ? c.slice(0, -1) : c;
}

// Drops blank lines and whitespace around a body but keeps the first line's
// indentation: in Markdown it can make that line a code block or nested item.
export function tidyBody(s: string): string {
  return s.replace(/^\s*\n/, "").trimEnd();
}

// Undo re-adds a deleted note as a new doc, so it has to pass today's create
// rules even if an older app version wrote it (unknown tag, long title, …).
export function restoreData(n: Note) {
  return {
    uid: n.uid, title: clip(n.title, TITLE_MAX), body: clip(n.body, BODY_MAX),
    tag: toTag(n.tag), pinned: n.pinned,
    createdAt: n.createdAt ?? serverTimestamp(),
    ...(n.updatedAt ? { updatedAt: n.updatedAt } : {}),
  };
}
