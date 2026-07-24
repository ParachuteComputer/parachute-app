// Test doubles for HTML5 drag-and-drop (views train E). jsdom implements
// neither `DataTransfer` nor `matchMedia`, so drag tests synthesize both: a
// minimal data store that mirrors the pieces the app touches (`setData` /
// `getData` / `types` / effect fields), and a pointer-class stub so
// `isFinePointer()` (src/lib/views/dnd.ts) sees a desktop or a touch device.

/**
 * A minimal DataTransfer stand-in. `types` reflects the set formats — the
 * readable surface drop targets sniff during dragover, when real browsers
 * protect the data itself.
 */
export function makeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  const dt = {
    dropEffect: "none",
    effectAllowed: "none",
    types: [] as string[],
    setData(format: string, data: string) {
      store.set(format, data);
      dt.types = [...store.keys()];
    },
    getData(format: string) {
      return store.get(format) ?? "";
    },
    clearData(format?: string) {
      if (format === undefined) store.clear();
      else store.delete(format);
      dt.types = [...store.keys()];
    },
    setDragImage() {},
  };
  return dt as unknown as DataTransfer;
}

/**
 * Stub `window.matchMedia` so `isFinePointer()` reports a desktop (fine) or
 * touch (coarse) device. Returns a restore function; call it in afterEach.
 */
export function stubPointer(kind: "fine" | "coarse"): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: kind === "fine" && query === "(pointer: fine)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
