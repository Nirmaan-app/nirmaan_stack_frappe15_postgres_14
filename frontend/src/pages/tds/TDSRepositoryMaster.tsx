import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileText, Trash2, Plus, Package, Pencil } from "lucide-react";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { DataTable } from "@/components/data-table/new-data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useFrappeDeleteDoc, useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { useUserData } from "@/hooks/useUserData";
import { useStateSyncedWithParams } from "@/hooks/useSearchParamsManager";
import { cn } from "@/lib/utils";
import { TDSItem } from "@/types/NirmaanStack/TDSItem";
import { TDSRepository } from "@/types/NirmaanStack/TDSRepository";
import { AddTDSItemWizard } from "./components/AddTDSItemWizard";
import { AddTDSEntryDialog } from "./components/AddTDSEntryDialog";
import { StatusBadge, AttachmentCell, CountPill } from "./components/cells";
import { EditTDSItemDialog } from "./components/EditTDSItemDialog";
import { EditTDSEntryDialog } from "./components/EditTDSEntryDialog";
import {
    LinkedSKUsPeekDialog,
    RepositoryEntriesPeekDialog,
} from "./components/TDSItemPeekDialogs";
import { ItemsSKUTab } from "./components/ItemsSKUTab";
import { DerivedFacetFilter, useDerivedFacetParam } from "./components/DerivedFacetFilter";

// ─────────────────────────────────────────────────────────────────────────────
// TDS Repository master — two tabs after the 3-level grouping restructure:
//   • TDS Items         — the grouping docs (label, WP, linked-SKU count, entry
//                         count). The name links to the detail page (T8); the
//                         count chips open read-only quick-peek dialogs; an Edit
//                         action opens the shared EditTDSItemDialog (admin only).
//   • Repository Entries — the TDS Repository datasheet records (link to a TDS
//                         Item + make + status + attachment). The Category facet
//                         is DERIVED from the linked TDS Item's members (category
//                         is no longer a field on TDS Repository).
// Admin-only authoring (Add New TDS Item / Add New Repository Entry / edit /
// delete). Design source of truth:
//   nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md (T7).
// Shared building blocks (StatusBadge / AttachmentCell / CountPill, the two edit
// dialogs, and the two peek dialogs) live in ./components — NO local duplicates.
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_DOCTYPE = "TDS Items";
const ENTRY_DOCTYPE = "TDS Repository";

type TabKey = "items" | "entries" | "skus";

// ── DERIVED column filters on the TDS Items tab ─────────────────────────────
// Neither of these is a field on `TDS Items`, so neither can be a normal
// `meta.facet` (that path aggregates a real field and round-trips the selection
// as `[column.id, "in", [...]]`):
//
//   • Linked Item SKU    -> membership lives on `Items.linked_tds_item`
//   • Repository Entries -> makes live on `TDS Repository.make`
//
// Both are driven by ./components/DerivedFacetFilter (see that file for why it
// is a local control and not the shared `DataTableFacetedFilter`) and are
// translated below into explicit `name in [...]` narrowings.
//
// `in` on every side is deliberate: it is the one form the data-table API pulls
// out of the generated query (`split_name_in_constraints`), so no list is ever
// inlined toward the sqlparse token cap. That is also why the members endpoint
// returns the complement (`unlinked`) rather than us sending a `not in`.
// A bonus of that same mechanism: several `name in` filters are INTERSECTED
// server-side, so stacking the two below reads as AND for free.
const LINK_FILTER_LINKED = "linked";
const LINK_FILTER_CUSTOM = "custom";
// Namespaced under the table's own urlSyncKey, like every other param it owns.
const LINK_FILTER_PARAM = "tds_items_master_link";
const MAKE_FILTER_PARAM = "tds_items_master_make";

const MEMBER_COUNT_TITLE = "Linked Item SKU";
const ENTRY_COUNT_TITLE = "Repository Entries";

// Stable identity so the table hook's export callback does not churn every render.
const NO_ADDITIONAL_FILTERS: any[] = [];

// ── The two reads both the page and the facet headers share ─────────────────
// ONE definition each, so every caller passes byte-identical args and therefore
// shares a single SWR entry: same key + same fields = one request, not two.
const useTdsEntryRows = () =>
    useFrappeGetDocList<TDSRepository>(
        ENTRY_DOCTYPE,
        { fields: ["name", "tds_item", "make"], limit: 0 },
        "tds_entries_for_item_counts"
    );

// Member counts come from a CUSTOM endpoint, NOT get_list on the child doctype:
// `TDS Items Child Table` is an istable doctype with no DocPerm rows, so the
// permission-aware get_list raises PermissionError for every non-superuser (only
// Administrator sees rows) — which made every item show "Custom". The endpoint
// reads via frappe.get_all (perm-ignoring).
const useTdsMemberIndex = () =>
    useFrappeGetCall<{
        message: { counts: Record<string, number>; categories: string[]; unlinked: string[] };
    }>("nirmaan_stack.api.tds.members.get_tds_member_index", undefined, "tds_member_index");

// ── Column headers: MODULE-LEVEL components, and that is load-bearing ────────
// `flexRender` hands a column's `header` to React as the ELEMENT TYPE. Defining
// these inline inside the page's `columns` useMemo gives them a fresh identity
// whenever `columns` rebuilds, which REMOUNTS the header and closes any open
// popover mid-selection (the multi-select bug). Hoisted here they are stable for
// the app's lifetime, so `columns` may rebuild freely and the facets survive.
// Consequence: they take no props but `column` — the Make options are derived
// from the shared fetch above rather than passed down.
const MemberCountHeader: React.FC<{ column: any }> = ({ column }) => {
    const { data: memberIndex } = useTdsMemberIndex();
    // Counts are the two halves of the same partition: groups with at least one
    // linked SKU, and the rest. They sum to the total number of TDS Items.
    // Memoised on the two NUMBERS, not the response object, so a revalidation
    // returning the same figures keeps the options identity stable.
    const linkedCount = Object.keys(memberIndex?.message?.counts ?? {}).length;
    const unlinkedCount = memberIndex?.message?.unlinked?.length ?? 0;
    const options = useMemo(
        () => [
            { label: "Linked SKU", value: LINK_FILTER_LINKED, count: linkedCount },
            // "Custom" is the word the count pill itself shows at zero — keep identical.
            { label: "Not Linked (Custom)", value: LINK_FILTER_CUSTOM, count: unlinkedCount },
        ],
        [linkedCount, unlinkedCount]
    );

    return (
        <div className="flex items-center gap-1">
            {/* No search box: two fixed options. */}
            <DerivedFacetFilter
                paramKey={LINK_FILTER_PARAM}
                options={options}
                title={MEMBER_COUNT_TITLE}
            />
            <DataTableColumnHeader column={column} title={MEMBER_COUNT_TITLE} />
        </div>
    );
};

const EntryCountHeader: React.FC<{ column: any }> = ({ column }) => {
    const { data: entryRows } = useTdsEntryRows();
    // Every distinct make, with how many TDS ITEMS carry it — DISTINCT tds_item,
    // not a row count: one group may hold several entries of the same make, and
    // the number has to match the rows left after ticking it.
    // Ordered count-desc then label-asc, mirroring the backend facet's ORDER BY,
    // so the makes worth filtering by sit at the top of the 120.
    const makeOptions = useMemo(() => {
        const itemsByMake = new Map<string, Set<string>>();
        (entryRows || []).forEach((e) => {
            if (!e.make || !e.tds_item) return;
            let set = itemsByMake.get(e.make);
            if (!set) itemsByMake.set(e.make, (set = new Set()));
            set.add(e.tds_item);
        });
        return Array.from(itemsByMake, ([make, items]) => ({
            label: make,
            value: make,
            count: items.size,
        })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }, [entryRows]);

    return (
        <div className="flex items-center gap-1">
            <DerivedFacetFilter
                paramKey={MAKE_FILTER_PARAM}
                options={makeOptions}
                title="Make"
                searchable
            />
            <DataTableColumnHeader column={column} title={ENTRY_COUNT_TITLE} />
        </div>
    );
};

// A TDS Item row enriched with derived counts. We extend the base TDSItem type
// with the in-memory derived fields so TanStack accessors are typed.
interface TDSItemRow extends TDSItem {
    _memberCount: number;
    _entryCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TDS ITEMS TAB
// ═══════════════════════════════════════════════════════════════════════════

const TDSItemsTab: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
    const navigate = useNavigate();
    const [isAddItemOpen, setIsAddItemOpen] = useState(false);

    // Quick-peek dialog target (clicking a count chip), and the item being edited.
    const [peek, setPeek] = useState<{ id: string; name: string; kind: "skus" | "entries" } | null>(null);
    const [editItem, setEditItem] = useState<TDSItem | null>(null);

    // ── Derived-data sources ──
    // Both are shared with the facet headers (`useTdsMemberIndex` /
    // `useTdsEntryRows`), so each hits the same SWR entry and only one request
    // per source goes out however many callers there are.
    const { data: memberIndex, mutate: mutateMembers } = useTdsMemberIndex();
    const { data: entryRows, mutate: mutateEntries } = useTdsEntryRows();

    // parent → member count (from the perm-safe index endpoint).
    const memberCountByItem = useMemo(
        () => memberIndex?.message?.counts ?? {},
        [memberIndex]
    );

    // tds_item → entry count.
    const entryCountByItem = useMemo(() => {
        const map = new Map<string, number>();
        (entryRows || []).forEach((e: any) => {
            if (!e.tds_item) return;
            map.set(e.tds_item, (map.get(e.tds_item) || 0) + 1);
        });
        return map;
    }, [entryRows]);

    // ── Derived-facet selections ──
    // READ-ONLY here. Each control owns its own value (see DerivedFacetFilter for
    // why — putting it in the `columns` deps remounts the header mid-click and
    // makes multi-select impossible); these are second subscribers to the same
    // url params, which is all the page needs to narrow the query.
    const { raw: linkFilterParam, values: linkFilterValues } =
        useDerivedFacetParam(LINK_FILTER_PARAM);
    const { raw: makeFilterParam, values: makeFilter } =
        useDerivedFacetParam(MAKE_FILTER_PARAM);
    const linkFilter = useMemo(
        () =>
            linkFilterValues.filter(
                (v) => v === LINK_FILTER_LINKED || v === LINK_FILTER_CUSTOM
            ),
        [linkFilterValues]
    );

    // Selecting BOTH options (or neither) is "no opinion" — no narrowing at all,
    // which also keeps the two lists from having to be stitched together.
    // While the member index is still in flight we deliberately do NOT narrow:
    // a momentarily empty name list would render as "no results", which reads as
    // an answer rather than as loading.
    const linkNameFilter = useMemo(() => {
        const index = memberIndex?.message;
        if (!index || linkFilter.length !== 1) return NO_ADDITIONAL_FILTERS;
        const names =
            linkFilter[0] === LINK_FILTER_LINKED
                ? Object.keys(index.counts ?? {})
                : index.unlinked ?? [];
        return [["name", "in", names]];
    }, [memberIndex, linkFilter]);

    // Make -> the TDS Items that have at least one entry of that make. UNION
    // across the ticked makes (OR within one facet, matching every other facet
    // in the app); the AND against the link filter happens server-side, where
    // stacked `name in` filters are intersected.
    // Same in-flight rule as above: no rows yet means no narrowing, not zero.
    const makeNameFilter = useMemo(() => {
        if (!makeFilter.length || !entryRows) return NO_ADDITIONAL_FILTERS;
        const wanted = new Set(makeFilter);
        const names = new Set<string>();
        entryRows.forEach((e) => {
            if (e.tds_item && e.make && wanted.has(e.make)) names.add(e.tds_item);
        });
        return [["name", "in", Array.from(names)]];
    }, [entryRows, makeFilter]);

    const additionalFilters = useMemo(() => {
        if (!linkNameFilter.length && !makeNameFilter.length) return NO_ADDITIONAL_FILTERS;
        return [...linkNameFilter, ...makeNameFilter];
    }, [linkNameFilter, makeNameFilter]);

    const columns = useMemo<ColumnDef<TDSItemRow>[]>(() => [
        // 1 — TDS Item (name → detail page)
        {
            accessorKey: "tds_item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="TDS Item" />,
            cell: ({ row }) => {
                const name = row.original.tds_item_name || row.original.name;
                return (
                    <button
                        type="button"
                        onClick={() => navigate(`/tds-repository/item/${row.original.name}`)}
                        className="text-left font-medium text-blue-700 hover:text-blue-900 hover:underline whitespace-normal break-words max-w-[25ch] block"
                        title={name}
                    >
                        {name}
                    </button>
                );
            },
            meta: { exportHeaderName: "TDS Item" },
        },
        // 2 — Work Package (facet)
        {
            accessorKey: "work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
            cell: ({ row }) => <div className="font-medium">{row.original.work_package || "--"}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome" as any,
            meta: { facet: { field: "work_package", title: "Work Package" } satisfies FacetDeclaration, exportHeaderName: "Work Package" },
        },
        // 3 — Linked Item SKU (clickable count pill → LinkedSKUsPeekDialog)
        {
            id: "member_count",
            size: 130,
            header: MemberCountHeader,
            cell: ({ row }) => {
                const count = memberCountByItem[row.original.name] ?? 0;
                const name = row.original.tds_item_name || row.original.name;
                return (
                    <div className="text-center">
                        <CountPill
                            count={count}
                            icon={Package}
                            zeroLabel="Custom"
                            title="View linked items"
                            onClick={() => setPeek({ id: row.original.name, name, kind: "skus" })}
                        />
                    </div>
                );
            },
            meta: {
                exportHeaderName: "Linked Item SKU Count",
                exportValue: (row: TDSItemRow) => memberCountByItem[row.name] ?? 0,
            },
        },
        // 4 — Repository Entries (clickable count pill → RepositoryEntriesPeekDialog).
        //     Its facet filters by the entries' MAKE — see EntryCountHeader.
        {
            id: "entry_count",
            size: 130,
            header: EntryCountHeader,
            cell: ({ row }) => {
                const count = entryCountByItem.get(row.original.name) ?? 0;
                const name = row.original.tds_item_name || row.original.name;
                return (
                    <div className="text-center">
                        <CountPill
                            count={count}
                            icon={FileText}
                            title="View entries"
                            onClick={() => setPeek({ id: row.original.name, name, kind: "entries" })}
                        />
                    </div>
                );
            },
            meta: {
                exportHeaderName: "Repository Entry Count",
                exportValue: (row: TDSItemRow) => entryCountByItem.get(row.name) ?? 0,
            },
        },
        // 5 — Actions (admin only): Edit → EditTDSItemDialog
        ...(isAdmin ? [
            {
                id: "actions",
                size: 70,
                meta: { excludeFromExport: true },
                header: ({ column }: { column: any }) => <DataTableColumnHeader column={column} title="Actions" />,
                cell: ({ row }: { row: any }) => (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-600 hover:text-[#dc2626]"
                            onClick={() => setEditItem(row.original)}
                            title="Edit TDS Item"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            } as ColumnDef<TDSItemRow>,
        ] : []),
        // ⚠️ The derived-facet selections are DELIBERATELY absent from these deps —
        // the header components own them. Listing them here rebuilds `columns` on
        // every click, remounting the header and closing its popover mid-selection.
    ], [navigate, memberCountByItem, entryCountByItem, isAdmin]);

    const searchableFields = useMemo(() => [
        { label: "TDS Item Name", value: "tds_item_name", default: true },
        { label: "ID", value: "name" },
        { label: "Description", value: "description" },
    ], []);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch,
        exportAllRows,
        isExporting,
        setPagination,
    } = useServerDataTable<TDSItemRow>({
        doctype: ITEM_DOCTYPE,
        columns,
        fetchFields: ["name", "tds_item_name", "work_package", "description", "creation"],
        defaultSort: "creation desc",
        searchableFields,
        urlSyncKey: "tds_items_master",
        additionalFilters,
    });

    // A narrowing that shrinks the result set can strand the user on a page that
    // no longer exists (page 4 of an unfiltered 352 → 39 custom groups). Reset on
    // CHANGE only, so a deep link carrying both a filter and a page still lands
    // where it was shared from.
    const facetSignature = `${linkFilterParam}|${makeFilterParam}`;
    const prevFacetSignature = useRef(facetSignature);
    useEffect(() => {
        if (prevFacetSignature.current === facetSignature) return;
        prevFacetSignature.current = facetSignature;
        setPagination((p) => ({ ...p, pageIndex: 0 }));
    }, [facetSignature, setPagination]);

    const handleCreated = () => {
        refetch();
        mutateMembers();
        mutateEntries();
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                {isAdmin && (
                    <Button
                        onClick={() => setIsAddItemOpen(true)}
                        className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add New TDS Item
                    </Button>
                )}
            </div>

            <DataTable
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                facetDoctype={ITEM_DOCTYPE}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                searchFieldOptions={searchableFields}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="TDS_Items"
            />

            {/* Read-only quick-peek dialogs (driven by the count chips) */}
            <LinkedSKUsPeekDialog
                open={peek?.kind === "skus"}
                onOpenChange={(o) => !o && setPeek(null)}
                tdsItemId={peek?.id || ""}
                tdsItemName={peek?.name || ""}
            />
            <RepositoryEntriesPeekDialog
                open={peek?.kind === "entries"}
                onOpenChange={(o) => !o && setPeek(null)}
                tdsItemId={peek?.id || ""}
                tdsItemName={peek?.name || ""}
            />

            {isAdmin && (
                <>
                    <AddTDSItemWizard
                        open={isAddItemOpen}
                        onOpenChange={setIsAddItemOpen}
                        onCreated={handleCreated}
                    />
                    <EditTDSItemDialog
                        open={!!editItem}
                        onOpenChange={(o) => !o && setEditItem(null)}
                        tdsItem={editItem}
                        onSaved={() => {
                            refetch();
                            mutateMembers();
                            mutateEntries();
                            setEditItem(null);
                        }}
                    />
                </>
            )}
        </div>

    );
};

// ═══════════════════════════════════════════════════════════════════════════
// REPOSITORY ENTRIES TAB
// ═══════════════════════════════════════════════════════════════════════════

const TDSEntriesTab: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
    const navigate = useNavigate();
    const [isAddEntryOpen, setIsAddEntryOpen] = useState(false);
    const [deleteEntry, setDeleteEntry] = useState<TDSRepository | null>(null);
    const [editEntry, setEditEntry] = useState<TDSRepository | null>(null);
    const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();

    // ── Resolve tds_item → tds_item_name (label) ──
    const { data: tdsItemList } = useFrappeGetDocList<TDSItem>(
        ITEM_DOCTYPE,
        { fields: ["name", "tds_item_name", "work_package"], limit: 0 },
        "tds_items_label_map"
    );

    // tds_item name → label.
    const tdsItemLabelMap = useMemo(() => {
        const map = new Map<string, string>();
        (tdsItemList || []).forEach((d) => map.set(d.name, d.tds_item_name || d.name));
        return map;
    }, [tdsItemList]);

    // Sibling makes for the entry being edited — used to disallow duplicate makes
    // within the same TDS Item. 3rd arg is the swrKey (frappe-react-sdk gotcha):
    // `undefined` = fetch, `null` = skip. Never use `{ enabled }`.
    const { data: siblingEntries } = useFrappeGetDocList<TDSRepository>(
        ENTRY_DOCTYPE,
        {
            filters: [["tds_item", "=", editEntry?.tds_item ?? ""]],
            fields: ["name", "make"],
            limit: 0,
        },
        editEntry ? undefined : null
    );

    const takenMakes = useMemo(
        () =>
            new Set(
                (siblingEntries || [])
                    .filter((e) => e.name !== editEntry?.name)
                    .map((e) => e.make)
            ),
        [siblingEntries, editEntry]
    );

    const columns = useMemo<ColumnDef<TDSRepository>[]>(() => [
        // 1 — TDS Item (name only, quiet link to detail page)
        {
            accessorKey: "tds_item",
            header: ({ column }) => <DataTableColumnHeader column={column} title="TDS Item" />,
            cell: ({ row }) => {
                const tdsItem = row.original.tds_item;
                const label = tdsItemLabelMap.get(tdsItem) || tdsItem || "--";
                if (!tdsItem) return <span className="font-medium">--</span>;
                return (
                    <button
                        type="button"
                        onClick={() => navigate(`/tds-repository/item/${tdsItem}`)}
                        className="text-left font-medium text-gray-800 hover:text-[#dc2626] hover:underline whitespace-normal break-words max-w-[25ch] block"
                        title={label}
                    >
                        {label}
                    </button>
                );
            },
            enableColumnFilter: true,
            filterFn: "arrIncludesSome" as any,
            meta: {
                // Facet by NAME, not id. The text search beside it can only LIKE the
                // raw `TDS-ITEM-#####` column (an app-wide Link-search limitation —
                // hence the "TDS Item ID" label below), so this picker is the only
                // way to narrow by the name the column actually displays. The labels
                // come from the `tds_item` LINK_FIELD_MAP entry server-side; without
                // it this facet would list raw ids.
                facet: { field: "tds_item", title: "TDS Item" } satisfies FacetDeclaration,
                exportHeaderName: "TDS Item",
                exportValue: (row: TDSRepository) => tdsItemLabelMap.get(row.tds_item) || row.tds_item,
            },
        },
        // 2 — Work Package (facet)
        {
            accessorKey: "work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
            cell: ({ row }) => <div className="font-medium">{row.original.work_package || "--"}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome" as any,
            meta: { facet: { field: "work_package", title: "Work Package" } satisfies FacetDeclaration, exportHeaderName: "Work Package" },
        },
        // 3 — Make (facet)
        {
            accessorKey: "make",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
            cell: ({ row }) => <div className="font-medium">{row.original.make || "--"}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome" as any,
            meta: { facet: { field: "make", title: "Make" } satisfies FacetDeclaration, exportHeaderName: "Make" },
        },
        // 4 — Status (facet)
        {
            accessorKey: "status",
            size: 110,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => (
                <div className="flex justify-center">
                    <StatusBadge status={row.original.status} />
                </div>
            ),
            enableColumnFilter: true,
            filterFn: "arrIncludesSome" as any,
            meta: { facet: { field: "status", title: "Status" } satisfies FacetDeclaration, exportHeaderName: "Status" },
        },
        // 5 — Datasheet (attachment)
        {
            accessorKey: "tds_attachment",
            size: 80,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Datasheet" />,
            cell: ({ row }) => (
                <div className="flex justify-start">
                    <AttachmentCell url={row.original.tds_attachment} />
                </div>
            ),
        },
        // 6 — Actions (admin only): Edit + Delete
        ...(isAdmin ? [
            {
                id: "actions",
                size: 90,
                meta: { excludeFromExport: true },
                header: ({ column }: { column: any }) => <DataTableColumnHeader column={column} title="Actions" />,
                cell: ({ row }: { row: any }) => (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-600 hover:text-[#dc2626]"
                            onClick={() => setEditEntry(row.original)}
                            title="Edit Entry"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-600 hover:text-red-600"
                            onClick={() => setDeleteEntry(row.original)}
                            title="Delete Entry"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            } as ColumnDef<TDSRepository>,
        ] : []),
    ], [isAdmin, tdsItemLabelMap, navigate]);

    // `tds_item` is a Link column holding `TDS-ITEM-#####`, and the server search
    // is a plain LIKE on that stored column — so this searches the ID, never the
    // group name the cell displays. Labelled "TDS Item ID" like every other Link
    // search in the app (Project ID / Vendor ID) rather than left reading as a
    // name search that silently returns nothing.
    //
    // To narrow by NAME, use the column's facet — that is what the `tds_item`
    // LINK_FIELD_MAP entry exists for. Searching a Link by its label from this
    // box would need the backend to resolve label -> ids, which it does not do
    // for any table.
    const searchableFields = useMemo(() => [
        { label: "Make", value: "make", default: true },
        { label: "TDS Item ID", value: "tds_item", placeholder: "Search by TDS Item ID (e.g. TDS-ITEM-00301)..." },
        { label: "Description", value: "description" },
    ], []);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch,
        exportAllRows,
        isExporting,
    } = useServerDataTable<TDSRepository>({
        doctype: ENTRY_DOCTYPE,
        columns,
        fetchFields: ["name", "tds_item", "work_package", "make", "tds_attachment", "status", "description", "creation"],
        defaultSort: "creation desc",
        searchableFields,
        urlSyncKey: "tds_entries_master",
    });

    const handleDelete = async () => {
        if (!deleteEntry) return;
        try {
            await deleteDoc(ENTRY_DOCTYPE, deleteEntry.name);
            toast({ title: "Success", description: "Entry deleted successfully", variant: "success" });
            refetch();
        } catch (e) {
            console.error("Delete error:", e);
            toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
        } finally {
            setDeleteEntry(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                {isAdmin && (
                    <Button
                        onClick={() => setIsAddEntryOpen(true)}
                        className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add New Repository Entry
                    </Button>
                )}
            </div>

            <DataTable
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                searchFieldOptions={searchableFields}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}

                facetDoctype={ENTRY_DOCTYPE}

                exportFileName="TDS_Entries"
            />

            {isAdmin && (
                <>
                    <AddTDSEntryDialog
                        open={isAddEntryOpen}
                        onOpenChange={setIsAddEntryOpen}
                        onCreated={refetch}
                    />
                    <EditTDSEntryDialog
                        open={!!editEntry}
                        onOpenChange={(o) => !o && setEditEntry(null)}
                        entry={editEntry}
                        takenMakes={takenMakes}
                        onSaved={() => {
                            refetch();
                            setEditEntry(null);
                        }}
                    />
                </>
            )}

            <AlertDialog open={!!deleteEntry} onOpenChange={(open) => !open && setDeleteEntry(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the TDS entry.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                            {deleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE SHELL
// ═══════════════════════════════════════════════════════════════════════════

const TAB_OPTIONS: { key: TabKey; label: string }[] = [
    { key: "items", label: "TDS Items" },
    { key: "entries", label: "Repository Entries" },
    // ADR-0004: membership is authored from the Item side, so the curation hub
    // needs the catalog itself — including SKUs no group has claimed yet.
    { key: "skus", label: "Items SKUs" },
];

export const TDSRepositoryMaster: React.FC = () => {
    const { role } = useUserData();
    // useUserData maps the Administrator user_id to "Nirmaan Admin Profile",
    // so this single check also covers the Administrator user.
    const isAdmin = role === "Nirmaan Admin Profile";

    const [tab, setTab] = useStateSyncedWithParams<TabKey>("tab", "items");
    const activeTab: TabKey =
        tab === "entries" ? "entries" : tab === "skus" ? "skus" : "items";

    return (
        <div className="flex-1 space-y-6 p-4 md:p-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold tracking-tight text-gray-800">TDS Repository</h2>
            </div>

            {/* Tab toggle (red-active segmented control, matching project tab styling) */}
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                {TAB_OPTIONS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => setTab(t.key)}
                        className={cn(
                            "px-5 py-1.5 text-sm font-medium rounded-md transition-colors",
                            activeTab === t.key
                                ? "bg-[#dc2626] text-white shadow-sm"
                                : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <Separator />

            {activeTab === "items" ? (
                <TDSItemsTab isAdmin={isAdmin} />
            ) : activeTab === "entries" ? (
                <TDSEntriesTab isAdmin={isAdmin} />
            ) : (
                <ItemsSKUTab isAdmin={isAdmin} />
            )}
        </div>
    );
};

export default TDSRepositoryMaster;
