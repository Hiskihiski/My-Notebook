import { describe, it, expect } from "vitest";
import { parseDraft, isDraftChanged } from "./draft";

describe("parseDraft", () => {
  it("returns null for missing or unusable data", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft("null")).toBeNull();
    expect(parseDraft(JSON.stringify({ title: 1, body: "x" }))).toBeNull();
  });

  it("keeps a valid draft", () => {
    const d = { title: "t", body: "b", tag: "ideas", pinned: true };
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
  });

  it("falls back to safe defaults for tag and pinned", () => {
    expect(parseDraft(JSON.stringify({ title: "t", body: "b", tag: "<script>", pinned: "yes" })))
      .toEqual({ title: "t", body: "b", tag: "work", pinned: false });
  });
});

describe("isDraftChanged", () => {
  const base = { title: "T", body: "B", tag: "work" as const, pinned: false };
  it("is false for identical fields and true for any change", () => {
    expect(isDraftChanged(base, { ...base })).toBe(false);
    expect(isDraftChanged(base, { ...base, title: "T2" })).toBe(true);
    expect(isDraftChanged(base, { ...base, body: "B " })).toBe(true);
    expect(isDraftChanged(base, { ...base, tag: "ideas" })).toBe(true);
    expect(isDraftChanged(base, { ...base, pinned: true })).toBe(true);
  });
});
