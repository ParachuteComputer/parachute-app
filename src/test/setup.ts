import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/dom";

// Testing-library's default `findBy*`/`waitFor` budget is 1000ms, which the
// APP-LEVEL integration tests (the ones that mount the real `<App/>`) now sit
// right on top of: the first such render in a file pays module init for the
// whole shell plus every chrome fetch, and the rail's pinned-note sub-list
// (app#131) pushed the cheapest of them from ~440ms to ~1375ms — over the
// line, so `App.test.tsx` and `AppFocusMode.test.tsx` were failing on `main`
// before this branch, and three more app-level files flaked in a loaded full
// run. This is a BUDGET, not a delay: a passing assertion resolves as soon as
// the element appears, so the only cost is how long a genuinely failing one
// waits. Raised once here rather than sprinkling `{ timeout }` at the call
// sites that happen to be nearest the line today.
configure({ asyncUtilTimeout: 3000 });

// Bun's runtime installs a broken `localStorage` global (missing methods) that
// shadows jsdom's implementation. Replace it with a simple in-memory Storage.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
  };
}

Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), writable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), writable: true });
