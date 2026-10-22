// `chequeEdit.ts` mirrors two backend rules to shape the Edit dialog: which header boxes an Approval Pending
// Payment cheque opens (`edit_rules.PAYMENT_CHEQUE_EDITABLE_FIELDS`) and which banks a cheque may be drawn on
// (`rules.header_problem`: a Payment cheque on ICICI Bank only). The Python is the enforcement; these cases
// read it as text so the two cannot drift (F1).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { chequeBankOptions, isHeaderLocked } from "./chequeEdit";
import { PAID_LINE_CANCEL_REASON } from "./chequeStatus";

const SERVICES = resolve(__dirname, "../../../../nirmaan_stack/services/cheques");
const EDIT_RULES = readFileSync(resolve(SERVICES, "edit_rules.py"), "utf-8");
const RULES = readFileSync(resolve(SERVICES, "rules.py"), "utf-8");
const CLEAR_RULES = readFileSync(resolve(SERVICES, "clear_rules.py"), "utf-8");

/** The body of the module-level tuple `name = (...)` in `source`. */
const tupleBody = (source: string, name: string): string => {
    const m = source.match(new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, "m"));
    expect(m, `${name} not found`).toBeTruthy();
    return m![1];
};

/** The string literals of the tuple `name`. */
const stringTuple = (source: string, name: string): string[] =>
    [...tupleBody(source, name).matchAll(/"([^"]*)"/g)].map((g) => g[1]);

/** The module-level string constant `name`. */
const stringConstant = (source: string, name: string): string => {
    const m = source.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
    expect(m, `${name} not found`).toBeTruthy();
    return m![1];
};

describe("parity with services/cheques/edit_rules.py and rules.py", () => {
    it("reads the real Python modules", () => {
        expect(EDIT_RULES).toContain("def edit_problem");
        expect(RULES).toContain("def header_problem");
    });

    it("an Approval Pending Payment cheque's Edit opens the fields PAYMENT_CHEQUE_EDITABLE_FIELDS allows, and its photo", () => {
        const editable = stringTuple(EDIT_RULES, "PAYMENT_CHEQUE_EDITABLE_FIELDS");
        const header = stringTuple(EDIT_RULES, "EDITABLE_HEADER_FIELDS");
        expect(editable.length).toBeGreaterThan(0);
        const open = [...header, "attachment"].filter((field) => !isHeaderLocked("header", field));
        expect(open.sort()).toEqual([...editable, "attachment"].sort());
    });

    it("a Payment cheque is offered only the bank header_problem allows; a deposit cheque every bank", () => {
        expect(RULES).toMatch(/cheque_type == CHEQUE_TYPE_PAYMENT and header\.bank != ICICI_BANK/);
        const banks = tupleBody(RULES, "BANKS")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => stringConstant(RULES, name));
        expect(chequeBankOptions({ cheque_type: stringConstant(RULES, "CHEQUE_TYPE_PAYMENT") })).toEqual([
            stringConstant(RULES, "ICICI_BANK"),
        ]);
        expect(chequeBankOptions({ cheque_type: stringConstant(RULES, "CHEQUE_TYPE_SECURITY_DEPOSIT") })).toEqual(banks);
    });
});

describe("parity with services/cheques/clear_rules.py", () => {
    it("the Cancel dialog refuses a cheque with a Paid line in the words cancel_problem uses", () => {
        expect(CLEAR_RULES).toContain("def cancel_problem");
        expect(stringConstant(CLEAR_RULES, "PAID_LINE_CANCEL_REASON")).toBe(PAID_LINE_CANCEL_REASON);
    });
});
