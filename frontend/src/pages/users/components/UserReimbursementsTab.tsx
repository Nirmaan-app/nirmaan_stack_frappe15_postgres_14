/**
 * The Reimbursements tab on a user's profile (owner, 2026-10-28): the person's claims for one month, with a summary of
 * the totals above the table. Admin only (`utils/reimbursements/profileMonth.seesProfileReimbursements`); the server already
 * lets Admin read every claim.
 *
 * A summary sits above the table: the month total (Approved + Paid, what the limit counts) with its limit chip, then
 * each status. Read only: the Reimbursements page is where claims are raised, decided, edited and deleted. The columns are that
 * page's "Raised By Me" set without its Edit / Delete, and a click on an ID opens the same detail sheet with no
 * actions. The month is the one a claim was raised in, as the monthly reimbursement limit counts it; the totals come
 * from the server, summed by status over every matching claim, so they never depend on the page shown.
 */

import { useCallback, useMemo, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";

import { DataTable } from "@/components/data-table/new-data-table";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerDataTable, type GroupByConfig } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import { ClaimDetailSheet } from "@/pages/Reimbursements/components/ClaimDetailSheet";
import { columnVisibilityFor, getReimbursementColumns } from "@/pages/Reimbursements/config/reimbursementColumns";
import {
    REIMBURSEMENT_DATE_COLUMNS,
    REIMBURSEMENT_FIELDS_TO_FETCH,
    REIMBURSEMENT_SEARCHABLE_FIELDS,
} from "@/pages/Reimbursements/config/reimbursementsTable.config";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { REIMBURSEMENT_DOCTYPE, type Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ALL_MONTHS, isMonthKey, monthFilters, monthKey, monthOptions, profileTotals } from "@/utils/reimbursements/profileMonth";
import { MONTHLY_LIMIT, TAB_MINE } from "@/utils/reimbursements/rules";
import { urlStateManager } from "@/utils/urlStateManager";

/** The month in the URL, so a link opens the same month. */
const MONTH_PARAM = "reimb_month";

/** The amounts summed by status, over every claim the filters match. Four statuses, so four groups at most. */
const STATUS_SUMS: GroupByConfig = { groupByField: "status", aggregateField: "amount", aggregateFunction: "sum", limit: 10 };

const noop = () => undefined;

interface Props {
    /** The profile's user: whose claims these are. */
    userId: string;
}

export function UserReimbursementsTab({ userId }: Props) {
    const options = useMemo(() => monthOptions(new Date()), []);
    const [month, setMonth] = useState<string>(() => {
        const wanted = urlStateManager.getParam(MONTH_PARAM);
        return wanted === ALL_MONTHS || isMonthKey(wanted) ? wanted : monthKey(new Date());
    });
    const pickMonth = (value: string) => {
        setMonth(value);
        urlStateManager.updateParam(MONTH_PARAM, value);
    };
    const monthName = options.find((o) => o.value === month)?.label ?? month;

    const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 0 });
    const getUserName = useCallback(
        memoize((id?: string | null) => users?.find((u) => u.name === id)?.full_name || id || "--"),
        [users],
    );

    const [openName, setOpenName] = useState<string | null>(null);
    const onOpen = useCallback((r: Reimbursement) => setOpenName(r.name), []);

    // The "Raised By Me" columns (no Claimant column: one person), without the Edit / Delete column.
    const columns = useMemo(
        () => getReimbursementColumns({ tab: TAB_MINE, userId: "", getUserName, onOpen, onEdit: noop, onDelete: noop })
            .filter((c) => c.id !== "actions"),
        [getUserName, onOpen],
    );

    const additionalFilters = useMemo(() => [["owner", "=", userId], ...monthFilters(month)], [userId, month]);

    const {
        table, totalCount, isLoading, error, groupByResult,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        exportAllRows, isExporting,
    } = useServerDataTable<Reimbursement>({
        doctype: REIMBURSEMENT_DOCTYPE,
        columns,
        fetchFields: REIMBURSEMENT_FIELDS_TO_FETCH,
        searchableFields: REIMBURSEMENT_SEARCHABLE_FIELDS,
        urlSyncKey: "profile_reimb",
        defaultSort: "creation desc",
        getRowId: (row) => row.name,
        initialState: { columnVisibility: columnVisibilityFor(TAB_MINE) },
        additionalFilters,
        groupByConfig: STATUS_SUMS,
    });

    const totals = profileTotals(groupByResult ?? []);
    const allMonths = month === ALL_MONTHS;
    const rupees = formatToRoundedIndianRupee;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="profile-reimb-month" className="text-sm text-muted-foreground">Month</Label>
                <Select value={month} onValueChange={pickMonth}>
                    <SelectTrigger id="profile-reimb-month" className="w-48">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            {/* The summary, above the table (owner, 2026-10-28): what counts toward the limit first, then each status. */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <div className="col-span-2 flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 md:col-span-1">
                    <span className="text-xs text-muted-foreground">{allMonths ? "Total" : `${monthName} total`}</span>
                    <span className="text-lg font-semibold tabular-nums">{rupees(totals.monthTotal)}</span>
                    <span className="text-[11px] text-muted-foreground">Approved + Paid</span>
                    {!allMonths && (
                        <span className={cn(
                            "self-start rounded px-2 py-0.5 text-xs font-medium",
                            totals.reachesLimit
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
                        )}>
                            {totals.reachesLimit ? "Limit reached" : `Under the ${rupees(MONTHLY_LIMIT)} limit`}
                        </span>
                    )}
                </div>
                <SummaryFigure label="Approved" value={totals.approved} />
                <SummaryFigure label="Paid" value={totals.paid} />
                <SummaryFigure label="Pending" value={totals.pending} note="not counted yet" />
                <SummaryFigure label="Rejected" value={totals.rejected} note="never counted" />
            </div>

            <DataTable<Reimbursement>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={REIMBURSEMENT_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                dateFilterColumns={REIMBURSEMENT_DATE_COLUMNS}
                showExportButton
                onExport={"default"}
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={`Reimbursements_${userId}_${allMonths ? "all" : month}`}
            />

            <ClaimDetailSheet
                claimName={openName}
                onOpenChange={(open) => !open && setOpenName(null)}
                userId=""
                getUserName={getUserName}
                canDecide={() => false}
                onDecide={noop}
                onEdit={noop}
                onDelete={noop}
            />
        </div>
    );
}

/** One status's total in the summary. */
function SummaryFigure({ label, value, note }: { label: string; value: number; note?: string }) {
    return (
        <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-base font-medium tabular-nums">{formatToRoundedIndianRupee(value)}</span>
            {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        </div>
    );
}
