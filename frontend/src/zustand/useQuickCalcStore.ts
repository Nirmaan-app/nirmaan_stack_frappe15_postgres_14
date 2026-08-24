import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Quick Calc -- the floating calculator's own state.
 *
 * TWO visibility states, deliberately:
 *   "pill"   the 44px launcher. The resting state, always on screen, always
 *            tappable, and carrying the last result.
 *   "open"   the full widget.
 *
 * There is NO dismissed state. A third "hidden" state existed and was removed: the
 * only way back from it was Alt+K, which is no way back at all on a tablet with no
 * keyboard. Every state must be leavable by touch alone, so the pill never goes away.
 *
 * Persisted: the view, where the user put both shapes, and the tape.
 */

export interface CalcTapeEntry {
    expression: string;
    value: number;
}

export type QuickCalcView = "pill" | "open";

interface QuickCalcState {
    view: QuickCalcView;
    /**
     * ONE position for both shapes: the top-left of whichever is showing. The pill
     * and the widget are the same object at two sizes, so dragging either moves
     * both, and tapping the pill opens the calculator exactly where the pill was.
     * null = dock bottom-right. Owner ruling: never two positions.
     */
    position: { x: number; y: number } | null;
    tape: CalcTapeEntry[];

    open: () => void;
    minimise: () => void;
    toggle: () => void;
    setPosition: (position: { x: number; y: number }) => void;
    resetPosition: () => void;
    pushTape: (entry: CalcTapeEntry) => void;
    clearTape: () => void;
}

const TAPE_LIMIT = 20;

export const useQuickCalcStore = create<QuickCalcState>()(
    persist(
        (set, get) => ({
            view: "pill",
            position: null,
            tape: [],

            open: () => set({ view: "open" }),
            minimise: () => set({ view: "pill" }),
            toggle: () => set({ view: get().view === "open" ? "pill" : "open" }),

            setPosition: (position) => set({ position }),
            resetPosition: () => set({ position: null }),

            pushTape: (entry) =>
                set((state) => ({ tape: [...state.tape, entry].slice(-TAPE_LIMIT) })),
            clearTape: () => set({ tape: [] }),
        }),
        {
            name: "quick-calc",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                view: state.view,
                position: state.position,
                tape: state.tape,
            }),
        }
    )
);
