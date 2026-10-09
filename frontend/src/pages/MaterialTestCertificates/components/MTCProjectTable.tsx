import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";

import { MTCItemsCell } from "./MTCItemsCell";
import { poLinkFor, shortPOName } from "../mtcLinks";

type MTCRow = MaterialTestCertificate & { vendor_label: string };

const SEARCH_FIELDS = [
  { value: "procurement_order", label: "PO No.", placeholder: "Search by PO number…", default: true },
  { value: "items", label: "Item", placeholder: "Search by item or make…" },
];

/** Every word must appear in the chosen field: the PO number, or the item names and makes. */
const matchesSearch = (mtc: MaterialTestCertificate, field: string, term: string) => {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = (
    field === "items"
      ? mtc.items.flatMap((i) => [i.item_name, i.item_id, i.make])
      : [mtc.procurement_order, shortPOName(mtc.procurement_order)]
  )
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
};

/** Facet options with counts, e.g. "ABC Traders (3)", sorted by label. */
const facetOptions = (values: { value: string; label: string }[]) => {
  const counts = new Map<string, { label: string; n: number }>();
  for (const v of values) {
    const prev = counts.get(v.value);
    counts.set(v.value, { label: v.label, n: (prev?.n ?? 0) + 1 });
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label))
    .map(([value, { label, n }]) => ({ value, label: `${label} (${n})` }));
};

interface MTCProjectTableProps {
  mtcs: MaterialTestCertificate[];
  getUserName: (id?: string) => string;
  isLoading?: boolean;
}

/**
 * The MTC list page table (PM / PL), on the app's standard DataTable:
 *   PO No. · Vendor (facet) · Items · Certificate Date (date filter) · Uploaded By (facet) · MTC Attachment
 * One project's MTCs are already loaded, so search, filters, sorting and paging all run in the browser.
 * MTC ids are never shown to users (owner).
 */
export const MTCProjectTable = ({ mtcs, getUserName, isLoading = false }: MTCProjectTableProps) => {
  const [searchField, setSearchField] = useState(SEARCH_FIELDS[0].value);
  const [searchTerm, setSearchTerm] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "certificate_date", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

  const data = useMemo<MTCRow[]>(
    () =>
      mtcs
        .filter((m) => matchesSearch(m, searchField, searchTerm))
        .map((m) => ({ ...m, vendor_label: m.vendor_name || m.vendor || "-" })),
    [mtcs, searchField, searchTerm]
  );

  // Filter options come from the whole project, not the search-narrowed rows.
  const facetFilterOptions = useMemo(
    () => ({
      vendor_label: {
        title: "Vendor",
        options: facetOptions(
          mtcs.map((m) => {
            const v = m.vendor_name || m.vendor || "-";
            return { value: v, label: v };
          })
        ),
      },
      owner: {
        title: "Uploaded By",
        options: facetOptions(mtcs.map((m) => ({ value: m.owner, label: getUserName(m.owner) }))),
      },
    }),
    [mtcs, getUserName]
  );

  const columns = useMemo<ColumnDef<MTCRow>[]>(
    () => [
      {
        id: "procurement_order",
        accessorKey: "procurement_order",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO No." />,
        sortingFn: (a, b) =>
          a.original.procurement_order.localeCompare(b.original.procurement_order, undefined, { numeric: true }),
        cell: ({ row }) => {
          const link = poLinkFor(row.original);
          const label = shortPOName(row.original.procurement_order);
          return link ? (
            <Link to={link} className="font-medium text-blue-600 underline hover:text-blue-800">
              {label}
            </Link>
          ) : (
            <span className="font-medium">{label}</span>
          );
        },
        size: 110,
      },
      {
        id: "vendor_label",
        accessorKey: "vendor_label",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        filterFn: facetedFilterFn,
        cell: ({ row }) => (
          <div className="max-w-[240px] truncate" title={row.original.vendor_label}>
            {row.original.vendor_label}
          </div>
        ),
        size: 220,
      },
      {
        id: "items",
        accessorFn: (r) => r.items.map((i) => i.item_name || i.item_id).join(", "),
        header: () => <span>Items</span>,
        enableSorting: false,
        cell: ({ row }) => <MTCItemsCell items={row.original.items} variant="list" />,
        size: 360,
      },
      {
        id: "certificate_date",
        accessorFn: (r) => r.certificate_date ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Certificate Date" />,
        filterFn: dateFilterFn,
        cell: ({ row }) => (row.original.certificate_date ? formatDate(row.original.certificate_date) : "—"),
        size: 150,
      },
      {
        id: "owner",
        accessorKey: "owner",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Uploaded By" />,
        filterFn: facetedFilterFn,
        sortingFn: (a, b) => getUserName(a.original.owner).localeCompare(getUserName(b.original.owner)),
        cell: ({ row }) => getUserName(row.original.owner),
        size: 160,
      },
      {
        id: "attachment",
        header: () => <span>MTC Attachment</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800" asChild>
            <a
              href={`${SITEURL}${row.original.attachment}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="View the MTC attachment"
            >
              <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
              View
            </a>
          </Button>
        ),
        meta: { excludeFromExport: true },
        size: 140,
      },
    ],
    [getUserName]
  );

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.name,
    state: { sorting, columnFilters, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const filtered = table.getFilteredRowModel().rows.map((r) => r.original);
  const summary = {
    certificates: filtered.length,
    pos: new Set(filtered.map((m) => m.procurement_order)).size,
    items: filtered.reduce((sum, m) => sum + m.items.length, 0),
  };

  return (
    <DataTable<MTCRow>
      table={table}
      columns={columns}
      isLoading={isLoading}
      totalCount={filtered.length}
      searchFieldOptions={SEARCH_FIELDS}
      selectedSearchField={searchField}
      onSelectedSearchFieldChange={(v) => {
        setSearchField(v);
        setPagination((p) => ({ ...p, pageIndex: 0 }));
      }}
      searchTerm={searchTerm}
      onSearchTermChange={(v) => {
        setSearchTerm(v);
        setPagination((p) => ({ ...p, pageIndex: 0 }));
      }}
      facetFilterOptions={facetFilterOptions}
      dateFilterColumns={["certificate_date"]}
      showExportButton={false}
      enableVirtualization={false}
      summaryCard={
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{summary.certificates}</span> certificate
          {summary.certificates === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold text-foreground">{summary.pos}</span> PO{summary.pos === 1 ? "" : "s"} ·{" "}
          <span className="font-semibold text-foreground">{summary.items}</span> item
          {summary.items === 1 ? "" : "s"}
        </p>
      }
    />
  );
};
