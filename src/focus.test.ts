import { describe, it, expect, beforeEach } from "vitest";
import { saveFocus, restoreFocus, tabbables, trapTarget, type ListFocusConfig } from "./focus";

const CFG: ListFocusConfig = { item: ".card", primary: ".card-open", keyed: ["card-open", "card-pin", "card-del"] };

const card = (id: string) => `
  <div class="card" data-id="${id}">
    <button class="card-open" data-id="${id}">${id}</button>
    <button class="card-pin" data-id="${id}">pin</button>
    <button class="card-del" data-id="${id}">del</button>
  </div>`;

let grid: HTMLDivElement;
let fab: HTMLButtonElement;

function render(ids: string[], foot = ""): void { grid.innerHTML = ids.map(card).join("") + foot; }
const q = (sel: string) => grid.querySelector<HTMLElement>(sel)!;

beforeEach(() => {
  document.body.innerHTML = `<div id="grid"></div><button id="fab">+</button>`;
  grid = document.getElementById("grid") as HTMLDivElement;
  fab  = document.getElementById("fab") as HTMLButtonElement;
});

describe("saveFocus", () => {
  it("ignores nothing focused", () => {
    expect(saveFocus(document.body, grid, CFG)).toBeNull();
    expect(saveFocus(null, grid, CFG)).toBeNull();
  });

  it("records the control's class, note id and card position", () => {
    render(["a", "b", "c"]);
    const s = saveFocus(q('.card-pin[data-id="b"]'), grid, CFG);
    expect(s).toMatchObject({ cls: "card-pin", id: "b", index: 1 });
  });
});

describe("restoreFocus after the list is rebuilt", () => {
  it("focuses the same control of the same note, wherever it moved", () => {
    render(["a", "b", "c"]);
    q('.card-pin[data-id="c"]').focus();
    const s = saveFocus(document.activeElement, grid, CFG)!;
    render(["c", "a", "b"]); // pinned note floats to the top
    expect(document.activeElement).toBe(document.body);
    const got = restoreFocus(grid, s, CFG, fab);
    expect(got).toBe(q('.card-pin[data-id="c"]'));
    expect(document.activeElement).toBe(got);
  });

  it("moves to the card that took a deleted card's place", () => {
    render(["a", "b", "c"]);
    q('.card-del[data-id="b"]').focus();
    const s = saveFocus(document.activeElement, grid, CFG)!;
    render(["a", "c"]);
    expect(restoreFocus(grid, s, CFG, fab)).toBe(q('.card-open[data-id="c"]'));
  });

  it("moves to the new last card when the last one was deleted", () => {
    render(["a", "b"]);
    q('.card-open[data-id="b"]').focus();
    const s = saveFocus(document.activeElement, grid, CFG)!;
    render(["a"]);
    expect(restoreFocus(grid, s, CFG, fab)).toBe(q('.card-open[data-id="a"]'));
  });

  it("falls back when the list is empty", () => {
    render(["a"]);
    q(".card-del").focus();
    const s = saveFocus(document.activeElement, grid, CFG)!;
    render([]);
    expect(restoreFocus(grid, s, CFG, fab)).toBe(fab);
  });

  it("finds links and id'd controls outside the cards again", () => {
    const foot = `<p><a href="/datenschutz.html">Datenschutz</a></p>`;
    render(["a"], foot);
    q('a[href="/datenschutz.html"]').focus();
    const s = saveFocus(document.activeElement, grid, CFG)!;
    expect(s.index).toBe(-1);
    render(["a", "b"], foot);
    expect(restoreFocus(grid, s, CFG, fab)).toBe(q('a[href="/datenschutz.html"]'));
  });

  it("returns to the original element when it is still in the document", () => {
    render(["a"]);
    const s = saveFocus(fab, grid, CFG)!;
    expect(restoreFocus(grid, s, CFG, null)).toBe(fab);
  });

  it("skips targets that cannot take focus", () => {
    render(["a"]);
    const s = saveFocus(q(".card-pin"), grid, CFG)!;
    render(["a"]);
    q(".card-pin").setAttribute("disabled", "");
    q(".card-open").setAttribute("disabled", "");
    expect(restoreFocus(grid, s, CFG, fab)).toBe(fab);
  });
});

describe("tabbables", () => {
  it("lists reachable controls in DOM order", () => {
    document.body.innerHTML = `
      <div id="d">
        <button id="x">x</button>
        <input id="i"><button disabled>no</button>
        <div tabindex="-1">no</div><div tabindex="0" id="t">t</div>
        <a>no href</a><a href="#" id="l">link</a>
        <div inert><button>no</button></div>
      </div>`;
    const ids = tabbables(document.getElementById("d")!, () => true).map((e) => e.id);
    expect(ids).toEqual(["x", "i", "t", "l"]);
  });
});

describe("trapTarget", () => {
  let dialog: HTMLElement, a: HTMLElement, b: HTMLElement, c: HTMLElement, outside: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = `<button id="out">out</button><div id="d"><button id="a">a</button><p id="p">text</p><button id="b">b</button><button id="c">c</button></div>`;
    [dialog, a, b, c, outside] = ["d", "a", "b", "c", "out"].map((id) => document.getElementById(id)!);
  });

  it("wraps Tab from the last control to the first", () => {
    expect(trapTarget(dialog, [a, b, c], c, false)).toBe(a);
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    expect(trapTarget(dialog, [a, b, c], a, true)).toBe(c);
  });

  it("leaves Tab between inner controls to the browser", () => {
    expect(trapTarget(dialog, [a, b, c], a, false)).toBeNull();
    expect(trapTarget(dialog, [a, b, c], c, true)).toBeNull();
    expect(trapTarget(dialog, [a, b, c], document.getElementById("p"), false)).toBeNull();
  });

  it("pulls focus that is outside the dialog back in", () => {
    expect(trapTarget(dialog, [a, b, c], outside, false)).toBe(a);
    expect(trapTarget(dialog, [a, b, c], document.body, true)).toBe(c);
    expect(trapTarget(dialog, [a, b, c], null, false)).toBe(a);
  });

  it("does nothing for a dialog without controls", () => {
    expect(trapTarget(dialog, [], outside, false)).toBeNull();
  });
});
