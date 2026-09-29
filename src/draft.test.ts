import { describe, it, expect } from "vitest";
import { parseDraft } from "./draft";

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
