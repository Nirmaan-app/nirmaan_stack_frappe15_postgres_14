import { describe, expect, it } from "vitest";

import { chequeReportPath } from "./chequeReportLink";

describe("chequeReportPath", () => {
    it("opens Reports, Payment, Cheque Payment searched by the cheque number", () => {
        const url = new URL(chequeReportPath("004521"), "http://x");
        expect(url.pathname).toBe("/reports");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            tab: "payment_tds",
            report: "Cheque Payment",
            cheques_q: "004521",
            cheques_searchBy: "cheque_no",
        });
    });

    it("keeps a number with spaces or symbols intact", () => {
        expect(new URL(chequeReportPath("TEST 1&2"), "http://x").searchParams.get("cheques_q")).toBe("TEST 1&2");
    });
});
