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
    paymentsOnCheque,
    paymentsSwitchingToOnline,
    switchBackHint,
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
    status: "Pending",
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
        expect(canEditCheque({ status: "Pending", owner: user }, PROCUREMENT, user)).toBe(true);
        expect(canEditCheque({ status: "Issued", owner: user }, PROCUREMENT, user)).toBe(false);
        expect(canEditCheque({ status: "Pending", owner: "other@nirmaan.app" }, PROCUREMENT, user)).toBe(false);
        expect(canEditCheque({ status: "Cleared", owner: user }, PROCUREMENT, user)).toBe(false);
    });

    it("never lets a Project Manager edit", () => {
        expect(canEditCheque({ status: "Issued", owner: "pm@nirmaan.app" }, PM, "pm@nirmaan.app")).toBe(false);
    });
});

describe("chequeEditMode and its locks", () => {
    it("opens everything on a Tracker-made Pending Cheque", () => {
        const edit = detail({ made_from: "Report" });
        const mode = chequeEditMode(edit);
        expect(mode).toBe("all");
        expect(isHeaderLocked(mode, "cheque_no")).toBe(false);
        expect(editLockHint(mode, edit)).toBeUndefined();
        expect(chequeFormRules(edit)).toEqual({ photoRequired: true, paymentCheque: true });
    });

    it("keeps a PO-page Pending Cheque's number, date and amount", () => {
        const edit = detail({ made_from: "PO/WO Page" });
        const mode = chequeEditMode(edit);
        expect(mode).toBe("po_wo_page");
        expect(["cheque_no", "cheque_date", "amount"].map((f) => isHeaderLocked(mode, f))).toEqual([true, true, true]);
        expect(["bank", "vendor", "description", "lines", "attachment"].some((f) => isHeaderLocked(mode, f))).toBe(false);
        expect(editLockHint(mode, edit)).toBe(
            "Made from the PO/WO page: the number, date and amount stay as on its payment. Change them on the payment.",
        );
    });

    it("opens everything on a PO-page Pending Cheque with no Project Payment line left", () => {
        // Its payment came off (removed or swapped out): nothing to stay in step with.
        const withoutPayment = detail().lines.filter((l) => l.payment_doctype !== "Project Payments");
        const mode = chequeEditMode(detail({ made_from: "PO/WO Page", lines: withoutPayment }));
        expect(mode).toBe("all");
        expect(isHeaderLocked(mode, "amount")).toBe(false);
        expect(chequeEditMode(detail({ made_from: "PO/WO Page", lines: [] }))).toBe("all");
    });

    it("leaves only the photo open once Issued, Cleared or Cancelled, wherever it was made (#1482)", () => {
        for (const status of ["Issued", "Cleared", "Cancelled"] as const) {
            const edit = detail({ status, made_from: "PO/WO Page" });
            const mode = chequeEditMode(edit);
            expect(mode).toBe("photo_only");
            expect(isHeaderLocked(mode, "attachment")).toBe(false);
            expect(["bank", "cheque_no", "vendor", "description", "lines"].every((f) => isHeaderLocked(mode, f))).toBe(true);
            expect(editLockHint(mode, edit)).toBe(`This cheque is ${status}: only its photo can change.`);
            expect(chequeFormRules(edit).paymentCheque).toBe(false);
        }
    });

    it("leaves only the photo open on an Old-type cheque, even while Pending", () => {
        const edit = detail({ old_type: 1, vendor: null, payee_name: "Tata Power" });
        const mode = chequeEditMode(edit);
        expect(mode).toBe("photo_only");
        expect(editLockHint(mode, edit)).toBe("This is an Old-type cheque: only its photo can change.");
        expect(chequeFormRules(edit)).toEqual({ photoRequired: true, paymentCheque: false });
    });

    it("lets an edit of a backfilled Cheque save without a photo", () => {
        expect(chequeFormRules(detail({ status: "Cleared", attachment: null })).photoRequired).toBe(false);
    });
});

describe("payments taken off on edit", () => {
    it("names the Project Payments a Pending Cheque holds, not expenses or lines with no payment", () => {
        expect(paymentsOnCheque(detail())).toEqual(["PAY-1"]);
        expect(paymentsOnCheque(detail({ status: "Issued" }))).toEqual([]);
    });

    it("says which recorded payments the edited lines no longer hold: removed or swapped out", () => {
        const recorded = chequeFormFromDetail(detail()).lines ?? [];
        expect(paymentsSwitchingToOnline(["PAY-1"], recorded)).toEqual([]);
        expect(paymentsSwitchingToOnline(["PAY-1"], recorded.slice(1))).toEqual(["PAY-1"]);
        expect(paymentsSwitchingToOnline(["PAY-1"], [{ ...recorded[0], payment_name: "PAY-9" }])).toEqual(["PAY-1"]);
    });

    it("tells the user the payment goes back to Online", () => {
        expect(switchBackHint("PAY-1")).toBe("PAY-1 will switch back to Online.");
    });
});

describe("chequeFormFromDetail", () => {
    it("fills the form with the Cheque as recorded", () => {
        const form = chequeFormFromDetail(detail());
        expect(form).toMatchObject({
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
        expect(form.lines).toEqual([
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Service Requests", record_name: "SR-001", payment_name: "PAY-1", payment_status: "Requested", amount: 20000 },
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Service Requests", record_name: "SR-001", payment_name: "", payment_status: "", amount: 5000 },
            { line_type: "Non-project Expense", project: "", record_doctype: "", record_name: "", payment_name: "NPE-7", payment_status: "", amount: 5000 },
        ]);
    });

    it("picks the typed-payee kind for a Cheque with no Vendor", () => {
        const form = chequeFormFromDetail(detail({ vendor: null, payee_name: "Tata Power", lines: [] }));
        expect([form.payee_kind, form.payee_name, form.vendor]).toEqual(["typed", "Tata Power", ""]);
    });
});

describe("editChequeArgs", () => {
    it("names the Cheque and always sends its lines, even none", () => {
        const old = detail({ old_type: 1, vendor: null, payee_name: "Tata Power", description: "Rent", lines: [] });
        const values = makeChequeFormSchema(chequeFormRules(old)).parse(chequeFormFromDetail(old));
        const args = editChequeArgs("CHQ-26-00001", values);
        expect(args.name).toBe("CHQ-26-00001");
        expect(args.lines).toEqual([]);
        expect(args.payee_name).toBe("Tata Power");
    });
});
