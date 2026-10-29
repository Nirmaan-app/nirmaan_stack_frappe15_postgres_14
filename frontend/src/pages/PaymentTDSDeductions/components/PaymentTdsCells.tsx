/**
 * Small cells for the TDS register's columns (`config/paymentTdsDeductions.config.tsx`), kept out of the
 * config so it stays under the file-size line.
 */

import { createContext, useContext } from "react";
import formatToIndianRupee from "@/utils/FormatPrice";

/**
 * `{payment name: its status}` for the register rows on screen (walk W9): the payment's status, shown in
 * its own column and read by the Pay TDS selection (`payableDeduction.canPayDeduction`). Provided by the
 * ledger table, which reads the page's payments once.
 */
export const PaymentStatusContext = createContext<Record<string, string>>({});

export const PaymentStatusCell = ({ payment }: { payment?: string | null }) => {
    const status = useContext(PaymentStatusContext)[payment || ""];
    if (!payment) return <span className="text-muted-foreground">--</span>;
    return <span className={status === "Paid" ? "text-green-700" : "text-amber-700"}>{status || "…"}</span>;
};

export const TextCell = ({ value }: { value: string | null }) =>
    value ? (
        <span className="tabular-nums whitespace-nowrap">{value}</span>
    ) : (
        <span className="text-muted-foreground">--</span>
    );

export const AmountCell = ({ value }: { value: number | null | undefined }) =>
    value == null ? (
        <div className="text-right text-muted-foreground">--</div>
    ) : (
        <div className="text-right tabular-nums">{formatToIndianRupee(value)}</div>
    );
