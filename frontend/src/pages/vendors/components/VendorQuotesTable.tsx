import React, { useMemo } from "react";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatDate } from "@/utils/FormatDate";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFacetValues } from "@/hooks/useFacetValues";

interface VendorQuotesTableProps {
  vendorId: string;
}

interface User {
  name: string;
  full_name: string;
}

export const VendorQuotesTable: React.FC<VendorQuotesTableProps> = ({ vendorId }) => {
  // Fetch projects for name lookup
  const { data: projectsData, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
    "Projects",
    {
      fields: ["name", "project_name"],
      limit: 0
    },
    "projects_lookup_for_vendor_quotes"
  );

  // Fetch users for 'Created By' lookup
  const { data: usersData, isLoading: usersLoading } = useFrappeGetDocList<User>(
    "User",
    {
      fields: ["name", "full_name"],
      limit: 0
    },
    "users_lookup_for_vendor_quotes"
  );

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projectsData?.forEach(p => map.set(p.name, p.project_name));
    return map;
  }, [projectsData]);

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    usersData?.forEach(u => map.set(u.name, u.full_name));
    return map;
  }, [usersData]);

  const staticFilters = useMemo(() => {
    if (!vendorId) return [];
    return [
      ["attachment_link_docname", "=", vendorId],
      ["attachment_type", "=", "Vendor Quote"],
      ["associated_doctype", "=", "Procurement Requests"]
    ];
  }, [vendorId]);

  const fetchFields = useMemo(
    () => [
      "name",
      "attachment",
      "creation",
      "associated_docname",
      "project",
      "owner",
      "attachment_type"
    ],
    []
  );

  const searchableFields = useMemo(
    () => [
      {
        value: "associated_docname",
        label: "PR ID",
        placeholder: "Search by PR ID...",
        default: true,
      },
      {
        value: "project",
        label: "Project",
        placeholder: "Search by Project ID...",
      }
    ],
    []
  );

  const columns = useMemo<ColumnDef<NirmaanAttachment>[]>(
    () => [
      {
        accessorKey: "owner",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created By" />
        ),
        cell: ({ row }) => {
          const ownerId = row.getValue<string>("owner");
          return (
            <div className="font-medium text-xs truncate max-w-[150px]" title={userMap.get(ownerId) || ownerId}>
              {userMap.get(ownerId) || ownerId || "--"}
            </div>
          );
        },
        size: 150,
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Date Uploaded" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap text-xs text-muted-foreground ">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 150,
      },
      {
        accessorKey: "associated_docname",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PR ID" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-xs whitespace-nowrap">
            {row.getValue("associated_docname")}
          </div>
        ),
        size: 180,
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const projectId = row.getValue<string>("project");
          return (
            <div className="font-medium text-xs truncate max-w-[200px]" title={projectMap.get(projectId) || projectId}>
              {projectMap.get(projectId) || projectId || "--"}
            </div>
          );
        },
        size: 200,
      },

      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const url = row.original.attachment;
          if (!url) return null;
          const fileName = url.split("/").pop();
          
          return (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-blue-700  border-blue-200 shadow-sm hover:bg-blue-100 hover:text-blue-800 hover:border-blue-300 transition-colors"
                onClick={() => window.open(`${SITEURL}${url}`, "_blank")}
                title={`View ${fileName}`}
              >
                <Eye className="mr-1 h-3.5 w-3.5" /> View
              </Button>
            </div>
          );
        },
        size: 100,
      },
    ],
    [projectMap, userMap]
  );

  const {
    table,
    totalCount,
    isLoading: tableLoading,
    error: tableError,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    columnFilters,
  } = useServerDataTable<NirmaanAttachment>({
    doctype: "Nirmaan Attachments",
    columns: columns,
    fetchFields: fetchFields,
    searchableFields: searchableFields,
    defaultSort: "creation desc",
    urlSyncKey: "vendor_attachments_list",
    enableRowSelection: false,
    additionalFilters: staticFilters,
  });

  // --- Dynamic Facet Values ---
  const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } =
    useFacetValues({
      doctype: "Nirmaan Attachments",
      field: "project",
      currentFilters: columnFilters,
      searchTerm: searchTerm,
      selectedSearchField: selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  const { facetOptions: ownerFacetOptions, isLoading: isOwnerFacetLoading } =
    useFacetValues({
      doctype: "Nirmaan Attachments",
      field: "owner",
      currentFilters: columnFilters,
      searchTerm: searchTerm,
      selectedSearchField: selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  const { facetOptions: prFacetOptions, isLoading: isPrFacetLoading } =
    useFacetValues({
      doctype: "Nirmaan Attachments",
      field: "associated_docname",
      currentFilters: columnFilters,
      searchTerm: searchTerm,
      selectedSearchField: selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions.map(opt => {
          // Parse "ProjectID (count)" from the default hook's label
          const match = opt.label.match(/(.*) \((\d+)\)$/);
          if (match) {
            const projectId = match[1];
            const count = match[2];
            return {
              ...opt,
              label: `${projectMap.get(projectId) || projectId} (${count})`
            };
          }
          return {
            ...opt,
            label: projectMap.get(opt.value) || opt.label
          };
        }),
        isLoading: isProjectFacetLoading || projectsLoading,
      },
      owner: {
        title: "Created By",
        options: ownerFacetOptions.map(opt => {
          const match = opt.label.match(/(.*) \((\d+)\)$/);
          if (match) {
            const userId = match[1];
            const count = match[2];
            return {
              ...opt,
              label: `${userMap.get(userId) || userId} (${count})`
            };
          }
          return {
            ...opt,
            label: userMap.get(opt.value) || opt.label
          };
        }),
        isLoading: isOwnerFacetLoading || usersLoading,
      },
      associated_docname: {
        title: "PR ID",
        options: prFacetOptions,
        isLoading: isPrFacetLoading,
      }
    }),
    [projectFacetOptions, isProjectFacetLoading, projectsLoading, projectMap, ownerFacetOptions, isOwnerFacetLoading, usersLoading, userMap, prFacetOptions, isPrFacetLoading]
  );

  if (tableError) return <AlertDestructive error={tableError} />;

  return (
    <DataTable<NirmaanAttachment>
      table={table}
      columns={columns}
      isLoading={tableLoading || projectsLoading || usersLoading}
      totalCount={totalCount}
      searchFieldOptions={searchableFields}
      selectedSearchField={selectedSearchField}
      onSelectedSearchFieldChange={setSelectedSearchField}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      dateFilterColumns={["creation"]}
      facetFilterOptions={facetFilterOptions}
      showExportButton={true}
      onExport={"default"}
    />
  );
};

export default VendorQuotesTable;

