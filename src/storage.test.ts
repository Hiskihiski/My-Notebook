import { describe, it, expect, vi, afterEach } from "vitest";
import { store } from "./storage";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("store", () => {
  it("reads, writes and removes like localStorage", () => {
    expect(store.get("k")).toBeNull();
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
    store.remove("k");
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("acts empty when the browser blocks site data", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(() => store.set("k", "v")).not.toThrow();
    expect(store.get("k")).toBeNull();
    expect(() => store.remove("k")).not.toThrow();
  });

  it("ignores a write when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(() => store.set("k", "v")).not.toThrow();
    expect(store.get("k")).toBeNull();
  });
});
