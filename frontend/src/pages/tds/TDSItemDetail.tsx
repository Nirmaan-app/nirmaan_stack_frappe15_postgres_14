// src/pages/tds/TDSItemDetail.tsx
//
// Detail page for a single TDS Item (the grouping doctype introduced by the
// 3-level TDS Repository restructure — backend doctype name "TDS Items").
// Admins can:
//   - view/edit the member Items SKUs of the group (multi-select staging dialog),
//   - manage its TDS Repository entries (one datasheet per Make),
//   - edit the TDS Item header (name + Work Package) via the shared edit dialog,
//   - delete the TDS Item (blocked while any entry references it).
//
// Phase-1 revamp: the body is a TABBED view (segmented control) splitting
// "Linked Item SKUs" and "Repository Entries" into two independent client-side
// TanStack tables, each with its own search / sort / faceted-filter toolbar.
// The inline EditEntryDialog + EntryStatusBadge + single-select member picker
// have been removed in favor of the shared EditTDSEntryDialog / StatusBadge /
// MultiAddMembersDialog components.
//
// Design source of truth:
//   nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md (T8) + CONTEXT.md
//
// Non-admins see a read-only view (no add/remove/edit/delete actions).

import React, { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    useFrappeGetDoc,
    useFrappeGetDocList,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
} from "frappe-react-sdk";
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import {
    ArrowLeft,
    Plus,
    Trash2,
    Pencil,
    Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { toast } from "@/components/ui/use-toast";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { fuzzyFilter } from "@/components/data-table/data-table-models";
import { useUserData } from "@/hooks/useUserData";
import { AddTDSEntryDialog } from "./components/AddTDSEntryDialog";
import { EditTDSItemDialog } from "./components/EditTDSItemDialog";
import { EditTDSEntryDialog } from "./components/EditTDSEntryDialog";
import { MultiAddMembersDialog } from "./components/MultiAddMembersDialog";
import { StatusBadge, AttachmentCell } from "./components/cells";
import { TDSItem, TDSItemMember } from "@/types/NirmaanStack/TDSItem";
import { TDSRepository } from "@/types/NirmaanStack/TDSRepository";

// ─── Small client-side table helper ──────────────────────────────────────────
// Both detail tables share this shell: a search Input + a faceted Status/Category
// filter on the left, an optional primary action button on the right, then a
// shadcn Table rendered from a TanStack `table` instance. Per-item sets are tiny,
// so everything is client-side (no useServerDataTable here).
interface ClientTableShellProps<TData> {
    table: import("@tanstack/react-table").Table<TData>;
    globalFilter: string;
    onGlobalFilterChange: (v: string) => void;
    searchPlaceholder: string;
    /** Column id to attach the faceted filter to (e.g. "category" / "status"). */
    facetColumnId: string;
    facetTitle: string;
    /** Primary right-aligned action (e.g. "Add Items"). */
    action?: React.ReactNode;
    emptyMessage: string;
    columnCount: number;
}

function ClientTableShell<TData>({
    table,
    globalFilter,
    onGlobalFilterChange,
    searchPlaceholder,
    facetColumnId,
    facetTitle,
    action,
    emptyMessage,
    columnCount,
}: ClientTableShellProps<TData>) {
    const facetColumn = table.getColumn(facetColumnId);
    const facetOptions = useMemo(() => {
        if (!facetColumn) return [];
        const values = Array.from(facetColumn.getFacetedUniqueValues().keys())
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .sort((a, b) => a.localeCompare(b));
        return values.map((v) => ({ label: v, value: v }));
    }, [facetColumn, facetColumn?.getFacetedUniqueValues()]);

    const rows = table.getRowModel().rows;

    return (
        <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-1 items-center gap-2">
                    <Input
                        value={globalFilter}
                        onChange={(e) => onGlobalFilterChange(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="h-9 max-w-xs bg-white border-gray-200"
                    />
                    {facetColumn && (
                        <DataTableFacetedFilter
                            column={facetColumn}
                            title={facetTitle}
                            options={facetOptions}
                        />
                    )}
                </div>
                {action}
            </div>

            {/* Table */}
            <div className="w-full overflow-x-auto border rounded-md">
                <Table>
                    <TableHeader className="bg-slate-50/70">
                        {table.getHeaderGroups().map((hg) => (
                            <TableRow key={hg.id} className="hover:bg-transparent">
                                {hg.headers.map((header) => (
                                    <TableHead
                                        key={header.id}
                                        className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider"
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext()
                                              )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell
                                    colSpan={columnCount}
                                    className="text-center py-8 text-gray-400 text-sm font-normal"
                                >
                                    {emptyMessage}
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    className="border-b border-gray-100 hover:bg-slate-50/50"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="px-4 py-2.5 font-normal">
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

// ─── Main detail page ─────────────────────────────────────────────────────────
export const TDSItemDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const { user_id, role } = useUserData();
    const isAdmin = role === "Nirmaan Admin Profile" || user_id === "Administrator";

    // ---- Fetch the TDS Item (group) ----
    const {
        data: doc,
        isLoading: isDocLoading,
        error: docError,
        mutate: mutateDoc,
    } = useFrappeGetDoc<TDSItem>("TDS Items", id, id ? undefined : null);

    // ---- Fetch its TDS Repository entries (one per Make) ----
    const {
        data: entries,
        isLoading: isEntriesLoading,
        mutate: mutateEntries,
    } = useFrappeGetDocList<TDSRepository>(
        "TDS Repository",
        {
            filters: [["tds_item", "=", id ?? ""]],
            fields: ["name", "make", "status", "tds_attachment", "description"],
            limit: 0,
        },
        id ? undefined : null
    );

    const members: TDSItemMember[] = doc?.members || [];
    const memberCount = members.length;
    const entryCount = entries?.length ?? 0;
    const isCustom = memberCount === 0;

    // ---- Mutations ----
    const { updateDoc, loading: savingMembers } = useFrappeUpdateDoc();
    const { deleteDoc, loading: deletingEntry } = useFrappeDeleteDoc();
    const { deleteDoc: deleteTdsItem, loading: deletingItem } = useFrappeDeleteDoc();

    // ---- UI state ----
    const [activeTab, setActiveTab] = useState<"members" | "entries">("members");
    const [isEditItemOpen, setIsEditItemOpen] = useState(false);
    const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
    const [isAddEntryOpen, setIsAddEntryOpen] = useState(false);
    const [editEntry, setEditEntry] = useState<TDSRepository | null>(null);
    const [deleteEntryTarget, setDeleteEntryTarget] = useState<TDSRepository | null>(null);
    const [isDeleteItemOpen, setIsDeleteItemOpen] = useState(false);

    // Independent table state (search + sort + facet) per tab.
    const [membersGlobalFilter, setMembersGlobalFilter] = useState("");
    const [membersSorting, setMembersSorting] = useState<SortingState>([]);
    const [membersColumnFilters, setMembersColumnFilters] = useState<ColumnFiltersState>([]);

    const [entriesGlobalFilter, setEntriesGlobalFilter] = useState("");
    const [entriesSorting, setEntriesSorting] = useState<SortingState>([]);
    const [entriesColumnFilters, setEntriesColumnFilters] = useState<ColumnFiltersState>([]);

    // ---- Member persistence ----
    // Persist members by sending the FULL list of {item} rows. Sending only the
    // item link is enough — item_name/category are fetched server-side from the
    // Items master (fetch_from on the TDS Items Child Table).
    const persistMembers = async (nextItems: string[]) => {
        if (!id) return;
        try {
            await updateDoc("TDS Items", id, {
                members: nextItems.map((item) => ({ item })),
            });
            mutateDoc();
        } catch (e: any) {
            console.error("Error updating members:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to update members",
                variant: "destructive",
            });
        }
    };

    const handleRemoveMember = async (item: string) => {
        const next = members.map((m) => m.item).filter((i) => i !== item);
        await persistMembers(next);
        toast({ title: "Member removed", variant: "success" });
    };

    const handleDeleteEntry = async () => {
        if (!deleteEntryTarget) return;
        try {
            await deleteDoc("TDS Repository", deleteEntryTarget.name);
            toast({ title: "Success", description: "Entry deleted successfully", variant: "success" });
            mutateEntries();
        } catch (e: any) {
            console.error("Error deleting entry:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to delete entry",
                variant: "destructive",
            });
        } finally {
            setDeleteEntryTarget(null);
        }
    };

    const handleDeleteTdsItem = async () => {
        if (!id) return;
        try {
            await deleteTdsItem("TDS Items", id);
            toast({ title: "Success", description: "TDS Item deleted successfully", variant: "success" });
            navigate("/tds-repository");
        } catch (e: any) {
            console.error("Error deleting TDS Item:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to delete TDS Item",
                variant: "destructive",
            });
            setIsDeleteItemOpen(false);
        }
    };

    // ---- Members table (client-side) ----
    const memberColumns = useMemo<ColumnDef<TDSItemMember>[]>(() => {
        const cols: ColumnDef<TDSItemMember>[] = [
            {
                accessorKey: "item",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Item Code" />,
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-slate-600">{row.original.item}</span>
                ),
            },
            {
                accessorKey: "item_name",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
                cell: ({ row }) => (
                    <span className="text-slate-800 font-medium">{row.original.item_name || "--"}</span>
                ),
            },
            {
                accessorKey: "category",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
                cell: ({ row }) => (
                    <span className="text-slate-600">{row.original.category || "--"}</span>
                ),
                enableColumnFilter: true,
                filterFn: (row, columnId, filterValue) =>
                    Array.isArray(filterValue)
                        ? filterValue.includes(row.getValue(columnId))
                        : true,
            },
        ];
        if (isAdmin) {
            cols.push({
                id: "actions",
                header: () => <span>Actions</span>,
                enableSorting: false,
                enableColumnFilter: false,
                cell: ({ row }) => (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-500 hover:text-red-600"
                        disabled={savingMembers}
                        onClick={() => handleRemoveMember(row.original.item)}
                        title="Remove member"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                ),
            });
        }
        return cols;
        // handleRemoveMember closes over `members`; recompute when members change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, savingMembers, members]);

    const membersTable = useReactTable({
        data: members,
        columns: memberColumns,
        state: {
            globalFilter: membersGlobalFilter,
            sorting: membersSorting,
            columnFilters: membersColumnFilters,
        },
        onGlobalFilterChange: setMembersGlobalFilter,
        onSortingChange: setMembersSorting,
        onColumnFiltersChange: setMembersColumnFilters,
        globalFilterFn: fuzzyFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        getRowId: (row) => row.item,
    });

    // ---- Entries table (client-side) ----
    const entryColumns = useMemo<ColumnDef<TDSRepository>[]>(() => {
        const cols: ColumnDef<TDSRepository>[] = [
            {
                accessorKey: "make",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
                cell: ({ row }) => (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {row.original.make}
                    </span>
                ),
            },
            {
                accessorKey: "status",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => <StatusBadge status={row.original.status} />,
                enableColumnFilter: true,
                filterFn: (row, columnId, filterValue) =>
                    Array.isArray(filterValue)
                        ? filterValue.includes(row.getValue(columnId))
                        : true,
            },
            {
                accessorKey: "description",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
                cell: ({ row }) => (
                    <div className="truncate max-w-[260px] text-slate-500" title={row.original.description}>
                        {row.original.description || "--"}
                    </div>
                ),
            },
            {
                accessorKey: "tds_attachment",
                header: () => <span>Datasheet</span>,
                enableSorting: false,
                cell: ({ row }) => <AttachmentCell url={row.original.tds_attachment} />,
            },
        ];
        if (isAdmin) {
            cols.push({
                id: "actions",
                header: () => <span>Actions</span>,
                enableSorting: false,
                enableColumnFilter: false,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-600 hover:text-blue-600"
                            onClick={() => setEditEntry(row.original)}
                            title="Edit entry"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-600 hover:text-red-600"
                            onClick={() => setDeleteEntryTarget(row.original)}
                            title="Delete entry"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            });
        }
        return cols;
    }, [isAdmin]);

    const entriesTable = useReactTable({
        data: entries || [],
        columns: entryColumns,
        state: {
            globalFilter: entriesGlobalFilter,
            sorting: entriesSorting,
            columnFilters: entriesColumnFilters,
        },
        onGlobalFilterChange: setEntriesGlobalFilter,
        onSortingChange: setEntriesSorting,
        onColumnFiltersChange: setEntriesColumnFilters,
        // Search across make + description only.
        globalFilterFn: (row, _columnId, filterValue) => {
            const q = String(filterValue || "").toLowerCase().trim();
            if (!q) return true;
            const make = (row.original.make || "").toLowerCase();
            const desc = (row.original.description || "").toLowerCase();
            return make.includes(q) || desc.includes(q);
        },
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        getRowId: (row) => row.name,
    });

    // ---- Render ----
    if (isDocLoading) {
        return (
            <div className="flex-1 space-y-6 p-4 md:p-6">
                <Skeleton className="h-10 w-40" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (docError || !doc) {
        return (
            <div className="flex-1 space-y-4 p-4 md:p-6">
                <Button variant="ghost" onClick={() => navigate("/tds-repository")} className="gap-2">
                    <ArrowLeft className="h-4 w-4" /> Back to TDS Repository
                </Button>
                <div className="rounded-md border border-rose-200 bg-rose-50 p-6 text-center text-rose-700">
                    {docError ? "Failed to load TDS Item." : "TDS Item not found."}
                </div>
            </div>
        );
    }

    const deleteBlocked = entryCount > 0;
    const memberColumnCount = memberColumns.length;
    const entryColumnCount = entryColumns.length;

    return (
        <div className="flex-1 space-y-6 p-4 md:p-6">
            {/* Back */}
            <Button
                variant="ghost"
                onClick={() => navigate("/tds-repository")}
                className="gap-2 text-slate-600 hover:text-slate-900 -ml-2"
            >
                <ArrowLeft className="h-4 w-4" /> Back to TDS Repository
            </Button>

            {/* ---- Header ---- */}
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                            <CardTitle className="text-2xl font-bold tracking-tight text-gray-800 flex items-center gap-2">
                                <Layers className="h-5 w-5 text-slate-400" />
                                {doc.tds_item_name}
                            </CardTitle>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                                <Badge variant="outline" className="font-medium">{doc.work_package}</Badge>
                                <span className="text-slate-300">•</span>
                                <span className="font-mono text-xs">{doc.name}</span>
                                {isCustom && (
                                    <>
                                        <span className="text-slate-300">•</span>
                                        <Badge className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 border-0">
                                            Custom item
                                        </Badge>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Header actions (admin) */}
                        {isAdmin && (
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="outline"
                                    className="gap-2"
                                    onClick={() => setIsEditItemOpen(true)}
                                >
                                    <Pencil className="h-4 w-4" /> Edit
                                </Button>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            {/* span wrapper so the tooltip shows even while the button is disabled */}
                                            <span tabIndex={deleteBlocked ? 0 : undefined}>
                                                <Button
                                                    variant="outline"
                                                    className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                    disabled={deleteBlocked}
                                                    onClick={() => setIsDeleteItemOpen(true)}
                                                >
                                                    <Trash2 className="h-4 w-4" /> Delete TDS Item
                                                </Button>
                                            </span>
                                        </TooltipTrigger>
                                        {deleteBlocked && (
                                            <TooltipContent>
                                                <p>Remove all entries first.</p>
                                            </TooltipContent>
                                        )}
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-6 text-sm">
                        <div>
                            <div className="text-xs uppercase tracking-wide text-slate-400">Members</div>
                            <div className="text-lg font-semibold text-slate-800">{memberCount}</div>
                        </div>
                        <div>
                            <div className="text-xs uppercase tracking-wide text-slate-400">Entries</div>
                            <div className="text-lg font-semibold text-slate-800">{entryCount}</div>
                        </div>
                    </div>
                    {isCustom && (
                        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded p-2">
                            This is a custom item — it has no member Items SKUs (Work Package + label only).
                            Adding members converts it into a normal group.
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* ---- Tab toggle (segmented control) ---- */}
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                <button
                    type="button"
                    onClick={() => setActiveTab("members")}
                    className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        activeTab === "members"
                            ? "bg-[#dc2626] text-white shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                    Linked Item SKUs ({memberCount})
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("entries")}
                    className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        activeTab === "entries"
                            ? "bg-[#dc2626] text-white shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                    Repository Entries ({entryCount})
                </button>
            </div>

            {/* ---- Tab A: Linked Item SKUs ---- */}
            {activeTab === "members" && (
                <Card>
                    <CardContent className="pt-6">
                        <ClientTableShell
                            table={membersTable}
                            globalFilter={membersGlobalFilter}
                            onGlobalFilterChange={setMembersGlobalFilter}
                            searchPlaceholder="Search items..."
                            facetColumnId="category"
                            facetTitle="Category"
                            columnCount={memberColumnCount}
                            emptyMessage="No member items — this is a custom item."
                            action={
                                isAdmin ? (
                                    <Button
                                        onClick={() => setIsAddMembersOpen(true)}
                                        className="gap-2 bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                                        size="sm"
                                    >
                                        <Plus className="h-4 w-4" /> Add Items
                                    </Button>
                                ) : undefined
                            }
                        />
                    </CardContent>
                </Card>
            )}

            {/* ---- Tab B: Repository Entries ---- */}
            {activeTab === "entries" && (
                <Card>
                    <CardContent className="pt-6">
                        {isEntriesLoading ? (
                            <div className="space-y-2">
                                <Skeleton className="h-9 w-full max-w-xs" />
                                <Skeleton className="h-48 w-full" />
                            </div>
                        ) : (
                            <ClientTableShell
                                table={entriesTable}
                                globalFilter={entriesGlobalFilter}
                                onGlobalFilterChange={setEntriesGlobalFilter}
                                searchPlaceholder="Search make or description..."
                                facetColumnId="status"
                                facetTitle="Status"
                                columnCount={entryColumnCount}
                                emptyMessage="No entries yet."
                                action={
                                    isAdmin ? (
                                        <Button
                                            onClick={() => setIsAddEntryOpen(true)}
                                            className="gap-2 bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                                            size="sm"
                                        >
                                            <Plus className="h-4 w-4" /> Add Repository Entry
                                        </Button>
                                    ) : undefined
                                }
                            />
                        )}
                    </CardContent>
                </Card>
            )}

            <Separator />

            {/* ---- Dialogs (admin) ---- */}
            {isAdmin && (
                <>
                    <EditTDSItemDialog
                        open={isEditItemOpen}
                        onOpenChange={setIsEditItemOpen}
                        tdsItem={{
                            name: doc.name,
                            tds_item_name: doc.tds_item_name,
                            work_package: doc.work_package,
                            description: doc.description,
                        }}
                        onSaved={() => mutateDoc()}
                    />

                    <MultiAddMembersDialog
                        open={isAddMembersOpen}
                        onOpenChange={setIsAddMembersOpen}
                        workPackage={doc.work_package}
                        existingItems={members.map((m) => m.item)}
                        onCommit={async (newIds) => {
                            await persistMembers([...members.map((m) => m.item), ...newIds]);
                            toast({ title: "Members added", variant: "success" });
                        }}
                    />

                    <AddTDSEntryDialog
                        open={isAddEntryOpen}
                        onOpenChange={setIsAddEntryOpen}
                        presetTdsItem={id}
                        onCreated={() => mutateEntries()}
                    />

                    <EditTDSEntryDialog
                        open={!!editEntry}
                        onOpenChange={(open) => !open && setEditEntry(null)}
                        entry={editEntry}
                        takenMakes={
                            // makes taken by OTHER entries (exclude the one being edited)
                            new Set(
                                (entries || [])
                                    .filter((e) => e.name !== editEntry?.name)
                                    .map((e) => e.make)
                            )
                        }
                        onSaved={() => {
                            mutateEntries();
                            setEditEntry(null);
                        }}
                    />

                    {/* Delete entry confirm */}
                    <AlertDialog
                        open={!!deleteEntryTarget}
                        onOpenChange={(open) => !open && setDeleteEntryTarget(null)}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete entry?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete the
                                    {deleteEntryTarget?.make ? ` "${deleteEntryTarget.make}"` : ""} datasheet entry.
                                    This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={handleDeleteEntry}
                                    className="bg-red-600 hover:bg-red-700"
                                >
                                    {deletingEntry ? "Deleting..." : "Delete"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    {/* Delete TDS Item confirm */}
                    <AlertDialog open={isDeleteItemOpen} onOpenChange={setIsDeleteItemOpen}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete TDS Item?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete the TDS Item "{doc.tds_item_name}" ({doc.name}).
                                    This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={handleDeleteTdsItem}
                                    className="bg-red-600 hover:bg-red-700"
                                >
                                    {deletingItem ? "Deleting..." : "Delete"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            )}
        </div>
    );
};

export default TDSItemDetail;
