// src/pages/outflow-import/importWizard.ts

import type { WizardStep } from "@/components/ui/wizard-steps";

/**
 * The import dialog's steps (slice CF/S7).
 *
 * ⚠️ TWO STEP LISTS, NOT ONE SHARED SHAPE (owner ruling). A Cashfree import PAYS what somebody
 * approved; a Cashbook import CREATES what a wallet already spent. Forcing them into one list would
 * need a step that means nothing on one side — and the deepest difference is at step 3: by then a
 * Cashfree import has ALREADY WRITTEN its rows, and a Cashbook one has written nothing at all.
 *
 * ⚠️ THE COUNT IS FIXED PER SOURCE AND MUST STAY THAT WAY. A wizard whose last step disappears when
 * it has nothing to say reads as a crash, so step 4 renders even when nothing matched — see
 * `confirmEmptyCopy`.
 *
 * Pure: no React, no fetching. `ImportStatementDialog` derives everything from these.
 */

export type CashfreeStepKey = "upload" | "check" | "run" | "confirm";
export type CashbookStepKey = "upload" | "review" | "create";
export type ImportStepKey = CashfreeStepKey | CashbookStepKey;

export const CASHFREE_STEPS: (WizardStep & { key: CashfreeStepKey })[] = [
    { key: "upload", title: "Upload", shortTitle: "Upload" },
    { key: "check", title: "Check", shortTitle: "Check" },
    { key: "run", title: "Import & match", shortTitle: "Import" },
    { key: "confirm", title: "Confirm", shortTitle: "Confirm" },
];

export const CASHBOOK_STEPS: (WizardStep & { key: CashbookStepKey })[] = [
    { key: "upload", title: "Upload", shortTitle: "Upload" },
    { key: "review", title: "Review plan", shortTitle: "Review" },
    { key: "create", title: "Create", shortTitle: "Create" },
];

export const importSteps = (source: string): (WizardStep & { key: ImportStepKey })[] =>
    source === "Cashbook" ? CASHBOOK_STEPS : CASHFREE_STEPS;

/**
 * What the dialog has achieved so far. The step is DERIVED from this, never held beside it.
 *
 * ⚠️ ONE SOURCE OF TRUTH, BECAUSE A STEP POINTER CAN LIE. A separate `currentStep` number would be
 * free to disagree with what is actually on screen — showing "Confirm" over an unmatched statement,
 * or "Upload" after the rows were written. Every field here is a fact about the SERVER's state, so
 * the step can only ever describe something that really happened.
 */
export interface ImportFlowState {
    /** The server read the file and returned a plan. Nothing written. */
    previewed: boolean;
    /** The rows are IN THE DATABASE. Past this point there is no going back. */
    staged: boolean;
    /** The match run finished. False while it runs AND after it fails. */
    matched: boolean;
}

/**
 * Which step the flow is on, zero-indexed into `importSteps(source)`.
 *
 * ⚠️ A FAILED MATCH STAYS ON STEP 3 (owner ruling). Advancing to Confirm would show an honestly
 * empty list for the WRONG reason — "nothing matched" and "the match never ran" are different
 * sentences, and only the second has a Re-run button as its answer.
 */
export const currentStepIndex = (source: string, state: ImportFlowState): number => {
    if (source === "Cashbook") {
        if (state.staged) return 2;
        return state.previewed ? 1 : 0;
    }
    if (state.staged) return state.matched ? 3 : 2;
    return state.previewed ? 1 : 0;
};

/**
 * May the reviewer step BACK from here?
 *
 * ⚠️ ONLY BETWEEN 1 AND 0, AND THE BOUNDARY IS "HAS ANYTHING BEEN WRITTEN". Steps 0 and 1 touch
 * nothing on the server, so going back is free. From step 2 on, a Cashfree import's rows are staged
 * and "back" would mean re-uploading a statement the duplicate guard will refuse — an offer that
 * cannot be honoured. Cashbook is the same shape for the same reason: its batch and rows exist by
 * then, even though the expenses are still being written.
 */
export const canStepBack = (state: ImportFlowState): boolean =>
    state.previewed && !state.staged;

/** Which step circles a reader may click. Completed steps only, and never past a write. */
export const clickableStepIndex = (
    source: string,
    state: ImportFlowState,
    target: number
): boolean => target < currentStepIndex(source, state) && canStepBack(state);

/**
 * What step 4 says when the matcher found nothing to confirm.
 *
 * ⚠️ THE STEP STILL RENDERS (owner ruling). "Nothing matched" is a real finding — on the first live
 * statement 145 transfers had nothing to settle against — and a step that vanishes when it has
 * nothing to report reads as a failure. It names where the work went instead of going quiet.
 */
export const confirmEmptyCopy = (importedRows: number): string =>
    importedRows > 0
        ? `None of these ${importedRows} transfers matched an approved record. They are waiting in the Not-Matched list, where each one can be linked by hand.`
        : "Nothing matched an approved record. Anything still open is in the Not-Matched list.";

/**
 * The heading over step 4.
 *
 * ⚠️ IT NAMES THE WIDER SCOPE, BECAUSE THE STEP HAS ONE (owner ruling, Q12/Q21). The list is every
 * confirmable transfer in the system, not only the statement just imported — the whole reason to
 * re-run after an upload is that a payment approved yesterday belongs to an OLDER statement. A
 * heading implying "this import" would misdescribe what the Confirm button writes.
 */
export const CONFIRM_STEP_NOTE =
    "Everything the matcher is sure about, across every open import — not only the statement you just uploaded.";

/** The wording on the way out of a step that has already written rows. */
export const FINISH_LATER_NOTE =
    "These transfers are already imported. You can confirm them now, or any time from the summary screen.";
