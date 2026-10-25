// `TDS_BORNE_BY` copies `payment_tds.BORNE_BY_VENDOR` / `BORNE_BY_COMPANY`: the server writes
// `Payment TDS Deduction.borne_by` with those strings, and the Work Order screens compare against this
// copy to decide whose tax a row is. A rename on one side only would make every comparison quietly
// false. The repo's convention for a rule with two homes is a parity test (ADR-0010 F1); this is that
// test. It reads the Python file as text, so the first case guards against a moved file reading as "".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TDS_BORNE_BY } from "./PaymentTDSDeduction";

const PAYMENT_TDS_PY = fileURLToPath(
    new URL("../../../../nirmaan_stack/services/payment_tds.py", import.meta.url)
);

const source = readFileSync(PAYMENT_TDS_PY, "utf8");

describe("TDS_BORNE_BY parity — the frontend copy matches payment_tds.py", () => {
    it("reads the real payment_tds.py, not an empty string standing in for it", () => {
        expect(source).toContain("def write_deduction");
    });

    it("VENDOR is BORNE_BY_VENDOR", () => {
        expect(source).toContain(`BORNE_BY_VENDOR = "${TDS_BORNE_BY.VENDOR}"`);
    });

    it("COMPANY is BORNE_BY_COMPANY", () => {
        expect(source).toContain(`BORNE_BY_COMPANY = "${TDS_BORNE_BY.COMPANY}"`);
    });
});
