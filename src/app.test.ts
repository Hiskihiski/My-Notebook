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
