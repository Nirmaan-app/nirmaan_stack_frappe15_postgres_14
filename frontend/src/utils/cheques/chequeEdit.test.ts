import { describe, expect, it } from "vitest";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";

import {
    canEditCheque,
    chequeEditMode,
    chequeFormRules,
    chequeFormFromDetail,
    editChequeArgs,
    editLockHint,
    isHeaderLocked,
} from "./chequeEdit";
import { makeChequeFormSchema } from "./chequeForm";

const ACCOUNTANT = "Nirmaan Accountant Profile";
const PROCUREMENT = "Nirmaan Procurement Executive Profile";
const PM = "Nirmaan Project Manager Profile";

const detail = (overrides: Partial<ChequeDetail> = {}): ChequeDetail => ({
    name: "CHQ-26-00001",
    creation: "2026-10-01 10:00:00",
    owner: "buyer@nirmaan.app",
    cheque_no: "004521",
    bank: "ICICI Bank",
    bank_name: null,
    bank_label: "ICICI Bank",
    cheque_date: "2026-10-14",
    amount: 30000,
    status: "Approval Pending",
    cheque_type: "Payment",
    old_type: 0,
    vendor: "VEN-0042",
    vendor_name: "Shree Steel",
    payee_name: null,
    description: null,
    attachment: "/private/files/cheque.jpg",
    made_from: "Report",
    lines: [
        {
            idx: 1,
            line_type: "PO/WO Payment",
            project: "PROJ-1",
            record_doctype: "Service Requests",
            record_name: "SR-001",
            payment_doctype: "Project Payments",
            payment_name: "PAY-1",
            payment_status: "Requested",
            amount: 20000,
        },
        {
            idx: 2,
            line_type: "PO/WO Payment",
            project: "PROJ-1",
            record_doctype: "Service Requests",
            record_name: "SR-001",
            payment_doctype: null,
            payment_name: null,
            amount: 5000,
        },
        {
            idx: 3,
            line_type: "Non-project Expense",
            project: null,
            record_doctype: null,
            record_name: null,
            payment_doctype: "Non Project Expenses",
            payment_name: "NPE-7",
            amount: 5000,
        },
    ],
    history: [],
    ...overrides,
});

describe("canEditCheque", () => {
    it("lets accounts edit any Cheque, at any status", () => {
        expect(canEditCheque({ status: "Cleared", owner: "someone@else" }, ACCOUNTANT, "acc@nirmaan.app")).toBe(true);
        expect(canEditCheque({ status: "Cancelled", owner: "someone@else" }, "Nirmaan Admin Profile", "Administrator")).toBe(true);
    });

    it("lets Procurement edit only the Pending Cheques they created (C6, #1482)", () => {
        const user = "buyer@nirmaan.app";
        expect(canEditCheque({ status: "Approval Pending", owner: user }, PROCUREMENT, user)).toBe(true);
        expect(canEditCheque({ status: "Issued", owner: user }, PROCUREMENT, user)).toBe(false);
        expect(canEditCheque({ status: "Approval Pending", owner: "other@nirmaan.app" }, PROCUREMENT, user)).toBe(false);
        expect(canEditCheque({ status: "Cleared", owner: user }, PROCUREMENT, user)).toBe(false);
    });

    it("lets Procurement edit only the Issued Security Deposit cheques they created (#1486)", () => {
        const user = "buyer@nirmaan.app";
        const deposit = (status: "Issued" | "Cancelled", owner = user) => ({ status, owner, cheque_type: "Security Deposit" as const });
        expect(canEditCheque(deposit("Issued"), PROCUREMENT, user)).toBe(true);
        expect(canEditCheque(deposit("Cancelled"), PROCUREMENT, user)).toBe(false);
        expect(canEditCheque(deposit("Issued", "other@nirmaan.app"), PROCUREMENT, user)).toBe(false);
    });

    it("never lets a Project Manager edit", () => {
        expect(canEditCheque({ status: "Issued", owner: "pm@nirmaan.app" }, PM, "pm@nirmaan.app")).toBe(false);
    });
});

describe("chequeEditMode and its locks", () => {
    it("opens everything on an Issued Security Deposit, and only the photo once it is Cancelled (#1486)", () => {
        const deposit = { old_type: 0 as const, cheque_type: "Security Deposit" as const };
        expect(chequeEditMode({ ...deposit, status: "Issued" })).toBe("all");
        expect(chequeEditMode({ ...deposit, status: "Cancelled" })).toBe("photo_only");
    });

    it("opens only what is written on a Pending Payment cheque: its number, bank, date and photo (spec #1514)", () => {
        for (const made_from of ["Report", "PO/WO Page"] as const) {
            const edit = detail({ made_from });
            const mode = chequeEditMode(edit);
            expect(mode).toBe("header");
            expect(["bank", "bank_name", "cheque_no", "cheque_date", "attachment"].some((f) => isHeaderLocked(mode, f))).toBe(false);
            expect(["amount", "vendor", "payee_name", "description"].every((f) => isHeaderLocked(mode, f))).toBe(true);
            expect(editLockHint(mode, edit)).toBe(
                "Only what is written on the cheque can change: its number, bank, date and photo. What it pays stays as " +
                    "it was made; to pay something else, cancel it and raise the payment again from the PO.",
            );
        }
    });

    it("leaves only the photo open once Issued, Cleared or Cancelled (#1482)", () => {
        for (const status of ["Issued", "Cleared", "Cancelled"] as const) {
            const edit = detail({ status, made_from: "PO/WO Page" });
            const mode = chequeEditMode(edit);
            expect(mode).toBe("photo_only");
            expect(isHeaderLocked(mode, "attachment")).toBe(false);
            expect(["bank", "cheque_no", "cheque_date", "vendor", "description"].every((f) => isHeaderLocked(mode, f))).toBe(true);
            expect(editLockHint(mode, edit)).toBe(`This cheque is ${status}: only its photo can change.`);
        }
    });

    it("leaves only the photo open on an Old-type cheque, even while Pending", () => {
        const edit = detail({ old_type: 1, vendor: null, payee_name: "Tata Power" });
        const mode = chequeEditMode(edit);
        expect(mode).toBe("photo_only");
        expect(editLockHint(mode, edit)).toBe("This is an Old-type cheque: only its photo can change.");
    });

    it("asks for the photo only when the Cheque has one: a backfilled Cheque saves without", () => {
        expect(chequeFormRules(detail())).toEqual({ photoRequired: true });
        expect(chequeFormRules(detail({ status: "Cleared", attachment: null }))).toEqual({ photoRequired: false });
    });
});

describe("chequeFormFromDetail", () => {
    it("fills the form with the Cheque's header as recorded", () => {
        expect(chequeFormFromDetail(detail())).toEqual({
            bank: "ICICI Bank",
            bank_name: "",
            cheque_no: "004521",
            cheque_date: "2026-10-14",
            amount: 30000,
            payee_kind: "vendor",
            vendor: "VEN-0042",
            payee_name: "",
            description: "",
            attachment: "/private/files/cheque.jpg",
        });
    });

    it("picks the typed-payee kind for a Cheque with no Vendor", () => {
        const form = chequeFormFromDetail(detail({ vendor: null, payee_name: "Tata Power", lines: [] }));
        expect([form.payee_kind, form.payee_name, form.vendor]).toEqual(["typed", "Tata Power", ""]);
    });
});

describe("editChequeArgs", () => {
    it("names the Cheque and sends its header, never its lines, so they stay as made", () => {
        const edit = detail({ description: "Advance" });
        const values = makeChequeFormSchema(chequeFormRules(edit)).parse({
            ...chequeFormFromDetail(edit),
            cheque_no: " 004522 ",
            cheque_date: "2026-10-20",
        });
        const args = editChequeArgs("CHQ-26-00001", values);
        expect(args).toEqual({
            name: "CHQ-26-00001",
            bank: "ICICI Bank",
            cheque_no: "004522",
            cheque_date: "2026-10-20",
            amount: 30000,
            vendor: "VEN-0042",
            description: "Advance",
            attachment: "/private/files/cheque.jpg",
        });
        expect("lines" in args).toBe(false);
    });

    it("sends an Old-type cheque's typed payee back as recorded", () => {
        const old = detail({ old_type: 1, vendor: null, payee_name: "Tata Power", description: "Rent", lines: [] });
        const args = editChequeArgs("CHQ-26-00001", makeChequeFormSchema(chequeFormRules(old)).parse(chequeFormFromDetail(old)));
        expect([args.payee_name, args.vendor]).toEqual(["Tata Power", undefined]);
    });
});
