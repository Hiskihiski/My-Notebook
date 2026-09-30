import { describe, it, expect, vi } from "vitest";

// landing.ts leads to login.ts, which only needs these handles.
vi.mock("./firebase", () => ({ auth: {}, gProvider: {} }));
vi.mock("firebase/auth", () => ({}));

import { renderLanding } from "./landing";

describe("renderLanding", () => {
  it("lists the features and leads to the login screen", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    const root = document.getElementById("app")!;
    renderLanding(root);
    expect(root.querySelectorAll(".landing-feature")).toHaveLength(4);
    root.querySelector<HTMLButtonElement>(".landing-cta")!.click();
    expect(root.querySelector(".landing")).toBeNull();
    expect(document.getElementById("google-signin")).not.toBeNull();
  });
});
