// src/pages/outflow-import/importWizard.ts

import type { WizardStep } from "@/components/ui/wizard-steps";

/**
 * The import dialog's steps (slice CF/S7, third source added at C6).
 *
 * ⚠️ ONE STEP LIST PER SOURCE, NOT ONE SHARED SHAPE (owner ruling). A Cashfree import PAYS what
 * somebody approved; a Cashbook import CREATES what a wallet already spent; a bank import merely
 * BRINGS THE ROWS IN for a person to resolve afterwards. Forcing them into one list would need a
 * step that means nothing on the other sides — and the deepest difference is at step 3: by then a
 * Cashfree import has ALREADY WRITTEN its rows, and a Cashbook one has written nothing at all.
 *
 * ⚠️ THE COUNT IS FIXED PER SOURCE AND MUST STAY THAT WAY. A wizard whose last step disappears when
 * it has nothing to say reads as a crash, so Cashfree's step 4 renders even when nothing matched —
 * see `confirmEmptyCopy`. Never make a step conditional; give the source its own list instead.
 *
 * Pure: no React, no fetching. `ImportStatementDialog` derives everything from these.
 */

export type CashfreeStepKey = "upload" | "check" | "run" | "confirm";
export type CashbookStepKey = "upload" | "review" | "create";
export type BankStepKey = "upload" | "check" | "import";
export type ImportStepKey = CashfreeStepKey | CashbookStepKey | BankStepKey;

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

/**
 * The bank statement's three steps (slice C6, owner ruling).
 *
 * ⚠️ IT ENDS WHERE THE WORK ENDS, WHICH IS WHY IT IS NOT CASHFREE'S FOUR. A bank row carries no
 * transfer id anybody approved against, so the matcher can never settle one and every row lands
 * `Mismatched` on the Not-Matched worklist. Running Cashfree's Confirm step here would put a
 * permanently, structurally empty screen at the end of every bank import — a last impression that
 * says the import found nothing, when in truth it was never that step's job to find anything.
 */
export const BANK_STEPS: (WizardStep & { key: BankStepKey })[] = [
    { key: "upload", title: "Upload", shortTitle: "Upload" },
    { key: "check", title: "Check", shortTitle: "Check" },
    { key: "import", title: "Import", shortTitle: "Import" },
];

/**
 * Everything that differs between sources, in ONE place, keyed by the source string.
 *
 * ⚠️ A LOOKUP RATHER THAN A CHAIN OF `source === "…"` LITERALS (slice C6). The step list and the
 * step INDEX are two halves of one answer — how many steps this source has, and which of them it is
 * on — and while they lived as two separate branch chains a fourth source meant editing both and
 * they were free to disagree, which shows up as a stepper pointing at a step that does not exist.
 * Adding a source is now one entry here plus its `*_STEPS` array; it is DATA, not a third literal.
 *
 * ⚠️ THE DEFAULT IS CASHFREE, AND AN UNKNOWN SOURCE FALLS TO IT DELIBERATELY. A source the picker
 * cannot offer should never reach here, but rendering a stepper with no steps at all would look
 * like a crash rather than a mis-configuration.
 */
interface SourceFlow {
    steps: (WizardStep & { key: ImportStepKey })[];
    /** Zero-indexed into `steps`, derived from the flow state alone. */
    stepIndex: (state: ImportFlowState) => number;
}

const DEFAULT_FLOW: SourceFlow = {
    steps: CASHFREE_STEPS,
    // ⚠️ A FAILED MATCH STAYS ON STEP 3 — see the `currentStepIndex` note below.
    stepIndex: (state) =>
        state.staged ? (state.matched ? 3 : 2) : state.previewed ? 1 : 0,
};

const SOURCE_FLOWS: Record<string, SourceFlow> = {
    Cashbook: {
        steps: CASHBOOK_STEPS,
        // `matched` is meaningless here: a Cashbook import creates records rather than finding
        // them, so there is nothing for a matcher to have run.
        stepIndex: (state) => (state.staged ? 2 : state.previewed ? 1 : 0),
    },
    "ICICI Bank Statement": {
        steps: BANK_STEPS,
        /**
         * ⚠️ `matched` IS NOT READ, AND THAT IS THE FAILED-MATCH RULING ARRIVING SOMEWHERE ELSE.
         * On Cashfree a failed match must NOT advance to Confirm, because "nothing matched" and
         * "the match never ran" are different sentences and only the second has a Re-run button as
         * its answer. Here the index is 2 whether the run succeeded or threw — not because the
         * distinction stopped mattering, but because step 3 IS the terminal step: there is nowhere
         * to be wrongly advanced TO. The distinction is still carried on screen, by the footer that
         * renders from step 3 on and holds the Re-run button beside the error.
         */
        stepIndex: (state) => (state.staged ? 2 : state.previewed ? 1 : 0),
    },
};

const flowFor = (source: string): SourceFlow => SOURCE_FLOWS[source] ?? DEFAULT_FLOW;

export const importSteps = (source: string): (WizardStep & { key: ImportStepKey })[] =>
    flowFor(source).steps;

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
 * ⚠️ A FAILED MATCH STAYS ON STEP 3 (owner ruling), AND IT IS CASHFREE'S RULE BECAUSE ONLY CASHFREE
 * HAS A FOURTH STEP. Advancing to Confirm would show an honestly empty list for the WRONG reason —
 * "nothing matched" and "the match never ran" are different sentences, and only the second has a
 * Re-run button as its answer. On the bank source the index is 2 either way, because 2 IS the last
 * step; the two sentences are still told apart on screen by the error banner and the footer's
 * Re-run button, both of which render from step 3 on. See `SOURCE_FLOWS`.
 *
 * ⚠️ IT READS THE SAME `SOURCE_FLOWS` TABLE `importSteps` DOES, so an index can never point past
 * the end of the list it is an index into.
 */
export const currentStepIndex = (source: string, state: ImportFlowState): number =>
    flowFor(source).stepIndex(state);

/**
 * May the reviewer step BACK from here?
 *
 * ⚠️ ONLY BETWEEN 1 AND 0, AND THE BOUNDARY IS "HAS ANYTHING BEEN WRITTEN". Steps 0 and 1 touch
 * nothing on the server, so going back is free. From step 2 on, a Cashfree import's rows are staged
 * and "back" would mean re-uploading a statement the duplicate guard will refuse — an offer that
 * cannot be honoured. Cashbook is the same shape for the same reason: its batch and rows exist by
 * then, even though the expenses are still being written. So is the bank source — its step 2 is the
 * Check step, where the header row is chosen and nothing has been posted anywhere yet.
 *
 * ⚠️ IT IS DELIBERATELY SOURCE-BLIND. The boundary is "has anything been written", which is a fact
 * about `ImportFlowState` and not about which columns the file has, so a fourth source inherits the
 * right answer without an entry anywhere.
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
