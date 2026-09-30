import { describe, it, expect } from "vitest";
import rules from "../firestore.rules?raw";
import { TC, TL, FL, toTag } from "./types";

describe("tags", () => {
  it("match the tags firestore.rules accepts", () => {
    const list = rules.match(/function validTag\(v\)\s*\{\s*return v in \[([^\]]*)\]/)?.[1];
    expect(list, "validTag() not found in firestore.rules").toBeDefined();
    const ruleTags = [...list!.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(Object.keys(TL).sort()).toEqual(ruleTags);
    expect(Object.keys(TC).sort()).toEqual(ruleTags);
  });

  it("each have a filter label", () => {
    for (const tag of Object.keys(TL)) expect(FL).toHaveProperty(tag);
  });
});

describe("toTag", () => {
  it("keeps known tags", () => {
    for (const tag of Object.keys(TL)) expect(toTag(tag)).toBe(tag);
  });

  it("falls back to work for anything the form can't show", () => {
    for (const v of ["misc", "", "constructor", "__proto__", undefined, null, 1]) expect(toTag(v)).toBe("work");
  });
});
