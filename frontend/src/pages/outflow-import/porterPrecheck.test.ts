// The Porter Statement checked in the browser before upload (#1555): the screen helper's public function,
// driven the way the dialog drives it, with a file the Accountant picked.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PORTER_STEPS } from "./importWizard";
import {
    PORTER_CHECK_SKIPPED,
    PORTER_WRONG_TYPE,
    checkPorterFile,
    porterFileCheckLines,
    porterUploadAllowed,
    type PorterFileRules,
} from "./porterPrecheck";

const repoFile = (relative: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");

/** What `get_porter_statement_rules` answers: the parser's own list, read from it here as the server reads it. */
const RULES: PorterFileRules = {
    columns: [
        "crn",
        "order_completion_time",
        "invoice_order_fare",
        "tax_amount",
        "porter_invoice_number",
        "customer_gstin",
        "porter_gstin",
        "vehicle_type",
        "customer_name",
        "customer_mobile",
        "customer_email",
        "order_status",
        "city",
        "from_address",
        "to_address",
        "waypoint_addresses",
        "travel_distance_kms",
        "travel_duration",
        "waiting_time",
        "customer_remarks",
        "billing_entity",
        "invoice_link",
    ],
    completed_status: "completed",
    status_column: "order_status",
    completed_at_column: "order_completion_time",
    invoice_column: "invoice_link",
};

const file = (name: string, text: string) => ({ name, text: async () => text });

/** The repo's synthetic Porter fixture, shaped like the 2026-09 statement (23 columns, 12 orders). */
const SAMPLE = repoFile("nirmaan_stack/services/outflow_import/tests/fixtures/porter_sample.csv");

describe("a Porter Order statement CSV", () => {
    it("is accepted with its columns, orders, invoices, order dates and Cancelled Porter orders counted", async () => {
        expect(await checkPorterFile(file("porter_sep_2026.csv", SAMPLE), RULES)).toEqual({
            kind: "ok",
            columns: 22,
            orders: 12,
            invoices: 4,
            firstOrder: "2026-09-01",
            lastOrder: "2026-09-30",
            cancelled: 1,
        });
    });

    it("reads a header with a byte-order mark and day-first dates, and skips blank lines", async () => {
        const header = RULES.columns.join(",");
        const row = (crn: string, when: string, status: string, link: string) =>
            RULES.columns
                .map((column) =>
                    column === "crn"
                        ? crn
                        : column === "order_completion_time"
                          ? when
                          : column === "order_status"
                            ? status
                            : column === "invoice_link"
                              ? link
                              : "x",
                )
                .join(",");
        const text = `﻿${header}\n${row("C1", "03/10/2026 10:00", "Completed", "L1")}\n\n${row(
            "C2",
            "1/10/2026 09:00",
            "completed",
            "L1",
        )}\n${row("C3", "", "cancelled", "L2")}\n`;
        expect(await checkPorterFile(file("oct.csv", text), RULES)).toEqual({
            kind: "ok",
            columns: 22,
            orders: 3,
            invoices: 2,
            firstOrder: "2026-10-01",
            lastOrder: "2026-10-03",
            cancelled: 1,
        });
    });
});

describe("a file that is not a Porter Order statement is refused before upload", () => {
    it("names the missing columns and says which export to download", async () => {
        const withoutThree = SAMPLE.replace("order_completion_time", "completed_at")
            .replace("invoice_order_fare", "fare")
            .replace("billing_entity", "entity");
        expect(await checkPorterFile(file("orders.csv", withoutThree), RULES)).toEqual({
            kind: "refused",
            missing: ["order_completion_time", "invoice_order_fare", "billing_entity"],
            message:
                "This isn't a Porter order statement. 3 columns are missing: order_completion_time, invoice_order_fare, billing_entity. Download the Order statement as CSV from Porter for Business and try again.",
        });
    });

    it("refuses a header with no orders under it", async () => {
        const result = await checkPorterFile(file("empty.csv", `${RULES.columns.join(",")}\n`), RULES);
        expect(result.kind).toBe("refused");
    });

    it.each(["statement.pdf", "statement.xlsx", "statement.XLS"])("refuses %s as the wrong type, unread", async (name) => {
        const unread = { name, text: async () => Promise.reject(new Error("must not be read")) };
        expect(await checkPorterFile(unread, RULES)).toEqual({ kind: "refused", message: PORTER_WRONG_TYPE });
        expect(PORTER_WRONG_TYPE).toBe("A Porter statement is the CSV export, not PDF or Excel.");
    });
});

describe("what the screen says about an accepted file", () => {
    const iso = (value: string) => value;

    it("names the columns, the orders on their invoices, the order dates and the Cancelled orders skipped", async () => {
        const check = await checkPorterFile(file("porter_sep_2026.csv", SAMPLE), RULES);
        expect(check.kind === "ok" && porterFileCheckLines(check, iso)).toEqual([
            "All 22 Porter columns found",
            "12 orders on 4 invoices · orders from 2026-09-01 to 2026-09-30",
            "1 cancelled order will be skipped",
        ]);
    });

    it("speaks in the singular, says when no order is cancelled, and gives one date for a one-day file", () => {
        const one = { kind: "ok", columns: 22, orders: 1, invoices: 1, firstOrder: "2026-09-04", lastOrder: "2026-09-04", cancelled: 0 } as const;
        expect(porterFileCheckLines(one, iso)).toEqual([
            "All 22 Porter columns found",
            "1 order on 1 invoice · orders on 2026-09-04",
            "No cancelled orders",
        ]);
    });
});

describe("the second step's name", () => {
    it("is Check invoices at every width; Validate is gone", () => {
        const second = PORTER_STEPS[1];
        expect(second.title).toBe("Check invoices");
        expect(second.shortTitle ?? second.title).toBe("Check invoices");
        for (const step of PORTER_STEPS) expect(`${step.title} ${step.shortTitle ?? ""}`).not.toMatch(/validat/i);
    });
});

describe("the columns it counts by are the server's, never names typed here (#1554 review)", () => {
    it("reads the status, completion time and invoice link from the columns the rules name", async () => {
        const renamed: PorterFileRules = {
            ...RULES,
            columns: RULES.columns.map((column) => (column === "order_status" ? "trip_state" : column)),
            status_column: "trip_state",
        };
        const check = await checkPorterFile(file("sep.csv", SAMPLE.replace("order_status", "trip_state")), renamed);
        expect(check).toMatchObject({ kind: "ok", orders: 12, cancelled: 1 });
    });
});

describe("when the rules could not be fetched (#1555)", () => {
    it("skips the browser check with a short note, and the upload goes to the server", async () => {
        const check = await checkPorterFile(file("porter_sep_2026.csv", SAMPLE), null);
        expect(check).toEqual({ kind: "skipped", message: PORTER_CHECK_SKIPPED });
        expect(porterUploadAllowed(check)).toBe(true);
    });

    it("still refuses a PDF or Excel file, which needs no rules", async () => {
        expect(await checkPorterFile(file("statement.pdf", ""), null)).toEqual({ kind: "refused", message: PORTER_WRONG_TYPE });
    });

    it("lets an upload go only for an accepted or a skipped check", () => {
        expect(porterUploadAllowed(null)).toBe(false);
        expect(porterUploadAllowed({ kind: "refused", message: "no" })).toBe(false);
    });
});
