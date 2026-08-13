// src/pages/outflow-import/components/CashbookReviewTree.tsx

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    CashbookPreviewGroup,
    CashbookPreviewResult,
    isLoneRow,
    ledgerSections,
    typeHint,
    typeLabel,
} from "../cashbookPreview";

/**
 * What a Cashbook statement will create, grouped by where the money is going.
 *
 * ⚠️ READ-ONLY BY OWNER RULING (Q2). Nothing here can be corrected before it is written, so this
 * screen's only job is to make a wrong placement FINDABLE. That is why it is a tree of groups and
 * not a list of 115 rows: a wrong project match is invisible in a long list and obvious in a
 * rollup, where a project nobody is working on this month shows up as a lonely one-row line.
 *
 * ⚠️ THE CONFIRM TREE (now in `ConfirmMatchedPanel`) WAS DELIBERATELY NOT EXTRACTED FOR THIS, AND
 * THAT FINDING STILL STANDS. It is a three-level vendor -> project -> transfer shape built around
 * tri-state selection -- `TriCheckbox`, `nodeSelectionState`, toggle-a-whole-branch -- and strip
 * those out and there is no component left, only a chevron and a right-aligned figure.
 * Parameterising it over node type, depth, leaf renderer and whether selection exists at all would
 * make it worse for both callers, and it confirms real settlements. This copies the VISUAL GRAMMAR
 * on purpose (same chevron, same truncation, same tabular amount column) and shares no logic.
 *
 * ⚠️ SLICE CF/S6 IS A DIFFERENT EXTRACTION AND DOES NOT REOPEN THIS. It moved the WHOLE panel --
 * tree, selection, safety bar and settle loop together -- out of its `<Dialog>` shell so the import
 * wizard could render the same one. Nothing was pulled apart, and nothing is shared with this file.
 *
 * ⚠️ THE TWO LEDGERS GROUP BY DIFFERENT THINGS, and that is the design rather than an oversight. A
 * project expense is checked by asking "does that project have work this month", so it groups by
 * PROJECT. A non-project expense has no project to check, so the only useful question is what kind
 * of spending it is: it groups by TYPE.
 */
export const CashbookReviewTree = ({ preview }: { preview: CashbookPreviewResult }) => {
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
    const [showSkipped, setShowSkipped] = useState(false);
    const sections = ledgerSections(preview.groups);

    const toggle = (key: string) =>
        setOpen((current) => {
            const next = new Set(current);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="text-sm font-medium">
                    {preview.creating} expense {preview.creating === 1 ? "record" : "records"}
                    {preview.period_from && preview.period_to ? (
                        <span className="font-normal text-muted-foreground">
                            {" "}
                            · {preview.period_from} to {preview.period_to}
                        </span>
                    ) : null}
                </p>
                <p className="text-sm font-medium tabular-nums">
                    {formatToRoundedIndianRupee(preview.total_value)}
                </p>
            </div>

            {/* Said once, plainly, because it is the thing a reader most needs to know before
                clicking: this is the last screen, and the correction happens somewhere else. */}
            <p className="text-xs text-muted-foreground">
                Nothing here can be changed once created. Corrections are made in Expenses.
            </p>

            <div className="rounded-md border">
                {sections.map((section) => (
                    <div key={section.ledger} className="border-b last:border-b-0">
                        <div className="flex items-center gap-2 bg-muted/40 px-2 py-1.5">
                            <span className="flex-1 text-xs font-semibold uppercase tracking-wide">
                                {section.title}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {section.count}
                            </span>
                            <span className="w-28 shrink-0 text-right text-sm font-medium tabular-nums">
                                {formatToRoundedIndianRupee(section.value)}
                            </span>
                        </div>
                        {section.groups.map((group) => (
                            <GroupBranch
                                key={`${group.ledger}:${group.key}`}
                                group={group}
                                open={open.has(`${group.ledger}:${group.key}`)}
                                onToggle={() => toggle(`${group.ledger}:${group.key}`)}
                            />
                        ))}
                    </div>
                ))}
            </div>

            {preview.skipping > 0 && (
                <div className="rounded-md border bg-muted/20">
                    <button
                        type="button"
                        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
                        onClick={() => setShowSkipped((current) => !current)}
                    >
                        {showSkipped ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-xs font-semibold uppercase tracking-wide">
                            Not importing
                        </span>
                        <span className="text-xs text-muted-foreground">
                            · {preview.skipping} {preview.skipping === 1 ? "row" : "rows"}
                        </span>
                    </button>
                    {showSkipped && (
                        <div className="border-t">
                            {preview.skipped.map((row) => (
                                <div
                                    key={row.transfer_id || row.row_number}
                                    className="flex items-baseline gap-3 px-3 py-1.5 text-xs"
                                >
                                    <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                                        {formatToRoundedIndianRupee(row.amount)}
                                    </span>
                                    <span className="flex-1 truncate text-muted-foreground">
                                        {row.reason}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {preview.warnings.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                    ))}
                </ul>
            )}
        </div>
    );
};

/** One destination -- a project, or an expense type on the non-project side -- and its rows. */
const GroupBranch = ({
    group,
    open,
    onToggle,
}: {
    group: CashbookPreviewGroup;
    open: boolean;
    onToggle: () => void;
}) => (
    <div className="border-t first:border-t-0">
        <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40"
            onClick={onToggle}
        >
            {open ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.label}</span>
            {/* A single-row group is where a wrong project match shows itself. Marked quietly --
                it is a prompt to look, not a warning that something is wrong. */}
            <span
                className={
                    isLoneRow(group)
                        ? "shrink-0 text-xs tabular-nums text-amber-700 dark:text-amber-500"
                        : "shrink-0 text-xs tabular-nums text-muted-foreground"
                }
            >
                {group.count}
            </span>
            <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                {formatToRoundedIndianRupee(group.value)}
            </span>
        </button>

        {open && (
            <div className="bg-muted/10">
                {group.rows.map((row) => (
                    <div
                        key={row.transfer_id || row.row_number}
                        className="flex items-baseline gap-3 py-1.5 pl-8 pr-2 text-xs"
                    >
                        <span className="w-24 shrink-0 text-right tabular-nums">
                            {formatToRoundedIndianRupee(row.amount)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate">
                                {row.remarks || (
                                    <span className="text-muted-foreground">(no remark)</span>
                                )}
                            </span>
                            <span className="block truncate text-muted-foreground">
                                {row.beneficiary_name}
                                {row.spent_by ? ` · spent by ${row.spent_by}` : ""}
                            </span>
                        </span>
                        <span
                            className={
                                row.is_fallback_type
                                    ? "w-44 shrink-0 truncate text-right text-muted-foreground"
                                    : "w-44 shrink-0 truncate text-right"
                            }
                            title={typeHint(row)}
                        >
                            {typeLabel(row)}
                        </span>
                    </div>
                ))}
            </div>
        )}
    </div>
);
