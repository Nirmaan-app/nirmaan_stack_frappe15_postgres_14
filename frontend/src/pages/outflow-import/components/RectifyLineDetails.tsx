// src/pages/outflow-import/components/RectifyLineDetails.tsx
//
// The Move dialog's details row for one plan line (spec #1753 stories 40-45), by the plan's source: a Cashbook line's
// statement facts with its bill and Bill check (#1757), a card line's holder, merchant, statement and date (#1761), a
// bank or Cashfree line's date, UTR, beneficiary and remark (#1760), a Porter order's delivery (#1759). Split out of
// `RectifyDialog`.

import { Paperclip } from "lucide-react";

import { usePorterExpense } from "@/components/common/PorterExpense";
import SITEURL from "@/constants/siteURL";
import { porterMoveDetailRows } from "@/utils/porterExpense";

import { BANK_MOVE_SOURCES, bankDetailRows, type BankPlanLine } from "../bankRectify";
import { cardDetailRows, type CardPlanLine } from "../cardRectify";
import { CASHBOOK_SOURCE, billCheckText, cashbookDetailRows, type CashbookPlanLine } from "../cashbookRectify";
import { CARD_SOURCE } from "../creditCardImport";
import { PORTER_SOURCE } from "../porterImport";
import type { RectifyPlanLine } from "../porterRectify";

/** A plan line of any source: Porter's fields, and a Cashbook, card or bank line's beside them. */
export type PlanLine = RectifyPlanLine & Partial<CashbookPlanLine> & Partial<CardPlanLine> & Partial<BankPlanLine>;

/** A bank or Cashfree plan (#1760). */
export const isBankSource = (source: string | undefined): boolean => Boolean(source && source in BANK_MOVE_SOURCES);

/** One compact row of `line`'s details (story 45); the amount is shown above it. */
export const LineDetails = ({ source, line }: { source: string | undefined; line: PlanLine }) => {
    if (source === PORTER_SOURCE) {
        return line.ledger && line.expense ? <PorterDetails doctype={line.ledger} expense={line.expense} /> : null;
    }
    if (source === CASHBOOK_SOURCE) return <CashbookDetails line={line} />;
    if (source === CARD_SOURCE) return <DetailRow rows={cardDetailRows(line)} />;
    if (isBankSource(source)) return <DetailRow rows={bankDetailRows(line)} />;
    return null;
};

/** The wallet line's details (story 42): the statement's facts, then the bill and its Bill check. */
const CashbookDetails = ({ line }: { line: PlanLine }) => (
    <DetailRow rows={cashbookDetailRows(line)}>
        <span>
            <span className="text-muted-foreground">Bill: </span>
            {line.bill?.file && (
                <a
                    href={SITEURL + line.bill.file}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-1 inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                    <Paperclip className="h-3 w-3" /> Open
                </a>
            )}
            <span>{billCheckText(line.bill)}</span>
        </span>
    </DetailRow>
);

/**
 * A Porter line's delivery details (stories 41, 45): where it went, fare and reverse-charge GST, the invoice number
 * and its PDF. Read from the expense's Porter section, so the facts are the expense screens' own.
 */
const PorterDetails = ({ doctype, expense }: { doctype: string; expense: string }) => {
    const { section, isLoading, error } = usePorterExpense(doctype, expense, true);
    if (isLoading) return <p className="text-xs text-muted-foreground">Loading the delivery…</p>;
    if (error || !section) return <p className="text-xs text-muted-foreground">Could not read this delivery's details.</p>;
    return (
        <DetailRow rows={porterMoveDetailRows(section)}>
            {section.pdf_url && (
                <a
                    href={SITEURL + section.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                    <Paperclip className="h-3 w-3" /> Invoice PDF
                </a>
            )}
        </DetailRow>
    );
};

const DetailRow = ({ rows, children }: { rows: { label: string; value: string }[]; children?: React.ReactNode }) => (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" data-testid="move-details">
        {rows
            .filter((row) => row.label !== "Amount")
            .map((row) => (
                <span key={row.label}>
                    <span className="text-muted-foreground">{row.label}: </span>
                    {row.value}
                </span>
            ))}
        {children}
    </div>
);
