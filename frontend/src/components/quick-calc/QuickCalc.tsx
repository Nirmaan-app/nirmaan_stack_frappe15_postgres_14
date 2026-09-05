import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Calculator, ChevronDown, ChevronUp, GripVertical, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { useQuickCalcStore } from "@/zustand/useQuickCalcStore";
import {
    CALC_INPUT_PATTERN,
    evaluateExpression,
    formatResult,
    sanitiseExpressionInput,
    toClipboardValue,
    toDisplayOperators,
    tryEvaluate,
    CalcError,
} from "./calc-engine";
import { ClearMode, KeypadAction, QuickCalcKeypad } from "./QuickCalcKeypad";
import { useCalcKeyboard, useQuickCalcHotkey } from "./useCalcKeyboard";
import { usePlatformModifier } from "./usePlatformModifier";

/**
 * Quick Calc -- a floating calculator that works by mouse, touch and physical
 * keyboard, and that never takes a keystroke from the Nirmaan screen behind it.
 *
 * Mounted once in MainLayout. Non-blocking by construction: no overlay, no
 * focus trap, nothing marked inert, and no autofocus. The keyboard handler lives
 * on this component's root element, so while focus is anywhere else in Nirmaan
 * it is not called at all (see useCalcKeyboard).
 *
 * Known limit: over a Radix dialog opened with modal={true}, the dialog's focus
 * trap pulls focus back, so typing into the calculator does not work while such
 * a dialog is open -- the keypad still does. Dialogs that need the calculator
 * alongside them should pass modal={false}.
 */

const WIDGET_WIDTH = 270;
const PILL_SIZE = 44;
const EDGE_GAP = 16;

export const QuickCalc = () => {
    const { view, position, tape, tapeExpanded, open, minimise, setPosition, toggleTape, pushTape, clearTape } =
        useQuickCalcStore();

    const { toast } = useToast();
    const modifier = usePlatformModifier();

    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pillRef = useRef<HTMLButtonElement>(null);

    const [expression, setExpression] = useState("");
    const [result, setResult] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** The result a completed "=" left on screen, readable inside one batch. */
    const settledResultRef = useRef<number | null>(null);
    const [hasFocus, setHasFocus] = useState(false);
    const [copied, setCopied] = useState(false);
    const [coarsePointer, setCoarsePointer] = useState(false);
    const [pendingFocus, setPendingFocus] = useState(false);

    /**
     * Focus is only ever taken on an explicit activation -- a tap on the pill, or
     * the toggle shortcut. Opening any other way leaves the caret wherever it was in
     * the Nirmaan form behind. The flag waits for the input to actually mount.
     */
    const openAndFocus = useCallback(() => {
        open();
        setPendingFocus(true);
    }, [open]);

    useEffect(() => {
        if (view === "open" && pendingFocus) {
            inputRef.current?.focus();
            setPendingFocus(false);
        }
    }, [view, pendingFocus]);

    useQuickCalcHotkey(
        useCallback(() => {
            if (view === "open") minimise();
            else openAndFocus();
        }, [view, minimise, openAndFocus])
    );

    /* ── touch sizing follows the pointer, live ───────────────────────────── */
    useEffect(() => {
        const query = window.matchMedia("(pointer: coarse)");
        const sync = () => setCoarsePointer(query.matches);
        sync();
        query.addEventListener("change", sync);
        return () => query.removeEventListener("change", sync);
    }, []);

    /* ── placement: dock bottom-right until the user drags it ─────────────── */
    const clampRect = useCallback((x: number, y: number, width: number, height: number) => {
        const edge = EDGE_GAP / 2;
        return {
            x: Math.min(Math.max(edge, x), Math.max(edge, window.innerWidth - width - edge)),
            y: Math.min(Math.max(edge, y), Math.max(edge, window.innerHeight - height - edge)),
        };
    }, []);

    const clamp = useCallback(
        (x: number, y: number) =>
            clampRect(x, y, rootRef.current?.offsetWidth || WIDGET_WIDTH, rootRef.current?.offsetHeight || 380),
        [clampRect]
    );

    useLayoutEffect(() => {
        if (view !== "open") return;
        const width = rootRef.current?.offsetWidth || WIDGET_WIDTH;
        const height = rootRef.current?.offsetHeight || 380;

        // No position yet: dock bottom-right.
        if (!position) {
            setPosition({
                x: window.innerWidth - width - EDGE_GAP,
                y: Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP),
            });
            return;
        }

        // The calculator opens where the pill was. The pill is 44px tall and the
        // widget ~490px, so a pill sitting low would open a widget hanging off the
        // bottom -- clamping slides it just far enough back in, which reads as the
        // calculator growing upward out of the pill. Idempotent, so no loop.
        const fitted = clampRect(position.x, position.y, width, height);
        if (fitted.x !== position.x || fitted.y !== position.y) setPosition(fitted);
        // tapeExpanded is a dependency because expanding the history makes the panel
        // TALLER: without it the clamp never re-runs and a widget sitting low on the
        // screen grows straight off the bottom edge.
    }, [view, position, tapeExpanded, clampRect, setPosition]);

    useEffect(() => {
        const onResize = () => {
            if (!position) return;
            const next =
                view === "open" ? clamp(position.x, position.y) : clampRect(position.x, position.y, PILL_SIZE, PILL_SIZE);
            if (next.x !== position.x || next.y !== position.y) setPosition(next);
        };
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("orientationchange", onResize);
        };
    }, [view, position, clamp, clampRect, setPosition]);

    /* ── dragging: one Pointer Events path for finger, pen and mouse ──────── */
    const dragRef = useRef<{ id: number; dx: number; dy: number; moved: boolean } | null>(null);

    const onDragStart = (event: React.PointerEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        const origin = position ?? { x: 0, y: 0 };
        dragRef.current = { id: event.pointerId, dx: event.clientX - origin.x, dy: event.clientY - origin.y, moved: false };
        // Throws if the pointer is already gone (a cancelled or synthetic event);
        // capture is an optimisation, never a correctness requirement.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
    };

    const onDragMove = (event: React.PointerEvent<HTMLElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        drag.moved = true;
        setPosition(clamp(event.clientX - drag.dx, event.clientY - drag.dy));
    };

    const onDragEnd = (event: React.PointerEvent<HTMLElement>) => {
        if (dragRef.current?.id === event.pointerId) dragRef.current = null;
    };

    /* ── the pill drags too: move it anywhere, tap it to open ─────────────── */
    const pillDragRef = useRef<{ id: number; dx: number; dy: number; moved: boolean } | null>(null);

    /** Set when a drag ends, so the click that follows it does not also open. */
    const pillDraggedRef = useRef(false);

    const onPillDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        pillDraggedRef.current = false;
        pillDragRef.current = {
            id: event.pointerId,
            dx: event.clientX - rect.left,
            dy: event.clientY - rect.top,
            moved: false,
        };
        // Throws if the pointer is already gone (a cancelled or synthetic event);
        // capture is an optimisation, never a correctness requirement.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
    };

    const onPillDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = pillDragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const next = clampRect(event.clientX - drag.dx, event.clientY - drag.dy, rect.width, rect.height);
        // A few pixels of travel while pressing is a click, not a drag -- without
        // this threshold a slightly shaky tap would move the pill instead of opening it.
        if (!drag.moved && Math.abs(next.x - rect.left) < 4 && Math.abs(next.y - rect.top) < 4) return;
        drag.moved = true;
        setPosition(next);
    };

    const onPillDragEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = pillDragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        pillDragRef.current = null;
        pillDraggedRef.current = drag.moved;
    };

    /**
     * Opening lives on click, not on pointer-up: Enter and Space on a focused button
     * fire click only, and a launcher that a keyboard cannot open would be a poor
     * front door for a feature whose whole point is keyboard reach.
     */
    const onPillClick = () => {
        if (pillDraggedRef.current) {
            pillDraggedRef.current = false;
            return;
        }
        // The calculator opens where the pill is, so a pill that has never been
        // dragged (still on its CSS default corner) hands over its real rect first.
        if (!position && pillRef.current) {
            const rect = pillRef.current.getBoundingClientRect();
            setPosition({ x: rect.left, y: rect.top });
        }
        openAndFocus();
    };

    const onPillDragCancel = () => {
        pillDragRef.current = null;
    };

    /* ── expression edits ─────────────────────────────────────────────────── */
    const applyExpression = useCallback((next: string) => {
        setExpression(next);
        setResult(null);
        setError(null);
        settledResultRef.current = null;
    }, []);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const input = event.target;
        const raw = input.value;
        // Typing, pasting and dictation all land here; keep only what the field holds,
        // then show the operators the way the keys show them. The rewrite happens on
        // the element (not via state) so React never reassigns .value and moves the
        // caret; the mapping is one-char-for-one-char, so the caret index still points
        // at the same place.
        const cleaned = CALC_INPUT_PATTERN.test(raw) ? raw : sanitiseExpressionInput(raw);
        const display = toDisplayOperators(cleaned);
        if (display !== raw) {
            const caret = input.selectionStart;
            input.value = display;
            if (caret !== null) input.setSelectionRange(caret, caret);
        }
        applyExpression(display);
    };

    /**
     * Where a keypad tap should act.
     *
     * An UNFOCUSED input reports selectionStart 0, so reading it blindly made every
     * tapped character land at the START -- tapping 5 then 6 produced "65". When the
     * field has no caret the honest answer is the END of the value, which is also what
     * anyone tapping a calculator expects. When it does have a caret (or a selection),
     * that wins, so tapping behaves exactly like typing.
     */
    const caretRange = (input: HTMLInputElement): [number, number] => {
        const focused = document.activeElement === input;
        if (!focused) return [input.value.length, input.value.length];
        return [input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length];
    };

    /** Inserts at the caret so keypad taps behave like typing, not like appending. */
    const insertAtCaret = useCallback((rawText: string) => {
        const input = inputRef.current;
        if (!input) return;
        // A tapped ÷ must read as ÷ in the expression, not as /.
        const text = toDisplayOperators(rawText);

        // A finished result is on screen. What happens next is the one piece of
        // calculator behaviour everyone already knows: a DIGIT starts a fresh
        // calculation, an OPERATOR carries the result into the next one. Appending
        // to the old expression (89*63 then tapping 5 giving 89*635) is nobody's
        // intent. Applies to taps and typing alike -- see useCalcKeyboard.
        const settled = settledResultRef.current;
        if (settled !== null) {
            const startsNew = /[0-9.(]/.test(text.charAt(0));
            const next = (startsNew ? "" : toClipboardValue(settled)) + text;
            input.value = next;
            applyExpression(next);
            input.focus();
            input.setSelectionRange(next.length, next.length);
            return;
        }

        const [start, end] = caretRange(input);
        input.setRangeText(text, start, end, "end");
        // A tap is an explicit activation, so taking focus is fair -- and it is what
        // gives the NEXT tap a real caret to read.
        const caret = start + text.length;
        input.focus();
        input.setSelectionRange(caret, caret);
        applyExpression(input.value);
    }, [applyExpression]);

    const backspace = useCallback(() => {
        const input = inputRef.current;
        if (!input) return;
        const [start, end] = caretRange(input);
        let caret = start;
        if (start !== end) {
            input.setRangeText("", start, end, "end");
        } else if (start > 0) {
            input.setRangeText("", start - 1, start, "end");
            caret = start - 1;
        }
        input.focus();
        input.setSelectionRange(caret, caret);
        applyExpression(input.value);
    }, [applyExpression]);

    const clear = useCallback(() => {
        // Write through to the element as well as the state. setRangeText already
        // mutates it directly, so the input stays the source of truth even when a
        // clear and the next tap land in the same batch.
        if (inputRef.current) inputRef.current.value = "";
        applyExpression("");
        inputRef.current?.focus();
    }, [applyExpression]);

    /**
     * Whether the draft holds anything -- the first rung of the clear ladder that
     * both the C key and Escape walk (draft -> history -> put away).
     *
     * The expression is read off the input ELEMENT for the same reason `evaluate`
     * does: a keypad tap and an Escape can land in one batch, and the state from
     * the last committed render would still read empty and send the press down to
     * the history rung. A leftover error counts as draft too, so the first press
     * dismisses it rather than reaching past it; `result` needs no test of its own,
     * since a result only exists while the expression that produced it is still in
     * the field.
     */
    const hasDraft = useCallback(
        () => (inputRef.current?.value ?? expression).trim().length > 0 || error !== null,
        [expression, error]
    );

    const clearHistory = useCallback(() => {
        clearTape();
        inputRef.current?.focus();
    }, [clearTape]);

    const evaluate = useCallback(() => {
        // The input element is the source of truth, not the React state: several
        // keypad taps and then "=" can land in a single batch, and the state from
        // the last committed render would be one or more characters behind.
        const source = (inputRef.current?.value ?? expression).trim();
        if (!source) {
            setError("Type an expression first");
            setResult(null);
            return;
        }

        // A second Enter carries the result forward, for chained arithmetic. The
        // settled value lives in a ref for the same reason the expression is read
        // off the input: a clear and an "=" can share one batch, and state from the
        // last committed render would still claim a result was on screen.
        const settled = settledResultRef.current;
        if (settled !== null) {
            const carried = toClipboardValue(settled);
            settledResultRef.current = null;
            setExpression(carried);
            if (inputRef.current) inputRef.current.value = carried;
            requestAnimationFrame(() => {
                inputRef.current?.setSelectionRange(carried.length, carried.length);
            });
            return;
        }

        try {
            const value = evaluateExpression(source);
            settledResultRef.current = value;
            setResult(value);
            setError(null);
            pushTape({ expression: source, value });
        } catch (thrown) {
            settledResultRef.current = null;
            setResult(null);
            setError(thrown instanceof CalcError ? thrown.message : "That expression cannot be read");
        }
    }, [expression, pushTape]);

    /* ── copy: the result only, unformatted ───────────────────────────────── */
    const copyResult = useCallback(async () => {
        if (result === null) return;
        const text = toClipboardValue(result);

        const confirm = () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        };

        try {
            await navigator.clipboard.writeText(text);
            confirm();
        } catch {
            // Older browsers, and any context where the async clipboard is blocked.
            const scratch = document.createElement("textarea");
            scratch.value = text;
            scratch.setAttribute("readonly", "");
            scratch.style.cssText = "position:fixed;top:-1000px;opacity:0";
            document.body.appendChild(scratch);
            scratch.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(scratch);
            inputRef.current?.focus();
            if (ok) confirm();
            else
                toast({
                    title: "Could not reach the clipboard",
                    description: `The result is ${text} -- copy it by hand.`,
                    variant: "destructive",
                });
        }
    }, [result, toast]);

    /* ── keyboard, scoped to this subtree ─────────────────────────────────── */
    const onKeyDown = useCalcKeyboard(
        {
            evaluate,
            clear,
            clearHistory,
            minimise,
            copyResult,
            insert: insertAtCaret,
            hasDraft,
            hasHistory: tape.length > 0,
            hasResult: result !== null,
            hasSelection: () => {
                const input = inputRef.current;
                return !!input && input.selectionStart !== input.selectionEnd;
            },
            resultIsSettled: result !== null,
            onKeyHandled: () => {
                setResult(null);
                setError(null);
                settledResultRef.current = null;
            },
        },
        modifier
    );

    /**
     * The face is rendered from React state while the action re-reads the input
     * element, so in a pathological same-batch tap the two can disagree -- and the
     * disagreement falls the safe way round: the key clears the draft when the face
     * already says AC, never the history when the face says C.
     */
    const clearMode: ClearMode =
        expression.trim().length > 0 || error !== null
            ? "draft"
            : tape.length > 0
              ? "history"
              : "none";

    const onKeypadAction = (action: KeypadAction) => {
        if (action === "clear") {
            if (hasDraft()) clear();
            else clearHistory();
        }
        else if (action === "backspace") backspace();
        else if (action === "equals") evaluate();
        // Tapping a key is an explicit activation, so keeping the caret here is fair.
        inputRef.current?.focus();
    };

    // The tape scrolls, so every entry stays reachable rather than being clipped.
    const tapeRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        const el = tapeRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [tape.length, tapeExpanded]);

    /**
     * The last answer, for the pill's tooltip only. The pill face is the calculator
     * icon and nothing else (owner ruling) -- a number on it competed with the app's
     * own figures for attention.
     */
    const lastValue = result ?? (tape.length ? tape[tape.length - 1].value : null);

    /* ── minimised: a 44px launcher that is also the resting state ─────────── */
    /**
     * A quiet running total while the expression is still being written. It replaces
     * the old "=" placeholder, which was a label pretending to be a value. Pressing
     * Enter is still what commits: only then does it become the bold result, join the
     * history and turn Copy on.
     */
    const previewProbe = result === null && !error && expression.trim() ? tryEvaluate(expression) : null;
    const preview = previewProbe?.ok ? previewProbe.value : null;

    if (view === "pill") {
        return (
            <button
                type="button"
                onClick={onPillClick}
                onPointerDown={onPillDragStart}
                onPointerMove={onPillDragMove}
                onPointerUp={onPillDragEnd}
                onPointerCancel={onPillDragCancel}
                // Drag it anywhere; a tap that never moved opens the calculator.
                ref={pillRef}
                style={{
                    ...(position ? { left: position.x, top: position.y } : { right: EDGE_GAP, bottom: EDGE_GAP }),
                    touchAction: "none",
                }}
                className={cn(
                    "pointer-events-auto fixed z-[60] grid h-11 w-11 cursor-grab place-items-center rounded-full",
                    "bg-card/65 text-muted-foreground backdrop-blur-2xl backdrop-saturate-[1.8]",
                    "ring-1 ring-inset ring-border/70 shadow-[0_8px_28px_-10px_rgba(0,0,0,0.35)]",
                    "select-none transition-colors active:cursor-grabbing",
                    "hover:bg-card/90 hover:text-foreground hover:ring-primary/40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                )}
                title={
                    lastValue === null
                        ? `Quick Calc — drag to move, click to open (${modifier.toggleLabel})`
                        : `Quick Calc — last result ${formatResult(lastValue)}. Drag to move, click to open (${modifier.toggleLabel})`
                }
            >
                <Calculator className="h-[18px] w-[18px]" />
            </button>
        );
    }

    return (
        <div
            ref={rootRef}
            role="region"
            aria-label="Quick Calc calculator"
            onKeyDown={onKeyDown}
            onFocus={() => setHasFocus(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setHasFocus(false);
            }}
            style={{
                left: position?.x ?? undefined,
                top: position?.y ?? undefined,
                right: position ? undefined : EDGE_GAP,
                bottom: position ? undefined : EDGE_GAP,
                width: WIDGET_WIDTH,
                touchAction: "none",
            }}
            // pointer-events-auto keeps it usable when a Radix modal sets
            // pointer-events:none on the body.
            // See-through, not frosted. A backdrop blur is what actually HIDES the
            // page -- it smears the row you are checking into an unreadable wash -- so
            // there is none. The fill is a barely-there tint that only separates the
            // panel from the page; the hairline ring is what states its bounds.
            className={cn(
                "pointer-events-auto fixed z-[60] overflow-hidden rounded-2xl",
                "backdrop-blur-3xl backdrop-saturate-[1.2]  transition-colors duration-200",
                "shadow-[0_24px_70px_-20px_rgba(0,0,0,0.45)] ring-1 ring-inset",
                hasFocus ? "bg-card/30 ring-primary/40" : "bg-card/15 ring-border/60"
            )}
        >
            {/* A. drag handle */}
            <div
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-border/40 px-3 py-1.5 active:cursor-grabbing"
            >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className={cn("mr-auto text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80", "[text-shadow:0_0_7px_hsl(var(--card)),0_0_3px_hsl(var(--card)),0_0_1px_hsl(var(--card))]")}>
                    Quick Calc
                </span>
                <button
                    type="button"
                    data-no-drag
                    aria-label="Put away"
                    title="Put away (Esc)"
                    onClick={minimise}
                    className="grid h-6 w-6 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <Minus className="h-4 w-4" />
                </button>
            </div>

            {/* B. tape */}
            <div className="relative">
                {tape.length > 0 && (
                    // Sits on the left, where the right-aligned history leaves room.
                    <button
                        type="button"
                        data-no-drag
                        onClick={toggleTape}
                        aria-expanded={tapeExpanded}
                        aria-label={tapeExpanded ? "Show less history" : "Show more history"}
                        title={tapeExpanded ? "Show less history" : "Show more history"}
                        className="absolute left-2 top-1.5 z-10 grid h-5 w-5 place-items-center rounded text-muted-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        {tapeExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                )}
            <ul
                ref={tapeRef}
                // touch-action has to be re-enabled here: the widget root sets it to
                // "none" so a drag never scrolls the page, which would otherwise make
                // the history unscrollable by finger. scrollbar-hide is the app's own
                // utility (index.css) -- scrollable, but no bar in the way.
                style={{ touchAction: "pan-y" }}
                className={cn(
                    // first-child:mt-auto bottom-aligns a short history the way an adding-machine
                    // roll reads, WITHOUT justify-end -- content overflowing a flex-end box
                    // cannot be scrolled back to.
                    "scrollbar-hide flex flex-col gap-0.5 overflow-y-auto overscroll-contain px-4 pb-1 pt-2 [&>li:first-child]:mt-auto",
                    // Two lines by default so it never crowds the answer; the user can
                    // open it up when they want to look back, and that choice sticks.
                    tapeExpanded ? "max-h-[150px]" : "max-h-[40px]",
                    "text-right font-mono text-[10px] text-muted-foreground/70",
                    // A tight halo the colour of the card. With no blur behind it, this
                    // is what keeps the figures readable over a table row -- it clears
                    // the background exactly where the glyphs sit and nowhere else, so
                    // the page stays visible through the rest of the panel.
                    "[text-shadow:0_0_7px_hsl(var(--card)),0_0_3px_hsl(var(--card)),0_0_1px_hsl(var(--card))]",
                    "[mask-image:linear-gradient(to_bottom,transparent,#000_16px)]"
                )}
            >
                {tape.length === 0 ? (
                    <li className="mt-auto text-[9px] uppercase tracking-[0.16em] text-muted-foreground/50">No history yet</li>
                ) : (
                    tape.map((entry, index) => (
                        <li key={`${entry.expression}-${index}`} className="shrink-0 truncate">
                            <button
                                type="button"
                                title="Reload this expression"
                                onClick={() => {
                                    applyExpression(entry.expression);
                                    inputRef.current?.focus();
                                }}
                                className="w-full truncate text-right transition-colors hover:text-foreground"
                            >
                                {entry.expression} <span className="ml-1 text-foreground/60">{formatResult(entry.value)}</span>
                            </button>
                        </li>
                    ))
                )}
            </ul>
            </div>

            {/* C + D. expression, result, copy */}
            <div className="grid gap-0.5 px-4 pb-2.5 pt-1">
                <input
                    ref={inputRef}
                    value={expression}
                    onChange={handleChange}
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Expression"
                    // placeholder="type or tap · 12500*18%"
                    className={cn(
                        "w-full border-0 bg-transparent p-0 text-right font-mono text-[13px] font-medium leading-5",
                        "text-muted-foreground placeholder:font-normal placeholder:text-muted-foreground/45 focus:outline-none",
                        "[text-shadow:0_0_7px_hsl(var(--card)),0_0_3px_hsl(var(--card)),0_0_1px_hsl(var(--card))]"
                    )}
                />
                <div className="flex min-h-[32px] items-center gap-2">
                    {/* Says what it does. An icon here was an unexplained glyph sitting
                        next to a number -- the one place in the widget where guessing
                        wrong means you paste the wrong figure into a PO. */}
                    <button
                        type="button"
                        disabled={result === null}
                        onClick={copyResult}
                        title={`Copy result (${modifier.label}+C)`}
                        className={cn(
                            "shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors",
                            "[text-shadow:0_0_7px_hsl(var(--card)),0_0_3px_hsl(var(--card)),0_0_1px_hsl(var(--card))]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            "disabled:cursor-default disabled:opacity-30",
                            copied
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground enabled:hover:bg-foreground/[0.07] enabled:hover:text-foreground"
                        )}
                    >
                        {copied ? "Copied" : "Copy"}
                    </button>

                    <span
                        aria-live="polite"
                        className={cn(
                            "ml-auto overflow-hidden text-ellipsis whitespace-nowrap text-right tabular-nums",
                            "[text-shadow:0_0_7px_hsl(var(--card)),0_0_3px_hsl(var(--card)),0_0_1px_hsl(var(--card))]",
                            error
                                ? "whitespace-normal text-[11px] font-medium leading-snug text-destructive"
                                : result !== null
                                  ? "text-[24px] font-semibold leading-none tracking-tight text-foreground"
                                  : preview !== null
                                    ? "text-[18px] font-medium leading-none tracking-tight text-muted-foreground/70"
                                    : "text-[15px] text-muted-foreground/40"
                        )}
                    >
                        {error ?? (result !== null ? formatResult(result) : preview !== null ? formatResult(preview) : expression.trim() ? "" : "0")}
                    </span>
                </div>
            </div>

            {/* E. keypad */}
            <QuickCalcKeypad
                onInsert={insertAtCaret}
                onAction={onKeypadAction}
                coarsePointer={coarsePointer}
                clearMode={clearMode}
            />

        </div>
    );
};
