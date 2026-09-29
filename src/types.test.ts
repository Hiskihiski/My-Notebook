import { describe, it, expect } from "vitest";
import rules from "../firestore.rules?raw";
import { TC, TL, FL } from "./types";

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
