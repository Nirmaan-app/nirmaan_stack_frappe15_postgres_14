import { useMemo } from "react";

/**
 * Which modifier this keyboard actually has, for the two shortcuts where the
 * platform differs: copy and select-all. Everything mathematical (+ - * / % ( )
 * . Enter Backspace) is identical on every keyboard and must never be routed
 * through here.
 *
 * Detection is on the platform string, not the layout, and it is only ever used
 * to decide *which modifier flag to read* and *what label to print*. Sizing and
 * touch behaviour are decided by media queries instead, so a Mac with a
 * touchscreen and a Windows tablet both behave correctly.
 */
export interface PlatformModifier {
    isApple: boolean;
    /** For display: "⌘" on Apple, "Ctrl" elsewhere. */
    label: string;
    /**
     * For display: "⌥" on Apple, "Alt" elsewhere. A Mac keyboard has no key
     * labelled Alt -- writing "Alt+K" in the UI sends a Mac user hunting for a key
     * that is not on their keyboard. Same physical key, different name on the cap.
     */
    altLabel: string;
    /** The toggle shortcut, spelled the way this platform spells it. */
    toggleLabel: string;
    /** True when the copy/select-all modifier for THIS platform is held. */
    isHeld: (event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) => boolean;
}

function detectApple(): boolean {
    if (typeof navigator === "undefined") return false;

    // userAgentData.platform is the supported route; navigator.platform is the
    // fallback for Safari and older Firefox.
    const platform =
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
        navigator.platform ||
        "";

    if (/Mac|iPhone|iPad|iPod/i.test(platform)) return true;

    // iPadOS 13+ reports itself as a Mac; both want Cmd, so either way this is right.
    return /Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function usePlatformModifier(): PlatformModifier {
    return useMemo(() => {
        const isApple = detectApple();
        return {
            isApple,
            label: isApple ? "⌘" : "Ctrl",
            altLabel: isApple ? "⌥" : "Alt",
            toggleLabel: isApple ? "⌥K" : "Alt+K",
            isHeld: (event) => (isApple ? event.metaKey : event.ctrlKey),
        };
    }, []);
}
