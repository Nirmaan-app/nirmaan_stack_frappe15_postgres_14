import React, { useMemo, useRef, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate } from "react-router-dom";
import { FilePenLine, MoreHorizontal, Trash2 } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { PROJECT_STATUS_BADGE_CLASSES } from "@/components/common/projectStatus";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import {
  PROJECT_SEARCHABLE_FIELDS,
  PROJECT_DATE_COLUMNS,
  getTenderingStaticFilters,
} from "@/pages/projects/config/projectTable.config";
import { canManageTendering } from "./tenderingAuth";
import { useDeleteTenderingProject } from "./hooks/useTenderingMutations";

const DOCTYPE = "Projects";

// Slim set of fields for the Tendering tab — only the four stub fields + name/creation.
const TENDERING_FIELDS_TO_FETCH: (keyof ProjectsType | "name")[] = [
  "name",
  "project_name",
  "project_city",
  "project_state",
  "customer",
  "status",
  "creation",
];

interface TenderingProjectsTableProps {
  customerId?: string;
  urlContext?: string;
}

/**
 * Per-row Edit / Delete actions for a Tendering stub.
 *
 * Edit navigates to the stub's lightweight detail view (which hosts the inline
 * minimal editor) — the full edit-project form is never used for a stub.
 * Delete calls `delete_tendering_project` (backend enforces "must be
 * Tendering") behind a confirmation dialog. Both are gated to Admin / PMO /
 * Administrator. Convert is intentionally omitted (Slice 7).
 */
const TenderingRowActions: React.FC<{
  project: ProjectsType;
  onDeleted: () => void;
}> = ({ project, onDeleted }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { deleteTenderingProject, loading: deleting } =
    useDeleteTenderingProject();

  const handleDelete = async () => {
    try {
      const response = await deleteTenderingProject(project.name);
      if (response.message.status !== 200) {
        throw new Error(
          response.message.error || "Failed to delete tendering project"
        );
      }
      toast({
        title: "Deleted",
        description: (
          <>
            Tendering Project:{" "}
            <strong className="text-[14px]">
              {project.project_name || project.name}
            </strong>{" "}
            deleted successfully!
          </>
        ),
        variant: "success",
      });
      setConfirmOpen(false);
      onDeleted();
    } catch (err: any) {
      toast({
        title: "Failed!",
        description: err?.message || "Error while deleting tendering project!",
        variant: "destructive",
      });
      console.error("Error while deleting tendering project:", err);
    }
  };

  return (
    <div className="flex justify-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open actions</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => navigate(`/projects/${project.name}`)}>
            <FilePenLine className="h-4 w-4 mr-2" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Tendering project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the prospect stub{" "}
              <strong>{project.project_name || project.name}</strong>. A
              Tendering stub has no operational data, so nothing else is
              affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/**
 * Slim Tendering-stub list for the "Tendering" tab on the Projects page.
 *
 * Shows only Name / City / State / Customer (+ a Tendering badge). Convert and
 * Edit actions are intentionally deferred to Slice 3. This table is filtered
 * to `status = "Tendering"` and is the ONLY surface that shows stubs.
 */
export const TenderingProjectsTable: React.FC<TenderingProjectsTableProps> = ({
  customerId,
  urlContext = "main",
}) => {
  const { role, user_id } = useUserData();
  const canManage = canManageTendering(role, user_id);

  const staticFilters = useMemo(
    () => getTenderingStaticFilters(customerId),
    [customerId]
  );

  const urlSyncKey = useMemo(
    () => `tendering_list_${urlContext}${customerId ? `_cust_${customerId}` : ""}`,
    [urlContext, customerId]
  );

  // Row actions need the table's `refetch`, but `refetch` is only available
  // after the hook runs (which itself needs `columns`). Bridge the cycle with
  // a ref: columns read `refetchRef.current`, populated post-hook below.
  const refetchRef = useRef<() => void>(() => {});

  const columns = useMemo<ColumnDef<ProjectsType>[]>(
    () => [
      {
        accessorKey: "project_name",
        header: "Project Name",
        cell: ({ row }) => (
          <Link
            to={`/projects/${row.original.name}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {row.original.project_name || row.original.name}
          </Link>
        ),
        size: 240,
      },
      {
        accessorKey: "project_city",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="City" />
        ),
        cell: ({ row }) => <div>{row.original.project_city || "--"}</div>,
        meta: { exportHeaderName: "City" },
      },
      {
        accessorKey: "project_state",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="State" />
        ),
        cell: ({ row }) => <div>{row.original.project_state || "--"}</div>,
        meta: { exportHeaderName: "State" },
      },
      {
        accessorKey: "customer",
        header: "Customer",
        cell: ({ row }) => <div>{row.original.customer || "--"}</div>,
        meta: { exportHeaderName: "Customer" },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => formatDate(row.original.creation),
        meta: { exportHeaderName: "Created" },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: () => (
          <div className="flex justify-center">
            <Badge
              variant="outline"
              className={cn("font-medium", PROJECT_STATUS_BADGE_CLASSES["Tendering"])}
            >
              Tendering
            </Badge>
          </div>
        ),
        size: 120,
      },
      // Edit / Delete row actions — Admin / PMO / Administrator only. Convert
      // is intentionally omitted (Slice 7).
      ...(canManage
        ? ([
            {
              id: "actions",
              header: () => <div className="text-center">Actions</div>,
              cell: ({ row }) => (
                <TenderingRowActions
                  project={row.original}
                  onDeleted={() => refetchRef.current()}
                />
              ),
              size: 80,
              enableSorting: false,
              meta: { excludeFromExport: true },
            },
          ] as ColumnDef<ProjectsType>[])
        : []),
    ],
    [canManage]
  );

  const {
    table,
    totalCount,
    isLoading,
    error,
    exportAllRows,
    isExporting,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    data,
    refetch,
  } = useServerDataTable<ProjectsType>({
    doctype: DOCTYPE,
    columns,
    fetchFields: TENDERING_FIELDS_TO_FETCH,
    searchableFields: PROJECT_SEARCHABLE_FIELDS,
    urlSyncKey,
    defaultSort: "creation desc",
    enableRowSelection: false,
    additionalFilters: staticFilters,
  });

  // Keep the ref current so row-action handlers always call the latest refetch.
  refetchRef.current = refetch;

  if (error && !data?.length) {
    return <AlertDestructive error={error} />;
  }

  if (isLoading && !data?.length) {
    return <TableSkeleton />;
  }

  return (
    <DataTable<ProjectsType>
      table={table}
      columns={columns}
      isLoading={isLoading}
      error={error}
      totalCount={totalCount}
      searchFieldOptions={PROJECT_SEARCHABLE_FIELDS}
      selectedSearchField={selectedSearchField}
      onSelectedSearchFieldChange={setSelectedSearchField}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      dateFilterColumns={PROJECT_DATE_COLUMNS}
      showExportButton={true}
      onExport={"default"}
      onExportAll={exportAllRows}
      isExporting={isExporting}
      exportFileName="Tendering_Projects"
    />
  );
};

export default TenderingProjectsTable;
