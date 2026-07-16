// Live-preview editor mode — a per-device on/off toggle for the CM6
// live-preview decoration layer (src/lib/editor/live-preview.ts). Mirrors
// text-size.ts's read/write pattern, with the sentinel flipped: DEFAULT IS
// ON here (vs. text-size's "default" being the unset state), so the value
// worth persisting is "off" — storing "on" would be redundant. Removing the
// key on "on" keeps the common case (nobody has touched the setting) a
// clean localStorage with no live-preview key at all.
//
// This is a mount-time read, not a subscribed live value: CodeMirrorEditor
// builds its extension set once per mount (buildExtensions' `opts.livePreview`
// picks the CM6 parser/decoration/theme wiring), and NoteEditor/NoteNew read
// this pref when THEY mount. Flipping the Settings toggle takes effect the
// next time a note is opened — a runtime kill-switch, not a live Compartment
// swap (A4-SPEC.md §7: the escape hatch is the point, not smoothness here).

export const LIVE_PREVIEW_STORAGE_KEY = "notes:livePreview";

export function readStoredLivePreview(): boolean {
  try {
    return localStorage.getItem(LIVE_PREVIEW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeStoredLivePreview(on: boolean): void {
  try {
    if (on) localStorage.removeItem(LIVE_PREVIEW_STORAGE_KEY);
    else localStorage.setItem(LIVE_PREVIEW_STORAGE_KEY, "off");
  } catch {
    // storage unavailable — caller still applies visually for this session
  }
}
