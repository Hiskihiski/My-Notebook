import { describe, it, expect } from "vitest";
import rules from "../firestore.rules?raw";
import { TC, TL, FL, toTag, tagClass, tagLabel } from "./types";

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

describe("tagClass / tagLabel", () => {
  it("use the display maps for known tags", () => {
    expect([tagClass("ideas"), tagLabel("ideas")]).toEqual([TC.ideas, TL.ideas]);
  });

  it("show unknown tags by name in the work color, prototype names included", () => {
    for (const t of ["misc", "constructor", "toString", "__proto__"]) {
      expect(tagClass(t)).toBe("tw");
      expect(tagLabel(t)).toBe(t);
    }
  });
});
