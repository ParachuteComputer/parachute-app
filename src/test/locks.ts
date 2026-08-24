// A minimal but REAL exclusive Web Locks implementation for tests.
//
// jsdom ships no `navigator.locks`, and the mirror's whole #79 item-2 argument
// is about what happens under CONTENTION — so shape-only spies aren't enough:
// several tests need a lock manager that actually queues, actually excludes,
// and actually honours the two escape hatches the app relies on. This models
// the slice of the spec the mirror uses:
//
//   - exclusive mode, one FIFO queue per name;
//   - `ifAvailable: true` does NOT queue — a contended request is handed a null
//     lock and the callback bails (the engine's background mode);
//   - `signal` cancels a request that is still QUEUED: it is dropped from the
//     queue, its callback never runs, and `request()` rejects with the signal's
//     reason. After the grant the signal is ignored, exactly as in the spec —
//     a deadline bounds the WAIT, never the held section.
//
// `signal` and `ifAvailable` are mutually exclusive in the real API; nothing
// here passes both, and this helper does not police it.

type LockCallback = (lock: unknown) => unknown;

/**
 * Install a working exclusive `navigator.locks` for the duration of a test.
 * Returns the restore function — call it in `afterEach`.
 */
export function installFifoLocks(): () => void {
  const tails = new Map<string, Promise<unknown>>();

  const request = async (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const options = (typeof a === "function" ? undefined : a) as LockOptions | undefined;
    const cb = (typeof a === "function" ? a : b) as LockCallback;
    const held = tails.get(name);

    if (held && options?.ifAvailable) return cb(null);

    const signal = options?.signal;
    if (signal?.aborted) throw signal.reason;

    let granted = false;
    let abandoned = false;
    const run = (held ?? Promise.resolve()).then(() => {
      // Dropped from the queue while waiting: never take the lock, never run.
      if (abandoned) return undefined;
      granted = true;
      return cb({ name, mode: "exclusive" });
    });
    // Keep the chain alive on rejection so one failed holder can't wedge the name.
    tails.set(
      name,
      run.catch(() => undefined),
    );
    if (!signal) return run;

    return await new Promise((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          // Only a still-QUEUED request is cancellable.
          if (granted) return;
          abandoned = true;
          reject(signal.reason);
        },
        { once: true },
      );
      run.then(resolve, reject);
    });
  };

  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  return () => {
    if (original) Object.defineProperty(navigator, "locks", original);
    else Reflect.deleteProperty(navigator as unknown as object, "locks");
  };
}

/**
 * Hold `name` until the returned `release()` is called — a stand-in for a drain
 * wedged on a fetch that never resolves. `held` settles once the lock is
 * actually taken, so a test can stage contention deterministically.
 */
export function holdLock(name: string): { held: Promise<void>; release: () => void } {
  let release!: () => void;
  const releasing = new Promise<void>((r) => {
    release = r;
  });
  let signalHeld!: () => void;
  const held = new Promise<void>((r) => {
    signalHeld = r;
  });
  void navigator.locks.request(name, async () => {
    signalHeld();
    await releasing;
  });
  return { held, release };
}
