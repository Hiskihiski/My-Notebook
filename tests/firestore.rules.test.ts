// Security rules tests. Run with `npm run test:rules`, which starts the
// Firestore emulator for the "demo-notebook" project (never real data).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, type Firestore,
} from "firebase/firestore";

let env: RulesTestEnvironment;

// rules-unit-testing hands out compat instances; the modular API unwraps them.
const db = (uid?: string) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

const note = (over: Record<string, unknown> = {}) => ({
  uid: "alice", title: "Hello", body: "**hi**", tag: "work", pinned: false,
  createdAt: serverTimestamp(), ...over,
});

const ALICE_NOTE = "AliceNote00000000001";
const LEGACY_NOTE = "LegacyNote0000000001";

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-notebook",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(admin, "notes", ALICE_NOTE), { ...note(), createdAt: Timestamp.now() });
    // Written by an older app version: bad tag, long title, extra field.
    await setDoc(doc(admin, "notes", LEGACY_NOTE), {
      uid: "alice", title: "x".repeat(300), body: "old", tag: "misc", pinned: false, color: "red",
    });
  });
});

describe("notes: allowed", () => {
  it("create a normal note", () => assertSucceeds(addDoc(collection(db("alice"), "notes"), note())));
  it("undo: re-create with the original timestamps", () => assertSucceeds(addDoc(collection(db("alice"), "notes"),
    note({ createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.fromMillis(1.1e12) }))));
  it("toggle pin", () => assertSucceeds(updateDoc(doc(db("alice"), "notes", ALICE_NOTE), { pinned: true })));
  it("edit title, body, tag, pinned and updatedAt", () => assertSucceeds(updateDoc(doc(db("alice"), "notes", ALICE_NOTE),
    { title: "New", body: "b", tag: "ideas", pinned: false, updatedAt: serverTimestamp() })));
  it("title of exactly 200 chars", () => assertSucceeds(addDoc(collection(db("alice"), "notes"), note({ title: "t".repeat(200) }))));
  it("body of exactly 20000 chars", () => assertSucceeds(addDoc(collection(db("alice"), "notes"), note({ body: "b".repeat(20000) }))));
  it("emoji body at the app's 20000 limit", () => assertSucceeds(addDoc(collection(db("alice"), "notes"), note({ body: "😀".repeat(10000) }))));
  it("read own note", () => assertSucceeds(getDoc(doc(db("alice"), "notes", ALICE_NOTE))));
  it("list own notes (the app's query)", () =>
    assertSucceeds(getDocs(query(collection(db("alice"), "notes"), where("uid", "==", "alice")))));
  it("pin a legacy note", () => assertSucceeds(updateDoc(doc(db("alice"), "notes", LEGACY_NOTE), { pinned: true })));
  it("delete a legacy note", () => assertSucceeds(deleteDoc(doc(db("alice"), "notes", LEGACY_NOTE))));
});

describe("notes: denied", () => {
  it("create with someone else's uid", () => assertFails(addDoc(collection(db("alice"), "notes"), note({ uid: "bob" }))));
  it("create with an unknown tag", () => assertFails(addDoc(collection(db("alice"), "notes"), note({ tag: "<img src=x onerror=alert(1)>" }))));
  it("create with an extra field", () => assertFails(addDoc(collection(db("alice"), "notes"), note({ admin: true }))));
  it("create without createdAt", () => {
    const n = note();
    delete (n as Record<string, unknown>).createdAt;
    return assertFails(addDoc(collection(db("alice"), "notes"), n));
  });
  it("create with a 201-char title", () => assertFails(addDoc(collection(db("alice"), "notes"), note({ title: "t".repeat(201) }))));
  it("create with a 20001-char body", () => assertFails(addDoc(collection(db("alice"), "notes"), note({ body: "b".repeat(20001) }))));
  it("create with pinned as a string", () => assertFails(addDoc(collection(db("alice"), "notes"), note({ pinned: "yes" }))));
  it("create with a custom ID that could break HTML", () => assertFails(setDoc(doc(db("alice"), "notes", 'x"><img src=x>'), note())));
  it("move a note to another user (change uid)", () => assertFails(updateDoc(doc(db("alice"), "notes", ALICE_NOTE), { uid: "bob" })));
  it("update to an unknown tag", () => assertFails(updateDoc(doc(db("alice"), "notes", ALICE_NOTE), { tag: "evil" })));
  it("update with an extra field", () => assertFails(updateDoc(doc(db("alice"), "notes", ALICE_NOTE), { admin: true })));
  it("another user reads the note", () => assertFails(getDoc(doc(db("bob"), "notes", ALICE_NOTE))));
  it("another user lists the notes", () =>
    assertFails(getDocs(query(collection(db("bob"), "notes"), where("uid", "==", "alice")))));
  it("another user edits the note", () => assertFails(updateDoc(doc(db("bob"), "notes", ALICE_NOTE), { title: "pwned" })));
  it("another user deletes the note", () => assertFails(deleteDoc(doc(db("bob"), "notes", ALICE_NOTE))));
  it("signed-out user reads a note", () => assertFails(getDoc(doc(db(), "notes", ALICE_NOTE))));
  it("write to another collection", () => assertFails(addDoc(collection(db("alice"), "other"), { a: 1 })));
});
