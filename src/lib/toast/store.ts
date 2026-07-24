import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
  /**
   * Per-toast auto-dismiss override in ms. Absent → the Toaster's 4s default.
   * Microconfirmations (the field-write "✓ status → done" pulses) run shorter
   * (~1800ms) so a burst of quick edits doesn't stack a wall of toasts.
   */
  durationMs?: number;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, tone?: Toast["tone"], opts?: { durationMs?: number }): number;
  dismiss(id: number): void;
  clear(): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push(message, tone, opts) {
    const id = nextId++;
    set((s) => ({
      toasts: [...s.toasts, { id, message, tone: tone ?? "info", durationMs: opts?.durationMs }],
    }));
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  clear() {
    set({ toasts: [] });
  },
}));
