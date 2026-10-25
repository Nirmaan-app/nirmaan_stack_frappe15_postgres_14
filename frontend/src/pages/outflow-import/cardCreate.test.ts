// Review the card spends' types, then Create (#1568): each spend shows its type (Misc. Expenses marked
// "Check" until someone chooses), only a spend Create would still write is retypable, and Create is offered
// while spends are left to create and its job is not running.
import { describe, expect, it } from "vitest";

import {
    canCreateCard,
    cardCreateButtonLabel,
    cardCreateProgress,
    cardCreateStarted,
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
    created: 0,
    failed: 0,
    to_create: 40,
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

    it("names how many it creates, and the remainder once it has started", () => {
        expect(cardCreateButtonLabel(progress())).toBe("Create 40 expenses");
        expect(cardCreateButtonLabel(progress({ created: 39, to_create: 1, discardable: false }))).toBe(
            "Create the remaining 1",
        );
    });
});

describe("where Create stands", () => {
    it("says nothing before it starts", () => {
        expect(cardCreateStarted(progress())).toBe(false);
        expect(cardCreateProgress(progress())).toBeNull();
    });

    it("counts while it runs, and the dialog polls", () => {
        const running = progress({ create_running: true, created: 12, to_create: 28, discardable: false });
        expect(cardCreateStarted(running)).toBe(true);
        expect(cardPolling(running)).toBe(true);
        expect(cardCreateProgress(running)).toBe("Creating… 12 of 40 created.");
    });

    it("names a spend that failed, and that Create retries it", () => {
        const stopped = progress({ created: 39, failed: 1, to_create: 1, discardable: false });
        expect(cardPolling(stopped)).toBe(false);
        expect(cardCreateProgress(stopped)).toBe(
            "39 of 40 created. 1 could not be created: press Create again to retry it.",
        );
    });

    it("says when every spend is created, at Paid", () => {
        expect(cardCreateProgress(progress({ created: 40, to_create: 0, discardable: false }))).toBe(
            "All 40 expenses created, at Paid.",
        );
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
