// Review the card spends' types, then Create (#1568): each spend shows its type (Misc. Expenses marked
// "Check" until someone chooses), only a spend Create would still write is retypable, and Create is offered
// while spends are left to create and its job is not running.
import { describe, expect, it } from "vitest";

import {
    canCreateCard,
    cardCreateButtonLabel,
    cardCreateStarted,
    cardPhaseView,
    cardPolling,
    cardSuggestNote,
    merchantRetype,
    merchantScope,
    typeChoiceLabel,
    typeSourceTitle,
    type CardCreateProgress,
} from "./cardCreate";
import { CARD_SOURCE, type CardImportLine } from "./creditCardImport";
import { CARD_STEPS, currentStepIndex } from "./importWizard";

const progress = (overrides: Partial<CardCreateProgress> = {}): CardCreateProgress => ({
    spends: 40,
    refunds: 0,
    created: 0,
    failed: 0,
    to_create: 40,
    spends_to_create: 40,
    refunds_to_create: 0,
    create_running: false,
    suggest_running: false,
    discardable: true,
    ...overrides,
});

describe("Create is offered", () => {
    it("while spends are left to create and the job is not running", () => {
        expect(canCreateCard(progress())).toBe(true);
        expect(canCreateCard(progress({ create_running: true }))).toBe(false);
        // Not while the types are still being suggested (#1569).
        expect(canCreateCard(progress({ suggest_running: true }))).toBe(false);
        expect(canCreateCard(progress({ created: 40, to_create: 0, discardable: false }))).toBe(false);
    });

    it("names both counts when unpaired refunds wait too (#1673)", () => {
        const withRefund = progress({ spends: 39, refunds: 1, to_create: 40, spends_to_create: 39, refunds_to_create: 1 });
        expect(cardCreateButtonLabel(withRefund)).toBe("Create 39 expenses and 1 refund");
        expect(
            cardCreateButtonLabel(progress({ refunds: 2, to_create: 2, spends_to_create: 0, refunds_to_create: 2 })),
        ).toBe("Create 2 refunds");
    });

    it("names how many it creates, and the remainder once it has started", () => {
        expect(cardCreateButtonLabel(progress())).toBe("Create 40 expenses");
        expect(
            cardCreateButtonLabel(
                progress({ created: 39, to_create: 1, spends_to_create: 1, discardable: false }),
            ),
        ).toBe("Create the remaining 1 expense");
    });
});

describe("the dialog's phase (#1674)", () => {
    const settled = (name: string, amount: number, over: Partial<CardImportLine> = {}) =>
        spend(name, "SHOP", { amount, row_status: "Settled", editable: false, expense: `NPE-${name}`, ...over });
    // Two spends and a refund created, one line skipped, one internal transfer.
    const finishedLines = [
        settled("s1", 100),
        settled("s2", 50.5),
        settled("r1", 801.5, { is_credit: true, is_refund: true }),
        spend("k1", "UPI", { is_credit: true, row_status: "Skipped", skip_kind: "Card payment received" }),
        spend("t1", "AUTODEBIT", { is_credit: true, row_status: "Internal Transfer" }),
    ];

    it("Review: Create not started; Create, Discard and Done are offered, nothing is reported yet", () => {
        const view = cardPhaseView({ ...progress({ refunds: 1, to_create: 41, refunds_to_create: 1 }), lines: [] });
        expect(view.phase).toBe("review");
        expect(view.progress).toBeNull();
        expect(view.banner).toBeNull();
        expect(view.notice).toBeNull();
        expect(view.footer).toEqual({ create: "Create 40 expenses and 1 refund", discard: true, done: "outline" });
    });

    it("Creating: the job is queued or running; it counts N of M with a bar, and only Done is offered", () => {
        const running = progress({
            refunds: 1, create_running: true, created: 12, to_create: 29, spends_to_create: 28, refunds_to_create: 1,
            discardable: false,
        });
        const view = cardPhaseView({ ...running, lines: [] });
        expect(view.phase).toBe("creating");
        expect(cardCreateStarted(running) && cardPolling(running)).toBe(true);
        expect(view.progress).toEqual({ label: "Creating… 12 of 41", percent: 29 });
        expect(view.banner).toBeNull();
        expect(view.footer).toEqual({ create: null, discard: false, done: "outline" });
    });

    it("Finished: nothing left to create; a green banner with the counts, and Done is the only button", () => {
        const finished = progress({ spends: 2, refunds: 1, created: 3, to_create: 0, spends_to_create: 0, discardable: false });
        const view = cardPhaseView({ ...finished, lines: finishedLines });
        expect(view.phase).toBe("finished");
        expect(view.banner).toEqual({
            title: "Import finished",
            lines: [
                "2 expenses created, ₹150.50",
                "1 refund recorded, -₹801.50",
                "1 line skipped",
                "1 internal transfer",
            ],
        });
        expect(view.progress).toBeNull();
        expect(view.notice).toBeNull();
        expect(view.footer).toEqual({ create: null, discard: false, done: "primary" });
    });

    it("Needs another Create: some lines failed or wait; it says how many and offers Create again", () => {
        const failed = progress({ refunds: 1, created: 40, failed: 1, to_create: 1, spends_to_create: 1, discardable: false });
        const view = cardPhaseView({ ...failed, lines: [] });
        expect(view.phase).toBe("needs_create");
        expect(view.banner).toBeNull();
        expect(view.notice).toBe("40 of 41 created. 1 line could not be created: press Create again to retry it.");
        expect(view.footer).toEqual({ create: "Create the remaining 1 expense", discard: false, done: "outline" });

        const waiting = progress({ refunds: 1, created: 39, to_create: 2, spends_to_create: 1, refunds_to_create: 1, discardable: false });
        expect(cardPhaseView({ ...waiting, lines: [] }).notice).toBe(
            "39 of 41 created. 2 lines still wait: press Create again to create them.",
        );
    });

    it("a reopened finished import (Import History) reads Finished from the import alone", () => {
        const reopened = progress({ spends: 2, refunds: 1, created: 3, to_create: 0, spends_to_create: 0, discardable: false });
        expect(cardPhaseView({ ...reopened, lines: finishedLines }).phase).toBe("finished");
    });

    it("moves the stepper to Create once it has started", () => {
        const state = { previewed: true, staged: true, matched: false, createStarted: true };
        expect(CARD_STEPS[currentStepIndex(CARD_SOURCE, state)].key).toBe("create");
    });
});

describe("a spend's type", () => {
    it("says where it came from", () => {
        expect(typeChoiceLabel({ type_source: "Fallback", check: true })).toBe("Check");
        expect(typeChoiceLabel({ type_source: "Chosen on Review", check: false })).toBe("Chosen on Review");
        expect(typeChoiceLabel({ type_source: null, check: false })).toBeNull();
    });

    it("names the fallback's source in its title, and every other source", () => {
        expect(typeSourceTitle({ type_source: "Fallback" })).toBe(
            "Fallback: nothing better was known for this merchant. Check it.",
        );
        expect(typeSourceTitle({ type_source: "Earlier statement" })).toBe(
            "Confirmed for this merchant on an earlier statement.",
        );
        expect(typeSourceTitle({ type_source: "AI" })).toBe("Suggested by AI from the live type list.");
        expect(typeSourceTitle({ type_source: null })).toBeNull();
    });
});

describe("suggesting types (#1569)", () => {
    it("polls and says so while the suggestion runs", () => {
        expect(cardPolling({ create_running: false, suggest_running: true })).toBe(true);
        expect(cardSuggestNote({ suggest_running: true })).toBe(
            "Suggesting expense types… Review updates when it is done.",
        );
        expect(cardPolling({ create_running: false, suggest_running: false })).toBe(false);
        expect(cardSuggestNote({ suggest_running: false })).toBeNull();
    });
});

const spend = (name: string, merchant: string, overrides: Partial<CardImportLine> = {}): CardImportLine =>
    Object.assign(
        {
            name,
            serno: name,
            date: "2026-09-10",
            details: merchant,
            merchant,
            amount: 100,
            is_credit: false,
            row_status: "Pending match run",
            skip_kind: null,
            skip_reason: null,
            expense_type: "Misc. Expenses",
            type_source: "Fallback",
            check: true,
            editable: true,
            is_refund: false,
            expense: null,
            outcome_note: null,
        },
        overrides,
    );

describe("retyping every spend of one merchant (#1569)", () => {
    const lines = [
        spend("a", "MAKEMYTRIP", {
            expense_type: "Travel Expenses (Flight)",
            type_source: "Chosen on Review",
            check: false,
        }),
        spend("b", "MAKEMYTRIP"),
        spend("c", "MAKEMYTRIP"),
        spend("d", "SWIGGY"),
        spend("e", "MAKEMYTRIP", { editable: false, row_status: "Settled" }),
        spend("f", "MAKEMYTRIP", { is_credit: true, merchant: null, expense_type: null, editable: false }),
    ];

    it("offers the line's type to the merchant's other spends Create would still write", () => {
        expect(merchantRetype(lines, lines[0])).toEqual({
            rows: ["a", "b", "c"],
            expenseType: "Travel Expenses (Flight)",
            label: "Use for all 3 MAKEMYTRIP spends",
        });
    });

    it("is not offered once they all have the type, or for a merchant with one spend", () => {
        const same = lines.map((line) => ({ ...line, expense_type: "Travel Expenses (Flight)" }));
        expect(merchantRetype(same, same[0])).toBeNull();
        expect(merchantRetype(lines, lines[3])).toBeNull();
    });

    it("is not offered on a spend that can no longer be retyped", () => {
        expect(merchantRetype(lines, lines[4])).toBeNull();
    });

    it("is not offered from a spend still at the fallback: there is no choice to spread", () => {
        expect(merchantRetype(lines, lines[1])).toBeNull();
    });
});

describe("choosing a type for every spend of one merchant in one step (story 29)", () => {
    // Ten MakeMyTrip lines, all still at the fallback: one choice types them all.
    const lines = [
        ...Array.from({ length: 10 }, (_, i) => spend(`m${i}`, "MAKEMYTRIP")),
        spend("s", "SWIGGY"),
        spend("done", "MAKEMYTRIP", { editable: false, row_status: "Settled" }),
        spend("cr", "MAKEMYTRIP", { is_credit: true, merchant: null, expense_type: null, editable: false }),
    ];

    it("offers every retypable spend of the merchant, from any of them, all at Check too", () => {
        const scope = merchantScope(lines, lines[3]);
        expect(scope).toEqual({
            rows: ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"],
            label: "All 10 MAKEMYTRIP spends",
        });
    });

    it("is not offered for a merchant with one retypable spend, a credit, or a spend Create has written", () => {
        expect(merchantScope(lines, lines[10])).toBeNull();
        expect(merchantScope(lines, lines[11])).toBeNull();
        expect(merchantScope(lines, lines[12])).toBeNull();
    });
});

describe("an unpaired card refund's type is its own (#1673)", () => {
    const refund = spend("r", "MAKEMYTRIP", { is_credit: true, is_refund: true });
    const lines = [
        spend("a", "MAKEMYTRIP", { expense_type: "Hotel Expenses", type_source: "Chosen on Review", check: false }),
        spend("b", "MAKEMYTRIP"),
        refund,
    ];

    it("Use for all reaches only the merchant's spends, never its refund", () => {
        expect(merchantRetype(lines, lines[0])?.rows).toEqual(["a", "b"]);
        expect(merchantScope(lines, lines[0])?.rows).toEqual(["a", "b"]);
    });

    it("the refund's own picker types it alone", () => {
        expect(merchantScope(lines, refund)).toBeNull();
        expect(merchantRetype(lines, refund)).toBeNull();
    });
});
