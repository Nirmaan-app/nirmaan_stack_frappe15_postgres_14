import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect } from "react";
import { PlatformModifier } from "./usePlatformModifier";

/**
 * Quick Calc -- keyboard handling, and the whole of the input-priority rule.
 *
 * The rule is enforced by WHERE this handler is attached, not by a condition
 * inside it. `useCalcKeyboard` returns an onKeyDown for the widget's own root
 * element, so React only ever calls it for events originating inside the
 * calculator's subtree. If the user is typing in a PR form, a data table, a
 * search box or a Radix dialog, this code does not run at all -- there is no
 * `window` listener for +, -, *, /, Enter or Backspace to get wrong, and
 * nothing to leak when the widget unmounts.
 *
 * The one exception is `useQuickCalcHotkey` below: a single Alt+K binding on
 * window (⌥K on a Mac -- same physical key, different name on the cap), because
 * opening the calculator has to be possible while focus is elsewhere. It is a
 * modifier combination no Nirmaan screen claims, and it is the only global key
 * listener this feature installs.
 */

export interface CalcKeyboardActions {
    evaluate: () => void;
    /** Clears the draft: the expression, and the result or error under it. */
    clear: () => void;
    /** Clears the tape. The second rung of the Escape ladder; no undo. */
    clearHistory: () => void;
    minimise: () => void;
    copyResult: () => void;
    /** Used only for `x`/`X` -> `*`; every other character is left to the native input. */
    insert: (text: string) => void;
    /**
     * Whether the draft holds anything -- read imperatively, not passed as a
     * boolean. The expression lives on the input element (see QuickCalc), and a
     * keypad tap plus an Escape can land in one batch, where state from the last
     * committed render would still read empty and send Escape down the wrong rung.
     */
    hasDraft: () => boolean;
    /** Whether the tape holds anything for the ladder's second rung. */
    hasHistory: boolean;
    hasResult: boolean;
    /** True when the user has selected text in the expression field. */
    hasSelection: () => boolean;
    /**
     * True while a finished result is on screen. The next typed character then goes
     * through `insert` rather than the native input, so typing starts a new entry
     * exactly like tapping does.
     */
    resultIsSettled: boolean;
    /** Called after a handled key, for the result/error repaint. */
    onKeyHandled?: () => void;
}

/** Characters the expression field accepts straight from the native input. */
const PASSTHROUGH = "0123456789+-*/%().";

export function useCalcKeyboard(
    actions: CalcKeyboardActions,
    modifier: PlatformModifier
): (event: ReactKeyboardEvent<HTMLElement>) => void {
    const {
        evaluate,
        clear,
        clearHistory,
        minimise,
        copyResult,
        insert,
        hasDraft,
        hasHistory,
        hasResult,
        hasSelection,
        resultIsSettled,
        onKeyHandled,
    } = actions;

    return useCallback(
        (event: ReactKeyboardEvent<HTMLElement>) => {
            const key = event.key;

            // ---- platform modifier combinations -------------------------------
            if (modifier.isHeld(event)) {
                if (key === "c" || key === "C") {
                    // A selection the user made on purpose always wins; only copy
                    // the result when there is nothing selected to copy instead.
                    if (!hasSelection() && hasResult) {
                        event.preventDefault();
                        copyResult();
                    }
                }
                // Cmd/Ctrl+A, +V, +Z, +R and everything else: the browser's business.
                return;
            }

            // Alt/AltGr combinations belong to the OS and to layouts that need
            // them for characters; never claim them here.
            if (event.altKey) return;

            switch (key) {
                case "Enter":
                case "=":
                    event.preventDefault();
                    evaluate();
                    return;

                case "Escape":
                    // A ladder, one rung per press, so Escape never closes work still
                    // on screen: draft first, then history, then put away. It is a
                    // check and not a fixed count -- an empty calculator closes on the
                    // first press, and one with only history behind it on the second.
                    event.preventDefault();
                    if (hasDraft()) clear();
                    else if (hasHistory) clearHistory();
                    else minimise();
                    return;

                case "x":
                case "X":
                    // Site staff type x for times.
                    event.preventDefault();
                    insert("*");
                    return;

                case "Backspace":
                case "Delete":
                    // The native input already does the right thing at the caret;
                    // we only need to drop the stale result afterwards.
                    onKeyHandled?.();
                    return;

                default:
                    if (key.length === 1 && PASSTHROUGH.includes(key)) {
                        if (resultIsSettled) {
                            // First character after "=": route it through insert so a
                            // digit starts fresh and an operator continues from the
                            // result. Everything after goes native again.
                            event.preventDefault();
                            insert(key);
                            return;
                        }
                        onKeyHandled?.();
                    }
                    // Arrows, Home/End, Tab, F5, dead keys: left entirely alone.
                    return;
            }
        },
        [
            evaluate,
            clear,
            clearHistory,
            minimise,
            copyResult,
            insert,
            hasDraft,
            hasHistory,
            hasResult,
            hasSelection,
            resultIsSettled,
            onKeyHandled,
            modifier,
        ]
    );
}

/**
 * The only global key listener in this feature. Alt+K toggles the widget so it
 * can be opened without first finding it with the mouse. Deliberately not a
 * bare key, and deliberately not Cmd/Ctrl+something that a browser or Nirmaan
 * screen already owns.
 */
export function useQuickCalcHotkey(toggle: () => void, enabled = true): void {
    useEffect(() => {
        if (!enabled) return;

        const onKeyDown = (event: KeyboardEvent) => {
            // event.code, not event.key: on a Mac, Option+K emits the glyph "˚"
            // rather than "k", so keying on the character would never match. The
            // physical key position is the same everywhere.
            if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyK") {
                event.preventDefault();
                toggle();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [toggle, enabled]);
}
