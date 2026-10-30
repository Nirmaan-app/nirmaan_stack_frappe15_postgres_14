import { describe, expect, it } from "vitest";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";

import {
    depositFigures,
    depositFormFromDetail,
    depositPrefill,
    emptyDepositForm,
    makeDepositFormSchema,
    saveDepositArgs,
    securableOptions,
    type DepositFormInput,
} from "./chequeDeposit";

const TODAY = "2026-10-16";
const PO = { record_doctype: "Procurement Orders", record_name: "PO/301/00012/26-27", project: "PROJ-1" };
const PO2 = { record_doctype: "Procurement Orders", record_name: "PO/301/00019/26-27", project: "PROJ-1" };
const WO = { record_doctype: "Service Requests", record_name: "SR-00301-000045", project: "PROJ-1" };

const valid = (overrides: Partial<DepositFormInput> = {}): DepositFormInput => ({
    ...emptyDepositForm(TODAY),
    cheque_no: "000760",
    cheque_date: "2026-10-01",
    amount: 200000,
    vendor: "VEN-1",
    attachment: "/private/files/sd.jpg",
    ...overrides,
});

const problems = (values: DepositFormInput, photoRequired = true) => {
    const result = makeDepositFormSchema({ photoRequired, today: TODAY }).safeParse(values);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("the Security Deposit cheque form", () => {
    it("starts with today's issue date, a Vendor payee and nothing secured", () => {
        const form = emptyDepositForm(TODAY);
        expect(form.issue_date).toBe(TODAY);
        expect(form.payee_kind).toBe("vendor");
        expect(form.secures).toEqual([]);
    });

    it("saves with a Vendor and no secured record, or with a typed name", () => {
        expect(problems(valid())).toEqual({});
        expect(problems(valid({ payee_kind: "typed", vendor: "", payee_name: "Kavitha Properties" }))).toEqual({});
    });

    it("needs its photo, its issue date and a payee", () => {
        expect(problems(valid({ attachment: "" }))).toEqual({ attachment: "Upload the photo of the cheque." });
        expect(problems(valid({ issue_date: "" }))).toEqual({ issue_date: "Enter the issue date: the day it was handed over." });
        expect(problems(valid({ vendor: "" }))).toEqual({ vendor: "Pick the Vendor the cheque is made out to." });
        expect(problems(valid({ payee_kind: "typed", vendor: "", payee_name: " " }))).toEqual({
            payee_name: "Type the payee's name.",
        });
    });

    it("refuses an issue date after today", () => {
        expect(problems(valid({ issue_date: "2026-10-17" }))).toEqual({ issue_date: "The issue date cannot be after today." });
    });

    it("lets a typed payee secure nothing", () => {
        expect(problems(valid({ payee_kind: "typed", vendor: "", payee_name: "Kavitha", secures: [PO] }))).toEqual({
            secures: "A cheque made out to a typed payee names no PO or Work Order.",
        });
    });

    it("does not ask again for the photo of a cheque recorded without one", () => {
        expect(problems(valid({ attachment: "" }), false)).toEqual({});
    });
});

describe("saveDepositArgs", () => {
    it("sends a Security Deposit cheque, its issue date and one Secured PO/WO line per record", () => {
        const values = makeDepositFormSchema({ photoRequired: true, today: TODAY }).parse(valid({ secures: [PO, PO2] }));
        expect(saveDepositArgs(values)).toEqual({
            cheque_type: "Security Deposit",
            issue_date: TODAY,
            bank: "ICICI Bank",
            cheque_no: "000760",
            cheque_date: "2026-10-01",
            amount: 200000,
            vendor: "VEN-1",
            attachment: "/private/files/sd.jpg",
            lines: [
                { line_type: "Secured PO/WO", record_doctype: "Procurement Orders", record_name: "PO/301/00012/26-27", project: "PROJ-1" },
                { line_type: "Secured PO/WO", record_doctype: "Procurement Orders", record_name: "PO/301/00019/26-27", project: "PROJ-1" },
            ],
        });
    });

    it("sends a typed payee with no lines", () => {
        const values = makeDepositFormSchema({ photoRequired: true, today: TODAY }).parse(
            valid({ payee_kind: "typed", vendor: "", payee_name: " Kavitha Properties ", description: "Lease deposit" }),
        );
        const args = saveDepositArgs(values);
        expect(args.payee_name).toBe("Kavitha Properties");
        expect(args.vendor).toBeUndefined();
        expect(args.description).toBe("Lease deposit");
        expect(args.lines).toEqual([]);
    });
});

describe("a deposit added from a PO page", () => {
    it("is made out to its Vendor and names that PO", () => {
        const form = depositPrefill(
            { doctype: "Procurement Orders", name: "PO/301/00012/26-27", project: "PROJ-1", vendor: "VEN-1" },
            TODAY,
        );
        expect(form.vendor).toBe("VEN-1");
        expect(form.payee_kind).toBe("vendor");
        expect(form.secures).toEqual([PO]);
        expect(form.issue_date).toBe(TODAY);
    });
});

describe("a deposit added from a Work Order page (ADR-0035 Amendment C)", () => {
    it("is made out to its Vendor, names that Work Order and saves it as a Secured PO/WO line", () => {
        const form = depositPrefill(
            { doctype: "Service Requests", name: WO.record_name, project: "PROJ-1", vendor: "VEN-1" },
            TODAY,
        );
        expect(form.vendor).toBe("VEN-1");
        expect(form.secures).toEqual([WO]);

        const values = makeDepositFormSchema({ photoRequired: true, today: TODAY }).parse(valid({ secures: [WO, PO] }));
        expect(saveDepositArgs(values).lines).toEqual([
            { line_type: "Secured PO/WO", ...WO },
            { line_type: "Secured PO/WO", ...PO },
        ]);
    });

    it("lets a typed payee secure no Work Order either", () => {
        expect(problems(valid({ payee_kind: "typed", vendor: "", payee_name: "Kavitha", secures: [WO] }))).toEqual({
            secures: "A cheque made out to a typed payee names no PO or Work Order.",
        });
    });
});

describe("depositFormFromDetail", () => {
    it("fills the Edit form from the recorded deposit", () => {
        const detail = {
            name: "CHQ-1", cheque_no: "000760", bank: "Others", bank_name: "HDFC Bank", cheque_date: "2026-10-01",
            amount: 200000, vendor: "VEN-1", payee_name: null, attachment: "/private/files/sd.jpg", description: null,
            issue_date: "2026-10-02",
            lines: [{ idx: 1, line_type: "Secured PO/WO", ...PO, amount: 0 }],
        } as unknown as ChequeDetail;
        expect(depositFormFromDetail(detail)).toEqual({
            bank: "Others", bank_name: "HDFC Bank", cheque_no: "000760", cheque_date: "2026-10-01", amount: 200000,
            issue_date: "2026-10-02", payee_kind: "vendor", vendor: "VEN-1", payee_name: "",
            attachment: "/private/files/sd.jpg", description: "", secures: [PO],
        });
    });
});

describe("what a deposit secures, as the tab and the PO card show it", () => {
    it("offers in the picker only the records not already secured", () => {
        const records = [
            { doctype: "Procurement Orders" as const, name: PO.record_name, project: "PROJ-1", project_name: "Sarjapur", status: "Delivered" },
            { doctype: "Procurement Orders" as const, name: PO2.record_name, project: "PROJ-1", project_name: "Sarjapur", status: "Dispatched" },
        ];
        expect(securableOptions(records, [PO]).map((o) => o.value)).toEqual([`Procurement Orders|${PO2.record_name}`]);
        expect(securableOptions(records, [])[1].label).toBe("PO/301/00019/26-27 · Sarjapur");
    });

    it("offers the Vendor's Work Orders beside its POs, and drops one already secured", () => {
        const records = [
            { doctype: "Procurement Orders" as const, name: PO.record_name, project: "PROJ-1", project_name: "Sarjapur", status: "Delivered" },
            { doctype: "Service Requests" as const, name: WO.record_name, project: "PROJ-1", project_name: "Sarjapur", status: "Approved" },
        ];
        expect(securableOptions(records, []).map((o) => o.value)).toEqual([
            `Procurement Orders|${PO.record_name}`,
            `Service Requests|${WO.record_name}`,
        ]);
        expect(securableOptions(records, [WO]).map((o) => o.value)).toEqual([`Procurement Orders|${PO.record_name}`]);
    });
});

describe("depositFigures", () => {
    it("reads what is held now (Issued) and what came back (Cancelled) from the list's aggregates", () => {
        expect(
            depositFigures({ issued_count: 1, issued_amount: 200000, cancelled_count: 2, cancelled_amount: 40000 }),
        ).toEqual({ held: { count: 1, amount: 200000 }, returned: { count: 2, amount: 40000 } });
        expect(depositFigures(null)).toEqual({ held: { count: 0, amount: 0 }, returned: { count: 0, amount: 0 } });
    });
});
