// The Porter Statement source on the screen (#1443): its string is the server's everywhere it appears,
// it has its own step flow, its own Import History tab, and its upload reports itself in one line.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { initialHistoryTab, importsInTab, tabCounts } from "./importHistoryView";
import {
    IMPORT_SOURCES,
    PORTER_STEPS,
    SOURCES_WITH_OWN_FLOW,
    currentStepIndex,
    importSteps,
} from "./importWizard";
import { NEVER_MATCHED_SOURCES } from "./outflowImportStatus";
import { SOURCE_OPTIONS } from "./outflowTableModel";
import { PORTER_SOURCE, invoiceStateTone, porterCountsLine } from "./porterImport";
import { unskipBlockReason } from "./unskipView";

const repoFile = (relative: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");

describe("the Porter Statement source string is the server's, everywhere", () => {
    it("is spelled as sources.PORTER_STATEMENT_SOURCE", () => {
        const sources = repoFile("nirmaan_stack/services/outflow_import/sources.py");
        expect(sources).toContain(`PORTER_STATEMENT_SOURCE = "${PORTER_SOURCE}"`);
    });

    it("is an option of the Outflow Import Batch source Select", () => {
        // Read as text, not parsed: the Select's options line is the one fact asked of the file.
        const batch = repoFile(
            "nirmaan_stack/nirmaan_stack/doctype/outflow_import_batch/outflow_import_batch.json",
        );
        const options = batch.match(/"fieldname": "source",[\s\S]*?"options": "([^"]*)"/)?.[1] ?? "";
        expect(options.split("\\n")).toEqual([...SOURCE_OPTIONS]);
    });

    it("is in the source options, the dialog's source list and the never-matched set", () => {
        expect(SOURCE_OPTIONS).toContain(PORTER_SOURCE);
        expect(IMPORT_SOURCES.map((source) => source.value)).toEqual([...SOURCE_OPTIONS]);
        expect(NEVER_MATCHED_SOURCES.has(PORTER_SOURCE)).toBe(true);
    });

    it("every source with its own wizard flow is a source the dialog offers", () => {
        expect(SOURCES_WITH_OWN_FLOW).toContain(PORTER_SOURCE);
        for (const source of SOURCES_WITH_OWN_FLOW) expect(SOURCE_OPTIONS).toContain(source);
    });
});

describe("the Porter step flow", () => {
    it("is upload, check invoices, review projects, create", () => {
        expect(importSteps(PORTER_SOURCE)).toBe(PORTER_STEPS);
        expect(PORTER_STEPS.map((step) => step.key)).toEqual(["upload", "validate", "review", "create"]);
    });

    it("lands on the invoice check once the upload has written", () => {
        const state = { previewed: false, staged: false, matched: false };
        expect(currentStepIndex(PORTER_SOURCE, state)).toBe(0);
        expect(currentStepIndex(PORTER_SOURCE, { ...state, staged: true })).toBe(1);
        expect(PORTER_STEPS[1].key).toBe("validate");
    });
});

describe("the Porter tab in Import History", () => {
    const imports = [
        { name: "OFI-1", source: "Cashfree" },
        { name: "OFI-2", source: PORTER_SOURCE },
        { name: "OFI-3", source: PORTER_SOURCE },
    ];

    it("lists only Porter Statements under the Porter tab", () => {
        expect(importsInTab(imports, PORTER_SOURCE).map((item) => item.name)).toEqual(["OFI-2", "OFI-3"]);
        expect(tabCounts(imports)[PORTER_SOURCE]).toBe(2);
    });

    it("opens on the Porter tab for a selected Porter import", () => {
        expect(initialHistoryTab(PORTER_SOURCE, [])).toBe(PORTER_SOURCE);
    });
});

describe("a cancelled Porter order", () => {
    it("can never be unskipped, and says why", () => {
        expect(
            unskipBlockReason({ row_status: "Skipped", skip_kind: "Porter order cancelled", source: PORTER_SOURCE }),
        ).toBe("Porter cancelled this order and never billed it.");
    });
});

describe("what the upload reports", () => {
    const invoice = (n: number) => ({
        name: `INV-${n}`,
        invoice_number: `INV-${n}`,
        city: "Bangalore",
        billing_entity: "PORTERTEST LOGISTICS PRIVATE LIMITED",
        completed_orders: 1,
        fare_total: 100,
        tax_total: 5,
        validation_status: "Queued",
    });

    it("counts orders, invoices and the cancelled orders it skipped", () => {
        expect(porterCountsLine({ orders: 159, cancelled: 1, invoices: [1, 2, 3].map(invoice) })).toBe(
            "159 orders · 3 invoices · 1 cancelled order skipped",
        );
    });

    it("says nothing about cancellations when there were none, and counts in the singular", () => {
        expect(porterCountsLine({ orders: 1, cancelled: 0, invoices: [invoice(1)] })).toBe("1 order · 1 invoice");
    });

    it("tones an invoice by whether its check is settled, and which way", () => {
        expect(invoiceStateTone("Passed")).toBe("passed");
        expect(invoiceStateTone("Failed")).toBe("failed");
        expect(invoiceStateTone("Error")).toBe("failed");
        for (const state of ["Queued", "Downloading", "Reading", "Comparing"]) {
            expect(invoiceStateTone(state)).toBe("pending");
        }
    });
});
