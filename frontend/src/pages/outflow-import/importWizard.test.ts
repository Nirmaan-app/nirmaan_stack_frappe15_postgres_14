import { describe, expect, it } from "vitest";

import {
    BANK_STEPS,
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

/** The one source string that selects the bank flow. Spelled as the parser's adapter key. */
const BANK = "ICICI Bank Statement";

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
    it("gives Cashfree four steps, Cashbook three and the bank three", () => {
        // ⚠️ ONE LIST PER SOURCE, NOT ONE SHARED SHAPE (owner ruling). A Cashfree import PAYS what
        // somebody approved; a Cashbook import CREATES what a wallet already spent; a bank import
        // merely BRINGS THE ROWS IN. The deepest difference is at step 3: by then Cashfree has
        // already written its rows and Cashbook has not.
        expect(CASHFREE_STEPS.map((s) => s.key)).toEqual(["upload", "check", "run", "confirm"]);
        expect(CASHBOOK_STEPS.map((s) => s.key)).toEqual(["upload", "review", "create"]);
        expect(BANK_STEPS.map((s) => s.key)).toEqual(["upload", "check", "import"]);
    });

    it("⚠️ ends the bank flow where the work ends, with no Confirm step", () => {
        // Owner ruling (C6). A bank row carries nothing the matcher can settle against, so
        // Cashfree's Confirm step would be STRUCTURALLY empty here — every time, for every file.
        // A wizard that ends on a permanently empty screen reports the import as having found
        // nothing, which is not what happened.
        expect(BANK_STEPS.map((s) => s.key)).not.toContain("confirm");
        expect(BANK_STEPS).toHaveLength(3);
    });

    it("picks the list from the source", () => {
        expect(importSteps("Cashbook")).toBe(CASHBOOK_STEPS);
        expect(importSteps("Cashfree")).toBe(CASHFREE_STEPS);
        expect(importSteps(BANK)).toBe(BANK_STEPS);
        // ⚠️ AN UNKNOWN SOURCE FALLS TO CASHFREE'S LIST rather than rendering no steps at all: a
        // stepper with nothing in it reads as a crash, where the wrong-but-plausible stepper reads
        // as the mis-configuration it is. (This assertion is unchanged from before the bank source
        // existed; only its comment was, because "the bank flow" now names a real third list.)
        expect(importSteps("")).toBe(CASHFREE_STEPS);
        expect(importSteps("HDFC Bank Statement")).toBe(CASHFREE_STEPS);
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

    it("walks the bank source from upload to import", () => {
        expect(currentStepIndex(BANK, flow())).toBe(0);
        expect(currentStepIndex(BANK, flow({ previewed: true }))).toBe(1);
        expect(currentStepIndex(BANK, flow({ previewed: true, staged: true }))).toBe(2);
    });

    it("⚠️ leaves a FAILED bank match on the last step, where the Re-run button is", () => {
        // The Cashfree ruling arriving somewhere else. There the distinction is enforced by NOT
        // advancing to Confirm; here 2 IS the last step, so there is nowhere to be wrongly
        // advanced to and the index is the same either way. The two sentences — "nothing matched"
        // and "the match never ran" — are still told apart on screen, by the error banner and the
        // footer's Re-run button, both of which render from step 3 on.
        const succeeded = flow({ previewed: true, staged: true, matched: true });
        const failed = flow({ previewed: true, staged: true, matched: false });
        expect(currentStepIndex(BANK, failed)).toBe(2);
        expect(currentStepIndex(BANK, succeeded)).toBe(2);
        // ⚠️ AND THAT SAMENESS MUST NOT LEAK BACK TO CASHFREE, which is the whole point of the
        // ruling: there, the two states are different steps.
        expect(currentStepIndex("Cashfree", failed)).not.toBe(
            currentStepIndex("Cashfree", succeeded)
        );
    });

    it("never reports a step past the end of its own list", () => {
        // `matched` is meaningless on the Cashbook and bank flows; it must not push either off the
        // end. This is the invariant the shared `SOURCE_FLOWS` table exists to make unbreakable:
        // the list and the index are read from the SAME entry, so they cannot disagree about how
        // many steps a source has.
        const states = [
            flow(),
            flow({ previewed: true }),
            flow({ previewed: true, staged: true }),
            flow({ previewed: true, staged: true, matched: true }),
            // Incoherent, but a stepper must not point off the end even so.
            flow({ staged: true, matched: true }),
        ];
        for (const source of ["Cashfree", "Cashbook", BANK, "an unshipped source"]) {
            for (const state of states) {
                const index = currentStepIndex(source, state);
                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThan(importSteps(source).length);
            }
        }
        // Named explicitly too, so a regression reads as the concrete thing it is.
        const over = flow({ previewed: true, staged: true, matched: true });
        expect(currentStepIndex("Cashbook", over)).toBeLessThan(CASHBOOK_STEPS.length);
        expect(currentStepIndex("Cashfree", over)).toBeLessThan(CASHFREE_STEPS.length);
        expect(currentStepIndex(BANK, over)).toBeLessThan(BANK_STEPS.length);
    });

    it("⚠️ leaves Cashfree and Cashbook byte-identical to before the bank source existed", () => {
        // Both carry live settled data. The C6 change replaced two branch literals with a lookup
        // table, and the whole value of that refactor depends on those two sources coming out
        // exactly where they went in.
        const walk = (source: string) =>
            [
                flow(),
                flow({ previewed: true }),
                flow({ previewed: true, staged: true }),
                flow({ previewed: true, staged: true, matched: true }),
            ].map((state) => currentStepIndex(source, state));
        expect(walk("Cashfree")).toEqual([0, 1, 2, 3]);
        expect(walk("Cashbook")).toEqual([0, 1, 2, 2]);
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

    it("⚠️ lets the bank source back out of the Check step, and not past the import", () => {
        // The bank Check step is where the header row is chosen and NOTHING has been posted
        // anywhere — so going back to the file picker is free, exactly as on the other two
        // sources. `canStepBack` is source-blind on purpose: the boundary is "has anything been
        // written", which is a fact about the flow state and not about the file's columns.
        const checking = flow({ previewed: true });
        expect(canStepBack(checking)).toBe(true);
        expect(clickableStepIndex(BANK, checking, 0)).toBe(true);
        expect(clickableStepIndex(BANK, checking, 1)).toBe(false);

        const imported = flow({ previewed: true, staged: true });
        expect(canStepBack(imported)).toBe(false);
        expect(clickableStepIndex(BANK, imported, 0)).toBe(false);
        expect(clickableStepIndex(BANK, imported, 1)).toBe(false);
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
