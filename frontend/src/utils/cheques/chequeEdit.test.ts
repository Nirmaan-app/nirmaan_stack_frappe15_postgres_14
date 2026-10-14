import { describe, expect, it } from "vitest";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";

import {
    canEditCheque,
    chequeEditMode,
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
    status: "Issued",
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

    it("lets Procurement edit only the Issued Cheques they created", () => {
        const user = "buyer@nirmaan.app";
        expect(canEditCheque({ status: "Issued", owner: user }, PROCUREMENT, user)).toBe(true);
        expect(canEditCheque({ status: "Issued", owner: "other@nirmaan.app" }, PROCUREMENT, user)).toBe(false);
        expect(canEditCheque({ status: "Cleared", owner: user }, PROCUREMENT, user)).toBe(false);
    });

    it("never lets a Project Manager edit", () => {
        expect(canEditCheque({ status: "Issued", owner: "pm@nirmaan.app" }, PM, "pm@nirmaan.app")).toBe(false);
    });
});

describe("chequeEditMode and its locks", () => {
    it("opens everything on a report-made Issued Cheque", () => {
        const mode = chequeEditMode(detail({ made_from: "Report" }));
        expect(mode).toBe("all");
        expect(isHeaderLocked(mode, "cheque_no")).toBe(false);
        expect(editLockHint(mode, "Issued")).toBeUndefined();
    });

    it("keeps a PO-page Issued Cheque's number, date and amount", () => {
        const mode = chequeEditMode(detail({ made_from: "PO/WO Page" }));
        expect(mode).toBe("po_wo_page");
        expect(["cheque_no", "cheque_date", "amount"].map((f) => isHeaderLocked(mode, f))).toEqual([true, true, true]);
        expect(["bank", "vendor", "description", "lines", "attachment"].some((f) => isHeaderLocked(mode, f))).toBe(false);
        expect(editLockHint(mode, "Issued")).toBe(
            "Made from the PO/WO page: the number, date and amount stay as on its payment. Change them on the payment.",
        );
    });

    it("opens everything on a PO-page Issued Cheque with no Project Payment line left", () => {
        // Its payment came off (removed, swapped out, or dropped by a payee change): nothing to stay in step with.
        const withoutPayment = detail().lines.filter((l) => l.payment_doctype !== "Project Payments");
        const mode = chequeEditMode(detail({ made_from: "PO/WO Page", lines: withoutPayment }));
        expect(mode).toBe("all");
        expect(isHeaderLocked(mode, "amount")).toBe(false);
        expect(chequeEditMode(detail({ made_from: "PO/WO Page", lines: [] }))).toBe("all");
    });

    it("leaves only the photo open on a Cleared or Cancelled Cheque, wherever it was made", () => {
        for (const status of ["Cleared", "Cancelled"] as const) {
            const mode = chequeEditMode(detail({ status, made_from: "PO/WO Page" }));
            expect(mode).toBe("photo_only");
            expect(isHeaderLocked(mode, "attachment")).toBe(false);
            expect(["bank", "cheque_no", "vendor", "description", "lines"].every((f) => isHeaderLocked(mode, f))).toBe(true);
            expect(editLockHint(mode, status)).toBe(`This cheque is ${status}: only its photo can change.`);
        }
    });
});

describe("payments taken off on edit", () => {
    it("names the Project Payments an Issued Cheque holds, not expenses or lines with no payment", () => {
        expect(paymentsOnCheque(detail())).toEqual(["PAY-1"]);
        expect(paymentsOnCheque(detail({ status: "Cleared" }))).toEqual([]);
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
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Service Requests", record_name: "SR-001", payment_name: "PAY-1", amount: 20000 },
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Service Requests", record_name: "SR-001", payment_name: "", amount: 5000 },
            { line_type: "Non-project Expense", project: "", record_doctype: "", record_name: "", payment_name: "NPE-7", amount: 5000 },
        ]);
    });

    it("picks the typed-payee kind for a Cheque with no Vendor", () => {
        const form = chequeFormFromDetail(detail({ vendor: null, payee_name: "Tata Power", lines: [] }));
        expect([form.payee_kind, form.payee_name, form.vendor]).toEqual(["typed", "Tata Power", ""]);
    });
});

describe("editChequeArgs", () => {
    it("names the Cheque and always sends its lines, even none", () => {
        const values = makeChequeFormSchema({ photoRequired: true }).parse({
            ...chequeFormFromDetail(detail()),
            description: "Rent",
            lines: [],
        });
        const args = editChequeArgs("CHQ-26-00001", values);
        expect(args.name).toBe("CHQ-26-00001");
        expect(args.lines).toEqual([]);
    });
});

describe("makeChequeFormSchema", () => {
    it("lets an edit of a backfilled Cheque save without a photo", () => {
        const input = { ...chequeFormFromDetail(detail({ attachment: null })), description: "Old cheque" };
        expect(makeChequeFormSchema({ photoRequired: false }).safeParse(input).success).toBe(true);
        expect(makeChequeFormSchema({ photoRequired: true }).safeParse(input).success).toBe(false);
    });
});
