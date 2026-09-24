// src/pages/ExpenseRequests/ExpenseRequestsPage.tsx
//
// The Expense Request list — the first tab of the unified /expense module. Built on the SAME
// `useServerDataTable` + `DataTable` stack as the Misc Project and Non-Project tabs, so all
// three behave identically (search, facets, export, paging).
//
// ⚠️ THERE IS NO SERVER-SIDE ROW SCOPING. The `permission_query_conditions` hook was removed
// on request (see `access.get_permission_query_conditions`), so every role holding the read
// DocPerm sees every request.
//
// WHO SEES WHICH TAB (owner, 23 Sep 2026). A REVIEWER -- Admin / Accountant / Accountant Lead
// / HR Executive / HR Lead, i.e. `reviewsExpenseRequests`, mirroring the server's
// `access.ADMIN_PROFILE | PM_REQUEST_REVIEWERS` -- gets all three tabs. EVERYONE ELSE gets
// "Expense Raised By Me" alone: PMO Executive, Project Manager and the four procurement
// profiles, that being the rest of the `/expense` sidebar audience.
//
// The narrowing rides the TAB, not the page: "Raised By Me" carries `owner = <user>` into the
// table, the tab count, the facets and the export, and a non-reviewer has no other tab to
// stand on. That replaced a separate page-level `ownerFilter` for Project Managers -- two
// mechanisms for one rule, which could disagree. It is a DISPLAY filter either way; the API
// and Desk still return every request.
//
// `can_review` is SERVER-computed, fetched once per page via the scoped endpoint and keyed by
// request name. Never re-derive who may approve.

import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";

import { DataTable } from "@/components/data-table/new-data-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useCounts } from "@/hooks/useCounts";
import { useUserData } from "@/hooks/useUserData";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { cn } from "@/lib/utils";

import { reviewsExpenseRequests } from "@/constants/roles";

import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import type {
    ExpenseRequest, GetMyExpenseRequestsResponse,
} from "@/types/NirmaanStack/ExpenseRequest";

import NewExpenseRequestDialog from "./components/NewExpenseRequestDialog";
import ReviewActionDialog, { ReviewAction } from "./components/ReviewActionDialog";
import { getExpenseRequestColumns } from "./config/expenseRequestsColumns";
import {
    DEFAULT_EXR_FIELDS_TO_FETCH, EXR_DATE_COLUMNS, EXR_RAISED_BY_ME, EXR_SEARCHABLE_FIELDS,
    getExrStatusTabs,
} from "./config/expenseRequestsTable.config";

const DOCTYPE = "Expense Request";

export const ExpenseRequestsPage: React.FC = () => {
    const { role, user_id } = useUserData();

    // `useUserData` returns "Loading" while the Nirmaan Users doc is in flight. Mounting the
    // table then would fetch EVERY request before the role -- and so the tab set and its
    // owner filter -- exists, so hold. A brief null beats one unscoped fetch.
    if (role === "Loading") return null;

    return (
        <ExpenseRequestsList
            isReviewer={reviewsExpenseRequests(role, user_id)}
            userId={user_id}
        />
    );
};

const ExpenseRequestsList: React.FC<{ isReviewer: boolean; userId: string }> = ({
    isReviewer, userId,
}) => {
    // Tabs are decided ONCE from the role; the initial tab is whichever comes first, so a
    // non-reviewer opens on "Expense Raised By Me" rather than a tab they cannot see.
    const tabDefs = useMemo(() => getExrStatusTabs(isReviewer), [isReviewer]);
    const [statusTab, setStatusTab] = useState<string>(() => tabDefs[0].value);
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

    // The owner narrowing. It belongs to the "Raised By Me" TAB, not to the page -- see the
    // header note. One definition, read by the table filters and by that tab's count.
    const ownFilters = useMemo(() => [["owner", "=", userId]], [userId]);

    // Tab badge counts. `byMe` is its own spec rather than a slice of `byStatus`, because it
    // is not a status -- it spans all of them. The SWR key carries the user: SWR keys on the
    // key string alone, not on the specs, so two users would otherwise share one cache entry.
    const { data: countsData, mutate: mutateCounts } = useCounts(
        [
            { key: "byStatus", doctype: DOCTYPE, group_field: "status" },
            { key: "all", doctype: DOCTYPE },
            { key: "byMe", doctype: DOCTYPE, filters: ownFilters },
        ],
        `exr_status_counts:${userId}`
    );
    const byStatus = (countsData?.message?.byStatus ?? {}) as Record<string, number>;
    const allCount = (countsData?.message?.all as number) ?? 0;
    const byMeCount = (countsData?.message?.byMe as number) ?? 0;

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

    // Server-computed -- see `update.can_edit`. Disjoint from `reviewable` for everyone
    // EXCEPT an Admin, who may now edit any pending request and review it too; that
    // overlap is the owner's ruling, not an oversight, so a row can offer both actions.
    const editable = useMemo(() => {
        const s = new Set<string>();
        scopedByName.forEach((r, name) => { if (r.can_edit) s.add(name); });
        return s;
    }, [scopedByName]);
    const canEdit = useCallback((name: string) => editable.has(name), [editable]);

    // MERGED, not either-or. The TABLE row carries no `source_data` (the dialog would open with
    // every format answer blank and save that), while the ENRICHED row carries no
    // `projects_name` -- that label is injected by the data-table layer, and the dialog needs it
    // to show the project it cannot render through the picker. Enriched wins on the keys it
    // has; the table row supplies the rest.
    const [editing, setEditing] = useState<ExpenseRequest | null>(null);
    const openEdit = useCallback(
        (r: ExpenseRequest) => setEditing({ ...r, ...(scopedByName.get(r.name) ?? {}) }),
        [scopedByName]
    );

    const statusTabs = useMemo(
        () => tabDefs.map((t) => ({
            label: t.label, value: t.value,
            count: t.value === EXR_RAISED_BY_ME ? byMeCount
                : t.value === "All" ? allCount
                : byStatus[t.value] || 0,
        })),
        [tabDefs, byStatus, allCount, byMeCount]
    );

    // Three cases, spelled out rather than defaulted: "Raised By Me" filters on OWNER and
    // spans every status, "All" filters on nothing, and a status tab filters on its status.
    // Handing `EXR_RAISED_BY_ME` to a `status =` filter would return an empty table with no
    // error -- which is why it is cased out here and not folded into the `!== "All"` test.
    const additionalFilters = useMemo(
        () => statusTab === EXR_RAISED_BY_ME ? ownFilters
            : statusTab === "All" ? []
            : [["status", "=", statusTab]],
        [ownFilters, statusTab]
    );

    // Facet option lists follow the same rows the table shows, so on "Raised By Me" the
    // "Raised By" / "Project" filters never list other people's requests.
    const facetOverrides = useMemo(() => {
        const scoped = { additionalFilters };
        return {
            type: scoped, projects: scoped, owner: scoped, status: scoped, reviewed_by: scoped,
        };
    }, [additionalFilters]);

    const columnsDefinition = useMemo(
        () => getExpenseRequestColumns({
            statusTab, getUserName, getCategory, canReview, canEdit,
            onApprove: (r) => setReview({ action: "approve", request: r }),
            onReject: (r) => setReview({ action: "reject", request: r }),
            onEdit: openEdit,
        }),
        [statusTab, getUserName, getCategory, canReview, canEdit, openEdit]
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
                facetOverrides={facetOverrides}
                dateFilterColumns={EXR_DATE_COLUMNS}
                showExportButton={true}
                onExport={"default"}
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Expense_Requests"
            />

            <NewExpenseRequestDialog
                onSuccess={refreshAll}
                editing={editing}
                onEditingChange={setEditing}
            />
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
