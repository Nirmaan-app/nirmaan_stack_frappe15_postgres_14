// src/pages/outflow-import/components/OutflowRowsTable.tsx

import { Fragment, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { ROW_FILTERS, ROW_SETTLED, rowStatusTone } from "../outflowImportStatus";
import { OutflowRowDetail } from "./OutflowRowDetail";

interface Props {
    rows: OutflowImportRow[];
    onSkip: (row: OutflowImportRow, reason: string) => Promise<void>;
    onSettle: (row: OutflowImportRow, target: { doctype: string; name: string }) => Promise<void>;
    onCreate: (
        row: OutflowImportRow,
        payload: {
            doctype: string;
            expense_type: string;
            project?: string;
            description?: string;
            vendor?: string;
        }
    ) => Promise<void>;
}

/**
 * The staged transfers, with their outcome and the targets each matched.
 *
 * A plain table rather than the DataTable stack: these rows are a bounded working set that belongs
 * to one batch, they are already fully loaded, and the interaction is expand-and-decide rather
 * than sort/filter/paginate. Wiring server-side pagination over ~50 rows would cost the expansion
 * state and buy nothing.
 */
export const OutflowRowsTable = ({ rows, onSkip, onSettle, onCreate }: Props) => {
    const [filter, setFilter] = useState("all");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [skipping, setSkipping] = useState<string | null>(null);
    const [skipReason, setSkipReason] = useState("");

    const counts = useMemo(() => {
        const out: Record<string, number> = {};
        for (const f of ROW_FILTERS) out[f.id] = rows.filter((r) => f.match(r.row_status)).length;
        return out;
    }, [rows]);

    const visible = useMemo(() => {
        const active = ROW_FILTERS.find((f) => f.id === filter) || ROW_FILTERS[0];
        return rows.filter((r) => active.match(r.row_status));
    }, [rows, filter]);

    const submitSkip = async (row: OutflowImportRow) => {
        if (!skipReason.trim()) return;
        await onSkip(row, skipReason.trim());
        setSkipping(null);
        setSkipReason("");
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                {ROW_FILTERS.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            filter === f.id
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-transparent bg-muted text-muted-foreground hover:bg-muted/70"
                        }`}
                    >
                        {f.label}
                        <span className="ml-1.5 tabular-nums opacity-70">{counts[f.id] ?? 0}</span>
                    </button>
                ))}
            </div>

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="p-2 font-medium">Date</th>
                            <th className="p-2 font-medium">Beneficiary</th>
                            <th className="p-2 text-right font-medium">Amount</th>
                            <th className="p-2 font-medium">Remarks</th>
                            <th className="p-2 font-medium">Reference</th>
                            <th className="p-2 font-medium">Outcome</th>
                            <th className="p-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((row) => {
                            const isOpen = expanded === row.name;
                            return (
                                // Fragment, not `<>`: a keyed group of sibling <tr>s needs the key
                                // on the fragment itself, and the shorthand cannot take one.
                                <Fragment key={row.name}>
                                    <tr
                                        className="cursor-pointer border-t hover:bg-muted/30"
                                        onClick={() => setExpanded(isOpen ? null : row.name)}
                                    >
                                        <td className="whitespace-nowrap p-2">
                                            {row.added_on ? formatDate(row.added_on) : "--"}
                                        </td>
                                        <td className="max-w-[220px] truncate p-2" title={row.beneficiary_name}>
                                            {row.beneficiary_name || "--"}
                                        </td>
                                        <td className="whitespace-nowrap p-2 text-right tabular-nums">
                                            {formatToRoundedIndianRupee(row.amount)}
                                        </td>
                                        <td className="max-w-[260px] truncate p-2" title={row.remarks}>
                                            {row.remarks || "--"}
                                        </td>
                                        <td className="whitespace-nowrap p-2 font-mono text-xs">
                                            {row.bank_reference_no || "--"}
                                        </td>
                                        <td className="p-2">
                                            <Badge
                                                variant="outline"
                                                className={`whitespace-nowrap border-0 ${rowStatusTone(row.row_status)}`}
                                            >
                                                {row.row_status}
                                            </Badge>
                                        </td>
                                        <td className="p-2 text-right">
                                            {row.row_status !== ROW_SETTLED && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSkipping(skipping === row.name ? null : row.name);
                                                        setSkipReason("");
                                                    }}
                                                >
                                                    Skip
                                                </Button>
                                            )}
                                        </td>
                                    </tr>

                                    {skipping === row.name && (
                                        <tr className="border-t bg-muted/20">
                                            <td colSpan={7} className="p-3">
                                                <div className="flex items-center gap-2">
                                                    {/* A reason is REQUIRED for a manual skip (owner ruling).
                                                        Automatic skips carry a system reason instead. */}
                                                    <Input
                                                        autoFocus
                                                        value={skipReason}
                                                        placeholder="Why is this transfer being skipped?"
                                                        onChange={(e) => setSkipReason(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") submitSkip(row);
                                                            if (e.key === "Escape") setSkipping(null);
                                                        }}
                                                        className="max-w-md"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        disabled={!skipReason.trim()}
                                                        onClick={() => submitSkip(row)}
                                                    >
                                                        Skip row
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => setSkipping(null)}
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    {isOpen && (
                                        <tr className="border-t bg-muted/10">
                                            <td colSpan={7} className="p-4">
                                                <OutflowRowDetail row={row} onSettle={onSettle} onCreate={onCreate} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                        {!visible.length && (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                                    No rows in this view.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
