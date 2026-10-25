// The Porter import's progress bar (#1556, spec #1554 stories 49, 56-60): each phase's colour and words
// from the server's per-phase summary.
import { describe, expect, it } from "vitest";

import { type PorterProgress, historyChips, progressPhases, shownPorterState } from "./porterProgress";

const summary = (over: {
    check?: Partial<PorterProgress["check"]>;
    projects?: Partial<PorterProgress["projects"]>;
    create?: Partial<PorterProgress["create"]>;
} = {}): PorterProgress => ({
    upload: { orders: 164, invoices: 10, cancelled: 4 },
    check: {
        invoices: 10,
        passed: 10,
        in_progress: 0,
        to_retry: 0,
        not_matching: 0,
        seconds_left: null,
        ...over.check,
    },
    projects: { orders: 160, placed_automatically: 155, placed_by_person: 0, needs_person: 5, ...over.projects },
    create: { orders: 160, created: 0, waiting: 160, failed: 0, reopened: 0, running: false, ...over.create },
});

const shown = (progress: PorterProgress | null) =>
    progressPhases(progress).map(({ title, tone, counts }) => [title, tone, counts]);

describe("progressPhases", () => {
    it("before anything is uploaded, only Upload is open", () => {
        expect(shown(null)).toEqual([
            ["Upload", "current", "Choose the file"],
            ["Check invoices", "idle", "Not started"],
            ["Choose projects", "idle", "Not started"],
            ["Confirm & create", "idle", "Not started"],
        ]);
    });

    it("while checking, the check is the system's turn with the time left, and the rest wait for it", () => {
        expect(shown(summary({ check: { passed: 6, in_progress: 4, seconds_left: 160 } }))).toEqual([
            ["Upload", "done", "164 orders · 4 cancelled"],
            ["Check invoices", "running", "6 of 10 checked · about 3 min left"],
            ["Choose projects", "idle", "After the check"],
            ["Confirm & create", "idle", "After the check"],
        ]);
    });

    it("an invoice that doesn't match blocks the check", () => {
        expect(shown(summary({ check: { passed: 8, to_retry: 1, not_matching: 1 } }))[1]).toEqual([
            "Check invoices",
            "blocked",
            "8 passed · 1 to retry · 1 doesn't match",
        ]);
        expect(shown(summary({ check: { passed: 7, not_matching: 3 } }))[1][2]).toBe("7 passed · 3 don't match");
    });

    it("an invoice to retry, and nothing that doesn't match, is the person's turn", () => {
        expect(shown(summary({ check: { passed: 9, to_retry: 1 } }))[1]).toEqual([
            "Check invoices",
            "needs",
            "9 passed · 1 to retry",
        ]);
    });

    it("once every invoice passed, orders needing a project are the person's turn and Create waits", () => {
        expect(shown(summary()).slice(1)).toEqual([
            ["Check invoices", "done", "10 of 10 passed"],
            ["Choose projects", "needs", "5 of 160 need you"],
            ["Confirm & create", "idle", "Waiting"],
        ]);
    });

    it("with every order placed, Create is the person's turn", () => {
        const progress = summary({ projects: { placed_automatically: 150, placed_by_person: 10, needs_person: 0 } });
        expect(shown(progress).slice(2)).toEqual([
            ["Choose projects", "done", "160 placed"],
            ["Confirm & create", "needs", "160 to create"],
        ]);
    });

    it("reads Creating only while a create job runs", () => {
        const progress = summary({ create: { created: 40, waiting: 120, running: true } });
        expect(shown(progress).slice(2)).toEqual([
            ["Choose projects", "done", "160 placed"],
            ["Confirm & create", "running", "Creating · 40 of 160"],
        ]);
    });

    it("a partly created import with no job running needs a person, never Creating", () => {
        const failed = summary({ create: { created: 158, waiting: 0, failed: 2 } });
        expect(shown(failed)[3]).toEqual(["Confirm & create", "needs", "158 of 160 · 2 need you"]);
        const reopened = summary({ create: { created: 159, waiting: 0, reopened: 1 } });
        expect(shown(reopened)[3]).toEqual(["Confirm & create", "needs", "159 of 160 · 1 needs you"]);
    });

    it("when every order is created, every phase is done", () => {
        const progress = summary({ create: { created: 160, waiting: 0 } });
        expect(progressPhases(progress).map((phase) => phase.tone)).toEqual(["done", "done", "done", "done"]);
        expect(shown(progress)[3][2]).toBe("160 of 160 created");
    });

    it("an upload with no cancelled order does not mention cancelled orders", () => {
        const progress = summary();
        progress.upload = { orders: 1, invoices: 1, cancelled: 0 };
        expect(shown(progress)[0][2]).toBe("1 order");
    });
});

describe("shownPorterState", () => {
    it("reads Creating only while the create job runs; a partly created import needs you", () => {
        expect(shownPorterState({ state: "Creating", create_running: true })).toBe("Creating");
        expect(shownPorterState({ state: "Creating", create_running: false })).toBe("Needs you");
    });

    it("leaves every other state as the server spells it", () => {
        for (const state of ["Validating", "Validated", "Validation failed", "Created"]) {
            expect(shownPorterState({ state, create_running: false })).toBe(state);
        }
    });
});

describe("historyChips", () => {
    it("is one chip per phase, coloured as the bar is", () => {
        expect(historyChips(summary()).map(({ tone, label }) => [tone, label])).toEqual([
            ["done", "Uploaded"],
            ["done", "10 invoices checked"],
            ["needs", "5 orders need a project"],
            ["idle", "Create waiting"],
        ]);
    });

    it("names the check's problem and a half-done Create", () => {
        const progress = summary({
            check: { passed: 8, to_retry: 1, not_matching: 1 },
        });
        expect(historyChips(progress)[1]).toEqual({ tone: "blocked", label: "Invoices: 8 passed · 1 to retry · 1 doesn't match" });
        const partly = summary({ create: { created: 158, waiting: 0, failed: 2 }, projects: { needs_person: 0 } });
        expect(historyChips(partly)[3]).toEqual({ tone: "needs", label: "158 of 160 created · 2 need you" });
    });
});
