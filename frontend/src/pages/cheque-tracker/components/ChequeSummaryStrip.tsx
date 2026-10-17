import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { depositFigures } from "@/utils/cheques/chequeDeposit";

import { CHEQUE_STALE_DAYS, issuedChequeFigures, type ChequeSummaryBucket } from "../config/chequePaymentTable.config";

const DOT: Record<ChequeSummaryBucket["key"], string> = {
    all: "bg-foreground",
    pending: "bg-indigo-500",
    issued: "bg-amber-500",
    cleared: "bg-green-600",
    cancelled: "bg-red-600",
};

const countText = (n: number) => `${n} ${n === 1 ? "cheque" : "cheques"}`;

interface TileProps {
    label: string;
    amount: number;
    sub: string;
    dot?: string;
    className?: string;
}

const Tile = ({ label, amount, sub, dot, className }: TileProps) => (
    <div className={cn("flex flex-col px-4 py-3", className)}>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {dot && <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" />}
            {label}
        </span>
        <span className="mt-1 text-lg font-semibold tabular-nums">{formatToRoundedIndianRupee(amount)}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{sub}</span>
    </div>
);

const Loading = ({ loading }: { loading?: boolean }) =>
    loading ? <Loader2 className="absolute right-2 top-2 h-3 w-3 animate-spin text-muted-foreground" /> : null;

/**
 * All Cheques' summary strip (#1417, #1483): count and amount for All, Pending, Issued, Cleared and Cancelled
 * over the table's current filters and search. Each matching Cheque counts once, at its full amount, so the
 * figures are cheque amounts, not line amounts.
 */
export function ChequeSummaryStrip({ buckets, loading }: { buckets: ChequeSummaryBucket[]; loading?: boolean }) {
    return (
        <section aria-label="Cheque amounts" className="relative overflow-hidden rounded-md border bg-card">
            <Loading loading={loading} />
            <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-5 sm:divide-y-0">
                {buckets.map((b) => (
                    <Tile key={b.key} label={b.label} amount={b.amount} sub={countText(b.count)} dot={DOT[b.key]} />
                ))}
            </div>
            <p className="border-t bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                Counts follow the filters and search. Security Deposit cheques count under Issued and Cancelled; filter
                Type to leave them out.
            </p>
        </section>
    );
}

/**
 * The Issued tab's strip (#1483): what waits for the bank, and the part of it issued more than 90 days ago.
 * Both follow the tab's filters and search.
 */
export function IssuedChequeStrip({ aggregates, loading }: { aggregates: Record<string, unknown> | null; loading?: boolean }) {
    const { waiting, stale } = issuedChequeFigures(aggregates);
    return (
        <section aria-label="Issued cheques" className="relative overflow-hidden rounded-md border bg-card">
            <Loading loading={loading} />
            <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <Tile label="Waiting to clear" amount={waiting.amount} sub={countText(waiting.count)} />
                <Tile
                    label={`Stale, issued over ${CHEQUE_STALE_DAYS} days ago`}
                    amount={stale.amount}
                    sub={countText(stale.count)}
                    className={stale.count > 0 ? "bg-red-50 text-red-900" : undefined}
                />
            </div>
        </section>
    );
}

/**
 * The Security Deposits tab's strip (#1486): what is held by others now (Issued) and what came back (Cancelled),
 * over the tab's filters and search.
 */
export function DepositChequeStrip({ aggregates, loading }: { aggregates: Record<string, unknown> | null; loading?: boolean }) {
    const { held, returned } = depositFigures(aggregates);
    return (
        <section aria-label="Security Deposit cheques" className="relative overflow-hidden rounded-md border bg-card">
            <Loading loading={loading} />
            <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <Tile label="Held by others now" amount={held.amount} sub={`${countText(held.count)} Issued`} dot={DOT.issued} />
                <Tile label="Returned or cancelled" amount={returned.amount} sub={countText(returned.count)} dot={DOT.cancelled} />
            </div>
        </section>
    );
}
