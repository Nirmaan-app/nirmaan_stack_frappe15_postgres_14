/**
 * Copy a string to the OS clipboard. ONE shared implementation, so a "copy" affordance anywhere in
 * the app puts exactly the string it was handed on the clipboard -- nothing formats it here.
 *
 * Calculator slice 1 (2026-09-09): extracted as a SHARED helper because the rate-helper panel needed
 * a copy control and `frontend/src` had none -- the only live implementation was inline in
 * `components/quick-calc/QuickCalc.tsx` (async clipboard + hidden-textarea fallback + a 1.4 s
 * confirmation). The fallback is reproduced here verbatim in shape; QuickCalc is deliberately NOT
 * rewired onto this module (out of that slice's scope) -- a later cleanup may point it here.
 *
 * Returns true when the text landed on the clipboard by either route, false otherwise. Never throws:
 * a caller decides what a failed copy looks like on its own surface.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea route (older browsers, or a context where the async clipboard
    // is blocked -- an insecure origin, a denied permission)
  }
  try {
    if (typeof document === "undefined") return false;
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(scratch);
    return ok;
  } catch {
    return false;
  }
}

/** How long a "copied" confirmation stays on screen, in ms (QuickCalc's 1.4 s, shared). */
export const COPY_CONFIRM_MS = 1400;
