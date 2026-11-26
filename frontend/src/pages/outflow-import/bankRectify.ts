// src/pages/outflow-import/bankRectify.ts
//
// Move an expense a person created from a bank or Cashfree line with Create (#1760, spec #1753 stories 5, 44): the
// line's details the dialog shows. Pure: no React, no fetch. `bankRectify.test.ts` pins it; `RectifyDialog` renders
// it. The button and title follow every source's one label rule (`utils/moveLabel.ts`).
//
// ⚠️ NO RULE OF ITS OWN ABOUT A LINE. Whether a line can move is the server's (`rectify.get_rectify_plan`
// `refusal`); the write re-asks under its locks.

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { RectifyPlanLine } from "./porterRectify";

/** The statements whose created expenses Move takes (`rectify_sources.ICICI`, `CASHFREE`), and what each calls its lines. */
export const BANK_MOVE_SOURCES: Record<string, string> = {
    "ICICI Bank Statement": "ICICI Bank Statement lines",
    Cashfree: "Cashfree lines",
};

/** A bank or Cashfree line of the plan: the shared fields plus what the statement says. */
export interface BankPlanLine extends Omit<RectifyPlanLine, "crn"> {
    txn_id?: string | null;
    date?: string | null;
    utr?: string;
    beneficiary?: string;
    remark?: string;
    expense_type?: string;
}

const orDash = (value: string | null | undefined) => (value || "").trim() || "--";

/** The bank line's details (story 44), one compact row per line in the dialog. */
export const bankDetailRows = (line: BankPlanLine): { label: string; value: string }[] => [
    { label: "Date", value: line.date ? formatDate(line.date) : "--" },
    { label: "UTR", value: orDash(line.utr) },
    { label: "Beneficiary", value: orDash(line.beneficiary) },
    { label: "Amount", value: formatToRoundedIndianRupee(line.amount) },
    { label: "Remark", value: orDash(line.remark) },
];
