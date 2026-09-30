import { describe, it, expect } from "vitest";
import { serverTimestamp, type FieldValue, type QueryDocumentSnapshot, type Timestamp } from "firebase/firestore";
import rules from "../firestore.rules?raw";
import type { Note } from "./types";
import {
  TITLE_MAX, BODY_MAX, clip, noteFromSnapshot, restoreData, toNote, visibleNotes,
} from "./notes";

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as Timestamp;
const note = (over: Partial<Note> = {}): Note => ({
  id: "n", uid: "alice", title: "Title", body: "Body", tag: "work", pinned: false,
  createdAt: ts(1000), updatedAt: null, ...over,
});
const ids = (list: Note[]) => list.map((n) => n.id);

describe("limits", () => {
  it("match the sizes firestore.rules accepts", () => {
    const limit = (fn: string) => Number(rules.match(new RegExp(`function ${fn}\\(v\\).*size\\(\\) <= (\\d+)`))?.[1]);
    expect(limit("validTitle")).toBe(TITLE_MAX);
    expect(limit("validBody")).toBe(BODY_MAX);
  });
});

describe("toNote", () => {
  it("keeps a well-formed note", () => {
    const createdAt = ts(1), updatedAt = ts(2);
    expect(toNote("a", { uid: "alice", title: "t", body: "b", tag: "ideas", pinned: true, createdAt, updatedAt }))
      .toEqual({ id: "a", uid: "alice", title: "t", body: "b", tag: "ideas", pinned: true, createdAt, updatedAt });
  });

  it("coerces fields an older app version stored differently", () => {
    const n = toNote("a", { uid: "alice", title: 5, pinned: "yes", createdAt: 1_700_000_000_000, updatedAt: "today" });
    expect(n).toEqual({
      id: "a", uid: "alice", title: "", body: "", tag: "work", pinned: false, createdAt: null, updatedAt: null,
    });
  });

  it("keeps an unknown tag so the card can still show it", () => {
    expect(toNote("a", { tag: "misc" }).tag).toBe("misc");
  });

  it("leaves nothing that would crash the grid", () => {
    const n = toNote("a", {});
    expect(() => visibleNotes([n, note()], "all", "x", "az")).not.toThrow();
    expect(() => visibleNotes([n, note()], "all", "", "newest")).not.toThrow();
  });
});

describe("noteFromSnapshot", () => {
  it("reads a pending server timestamp as an estimate, not null", () => {
    const now = ts(Date.now());
    const snap = {
      id: "new",
      data: (o?: { serverTimestamps?: string }) =>
        ({ uid: "alice", title: "t", body: "", tag: "work", pinned: false,
           createdAt: o?.serverTimestamps === "estimate" ? now : null }),
    } as unknown as QueryDocumentSnapshot;
    const n = noteFromSnapshot(snap);
    expect(n.createdAt).toBe(now);
    // …so a just-added note is listed first, not last, under "Newest".
    expect(ids(visibleNotes([note({ id: "old" }), n], "all", "", "newest"))).toEqual(["new", "old"]);
  });
});

describe("visibleNotes", () => {
  const a = note({ id: "a", title: "banana", body: "Yellow fruit", tag: "work",     createdAt: ts(1) });
  const b = note({ id: "b", title: "Apple",  body: "red",          tag: "ideas",    createdAt: ts(3) });
  const c = note({ id: "c", title: "cherry", body: "Red too",      tag: "personal", createdAt: ts(2), pinned: true });
  const all = [a, b, c];

  it("sorts pinned first, then newest / oldest / A–Z", () => {
    expect(ids(visibleNotes(all, "all", "", "newest"))).toEqual(["c", "b", "a"]);
    expect(ids(visibleNotes(all, "all", "", "oldest"))).toEqual(["c", "a", "b"]);
    expect(ids(visibleNotes(all, "all", "", "az"))).toEqual(["c", "b", "a"]);
  });

  it("sorts numbers in titles by value under A–Z", () => {
    const t = (id: string, title: string) => note({ id, title });
    expect(ids(visibleNotes([t("10", "Week 10"), t("2", "week 2"), t("1", "Week 1")], "all", "", "az")))
      .toEqual(["1", "2", "10"]);
  });

  it("puts notes without a date last under Newest and first under Oldest", () => {
    const legacy = note({ id: "l", createdAt: null });
    expect(ids(visibleNotes([legacy, a, b], "all", "", "newest"))).toEqual(["b", "a", "l"]);
    expect(ids(visibleNotes([a, legacy, b], "all", "", "oldest"))).toEqual(["l", "a", "b"]);
  });

  it("filters by tag and by pinned", () => {
    expect(ids(visibleNotes(all, "ideas", "", "newest"))).toEqual(["b"]);
    expect(ids(visibleNotes(all, "pinned", "", "newest"))).toEqual(["c"]);
  });

  it("searches title and body, ignoring case and surrounding spaces", () => {
    expect(ids(visibleNotes(all, "all", "RED", "newest"))).toEqual(["c", "b"]);
    expect(ids(visibleNotes(all, "all", "  banana ", "newest"))).toEqual(["a"]);
    expect(ids(visibleNotes(all, "all", "red", "newest").filter((n) => n.tag === "ideas"))).toEqual(["b"]);
  });

  it("treats a whitespace-only search as no search", () => {
    expect(visibleNotes(all, "all", "   ", "newest")).toHaveLength(3);
  });

  it("does not reorder the list it was given", () => {
    const input = [a, b, c];
    visibleNotes(input, "all", "", "az");
    expect(input).toEqual([a, b, c]);
  });
});

describe("clip", () => {
  it("leaves short text alone", () => {
    expect(clip("hello", 10)).toBe("hello");
  });

  it("cuts long text to the limit", () => {
    expect(clip("x".repeat(250), TITLE_MAX)).toHaveLength(TITLE_MAX);
  });

  it("never splits an emoji in half", () => {
    const s = "x".repeat(199) + "😀";
    expect(clip(s, 200)).toBe("x".repeat(199));
    expect(clip("😀😀", 4)).toBe("😀😀");
  });
});

describe("restoreData", () => {
  it("re-creates a note with its original fields and timestamps", () => {
    const n = note({ tag: "ideas", pinned: true, createdAt: ts(1), updatedAt: ts(2) });
    expect(restoreData(n)).toEqual({
      uid: "alice", title: "Title", body: "Body", tag: "ideas", pinned: true, createdAt: n.createdAt, updatedAt: n.updatedAt,
    });
  });

  it("makes a note an older app version wrote pass today's create rules", () => {
    const r = restoreData(toNote("l", { uid: "alice", title: "x".repeat(300), body: "old", tag: "misc", pinned: false }));
    expect(r.title).toHaveLength(TITLE_MAX);
    expect(r.tag).toBe("work");
    expect(r).not.toHaveProperty("updatedAt");
    expect((r.createdAt as FieldValue).isEqual(serverTimestamp())).toBe(true);
  });
});
