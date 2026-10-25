import { terminate, clearIndexedDbPersistence, waitForPendingWrites } from "firebase/firestore";
import { db } from "./firebase";

// Firestore keeps an offline copy of the signed-in user's notes (IndexedDB)
// plus multi-tab bookkeeping in localStorage. Signing out removes both from
// the device (shared computers), see session.ts.

// True once every write has reached the server; false if some are still
// pending after `timeoutMs` (typically offline). Those edits only exist in the
// offline copy until they sync.
export function pendingWritesSynced(timeoutMs = 3000): Promise<boolean> {
  return Promise.race([
    waitForPendingWrites(db).then(() => true, () => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

// Terminates Firestore and deletes its offline copy; true if it was deleted.
// The page must reload afterwards: `db` is a module singleton that can't be
// used once terminated. Deleting fails while another tab still has the cache
// open; then that tab's localStorage state is left alone too, and it cleans
// up when it sees the sign-out itself.
export async function clearOfflineNotes(): Promise<boolean> {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err: unknown) {
    console.warn("Offline notes cache not cleared:", err);
    return false;
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("firestore_")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (err: unknown) {
    console.warn("Firestore tab state not cleared:", err);
  }
  return true;
}
