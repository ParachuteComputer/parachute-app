import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/dom";

// Testing-library's default `findBy*`/`waitFor` budget is 1000ms. c883f7a
// raised it to 3000ms claiming App.test.tsx/AppFocusMode.test.tsx already
// failed on `main` without it (app#131's pinned-note sub-list); checked at
// detached origin/main (e57a2b9) WITHOUT this bump — full suite, 215/215
// files, 2514/2514 tests — that claim didn't hold, so the bump was dropped.
//
// It came back for a real, DIFFERENT reason: this branch's own NavDrawer
// (d627032) adds a third persistent-chrome projection to every App-level
// render, and rendering it in a full, loaded `bun run test` run pushes these
// exact app-level integration tests over the 1000ms default:
//   - App.test.tsx > catch-all redirects to the root list, not /notes/notes
//   - AppFocusMode.test.tsx > Rail, NavDrawer, BottomTabBar, and the AGPL
//     footer are present before focus mode
//   - AppFocusMode.test.tsx > arming focus mode via the ghost button hides
//     Rail, NavDrawer, BottomTabBar, the footer, and shows the exit chip
//   - AppFocusMode.test.tsx > clicking the exit chip restores every chrome
//     element
// All four pass in isolation; only fail under the full suite's load. This is
// a BUDGET, not a delay: a passing assertion resolves as soon as the element
// appears, so the only cost is how long a genuinely failing one waits.
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
