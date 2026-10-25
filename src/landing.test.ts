import { describe, it, expect, vi } from "vitest";
import { renderLanding } from "./landing";

describe("renderLanding", () => {
  it("lists the features and hands \"Get started\" to the caller", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    const root = document.getElementById("app")!;
    const onGetStarted = vi.fn();
    renderLanding(root, onGetStarted);
    expect(root.querySelectorAll(".landing-feature")).toHaveLength(6);
    expect(onGetStarted).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".landing-cta")!.click();
    expect(onGetStarted).toHaveBeenCalledOnce();
  });
});
