import React, { useMemo, useState } from "react";
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
import { useFacetValues } from "@/hooks/useFacetValues";
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

type TabKey = "items" | "entries";

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
    // Member counts come from a CUSTOM endpoint, NOT get_list on the child
    // doctype: `TDS Items Child Table` is an istable doctype with no DocPerm
    // rows, so the permission-aware get_list raises PermissionError for every
    // non-superuser (only Administrator sees rows) — which made every item show
    // "Custom". The endpoint reads via frappe.get_all (perm-ignoring).
    const { data: memberIndex, mutate: mutateMembers } = useFrappeGetCall<{
        message: { counts: Record<string, number>; categories: string[] };
    }>("nirmaan_stack.api.tds.members.get_tds_member_index", undefined, "tds_member_index");
    // One list call for all entries → bucket entry counts by tds_item.
    const { data: entryRows, mutate: mutateEntries } = useFrappeGetDocList<TDSRepository>(
        ENTRY_DOCTYPE,
        { fields: ["name", "tds_item"], limit: 0 },
        "tds_entries_for_item_counts"
    );

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
            meta: { enableFacet: true, facetTitle: "Work Package", exportHeaderName: "Work Package" },
        },
        // 3 — Linked Item SKU (clickable count pill → LinkedSKUsPeekDialog)
        {
            id: "member_count",
            size: 130,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Linked Item SKU" />,
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
        // 4 — Repository Entries (clickable count pill → RepositoryEntriesPeekDialog)
        {
            id: "entry_count",
            size: 130,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Repository Entries" />,
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
        columnFilters,
        refetch,
        exportAllRows,
        isExporting,
    } = useServerDataTable<TDSItemRow>({
        doctype: ITEM_DOCTYPE,
        columns,
        fetchFields: ["name", "tds_item_name", "work_package", "description", "creation"],
        defaultSort: "creation desc",
        searchableFields,
        urlSyncKey: "tds_items_master",
    });

    // WP facet (only meaningful facet on the grouping doc).
    const { facetOptions: wpFacetOptions, isLoading: isWPLoading } = useFacetValues({
        doctype: ITEM_DOCTYPE,
        field: "work_package",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });

    const facetFilterOptions = useMemo(() => ({
        work_package: { title: "Work Package", options: wpFacetOptions, isLoading: isWPLoading },
    }), [wpFacetOptions, isWPLoading]);

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
                facetFilterOptions={facetFilterOptions}
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

    // ── Resolve tds_item → tds_item_name (label) and derive the Category facet ──
    // Category is no longer a field on TDS Repository; it's derived from the
    // linked TDS Item's members. We pull the TDS Item list (for the label map)
    // and the member child rows (for the derived category facet), then build a
    // static facet of distinct member-category names.
    const { data: tdsItemList } = useFrappeGetDocList<TDSItem>(
        ITEM_DOCTYPE,
        { fields: ["name", "tds_item_name", "work_package"], limit: 0 },
        "tds_items_label_map"
    );
    // Category facet is derived from member categories via the perm-safe index
    // endpoint (the child doctype isn't get_list-able for non-superusers — see
    // get_tds_member_index). Same swrKey as the Items tab → one shared call.
    const { data: memberIndex } = useFrappeGetCall<{
        message: { counts: Record<string, number>; categories: string[] };
    }>("nirmaan_stack.api.tds.members.get_tds_member_index", undefined, "tds_member_index");

    // tds_item name → label.
    const tdsItemLabelMap = useMemo(() => {
        const map = new Map<string, string>();
        (tdsItemList || []).forEach((d) => map.set(d.name, d.tds_item_name || d.name));
        return map;
    }, [tdsItemList]);

    // Distinct member-category names (already sorted by the endpoint) → facet.
    const categoryFacetOptions = useMemo(
        () => (memberIndex?.message?.categories ?? []).map((c) => ({ label: c, value: c })),
        [memberIndex]
    );

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
            meta: { enableFacet: true, facetTitle: "Work Package", exportHeaderName: "Work Package" },
        },
        // 3 — Make (facet)
        {
            accessorKey: "make",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
            cell: ({ row }) => <div className="font-medium">{row.original.make || "--"}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome" as any,
            meta: { enableFacet: true, facetTitle: "Make", exportHeaderName: "Make" },
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
            meta: { enableFacet: true, facetTitle: "Status", exportHeaderName: "Status" },
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

    const searchableFields = useMemo(() => [
        { label: "Make", value: "make", default: true },
        { label: "TDS Item", value: "tds_item" },
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
        columnFilters,
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

    // Server-driven facets on real repo fields.
    const { facetOptions: wpFacetOptions, isLoading: isWPLoading } = useFacetValues({
        doctype: ENTRY_DOCTYPE,
        field: "work_package",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });
    const { facetOptions: makeFacetOptions, isLoading: isMakeLoading } = useFacetValues({
        doctype: ENTRY_DOCTYPE,
        field: "make",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });
    const { facetOptions: statusFacetOptions, isLoading: isStatusLoading } = useFacetValues({
        doctype: ENTRY_DOCTYPE,
        field: "status",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });

    const facetFilterOptions = useMemo(() => ({
        work_package: { title: "Work Package", options: wpFacetOptions, isLoading: isWPLoading },
        make: { title: "Make", options: makeFacetOptions, isLoading: isMakeLoading },
        status: { title: "Status", options: statusFacetOptions, isLoading: isStatusLoading },
        // Category facet is DERIVED from the linked TDS Item's members (category
        // is no longer a field on TDS Repository). It is informational here — the
        // column filter for it is not wired to a server column, so it is offered
        // as a derived option set for visibility.
        category: { title: "Category (members)", options: categoryFacetOptions, isLoading: false },
    }), [wpFacetOptions, isWPLoading, makeFacetOptions, isMakeLoading, statusFacetOptions, isStatusLoading, categoryFacetOptions]);

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
                facetFilterOptions={facetFilterOptions}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                searchFieldOptions={searchableFields}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
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
];

export const TDSRepositoryMaster: React.FC = () => {
    const { role } = useUserData();
    // useUserData maps the Administrator user_id to "Nirmaan Admin Profile",
    // so this single check also covers the Administrator user.
    const isAdmin = role === "Nirmaan Admin Profile";

    const [tab, setTab] = useStateSyncedWithParams<TabKey>("tab", "items");
    const activeTab: TabKey = tab === "entries" ? "entries" : "items";

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
            ) : (
                <TDSEntriesTab isAdmin={isAdmin} />
            )}
        </div>
    );
};

export default TDSRepositoryMaster;
