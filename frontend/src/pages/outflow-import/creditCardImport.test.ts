// The Credit Card Statement source on the screen (#1566): its string is the server's everywhere it appears,
// it has its own step flow, its own Import History tab ("Credit Card"), listed by holder and period, and a
// read-only Review.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    CARD_SOURCE,
    canDiscardCard,
    cardCountsLine,
    cardDiscardConfirmation,
    cardHistoryTitle,
    cardTotalsRows,
    isCardImport,
    opensCardDialog,
    type CardImport,
} from "./creditCardImport";
import { historyEmptyLabel, historySubtitle, importsInTab, initialHistoryTab, tabCounts } from "./importHistoryView";
import {
    CARD_STEPS,
    IMPORT_SOURCES,
    SOURCES_WITH_OWN_FLOW,
    acceptedExtensions,
    currentStepIndex,
    importSteps,
} from "./importWizard";
import { NEVER_MATCHED_SOURCES } from "./outflowImportStatus";
import { SOURCE_OPTIONS, sourceLabel } from "./outflowTableModel";

const repoFile = (relative: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");

const cardImport = (overrides: Partial<CardImport> = {}): CardImport => ({
    batch: "OFI-26-00100",
    source: CARD_SOURCE,
    statement: "CCS-26-00001",
    original_filename: "statement.pdf",
    holder: "TEST HOLDER",
    company: "STRATOS INFRA TECHNOLOGIES PVT LTD",
    statement_date: "2026-10-01",
    period_from: "2026-09-02",
    period_to: "2026-10-01",
    statement_file: "/private/files/statement.pdf",
    totals: {
        previous_balance: 224166.02,
        purchases_charges: 137584.99,
        cash_advances: 0,
        payments_credits: 276821.73,
        total_amount_due: 84929.28,
    },
    spends: 40,
    credits: 7,
    spends_total: 137584.99,
    repeats_not_saved: 0,
    discardable: true,
    created: 0,
    failed: 0,
    to_create: 40,
    create_running: false,
    suggest_running: false,
    expense_types: ["Misc. Expenses"],
    lines: [],
    ...overrides,
});

describe("the Credit Card Statement source string is the server's, everywhere", () => {
    it("is spelled as sources.CARD_STATEMENT_SOURCE", () => {
        const sources = repoFile("nirmaan_stack/services/outflow_import/sources.py");
        expect(sources).toContain(`CARD_STATEMENT_SOURCE = "${CARD_SOURCE}"`);
    });

    it("is the last option of the Outflow Import Batch source Select, as SOURCE_OPTIONS is", () => {
        const batch = repoFile(
            "nirmaan_stack/nirmaan_stack/doctype/outflow_import_batch/outflow_import_batch.json",
        );
        const options = batch.match(/"fieldname": "source",[\s\S]*?"options": "([^"]*)"/)?.[1] ?? "";
        expect(options.split("\\n")).toEqual([...SOURCE_OPTIONS]);
        expect(SOURCE_OPTIONS[SOURCE_OPTIONS.length - 1]).toBe(CARD_SOURCE);
    });

    it("is in the dialog's source list, the never-matched set and the sources with their own flow", () => {
        expect(IMPORT_SOURCES.map((source) => source.value)).toEqual([...SOURCE_OPTIONS]);
        expect(NEVER_MATCHED_SOURCES.has(CARD_SOURCE)).toBe(true);
        expect(SOURCES_WITH_OWN_FLOW).toContain(CARD_SOURCE);
    });

    it("is a match basis the server's Outflow Row Match takes", () => {
        const match = repoFile("nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.json");
        const options = match.match(/"fieldname": "match_basis",[\s\S]*?"options": "([^"]*)"/)?.[1] ?? "";
        expect(options.split("\\n")).toContain("card statement");
    });
});

describe("the card step flow", () => {
    it("is upload, review, create, and takes only the bank's PDF", () => {
        expect(importSteps(CARD_SOURCE)).toBe(CARD_STEPS);
        expect(CARD_STEPS.map((step) => step.key)).toEqual(["upload", "review", "create"]);
        expect(acceptedExtensions(CARD_SOURCE)).toEqual([".pdf"]);
    });

    it("lands on Review once the upload has written", () => {
        const state = { previewed: false, staged: false, matched: false };
        expect(currentStepIndex(CARD_SOURCE, state)).toBe(0);
        expect(CARD_STEPS[currentStepIndex(CARD_SOURCE, { ...state, previewed: true, staged: true })].key).toBe(
            "review",
        );
    });
});

describe("the Credit Card tab in Import History", () => {
    const imports = [
        { name: "OFI-1", source: "Cashfree" },
        { name: "OFI-2", source: CARD_SOURCE, card_holder: "TEST HOLDER" },
    ];

    it("is labelled Credit Card and lists only card statements", () => {
        expect(sourceLabel(CARD_SOURCE)).toBe("Credit Card");
        expect(sourceLabel("Cashfree")).toBe("Cashfree");
        expect(importsInTab(imports, CARD_SOURCE).map((item) => item.name)).toEqual(["OFI-2"]);
        expect(tabCounts(imports)[CARD_SOURCE]).toBe(1);
        expect(initialHistoryTab(CARD_SOURCE, [])).toBe(CARD_SOURCE);
    });

    it("speaks of Credit Card statements", () => {
        expect(historySubtitle(CARD_SOURCE, "2026-09")).toBe(
            "Credit Card statements covering September 2026. Select one to open it.",
        );
        expect(historyEmptyLabel(CARD_SOURCE, "2026-09", "")).toBe("No Credit Card statements cover September 2026.");
    });

    it("lists a statement by its holder, and a statement with no holder by its file", () => {
        expect(cardHistoryTitle({ name: "OFI-2", card_holder: "TEST HOLDER", original_filename: "a.pdf" })).toBe(
            "TEST HOLDER",
        );
        expect(cardHistoryTitle({ name: "OFI-3", original_filename: "a.pdf" })).toBe("a.pdf");
    });

    it("opens its own dialog when chosen: its lines are not bank lines", () => {
        expect(opensCardDialog("OFI-2", [{ name: "OFI-2", source: ` ${CARD_SOURCE} ` }])).toBe(true);
        expect(opensCardDialog("OFI-1", [{ name: "OFI-1", source: "Cashfree" }])).toBe(false);
        expect(opensCardDialog(undefined, [{ name: "OFI-2", source: CARD_SOURCE }])).toBe(false);
        expect(isCardImport(CARD_SOURCE)).toBe(true);
        expect(isCardImport("Porter Statement")).toBe(false);
    });
});

describe("the read-only Review", () => {
    it("counts the spends and the credits, and the lines left out as already imported", () => {
        expect(cardCountsLine(cardImport())).toBe("40 spends · 7 credits");
        expect(cardCountsLine(cardImport({ spends: 1, credits: 0, repeats_not_saved: 46 }))).toBe(
            "1 spend · 0 credits · 46 lines already imported left out",
        );
    });

    it("shows the statement's five summary totals in its own order", () => {
        expect(cardTotalsRows(cardImport())).toEqual([
            { label: "Previous Balance", amount: 224166.02 },
            { label: "Purchases / Charges", amount: 137584.99 },
            { label: "Cash Advances", amount: 0 },
            { label: "Payments / Credits", amount: 276821.73 },
            { label: "Total Amount Due", amount: 84929.28 },
        ]);
    });
});

describe("Discard", () => {
    it("is offered to Admin and Accountant Lead while Create has written nothing", () => {
        expect(canDiscardCard(cardImport(), true)).toBe(true);
        expect(canDiscardCard(cardImport(), false)).toBe(false);
        expect(canDiscardCard(cardImport({ discardable: false }), true)).toBe(false);
    });

    it("says what goes and that the statement can be uploaded again", () => {
        expect(cardDiscardConfirmation(cardImport())).toBe(
            "Discard OFI-26-00100? This deletes TEST HOLDER's statement for 02-Sep-2026 to 01-Oct-2026, its 47 lines and its PDF. Nothing was created from it, so nothing else changes. You can upload the statement again afterwards.",
        );
    });
});
