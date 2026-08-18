// src/pages/ExpenseRequests/ExpenseRequestsPage.tsx
//
// The Expense Request list — the first tab of the unified /expense module. Built on the SAME
// `useServerDataTable` + `DataTable` stack as the Misc Project and Non-Project tabs, so all
// three behave identically (search, facets, export, paging).
//
// ⚠️ VISIBILITY IS ENFORCED SERVER-SIDE. The read DocPerm is deliberately broad; the real
// rule -- you see your OWN requests plus any whose expense type routes to your role profile
// -- lives in `permission_query_conditions` (hooks.py -> `access.get_permission_query_conditions`),
// which the table's `reportview` read passes through. Do NOT add a client-side filter for
// it: a second copy of that rule would be free to drift from the one the database applies.
//
// `can_review` is likewise SERVER-computed, fetched once per page via the scoped endpoint and
// keyed by request name. Never re-derive who may approve.

import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";

import { DataTable } from "@/components/data-table/new-data-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useCounts } from "@/hooks/useCounts";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { cn } from "@/lib/utils";

import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import type {
    ExpenseRequest, GetMyExpenseRequestsResponse,
} from "@/types/NirmaanStack/ExpenseRequest";

import NewExpenseRequestDialog from "./components/NewExpenseRequestDialog";
import ReviewActionDialog, { ReviewAction } from "./components/ReviewActionDialog";
import { getExpenseRequestColumns } from "./config/expenseRequestsColumns";
import {
    DEFAULT_EXR_FIELDS_TO_FETCH, EXR_DATE_COLUMNS, EXR_SEARCHABLE_FIELDS, EXR_STATUS_TABS,
} from "./config/expenseRequestsTable.config";

const DOCTYPE = "Expense Request";

export const ExpenseRequestsPage: React.FC = () => {
    const [statusTab, setStatusTab] = useState<string>("Pending Approval");
    const [review, setReview] = useState<{ action: ReviewAction | null; request: ExpenseRequest | null }>(
        { action: null, request: null }
    );

    const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name"], limit: 0,
    });
    const getUserName = useCallback(
        memoize((id?: string) => users?.find((u) => u.name === id)?.full_name || id || "--"),
        [users]
    );

    // The category lives on `Expense Type`, not on the request, and the table reads the
    // request doctype directly -- so it is resolved here from the master. 40 rows, one fetch.
    const { data: expenseTypes } = useFrappeGetDocList<ExpenseType>("Expense Type", {
        fields: ["name", "expense_category"], limit: 0,
    });
    const getCategory = useCallback(
        memoize((t?: string) =>
            expenseTypes?.find((e) => e.name === t)?.expense_category || "Uncategorised"),
        [expenseTypes]
    );

    // Tab badge counts. Already scoped -- the counts endpoint reads through the same
    // permission query condition, so a PM's badges show their own requests.
    const { data: countsData, mutate: mutateCounts } = useCounts(
        [{ key: "byStatus", doctype: DOCTYPE, group_field: "status" }, { key: "all", doctype: DOCTYPE }],
        "exr_status_counts"
    );
    const byStatus = (countsData?.message?.byStatus ?? {}) as Record<string, number>;
    const allCount = (countsData?.message?.all as number) ?? 0;

    // The scoped endpoint is the ONLY source of `can_review`; the table reads the doctype
    // directly and cannot compute it.
    const { data: scoped, mutate: mutateScoped } = useFrappeGetCall<{ message: GetMyExpenseRequestsResponse }>(
        "nirmaan_stack.api.expense_requests.read.get_my_expense_requests",
        undefined,
        "exr_can_review"
    );
    // The scoped read carries BOTH the review right and the server-labelled detail the
    // approval dialog shows -- one fetch, and the dialog never re-derives either.
    const scopedByName = useMemo(() => {
        const m = new Map<string, ExpenseRequest>();
        (scoped?.message?.requests ?? []).forEach((r) => m.set(r.name, r));
        return m;
    }, [scoped]);
    const reviewable = useMemo(() => {
        const s = new Set<string>();
        scopedByName.forEach((r, name) => { if (r.can_review) s.add(name); });
        return s;
    }, [scopedByName]);
    const canReview = useCallback((name: string) => reviewable.has(name), [reviewable]);

    const statusTabs = useMemo(
        () => EXR_STATUS_TABS.map((t) => ({
            label: t.label, value: t.value,
            count: t.value === "All" ? allCount : byStatus[t.value] || 0,
        })),
        [byStatus, allCount]
    );

    const additionalFilters = useMemo(
        () => (statusTab !== "All" ? [["status", "=", statusTab]] : []),
        [statusTab]
    );

    const columnsDefinition = useMemo(
        () => getExpenseRequestColumns({
            statusTab, getUserName, getCategory, canReview,
            onApprove: (r) => setReview({ action: "approve", request: r }),
            onReject: (r) => setReview({ action: "reject", request: r }),
        }),
        [statusTab, getUserName, getCategory, canReview]
    );

    const {
        table, data, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch, exportAllRows, isExporting,
    } = useServerDataTable<ExpenseRequest>({
        doctype: DOCTYPE,
        columns: columnsDefinition,
        fetchFields: DEFAULT_EXR_FIELDS_TO_FETCH,
        searchableFields: EXR_SEARCHABLE_FIELDS,
        urlSyncKey: "exr",
        defaultSort: "creation desc",
        enableRowSelection: false,
        additionalFilters,
    });

    const refreshAll = useCallback(() => {
        refetch(); mutateCounts(); mutateScoped();
    }, [refetch, mutateCounts, mutateScoped]);

    if (error && !data?.length) return <div className="m-4"><AlertDestructive error={error} /></div>;

    return (
        <div className={cn("flex flex-col gap-2 overflow-hidden",
            totalCount > 10 ? "h-[calc(100vh-80px)]" : "h-auto")}>
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                    {statusTabs.map((t) => {
                        const active = statusTab === t.value;
                        return (
                            <button key={t.value} type="button" onClick={() => setStatusTab(t.value)}
                                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                                    active ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                                {t.label}
                                <span className={`text-xs font-bold ${active ? "opacity-90" : "opacity-70"}`}>
                                    {t.count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <DataTable<ExpenseRequest>
                table={table}
                columns={columnsDefinition}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={EXR_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetDoctype={DOCTYPE}
                dateFilterColumns={EXR_DATE_COLUMNS}
                showExportButton={true}
                onExport={"default"}
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Expense_Requests"
            />

            <NewExpenseRequestDialog onSuccess={refreshAll} />
            <ReviewActionDialog
                action={review.action}
                request={review.request}
                enriched={review.request ? scopedByName.get(review.request.name) ?? null : null}
                getUserName={getUserName}
                onOpenChange={(o) => !o && setReview({ action: null, request: null })}
                onDone={refreshAll}
            />
        </div>
    );
};

export default ExpenseRequestsPage;
