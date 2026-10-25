// Discard on a Porter import (#1447, #1557): who is offered it, when, and what the confirmation says it deletes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PORTER_DISCARD_METHOD, canDiscardPorter, discardConfirmation, repeatsLeftOutNote } from "./porterDiscard";

const repoFile = (relative: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");

const status = (overrides: Partial<Parameters<typeof canDiscardPorter>[0]> = {}) => ({
    state: "Validation failed",
    discardable: true,
    create_running: false,
    ...overrides,
});

describe("canDiscardPorter", () => {
    it("is offered on an import Create has not written to, to every module user (Accountant included)", () => {
        for (const state of ["Validating", "Validated", "Validation failed"]) {
            expect(canDiscardPorter(status({ state }))).toBe(true);
        }
    });

    it("is not offered once Create has written anything, or while its job runs", () => {
        expect(canDiscardPorter(status({ state: "Creating", discardable: false }))).toBe(false);
        expect(canDiscardPorter(status({ state: "Created", discardable: false }))).toBe(false);
        expect(canDiscardPorter(status({ state: "Validated", create_running: true }))).toBe(false);
    });

    it("reads a server that does not say as not discardable", () => {
        expect(canDiscardPorter({ state: "Validated", create_running: false })).toBe(false);
    });
});

describe("discardConfirmation", () => {
    it("names the import and everything it deletes, and that the statement can come back", () => {
        const text = discardConfirmation({
            batch: "OFI-26-00042",
            orders: 12,
            invoices: [{}, {}, {}, {}],
        });
        expect(text).toBe(
            "Discard OFI-26-00042? This removes the whole import: its 12 orders, its 4 Porter invoices and their PDFs. " +
                "Nothing was created from it, so nothing else changes. You can upload the statement again afterwards.",
        );
    });

    it("speaks in the singular for one", () => {
        expect(discardConfirmation({ batch: "OFI-1", orders: 1, invoices: [{}] })).toContain(
            "its 1 order, its 1 Porter invoice and its PDF.",
        );
    });
});

describe("repeatsLeftOutNote", () => {
    it("says how many orders were left out as already created, and nothing when none were", () => {
        expect(repeatsLeftOutNote(9)).toBe(
            "9 orders on invoices already created were left out: they are not saved again.",
        );
        expect(repeatsLeftOutNote(1)).toBe(
            "1 order on an invoice already created was left out: it is not saved again.",
        );
        expect(repeatsLeftOutNote(0)).toBeNull();
        expect(repeatsLeftOutNote(undefined)).toBeNull();
    });
});

describe("the Discard endpoint is the server's", () => {
    it("is a POST-only whitelisted method of porter_discard", () => {
        const [, module, method] = PORTER_DISCARD_METHOD.match(/^nirmaan_stack\.api\.outflow_import\.(\w+)\.(\w+)$/) ?? [];
        const source = repoFile(`nirmaan_stack/api/outflow_import/${module}.py`);
        expect(source).toMatch(new RegExp(`@frappe\\.whitelist\\(methods=\\["POST"\\]\\)\\ndef ${method}\\(`));
    });

    it("is gated by the module access alone, as the screen is, not by the undo profiles", () => {
        const source = repoFile("nirmaan_stack/api/outflow_import/porter_discard.py");
        expect(source).toContain("require_outflow_access()");
        expect(source).not.toContain("has_outflow_undo_access");
    });
});
