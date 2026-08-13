import { describe, expect, it } from "vitest";

import {
    CASHBOOK_STEPS,
    CASHFREE_STEPS,
    CONFIRM_STEP_NOTE,
    canStepBack,
    clickableStepIndex,
    confirmEmptyCopy,
    currentStepIndex,
    importSteps,
    type ImportFlowState,
} from "./importWizard";

/**
 * The import wizard's step model (slice CF/S7).
 *
 * ⚠️ WHAT THIS SUITE CANNOT REACH, stated so it is not mistaken for coverage of the dialog: there is
 * no DOM environment in this repository, so the stepper rendering, the panel mounting and the
 * dismissal being blocked mid-write are React semantics and are structurally untestable here. This
 * file covers the derivation. The dialog itself is verified by a live browser walk.
 */

const flow = (over: Partial<ImportFlowState> = {}): ImportFlowState => ({
    previewed: false,
    staged: false,
    matched: false,
    ...over,
});

describe("the step lists", () => {
    it("gives Cashfree four steps and Cashbook three", () => {
        // ⚠️ TWO LISTS, NOT ONE SHARED SHAPE (owner ruling). A Cashfree import PAYS what somebody
        // approved; a Cashbook import CREATES what a wallet already spent. The deepest difference
        // is at step 3: by then Cashfree has already written its rows and Cashbook has not.
        expect(CASHFREE_STEPS.map((s) => s.key)).toEqual(["upload", "check", "run", "confirm"]);
        expect(CASHBOOK_STEPS.map((s) => s.key)).toEqual(["upload", "review", "create"]);
    });

    it("picks the list from the source", () => {
        expect(importSteps("Cashbook")).toBe(CASHBOOK_STEPS);
        expect(importSteps("Cashfree")).toBe(CASHFREE_STEPS);
        // An unknown source falls to the bank flow rather than rendering no steps at all.
        expect(importSteps("")).toBe(CASHFREE_STEPS);
    });
});

describe("which step the flow is on", () => {
    it("walks Cashfree from upload to confirm", () => {
        expect(currentStepIndex("Cashfree", flow())).toBe(0);
        expect(currentStepIndex("Cashfree", flow({ previewed: true }))).toBe(1);
        expect(currentStepIndex("Cashfree", flow({ previewed: true, staged: true }))).toBe(2);
        expect(
            currentStepIndex("Cashfree", flow({ previewed: true, staged: true, matched: true }))
        ).toBe(3);
    });

    it("⚠️ keeps a FAILED match on step 3, never advancing to Confirm", () => {
        // The owner ruling. Advancing would show an honestly empty confirm list for entirely the
        // wrong reason — "nothing matched" and "the match never ran" are different sentences, and
        // only the second has a Re-run button as its answer.
        const failed = flow({ previewed: true, staged: true, matched: false });
        expect(currentStepIndex("Cashfree", failed)).toBe(2);
    });

    it("walks Cashbook from upload to create", () => {
        expect(currentStepIndex("Cashbook", flow())).toBe(0);
        expect(currentStepIndex("Cashbook", flow({ previewed: true }))).toBe(1);
        expect(currentStepIndex("Cashbook", flow({ previewed: true, staged: true }))).toBe(2);
    });

    it("never reports a step past the end of its own list", () => {
        // `matched` is meaningless on the Cashbook flow; it must not push it off its three steps.
        const over = flow({ previewed: true, staged: true, matched: true });
        expect(currentStepIndex("Cashbook", over)).toBeLessThan(CASHBOOK_STEPS.length);
        expect(currentStepIndex("Cashfree", over)).toBeLessThan(CASHFREE_STEPS.length);
    });
});

describe("stepping back", () => {
    it("is allowed between the check step and the upload step", () => {
        expect(canStepBack(flow({ previewed: true }))).toBe(true);
    });

    it("⚠️ is refused once anything has been written", () => {
        // From step 2 on a Cashfree import's rows are staged, so "back" would offer a re-upload the
        // duplicate guard will refuse — a promise that cannot be kept. Cashbook is the same shape:
        // its batch and rows exist by then, even while the expenses are still being written.
        expect(canStepBack(flow({ previewed: true, staged: true }))).toBe(false);
        expect(canStepBack(flow({ previewed: true, staged: true, matched: true }))).toBe(false);
    });

    it("is refused before there is anything to go back from", () => {
        expect(canStepBack(flow())).toBe(false);
    });

    it("makes only a COMPLETED step clickable, and only before a write", () => {
        const checking = flow({ previewed: true });
        expect(clickableStepIndex("Cashfree", checking, 0)).toBe(true);
        // The step you are on, and the ones ahead of it, are never navigation targets.
        expect(clickableStepIndex("Cashfree", checking, 1)).toBe(false);
        expect(clickableStepIndex("Cashfree", checking, 2)).toBe(false);

        const written = flow({ previewed: true, staged: true, matched: true });
        expect(clickableStepIndex("Cashfree", written, 0)).toBe(false);
        expect(clickableStepIndex("Cashfree", written, 1)).toBe(false);
    });
});

describe("the confirm step's copy", () => {
    it("names where the work went when nothing matched", () => {
        // ⚠️ THE STEP STILL RENDERS (owner ruling). "Nothing matched" is a real finding — 145
        // transfers on the first live statement — and a step that vanishes when it has nothing to
        // report reads as a crash.
        const copy = confirmEmptyCopy(20);
        expect(copy).toContain("20");
        expect(copy).toContain("Not-Matched");
    });

    it("does not invent a count it was not given", () => {
        expect(confirmEmptyCopy(0)).not.toMatch(/\d/);
        expect(confirmEmptyCopy(0)).toContain("Not-Matched");
    });

    it("⚠️ states that the step reaches past the statement just imported", () => {
        // The list is every confirmable transfer in the system (owner ruling Q21) — the whole point
        // of re-running after an upload is that a payment approved yesterday may belong to an OLDER
        // statement. A heading implying "this import" would misdescribe what Confirm writes.
        expect(CONFIRM_STEP_NOTE).toContain("every open import");
        expect(CONFIRM_STEP_NOTE).toContain("not only the statement");
    });
});
