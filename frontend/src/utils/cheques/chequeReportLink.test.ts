import { describe, expect, it } from "vitest";

import { CHEQUE_TRACKER_PATH, chequeReportPath, chequeTrackerPathFromLegacyReport } from "./chequeReportLink";

describe("chequeReportPath", () => {
    it("opens the Cheque Tracker searched by the cheque number", () => {
        const url = new URL(chequeReportPath("004521"), "http://x");
        expect(url.pathname).toBe(CHEQUE_TRACKER_PATH);
        expect(Object.fromEntries(url.searchParams)).toEqual({ cheques_q: "004521", cheques_searchBy: "cheque_no" });
    });

    it("keeps a number with spaces or symbols intact", () => {
        expect(new URL(chequeReportPath("TEST 1&2"), "http://x").searchParams.get("cheques_q")).toBe("TEST 1&2");
    });
});

describe("chequeTrackerPathFromLegacyReport", () => {
    it("sends an old Reports › Payment › Cheque Payment link to the tracker with its search and filters", () => {
        const old = new URLSearchParams({
            tab: "payment_tds",
            report: "Cheque Payment",
            cheques_q: "004521",
            cheques_searchBy: "cheque_no",
            cheques_filters: '[{"id":"status","value":["Issued"]}]',
        });
        const url = new URL(chequeTrackerPathFromLegacyReport(`?${old}`) ?? "", "http://x");
        expect(url.pathname).toBe(CHEQUE_TRACKER_PATH);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            cheques_q: "004521",
            cheques_searchBy: "cheque_no",
            cheques_filters: '[{"id":"status","value":["Issued"]}]',
        });
    });

    it("sends a bare old link to the tracker", () => {
        expect(chequeTrackerPathFromLegacyReport("?tab=payment_tds&report=Cheque+Payment")).toBe(CHEQUE_TRACKER_PATH);
    });

    it("leaves every other Reports link alone", () => {
        expect(chequeTrackerPathFromLegacyReport("?tab=payment_tds&report=TDS+Deduction")).toBeNull();
        expect(chequeTrackerPathFromLegacyReport("?tab=projects")).toBeNull();
        expect(chequeTrackerPathFromLegacyReport("")).toBeNull();
    });
});
