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

export const QUOTES = [
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
];
