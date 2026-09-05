import { memo, ReactNode } from "react";
import { Delete } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Quick Calc -- the keypad.
 *
 * Every operation the keyboard offers is also a button here, because a tablet
 * without a keyboard has to be able to do all of it. Two rules hold the design
 * together:
 *
 *   1. Keys are real <button>s in reading order, so they work by tap, click,
 *      Tab+Enter and screen reader alike. Nothing is hover-only.
 *   1b. Digits are neutral; everything that is not a digit -- operators and the
 *      clear / bracket / backspace row -- is tinted with the brand rose, so the
 *      numbers you are entering stand apart from the things you do to them.
 *   2. A key whose face differs from the keystroke that does the same thing
 *      prints that keystroke in its corner -- the widget teaches its own
 *      shortcuts instead of hiding them in a help panel.
 */

export type KeypadAction = "clear" | "backspace" | "equals";

/**
 * Which rung of the clear ladder the C key is currently on -- the same ladder
 * Escape walks (see useCalcKeyboard):
 *
 *   "draft"    the draft holds something  -> face "C",  clears the draft
 *   "history"  draft empty, tape has rows -> face "AC", clears the history
 *   "none"     nothing left to clear      -> face "AC", inert
 *
 * "AC" carries a red border because that press wipes the saved tape and there is
 * no undo; the inert state does not, since a border promising a destructive
 * action that cannot happen is noise.
 */
export type ClearMode = "draft" | "history" | "none";

const CLEAR_FACE: Record<ClearMode, string> = {
    draft: "C",
    history: "AC",
    none: "AC",
};

const CLEAR_LABEL: Record<ClearMode, string> = {
    draft: "Clear",
    history: "Clear history",
    none: "Nothing to clear",
};

const CLEAR_TITLE: Record<ClearMode, string> = {
    draft: "Clear what you typed (Esc)",
    history: "Clear the history (Esc) -- this cannot be undone",
    none: "Nothing to clear",
};

export interface KeypadKey {
    /** What the key face shows. */
    face: ReactNode;
    /** A stable key for React, needed because `face` may be a node. */
    id: string;
    /** Screen-reader name, when the face is a glyph. */
    label?: string;
    /** Characters to insert at the caret. */
    insert?: string;
    /** Or an action to run. */
    action?: KeypadAction;
    /** The keyboard key that does the same thing, when it differs from the face. */
    legend?: string;
    role?: "digit" | "operator" | "utility" | "equals";
}

export const KEYPAD: KeypadKey[] = [
    { id: "clear", face: "C", label: "Clear", action: "clear", legend: "esc", role: "utility" },
    { id: "(", face: "(", label: "Open bracket", insert: "(", role: "utility" },
    { id: ")", face: ")", label: "Close bracket", insert: ")", role: "utility" },
    // The ⌫ character renders thin and boxy at this size; the icon is legible.
    { id: "backspace", face: <Delete className="h-4 w-4" />, label: "Backspace", action: "backspace", role: "utility" },

    { id: "7", face: "7", insert: "7", role: "digit" },
    { id: "8", face: "8", insert: "8", role: "digit" },
    { id: "9", face: "9", insert: "9", role: "digit" },
    { id: "÷", face: "÷", label: "Divide", insert: "/", role: "operator" },

    { id: "4", face: "4", insert: "4", role: "digit" },
    { id: "5", face: "5", insert: "5", role: "digit" },
    { id: "6", face: "6", insert: "6", role: "digit" },
    { id: "×", face: "×", label: "Multiply", insert: "*", role: "operator" },

    { id: "1", face: "1", insert: "1", role: "digit" },
    { id: "2", face: "2", insert: "2", role: "digit" },
    { id: "3", face: "3", insert: "3", role: "digit" },
    { id: "−", face: "−", label: "Subtract", insert: "-", role: "operator" },

    { id: "0", face: "0", insert: "0", role: "digit" },
    { id: ".", face: ".", label: "Decimal point", insert: ".", role: "digit" },
    { id: "%", face: "%", label: "Percent", insert: "%", role: "operator" },
    { id: "+", face: "+", label: "Add", insert: "+", role: "operator" },

    { id: "=", face: "=", label: "Equals", action: "equals", legend: "↵", role: "equals" },
];

interface QuickCalcKeypadProps {
    onInsert: (text: string) => void;
    onAction: (action: KeypadAction) => void;
    /** 44px targets when the pointer is coarse (the touch minimum); 36px on a mouse. */
    coarsePointer: boolean;
    /** Which rung the clear key shows. The action itself is decided in QuickCalc. */
    clearMode: ClearMode;
}

export const QuickCalcKeypad = memo(function QuickCalcKeypad({
    onInsert,
    onAction,
    coarsePointer,
    clearMode,
}: QuickCalcKeypadProps) {
    return (
        <div className="grid grid-cols-4 gap-1 px-3 pb-2.5">
            {KEYPAD.map((key) => {
                // The clear key is the one face that changes with state, so its
                // look and its name are resolved per render rather than read off
                // the static KEYPAD entry.
                const isClear = key.action === "clear";
                const destructive = isClear && clearMode === "history";
                const inert = isClear && clearMode === "none";

                return (
                <button
                    key={key.id}
                    type="button"
                    disabled={inert}
                    title={isClear ? CLEAR_TITLE[clearMode] : undefined}
                    aria-label={isClear ? CLEAR_LABEL[clearMode] : (key.label ?? key.id)}
                    // touch-manipulation kills the 300ms tap delay and double-tap zoom.
                    className={cn(
                        "relative grid place-items-center rounded-xl tabular-nums transition-colors duration-100",
                        "touch-manipulation select-none [-webkit-tap-highlight-color:transparent]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        "active:scale-[0.97]",
                        coarsePointer ? "min-h-[44px] text-[16px]" : "min-h-[36px] text-[14px]",
                        key.role === "equals" &&
                            "col-span-4 mt-1 bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90",
                        key.role === "operator" &&
                            "bg-primary/[0.10] font-medium text-primary hover:bg-primary/[0.18]",
                        key.role === "utility" &&
                            !destructive &&
                            "bg-primary/[0.10] text-[12px] font-medium text-primary hover:bg-primary/[0.18]",
                        // Red border: this press wipes the saved history, with no undo.
                        destructive &&
                            "border border-destructive/60 bg-destructive/[0.08] text-[12px] font-medium text-destructive hover:bg-destructive/[0.16]",
                        inert && "opacity-40",
                        key.role === "digit" &&
                            "bg-foreground/[0.07] font-medium text-foreground hover:bg-foreground/[0.13]"
                    )}
                    onClick={() => {
                        if (key.insert) onInsert(key.insert);
                        else if (key.action) onAction(key.action);
                    }}
                >
                    {key.legend && (
                        <span
                            aria-hidden="true"
                            className={cn(
                                "absolute left-1.5 top-1 font-mono text-[8px] leading-none tracking-wide",
                                key.role === "equals"
                                    ? "text-primary-foreground/50"
                                    : key.role === "utility"
                                      ? "text-primary/45"
                                      : "text-muted-foreground/45"
                            )}
                        >
                            {key.legend}
                        </span>
                    )}
                    {isClear ? CLEAR_FACE[clearMode] : key.face}
                </button>
                );
            })}
        </div>
    );
});
