import { describe, it, expect } from "vitest";
import { LANDING_TITLE } from "./landing";

const html = Object.values(import.meta.glob("../index.html", { query: "?raw", import: "default", eager: true }))[0] as string;
const doc = new DOMParser().parseFromString(html, "text/html");
const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content") ?? "";

describe("index.html SEO tags", () => {
  it("uses the landing page's title, at a length search results show in full", () => {
    expect(doc.title).toBe(LANDING_TITLE);
    expect(LANDING_TITLE.length).toBeGreaterThanOrEqual(50);
    expect(LANDING_TITLE.length).toBeLessThanOrEqual(60);
  });

  it("has a description, canonical URL and social preview tags", () => {
    const desc = meta('meta[name="description"]');
    expect(desc.length).toBeGreaterThanOrEqual(120);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://my-notebook-web.web.app/");
    expect(meta('meta[property="og:url"]')).toBe("https://my-notebook-web.web.app/");
    expect(meta('meta[property="og:image"]')).toBe("https://my-notebook-web.web.app/og-image.png");
    expect(meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  });

  it("has valid JSON-LD", () => {
    const ld = JSON.parse(doc.querySelector('script[type="application/ld+json"]')?.textContent ?? "");
    const types = ld["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(["WebSite", "WebApplication"]);
  });
});
