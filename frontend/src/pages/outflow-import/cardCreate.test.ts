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
    typeChoiceLabel,
    type CardCreateProgress,
} from "./cardCreate";
import { CARD_SOURCE } from "./creditCardImport";
import { CARD_STEPS, currentStepIndex } from "./importWizard";

const progress = (overrides: Partial<CardCreateProgress> = {}): CardCreateProgress => ({
    spends: 40,
    created: 0,
    failed: 0,
    to_create: 40,
    create_running: false,
    discardable: true,
    ...overrides,
});

describe("Create is offered", () => {
    it("while spends are left to create and the job is not running", () => {
        expect(canCreateCard(progress())).toBe(true);
        expect(canCreateCard(progress({ create_running: true }))).toBe(false);
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
});
