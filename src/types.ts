import type { Timestamp } from "firebase/firestore";

export type Tag        = "work" | "ideas" | "personal";
export type FilterType = "all" | "pinned" | Tag;
export type SortOrder  = "newest" | "oldest" | "az";

export interface Note {
  id:         string;
  uid:        string;
  title:      string;
  body:       string;
  tag:        Tag;
  pinned:     boolean;
  createdAt:  Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Draft { title: string; body: string; tag: Tag; pinned: boolean }

export const TC: Record<Tag, string>        = { work: "tw", ideas: "ti", personal: "tp" };
export const TL: Record<Tag, string>        = { work: "Work", ideas: "Ideas", personal: "Personal" };
const isTag = (v: unknown): v is Tag => typeof v === "string" && Object.hasOwn(TL, v);

// Tags an older app version wrote (or a hand-edited draft holds) can't be
// saved again, so the edit form falls back to "work" for them.
export function toTag(v: unknown): Tag {
  return isTag(v) ? v : "work";
}

// How a stored tag is shown. Unknown ones keep their name and the work color;
// hasOwn keeps a tag like "constructor" from reading Object.prototype.
export const tagClass = (t: string): string => isTag(t) ? TC[t] : "tw";
export const tagLabel = (t: string): string => isTag(t) ? TL[t] : t;

export const FL: Record<FilterType, string> = {
  all: "All Notes", pinned: "Pinned",
  work: "Work", ideas: "Ideas", personal: "Personal",
};
export const SORT_LABELS: Record<SortOrder, string> = {
  newest: "↓ Newest",
  oldest: "↑ Oldest",
  az:     "A–Z",
};

// What the sidebar mascot says. ACTIVE_QUOTE_GROUP picks the group at build
// time; every group needs at least two phrases, or the rotation shows no change.
// The "personal" phrases name real people, so they never go into git: they come
// from VITE_MASCOT_PERSONAL_QUOTES in .env ("phrase one|phrase two"), and only
// end up in the bundle while the switch is on "personal".
type QuoteGroup = "default" | "personal";

export const QUOTE_GROUPS = {
  default: [
    "You got this. Probably.",
    "Genius at work. Allegedly.",
    "One note at a time, boss.",
    "Touch grass later. Write now.",
    "Big brain energy detected.",
    "Future you says: nice work.",
    "Main character behavior.",
    "Notes are just vibes with ambition.",
    "You're built different. Literally.",
    "Coffee is optional. You are not.",
    "Award-winning note-taker.",
    "Productivity? She's right here.",
  ],
};

// `as` instead of an annotation, so TS doesn't narrow it and flag the check below.
const ACTIVE_QUOTE_GROUP = "personal" as QuoteGroup;

// "a|b|c" → ["a", "b", "c"], or null if fewer than two phrases are left.
export function parseQuotes(raw: string | undefined): string[] | null {
  const quotes = (raw ?? "").split("|").map((q) => q.trim()).filter(Boolean);
  return quotes.length >= 2 ? quotes : null;
}

// Without the .env value (CI, a fresh clone) the default phrases show instead.
export const QUOTES: string[] = ACTIVE_QUOTE_GROUP === "personal"
  ? parseQuotes(import.meta.env.VITE_MASCOT_PERSONAL_QUOTES) ?? QUOTE_GROUPS.default
  : QUOTE_GROUPS.default;
