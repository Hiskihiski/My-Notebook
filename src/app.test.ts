import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "firebase/auth";
import type { Timestamp } from "firebase/firestore";

// app.ts only needs these handles and calls; mocking them keeps Firebase from
// starting and lets the tests play the Firestore listener.
vi.mock("./firebase", () => ({ auth: {}, db: {} }));
vi.mock("firebase/auth", () => ({ signOut: vi.fn(() => Promise.resolve()) }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(),
  doc: vi.fn((_db: unknown, _path: string, id: string) => ({ id })),
  onSnapshot: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));

import { addDoc, deleteDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { renderApp, teardownApp } from "./app";

type Doc = Record<string, unknown> & { id: string };
type Listener = (snap: { docs: { id: string; data: () => object }[] }) => void;

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as Timestamp;
const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const alice = { uid: "alice", displayName: "Ada Lovelace", email: "ada@example.com" } as User;

let emit: Listener;
const unsub = vi.fn();
let root: HTMLElement;

function send(...docs: Doc[]): void {
  emit({ docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) });
}
const note = (over: Partial<Doc> = {}): Doc => ({
  id: "n1", uid: "alice", title: "Groceries", body: "milk", tag: "work", pinned: false, createdAt: ts(1000), ...over,
});
const cardIds = () => [...document.querySelectorAll<HTMLElement>(".card")].map((c) => c.dataset.id);
const type = (id: string, value: string) => {
  const input = el(id);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (target: EventTarget, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
const isOpen = (id: string) => el(id).classList.contains("open");
const toastText = () => el("toast")?.querySelector("span")?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(onSnapshot).mockImplementation(((_q: unknown, next: Listener) => { emit = next; return unsub; }) as never);
  vi.mocked(addDoc).mockReset().mockResolvedValue({} as never);
  vi.mocked(updateDoc).mockReset().mockResolvedValue();
  vi.mocked(deleteDoc).mockReset().mockResolvedValue();
  unsub.mockClear();
  document.body.innerHTML = `<div id="app"></div>`;
  root = el("app");
  renderApp(root, alice);
});
afterEach(() => {
  teardownApp();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("note list", () => {
  it("shows the notes from the listener, pinned first, newest next", () => {
    send(note({ id: "old", createdAt: ts(1) }), note({ id: "new", createdAt: ts(3) }), note({ id: "pin", pinned: true, createdAt: ts(2) }));
    expect(cardIds()).toEqual(["pin", "new", "old"]);
    expect(el("note-count").textContent).toBe("Free · 3 notes");
  });

  it("still renders when a stored note is malformed", () => {
    send(note({ id: "ok" }), { id: "bad", uid: "alice", createdAt: 5 });
    expect(cardIds()).toEqual(["ok", "bad"]);
  });

  it("sorts A–Z the way people count", () => {
    send(note({ id: "10", title: "Note 10" }), note({ id: "2", title: "note 2" }), note({ id: "1", title: "Note 1" }), note({ id: "a", title: "apple" }));
    el("sort-btn").click(); // oldest
    el("sort-btn").click(); // A–Z
    expect(cardIds()).toEqual(["a", "1", "2", "10"]);
  });

  it("shows tags an older version wrote by name, without miscounting them", () => {
    send(note({ id: "m", tag: "misc" }), note({ id: "c", tag: "constructor" }), note({ id: "p", tag: "pinned" }), note({ id: "x", tag: "<b>x</b>" }));
    const tag = (id: string) => document.querySelector(`.card[data-id="${id}"] .ctag`)!;
    expect(tag("m").textContent).toBe("misc");
    expect(tag("m").className).toBe("ctag tw");
    expect(tag("c").textContent).toBe("constructor");
    expect(tag("c").className).toBe("ctag tw");
    expect(tag("x").textContent).toBe("<b>x</b>");
    expect(document.querySelector('[data-count="pinned"]')!.textContent).toBe("0");
    expect(document.querySelector('[data-count="all"]')!.textContent).toBe("4");

    document.querySelector<HTMLElement>('.card[data-id="c"]')!.click();
    expect(el("view-tag").textContent).toBe("constructor");
    expect(el("view-tag").className).toBe("ctag tw");
  });

  it("filters as you type in the search box", () => {
    send(note({ id: "a", title: "Groceries" }), note({ id: "b", title: "Taxes", body: "receipts" }));
    type("search-input", "  RECEIPTS ");
    vi.advanceTimersByTime(120);
    expect(cardIds()).toEqual(["b"]);
  });
});

describe("editing", () => {
  it("saves a note whose tag the form doesn't offer as a tag the rules accept", () => {
    send(note({ tag: "misc" }));
    document.querySelector<HTMLElement>(".card-edit")!.click();
    expect(el<HTMLSelectElement>("ntag").value).toBe("work");
    type("nt", "Groceries!");
    el("save-btn").click();
    expect(updateDoc).toHaveBeenCalledWith({ id: "n1" }, expect.objectContaining({ tag: "work", title: "Groceries!" }));
  });

  it("doesn't write, or mark the note edited, when Save changes nothing", () => {
    send(note({ tag: "misc" }));
    document.querySelector<HTMLElement>(".card-edit")!.click();
    el("save-btn").click();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(isOpen("ov")).toBe(false);

    document.querySelector<HTMLElement>(".card-edit")!.click();
    type("nb", "milk, eggs");
    el("save-btn").click();
    expect(updateDoc).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open when a text selection is dragged onto the backdrop", () => {
    send(note());
    document.querySelector<HTMLElement>(".card-edit")!.click();
    el("nb").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el("ov").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOpen("ov")).toBe(true);
  });

  it("keeps the text as a draft when a new note is rejected", async () => {
    vi.mocked(addDoc).mockRejectedValueOnce(new Error("permission-denied"));
    el("fab").click();
    type("nt", "Idea");
    type("nb", "details");
    el("save-btn").click();
    expect(localStorage.getItem("noteDraft:alice")).toBeNull();
    await flush();
    expect(JSON.parse(localStorage.getItem("noteDraft:alice")!)).toEqual({ title: "Idea", body: "details", tag: "work", pinned: false });
    expect(toastText()).toBe("Couldn't save — your text is kept as a draft");
  });

  it("doesn't show one user's draft to the next", () => {
    el("fab").click();
    type("nt", "secret");
    teardownApp();
    renderApp(root, { uid: "bob", displayName: "Bob", email: "bob@example.com" } as User);
    el("fab").click();
    expect(el("nt").value).toBe("");
  });
});

describe("delete and undo", () => {
  it("re-creates a note an older version wrote in a form the rules accept", () => {
    send(note({ title: "x".repeat(300), tag: "misc", pinned: "yes", createdAt: undefined }));
    document.querySelector<HTMLElement>(".card-del")!.click();
    expect(deleteDoc).toHaveBeenCalledWith({ id: "n1" });
    el("toast-undo").click();
    expect(addDoc).toHaveBeenCalledWith({}, {
      uid: "alice", title: "x".repeat(200), body: "milk", tag: "work", pinned: false, createdAt: "SERVER_TS",
    });
  });

  it("says so when the note can't be restored", async () => {
    vi.mocked(addDoc).mockRejectedValueOnce(new Error("permission-denied"));
    send(note());
    document.querySelector<HTMLElement>(".card-del")!.click();
    el("toast-undo").click();
    await flush();
    expect(toastText()).toBe("Couldn't restore the note");
  });
});

describe("note view", () => {
  it("doesn't let HTML ids in a note hijack the app's toast or date", () => {
    send(note({ id: "html", body: '<div id="toast"></div><span id="view-date"></span>', createdAt: ts(Date.now()) }), note({ id: "other" }));
    document.querySelector<HTMLElement>('.card[data-id="html"]')!.click();
    expect(el("view-date").closest("#view-body")).toBeNull();
    expect(el("view-date").textContent).toBe("Created Just now");
    key(document, { key: "Escape" });

    document.querySelector<HTMLElement>('.card-del[data-id="other"]')!.click();
    expect(el("toast").closest("#view-body")).toBeNull();
    expect(el("toast").classList.contains("show")).toBe(true);
    expect(el("toast-undo")).not.toBeNull();
  });
});

describe("loading errors", () => {
  let fail: (err: Error) => void;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(onSnapshot).mockImplementation(((_q: unknown, next: Listener, error: typeof fail) => {
      emit = next; fail = error; return unsub;
    }) as never);
    teardownApp();
    renderApp(root, alice);
    vi.mocked(onSnapshot).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("offers Retry, which listens again", () => {
    fail(new Error("permission-denied"));
    expect(el("note-count").textContent).toBe("Couldn't load notes");
    el("notes-retry").click();
    expect(onSnapshot).toHaveBeenCalledOnce();
    expect(el("note-count").textContent).toBe("Loading…");
    send(note());
    expect(cardIds()).toEqual(["n1"]);
  });

  it("keeps the skeletons, not an empty notebook, until the notes arrive", () => {
    document.querySelector<HTMLElement>('.ni[data-filter="work"]')!.click();
    expect(el("grid").querySelector(".sk-card")).not.toBeNull();
    expect(el("grid").textContent).not.toContain("Nothing here yet");
    send(note());
    expect(cardIds()).toEqual(["n1"]);
  });

  it("keeps the error and Retry when the list is re-rendered", () => {
    fail(new Error("permission-denied"));
    document.querySelector<HTMLElement>('.ni[data-filter="work"]')!.click();
    el("sort-btn").click();
    type("search-input", "x");
    vi.advanceTimersByTime(120);
    expect(el("grid").textContent).not.toContain("Your notebook is empty");
    expect(el("notes-retry")).not.toBeNull();
  });
});

describe("filters, search and sort", () => {
  beforeEach(() => {
    send(note({ id: "w", tag: "work" }), note({ id: "i", tag: "ideas", pinned: true }), note({ id: "p", tag: "personal" }));
  });

  it("filter from the sidebar or the mobile bar, and count each", () => {
    document.querySelector<HTMLElement>('.mn-btn[data-filter="ideas"]')!.click();
    expect(cardIds()).toEqual(["i"]);
    expect(el("ptitle").textContent).toBe("Ideas");
    expect(document.querySelector('.ni[data-filter="ideas"]')!.classList.contains("on")).toBe(true);
    document.querySelector<HTMLElement>('.ni[data-filter="pinned"]')!.click();
    expect(cardIds()).toEqual(["i"]);
    const count = (f: string) => document.querySelector(`[data-count="${f}"]`)!.textContent;
    expect([count("all"), count("pinned"), count("work"), count("ideas"), count("personal")]).toEqual(["3", "1", "1", "1", "1"]);
  });

  it("says nothing matches rather than inviting a first note", () => {
    type("search-input", "zzz");
    vi.advanceTimersByTime(120);
    expect(el("grid").textContent).toContain("Nothing here yet");
  });

  it("clears the search from its button or with Escape", () => {
    type("search-input", "zzz");
    el("search-clear").click();
    expect(el("search-input").value).toBe("");
    expect(cardIds()).toHaveLength(3);

    type("search-input", "zzz");
    el("search-input").focus();
    key(el("search-input"), { key: "Escape" });
    expect(el("search-input").value).toBe("");
    expect(cardIds()).toHaveLength(3);
  });

  it("cycles Newest → Oldest → A–Z → Newest", () => {
    const labels = [el("sort-btn").textContent];
    for (let i = 0; i < 3; i++) { el("sort-btn").click(); labels.push(el("sort-btn").textContent); }
    expect(labels).toEqual(["↓ Newest", "↑ Oldest", "A–Z", "↓ Newest"]);
  });
});

describe("note view actions", () => {
  beforeEach(() => {
    send(note({ id: "a", title: "Alpha", body: "**hi**" }), note({ id: "b" }));
    document.querySelector<HTMLElement>('.card[data-id="a"]')!.click();
  });

  it("renders the note's Markdown", () => {
    expect(el("view-title").textContent).toBe("Alpha");
    expect(el("view-body").innerHTML).toContain("<strong>hi</strong>");
  });

  it("follows live changes and closes if the note is deleted elsewhere", () => {
    send(note({ id: "a", title: "Alpha 2", pinned: true }), note({ id: "b" }));
    expect(el("view-title").textContent).toBe("Alpha 2");
    expect(el("view-pin-badge").classList.contains("show")).toBe(true);
    send(note({ id: "b" }));
    expect(isOpen("ov-view")).toBe(false);
  });

  it("pins, edits and deletes the open note", () => {
    el("view-pin-btn").click();
    expect(updateDoc).toHaveBeenCalledWith({ id: "a" }, { pinned: true });
    el("view-edit").click();
    expect(isOpen("ov-view")).toBe(false);
    expect(isOpen("ov")).toBe(true);
    expect(el("nt").value).toBe("Alpha");
    key(el("nt"), { key: "Escape" });
    expect(isOpen("ov")).toBe(false);

    document.querySelector<HTMLElement>('.card[data-id="a"]')!.click();
    el("view-del-btn").click();
    expect(deleteDoc).toHaveBeenCalledWith({ id: "a" });
    expect(isOpen("ov-view")).toBe(false);
  });
});

describe("dialog and card buttons", () => {
  it("Cmd+Enter saves, a double press saves once", () => {
    el("fab").click();
    type("nt", "Quick");
    key(el("nt"), { key: "Enter", metaKey: true });
    key(el("nt"), { key: "Enter", metaKey: true });
    expect(addDoc).toHaveBeenCalledOnce();
    expect(addDoc).toHaveBeenCalledWith({}, expect.objectContaining({ uid: "alice", title: "Quick", body: "", createdAt: "SERVER_TS" }));
  });

  it("keeps the first line's indentation (a Markdown code block) but drops blank edges", () => {
    el("fab").click();
    type("nt", "  Snippet  ");
    type("nb", "\n\n    const x = 1;\n  \n");
    el("save-btn").click();
    expect(addDoc).toHaveBeenCalledWith({}, expect.objectContaining({ title: "Snippet", body: "    const x = 1;" }));

    el("fab").click();
    type("nb", " \n \t ");
    el("save-btn").click();
    expect(addDoc).toHaveBeenLastCalledWith({}, expect.objectContaining({ title: "Untitled", body: "" }));
  });

  it("Cancel discards a new note's draft; Escape keeps it", () => {
    el("fab").click();
    type("nt", "keep me");
    key(el("nt"), { key: "Escape" });
    el("fab").click();
    expect(el("nt").value).toBe("keep me");
    el("cancel-btn").click();
    el("fab").click();
    expect(el("nt").value).toBe("");
  });

  it("forgets a draft that was emptied again", () => {
    el("fab").click();
    type("nt", "x");
    type("nt", "  ");
    expect(localStorage.getItem("noteDraft:alice")).toBeNull();
  });

  it("warns when saving offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    el("fab").click();
    type("nt", "Plane notes");
    el("save-btn").click();
    expect(toastText()).toBe("Saved offline — will sync when you're back online");
    vi.restoreAllMocks();
  });

  it("pins from the card and reports a failed delete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send(note());
    document.querySelector<HTMLElement>(".card-pin")!.click();
    expect(updateDoc).toHaveBeenCalledWith({ id: "n1" }, { pinned: true });
    vi.mocked(deleteDoc).mockRejectedValueOnce(new Error("unavailable"));
    document.querySelector<HTMLElement>(".card-del")!.click();
    await flush();
    expect(toastText()).toBe("Couldn't delete — try again");
    vi.restoreAllMocks();
  });
});

describe("sign out", () => {
  it("clears the draft, tears down and signs out", async () => {
    const { signOut } = await import("firebase/auth");
    el("fab").click();
    type("nt", "private");
    el("signout-btn").click();
    expect(localStorage.getItem("noteDraft:alice")).toBeNull();
    expect(unsub).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("mascot", () => {
  it("rotates its quote every few seconds", () => {
    const first = el("qb").textContent;
    vi.advanceTimersByTime(4000 + 290);
    expect(el("qb").textContent).not.toBe(first);
    expect(el("fig").classList.contains("boing")).toBe(true);
    vi.advanceTimersByTime(600);
    expect(el("fig").classList.contains("boing")).toBe(false);
  });
});

describe("keyboard", () => {
  it("Escape closes the note view, then nothing else", () => {
    send(note());
    document.querySelector<HTMLElement>(".card")!.click();
    expect(isOpen("ov-view")).toBe(true);
    key(document, { key: "Escape" });
    expect(isOpen("ov-view")).toBe(false);
  });

  it("/ focuses search, but not from inside an open dialog", () => {
    key(document.body, { key: "/" });
    expect(document.activeElement).toBe(el("search-input"));

    el("search-input").blur();
    el("fab").click();
    const tag = el<HTMLSelectElement>("ntag");
    tag.focus();
    const handled = !key(tag, { key: "/" });
    expect(document.activeElement).toBe(tag);
    expect(handled).toBe(false);
  });

  it("Cmd/Ctrl+N opens a new note", () => {
    key(document, { key: "n", ctrlKey: true });
    expect(isOpen("ov")).toBe(true);
    expect(el("modal-title").textContent).toBe("New note");
  });
});

describe("with site data blocked", () => {
  // Browsers with cookies/site data disabled throw on any localStorage access.
  beforeEach(() => {
    teardownApp();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("still starts, and saves a note", () => {
    expect(() => renderApp(root, alice)).not.toThrow();
    send(note());
    expect(cardIds()).toEqual(["n1"]);
    el("fab").click();
    type("nt", "Idea");
    el("save-btn").click();
    expect(addDoc).toHaveBeenCalledOnce();
    expect(isOpen("ov")).toBe(false);
  });
});

describe("teardownApp", () => {
  it("leaves no listener, timer or shortcut behind", () => {
    type("search-input", "milk"); // arms the search debounce
    teardownApp();
    expect(unsub).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    key(document, { key: "n", metaKey: true });
    expect(isOpen("ov")).toBe(false);
  });
});
