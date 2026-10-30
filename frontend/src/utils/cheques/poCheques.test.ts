import { describe, expect, it } from "vitest";

import { alsoFor, chequesCardCopy, poChequeAmount, poChequesFilters } from "./poCheques";

const PO = "PO/301/00012/26-27";
const PO2 = "PO/301/00019/26-27";

describe("the amount a row of the PO's cheque card shows", () => {
    it("is the whole cheque for a Payment cheque that pays only this PO", () => {
        expect(poChequeAmount({ cheque_type: "Payment", amount: 30000, record_amount: 30000 })).toEqual({
            forPo: 30000,
            whole: null,
        });
    });

    it("is this PO's line amount, with the whole cheque beside it, for a cheque that also pays another PO", () => {
        expect(poChequeAmount({ cheque_type: "Payment", amount: 35000, record_amount: 20000 })).toEqual({
            forPo: 20000,
            whole: 35000,
        });
    });

    it("is the whole cheque for a deposit, which pays nothing on the PO it secures", () => {
        expect(poChequeAmount({ cheque_type: "Security Deposit", amount: 200000, record_amount: 0 })).toEqual({
            forPo: 200000,
            whole: null,
        });
    });
});

describe("the PO's cheque card", () => {
    it("asks the list for every cheque whose lines name the PO, of either type", () => {
        expect(poChequesFilters(PO)).toEqual([["record_name", "=", PO]]);
    });

    it("names the other POs a cheque is also for, once each, in line order", () => {
        const lines = [
            { line_type: "PO/WO Payment", record_doctype: "Procurement Orders", record_name: PO },
            { line_type: "PO/WO Payment", record_doctype: "Procurement Orders", record_name: PO2 },
            { line_type: "PO/WO Payment", record_doctype: "Procurement Orders", record_name: PO2 },
            { line_type: "Project Expense", record_doctype: null, record_name: null },
        ];
        expect(alsoFor(lines, PO)).toEqual([PO2]);
        expect(alsoFor(lines.slice(0, 1), PO)).toEqual([]);
        expect(alsoFor([{ line_type: "Secured PO/WO", record_doctype: "Procurement Orders", record_name: PO2 }], PO))
            .toEqual([PO2]);
    });
});

describe("the same card on a Work Order page (ADR-0035 Amendment C)", () => {
    const WO = "SR-00301-000045";

    it("asks the list for the cheques whose lines name the Work Order", () => {
        expect(poChequesFilters(WO)).toEqual([["record_name", "=", WO]]);
    });

    it("names the PO a deposit also secures beside the Work Order", () => {
        const lines = [
            { line_type: "Secured PO/WO", record_doctype: "Service Requests", record_name: WO },
            { line_type: "Secured PO/WO", record_doctype: "Procurement Orders", record_name: PO },
        ];
        expect(alsoFor(lines, WO)).toEqual([PO]);
        expect(alsoFor(lines, PO)).toEqual([WO]);
    });

    it("speaks of deposits only on a Work Order, and of every cheque on a PO", () => {
        expect(chequesCardCopy("Service Requests")).toMatchObject({
            title: "Security Deposits for this WO",
            empty: "No Security Deposit cheque secures this WO.",
            onlyThis: "Only this WO",
        });
        expect(chequesCardCopy("Procurement Orders")).toMatchObject({
            title: "Cheques issued for this PO",
            empty: "No cheque has been issued for this PO.",
            onlyThis: "Only this PO",
        });
    });
});
