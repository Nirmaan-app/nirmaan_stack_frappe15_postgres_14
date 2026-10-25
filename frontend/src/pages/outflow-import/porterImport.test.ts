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
import {
    PORTER_CREATE_METHOD,
    PORTER_IMPORT_STATES,
    PORTER_INVOICE_STATES,
    PORTER_SOURCE,
    canCreatePorter,
    canRetryInvoice,
    createButtonLabel,
    createProgress,
    invoiceFigureRows,
    invoiceProgress,
    invoiceStateTone,
    isPorterImport,
    opensPorterDialog,
    porterCountsLine,
    porterCreateStarted,
    porterPolling,
    porterStateNote,
    porterStateTone,
    porterValidationRunning,
    type PorterCreateProgress,
} from "./porterImport";
import { porterReviewOffered } from "./porterReview";
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

    it("follows the import's state: Review once validated, Create once Create has started", () => {
        const uploaded = { previewed: true, staged: true, matched: false };
        // The dialog's flow facts, derived from the server's state exactly as the dialog derives them.
        const step = (state: string) =>
            PORTER_STEPS[
                currentStepIndex(PORTER_SOURCE, {
                    ...uploaded,
                    validated: porterReviewOffered({ state }),
                    createStarted: porterCreateStarted({ state }),
                })
            ].key;
        expect(step("Validating")).toBe("validate");
        expect(step("Validation failed")).toBe("validate");
        expect(step("Validated")).toBe("review");
        expect(step("Creating")).toBe("create");
        expect(step("Created")).toBe("create");
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

describe("choosing a Porter import from a list of statements", () => {
    it("opens its own dialog, wherever it was chosen: its lines are not bank lines", () => {
        expect(opensPorterDialog("OFI-2", [{ name: "OFI-2", source: PORTER_SOURCE }])).toBe(true);
        expect(opensPorterDialog("OFI-2", [{ name: "OFI-2", source: ` ${PORTER_SOURCE} ` }])).toBe(true);
    });

    it("pins the table for any other statement, for All imports, and for one the list does not hold", () => {
        expect(opensPorterDialog("OFI-1", [{ name: "OFI-1", source: "Cashfree" }])).toBe(false);
        expect(opensPorterDialog(undefined, [{ name: "OFI-2", source: PORTER_SOURCE }])).toBe(false);
        expect(opensPorterDialog("OFI-9", [{ name: "OFI-2", source: PORTER_SOURCE }])).toBe(false);
    });

    it("reads one statement's source the same way (Import History hands its row's source)", () => {
        expect(isPorterImport(` ${PORTER_SOURCE} `)).toBe(true);
        expect(isPorterImport("Cashfree")).toBe(false);
        expect(isPorterImport(undefined)).toBe(false);
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

describe("validating against Porter's invoices (#1444)", () => {
    it("spells every invoice state as the Porter Invoice doctype does, in its order", () => {
        const doctype = repoFile("nirmaan_stack/nirmaan_stack/doctype/porter_invoice/porter_invoice.json");
        const options = doctype.match(/"fieldname": "validation_status",[\s\S]*?"options": "([^"]*)"/)?.[1] ?? "";
        expect(options.split("\\n")).toEqual([...PORTER_INVOICE_STATES]);
    });

    it("spells the import's states as the server derives them", () => {
        const service = repoFile("nirmaan_stack/services/outflow_import/porter_state.py");
        for (const state of PORTER_IMPORT_STATES) expect(service).toContain(`= "${state}"`);
        expect(PORTER_IMPORT_STATES).toEqual([
            "Validating",
            "Validated",
            "Validation failed",
            "Creating",
            "Created",
        ]);
    });

    it("keeps polling only while the import is validating", () => {
        expect(porterValidationRunning({ state: "Validating" })).toBe(true);
        expect(porterValidationRunning({ state: "Validated" })).toBe(false);
        expect(porterValidationRunning({ state: "Validation failed" })).toBe(false);
        expect(porterValidationRunning(undefined)).toBe(false);
    });

    it("shows each invoice's progress as Downloading, Reading, Comparing, then its outcome", () => {
        const progress = (validation_status: string, has_pdf = true, read: object | null = {}) =>
            invoiceProgress({ validation_status, has_pdf, read: read as never });
        expect(progress("Queued", false, null)).toEqual([
            { label: "Downloading", mark: "todo" },
            { label: "Reading", mark: "todo" },
            { label: "Comparing", mark: "todo" },
            { label: "Result", mark: "todo" },
        ]);
        expect(progress("Reading", true, null).map((step) => step.mark)).toEqual(["done", "current", "todo", "todo"]);
        expect(progress("Passed")[3]).toEqual({ label: "Passed", mark: "passed" });
        expect(progress("Failed")[3]).toEqual({ label: "Failed", mark: "failed" });
        expect(progress("Passed").slice(0, 3).every((step) => step.mark === "done")).toBe(true);
    });

    it("marks the step an Error broke in, from what the invoice holds", () => {
        const marks = (has_pdf: boolean, read: object | null) =>
            invoiceProgress({ validation_status: "Error", has_pdf, read: read as never }).map((step) => step.mark);
        // No PDF stored: the download broke.
        expect(marks(false, null)).toEqual(["failed", "todo", "todo", "failed"]);
        // A PDF but nothing read: Gemini broke.
        expect(marks(true, null)).toEqual(["done", "failed", "todo", "failed"]);
        // Read, but a figure missing: the comparison could not decide.
        expect(marks(true, {})).toEqual(["done", "done", "failed", "failed"]);
        expect(invoiceProgress({ validation_status: "Error", has_pdf: false, read: null })[3].label).toBe("Error");
    });

    it("sets what Gemini read beside the statement's figures, flagging only a read that differs", () => {
        const rows = invoiceFigureRows({
            invoice_number: "29SS27A0900001",
            porter_gstin: "29AAATP0000A1Z1",
            customer_gstin: "29AAACN9999X1Z0",
            fare_total: 3087,
            tax_total: 154.36,
            read: {
                invoice_number: "29SS27A0900001",
                invoice_date: "2026-10-01",
                supplier_gstin: "29aaatp0000a1z1",
                receiver_gstin: "27AAACN9999X1Z4",
                fare: 3087,
                tax: 155.37,
            },
        });
        expect(rows.map((row) => [row.label, row.differs])).toEqual([
            ["Invoice number", false],
            ["Porter GSTIN", false],
            ["Customer GSTIN", true],
            ["Fare", false],
            ["Tax", true],
        ]);
        const tax = rows.find((row) => row.label === "Tax");
        expect(tax?.statement).toBe(154.36);
        expect(tax?.read).toBe(155.37);
    });

    it("flags nothing before Gemini has read the invoice", () => {
        const rows = invoiceFigureRows({
            invoice_number: "X",
            porter_gstin: "G1",
            customer_gstin: "G2",
            fare_total: 1,
            tax_total: 1,
        });
        expect(rows.every((row) => !row.differs && row.read === null)).toBe(true);
    });

    it("offers Retry only on an invoice that hit an Error", () => {
        expect(canRetryInvoice({ validation_status: "Error" })).toBe(true);
        for (const state of ["Failed", "Passed", "Queued", "Reading"]) {
            expect(canRetryInvoice({ validation_status: state })).toBe(false);
        }
    });

    it("says what each import state means for Create", () => {
        expect(porterStateNote("Validating")).toMatch(/carries on/);
        expect(porterStateNote("Validated")).toMatch(/Every invoice agrees/);
        expect(porterStateNote("Validation failed")).toMatch(/Nothing will be created/);
    });
});

describe("creating the expenses (#1445)", () => {
    const status = (overrides: Partial<PorterCreateProgress> = {}): PorterCreateProgress => ({
        state: "Validated",
        completed: 11,
        to_create: 11,
        created: 0,
        failed: 0,
        create_running: false,
        ...overrides,
    });

    it("pins the Create endpoint to the server's module", () => {
        const module = repoFile("nirmaan_stack/api/outflow_import/porter_create.py");
        expect(PORTER_CREATE_METHOD).toBe("nirmaan_stack.api.outflow_import.porter_create.create_porter_expenses");
        expect(module).toContain("def create_porter_expenses(batch: str)");
    });

    it("offers Create only on a validated import with orders left to create, and not while it runs", () => {
        expect(canCreatePorter(status())).toBe(true);
        expect(canCreatePorter(status({ state: "Creating", to_create: 1, created: 10, failed: 1 }))).toBe(true);
        expect(canCreatePorter(status({ create_running: true }))).toBe(false);
        expect(canCreatePorter(status({ state: "Created", to_create: 0, created: 11 }))).toBe(false);
        for (const state of ["Validating", "Validation failed"]) {
            expect(canCreatePorter(status({ state }))).toBe(false);
        }
    });

    it("names what the button will create", () => {
        expect(createButtonLabel(status())).toBe("Create 11 expenses");
        expect(createButtonLabel(status({ to_create: 1 }))).toBe("Create 1 expense");
        expect(createButtonLabel(status({ state: "Creating", to_create: 2, created: 9 }))).toBe(
            "Create the remaining 2",
        );
    });

    it("polls while validating or while the Create job is queued or running", () => {
        expect(porterPolling(status({ state: "Validating" }))).toBe(true);
        expect(porterPolling(status({ create_running: true }))).toBe(true);
        expect(porterPolling(status())).toBe(false);
        expect(porterPolling(status({ state: "Created", to_create: 0, created: 11 }))).toBe(false);
        expect(porterPolling(undefined)).toBe(false);
    });

    it("reports progress from the lines, and says what is left after a run that could not finish", () => {
        expect(createProgress(status())).toBeNull();
        expect(createProgress(status({ create_running: true }))).toBe("Creating… 0 of 11 created.");
        expect(createProgress(status({ state: "Creating", create_running: true, created: 4, to_create: 7 }))).toBe(
            "Creating… 4 of 11 created.",
        );
        expect(createProgress(status({ state: "Creating", created: 10, to_create: 1 }))).toBe(
            "10 of 11 created. 1 is waiting: press Create again to create it.",
        );
        // A failed order, and every order created, are the result's to say (`porterResult`, #1561).
        expect(createProgress(status({ state: "Creating", created: 10, to_create: 1, failed: 1 }))).toBeNull();
        expect(createProgress(status({ state: "Created", created: 11, to_create: 0 }))).toBeNull();
    });

    it("says what Creating and Created mean, and tones Created as done", () => {
        expect(porterStateNote("Creating")).toMatch(/Creating the expenses/);
        expect(porterStateNote("Created")).toMatch(/one expense per completed order/);
        expect(porterStateNote("Needs you")).toBe(
            "Not every order is created yet, and nothing is running: press Create again for the rest.",
        );
        expect(porterStateTone("Created")).toBe("passed");
        expect(porterStateTone("Creating")).toBe("pending");
    });
});
