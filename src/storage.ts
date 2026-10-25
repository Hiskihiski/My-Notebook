// localStorage throws on any access when the browser blocks site data
// (cookies disabled), and setItem throws when storage is full. Nothing the
// app keeps there is essential, so treat those cases as empty storage rather
// than letting startup or a save crash.
export const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* blocked or full */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* blocked */ }
  },
};
