import React, { useCallback, useMemo } from "react";
import { ColumnDef, Row as TanRow } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { formatDate } from "@/utils/FormatDate";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useFrappeGetDocList } from "frappe-react-sdk";

interface VendorDeliveryNotesTableProps {
  vendorId: string;
  vendorName: string;
}

const DN_TABLE_FIELDS: (keyof DeliveryNote | "name")[] = [
  "name",
  "procurement_order",
  "project",
  "vendor",
  "note_no",
  "delivery_date",
  "updated_by_user",
  "is_return",
  "creation",
];

const DN_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  { value: "name", label: "DN ID", default: true },
  { value: "procurement_order", label: "PO ID" },
  { value: "project", label: "Project" },
];

export const VendorDeliveryNotesTable: React.FC<VendorDeliveryNotesTableProps> = ({
  vendorId,
  vendorName,
}) => {
  // --- Static Filters ---
  const staticFilters = useMemo(
    () => [["vendor", "=", vendorId]],
    [vendorId]
  );

  // Fetch users for name lookup
  const { data: usersData } = useFrappeGetDocList<{ name: string; full_name: string }>(
    "User",
    { fields: ["name", "full_name"], limit: 0 },
    "users_lookup_for_vendor_dn"
  );

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    usersData?.forEach(u => map.set(u.name, u.full_name));
    return map;
  }, [usersData]);

  // Fetch projects for name lookup
  const { data: projectsData } = useFrappeGetDocList<Projects>(
    "Projects",
    { fields: ["name", "project_name"], limit: 0 },
    "projects_lookup_for_vendor_dn"
  );

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projectsData?.forEach(p => map.set(p.name, p.project_name));
    return map;
  }, [projectsData]);

  // --- Dynamic Facet Values ---
  const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } =
    useFacetValues({
      doctype: "Delivery Notes",
      field: "project",
      currentFilters: [],
      searchTerm: "",
      selectedSearchField: "name",
      additionalFilters: staticFilters,
      enabled: true,
    });

  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      },
    }),
    [projectFacetOptions, isProjectFacetLoading]
  );

  // --- Columns ---
  const columns = useMemo<ColumnDef<DeliveryNote>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="DN ID" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm">{row.original.name}</div>
        ),
        size: 150,
      },
      {
        accessorKey: "procurement_order",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO ID" />
        ),
        cell: ({ row }) => {
          const poId = row.original.procurement_order;
          return (
            <div className="flex items-center gap-1.5">
              <Link
                className="text-blue-600 hover:underline font-medium text-sm"
                to={`${poId.replace(/\//g, "&=")}`}
              >
                {poId}
              </Link>
              <ItemsHoverCard
                parentDoc={row.original}
                parentDoctype="Delivery Notes"
                childTableName="items"
              />
            </div>
          );
        },
        size: 200,
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const projectId = row.original.project;
          const projectName = projectMap.get(projectId) || projectId;
          return (
            <div className="truncate max-w-[180px]" title={projectName}>
              {projectName}
            </div>
          );
        },
        size: 180,
        enableColumnFilter: true,
        meta: {
          exportHeaderName: "Project",
          exportValue: (row: DeliveryNote) =>
            projectMap.get(row.project) || row.project || "--",
        },
      },
      {
        accessorKey: "note_no",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Note #" />
        ),
        cell: ({ row }) => (
          <div className="text-center font-medium">
            {row.original.note_no}
          </div>
        ),
        size: 80,
      },
      {
        accessorKey: "delivery_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Delivery Date" />
        ),
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {row.original.delivery_date
              ? formatDate(row.original.delivery_date)
              : "--"}
          </div>
        ),
        size: 130,
        meta: {
          exportHeaderName: "Delivery Date",
          exportValue: (row: DeliveryNote) =>
            row.delivery_date ? formatDate(row.delivery_date) : "--",
        },
      },

      {
        accessorKey: "updated_by_user",
        header: "Updated By",
        cell: ({ row }) => {
          const email = row.original.updated_by_user;
          const displayName = userMap.get(email || "") || email || "--";
          return (
            <div className="text-sm text-muted-foreground truncate max-w-[140px]" title={displayName}>
              {displayName}
            </div>
          );
        },
        size: 140,
        meta: {
          exportHeaderName: "Updated By",
          exportValue: (row: DeliveryNote) =>
            userMap.get(row.updated_by_user || "") || row.updated_by_user || "--",
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created On" />
        ),
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {formatDate(row.original.creation)}
          </div>
        ),
        size: 150,
      },
    ],
    [userMap, projectMap]
  );

  // --- Server Data Table Hook ---
  const {
    table,
    isLoading: tableLoading,
    error: tableError,
    totalCount,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<DeliveryNote>({
    doctype: "Delivery Notes",
    columns: columns,
    fetchFields: DN_TABLE_FIELDS as string[],
    searchableFields: DN_SEARCHABLE_FIELDS,
    urlSyncKey: `vendor_dn_list_${vendorId}`,
    additionalFilters: staticFilters,
  });

  // --- Row styling for return notes ---
  const getRowClassName = useCallback(
    (row: TanRow<DeliveryNote>) =>
      row.original.is_return ? "bg-red-50 hover:bg-red-100" : undefined,
    []
  );

  if (tableError) return <AlertDestructive error={tableError} />;

  return (
    <DataTable<DeliveryNote>
      table={table}
      columns={columns}
      isLoading={tableLoading}
      totalCount={totalCount}
      searchFieldOptions={DN_SEARCHABLE_FIELDS}
      selectedSearchField={selectedSearchField}
      onSelectedSearchFieldChange={setSelectedSearchField}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      facetFilterOptions={facetFilterOptions}
      dateFilterColumns={["delivery_date", "creation"]}
      showExportButton={true}
      onExport={"default"}
      exportFileName={`${vendorName}_Delivery_Notes`}
      getRowClassName={getRowClassName}
    />
  );
};

export default VendorDeliveryNotesTable;
