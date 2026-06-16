import React, { useMemo, useRef, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FilePenLine, Hourglass, MoreHorizontal, Trash2 } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  useDeleteTenderingProject,
  useMarkTenderingProjectLost,
} from "./hooks/useTenderingMutations";

const DOCTYPE = "Projects";

// Slim set of fields for the Tendering tab — stub fields + name/creation + the
// bid dimension. We don't fetch `status` (execution stage) — pre-Won stubs
// have none.
const TENDERING_FIELDS_TO_FETCH: (keyof ProjectsType | "name")[] = [
  "name",
  "project_name",
  "project_city",
  "project_state",
  "customer",
  "tendering_status",
  "creation",
];

type TenderingSubTab = "Tendering" | "Lost";

interface TenderingProjectsTableProps {
  customerId?: string;
  urlContext?: string;
}

/**
 * Per-row actions for a Tendering/Lost stub.
 *
 * - Tendering: Edit (opens detail) + Mark as Lost + Delete.
 * - Lost:      Delete only (terminal, read-only).
 *
 * Gated to Admin / PMO / Administrator. Convert is reachable only from the
 * stub detail view (intentional).
 */
const TenderingRowActions: React.FC<{
  project: ProjectsType;
  onChanged: () => void;
}> = ({ project, onChanged }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLostOpen, setConfirmLostOpen] = useState(false);
  const { deleteTenderingProject, loading: deleting } =
    useDeleteTenderingProject();
  const { markTenderingProjectLost, loading: markingLost } =
    useMarkTenderingProjectLost();

  const isLost = project.tendering_status === "Lost";

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
      setConfirmDeleteOpen(false);
      onChanged();
    } catch (err: any) {
      toast({
        title: "Failed!",
        description: err?.message || "Error while deleting tendering project!",
        variant: "destructive",
      });
      console.error("Error while deleting tendering project:", err);
    }
  };

  const handleMarkLost = async () => {
    try {
      const response = await markTenderingProjectLost(project.name);
      if (response.message.status !== 200) {
        throw new Error(
          response.message.error || "Failed to mark tendering project Lost"
        );
      }
      toast({
        title: "Marked Lost",
        description: (
          <>
            Tendering Project:{" "}
            <strong className="text-[14px]">
              {project.project_name || project.name}
            </strong>{" "}
            marked Lost.
          </>
        ),
        variant: "success",
      });
      setConfirmLostOpen(false);
      onChanged();
    } catch (err: any) {
      toast({
        title: "Failed!",
        description:
          err?.message || "Error while marking tendering project Lost!",
        variant: "destructive",
      });
      console.error("Error while marking tendering project Lost:", err);
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
          {!isLost && (
            <DropdownMenuItem
              onClick={() => navigate(`/projects/${project.name}`)}
            >
              <FilePenLine className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
          )}
          {!isLost && (
            <DropdownMenuItem
              className="text-rose-700 focus:text-rose-800"
              onClick={() => setConfirmLostOpen(true)}
            >
              <Hourglass className="h-4 w-4 mr-2" />
              Mark as Lost
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {isLost ? "Lost" : "Tendering"} project?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the prospect stub{" "}
              <strong>{project.project_name || project.name}</strong>. A stub
              has no operational data, so nothing else is affected. This cannot
              be undone.
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

      <AlertDialog open={confirmLostOpen} onOpenChange={setConfirmLostOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this project Lost?</AlertDialogTitle>
            <AlertDialogDescription>
              The prospect stub{" "}
              <strong>{project.project_name || project.name}</strong> will be
              marked Lost and become read-only. This is a one-way transition —
              Lost cannot be reverted to Tendering or converted to Won.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markingLost}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={markingLost}
              onClick={(e) => {
                e.preventDefault();
                handleMarkLost();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {markingLost ? "Marking..." : "Mark as Lost"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/**
 * Tendering-tab list (v3 dual-field model).
 *
 * Shows pre-Won stubs filtered to a single `tendering_status` value via the
 * Tendering/Lost sub-toggle on top of the table. URL-synced via the
 * `tendering_sub` search param so a sub-tab survives reloads.
 */
export const TenderingProjectsTable: React.FC<TenderingProjectsTableProps> = ({
  customerId,
  urlContext = "main",
}) => {
  const { role, user_id } = useUserData();
  const canManage = canManageTendering(role, user_id);

  const [searchParams, setSearchParams] = useSearchParams();
  const subTab: TenderingSubTab =
    searchParams.get("tendering_sub") === "Lost" ? "Lost" : "Tendering";

  const handleSubTabChange = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === "Lost") {
      params.set("tendering_sub", "Lost");
    } else {
      params.delete("tendering_sub");
    }
    setSearchParams(params, { replace: true });
  };

  const staticFilters = useMemo(
    () => getTenderingStaticFilters(customerId, subTab),
    [customerId, subTab]
  );

  // Keep the URL sub-tab in the swr/url key so each sub-tab has independent
  // pagination / sort state.
  const urlSyncKey = useMemo(
    () =>
      `tendering_list_${urlContext}_${subTab}${
        customerId ? `_cust_${customerId}` : ""
      }`,
    [urlContext, customerId, subTab]
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
        accessorKey: "tendering_status",
        header: "Status",
        cell: ({ row }) => {
          const ts = row.original.tendering_status || "Tendering";
          return (
            <div className="flex justify-center">
              <Badge
                variant="outline"
                className={cn(
                  "font-medium",
                  PROJECT_STATUS_BADGE_CLASSES[ts]
                )}
              >
                {ts}
              </Badge>
            </div>
          );
        },
        size: 120,
        meta: { exportHeaderName: "Status" },
      },
      ...(canManage
        ? ([
            {
              id: "actions",
              header: () => <div className="text-center">Actions</div>,
              cell: ({ row }) => (
                <TenderingRowActions
                  project={row.original}
                  onChanged={() => refetchRef.current()}
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

  refetchRef.current = refetch;

  if (error && !data?.length) {
    return <AlertDestructive error={error} />;
  }

  return (
    <div className="space-y-3">
      <Tabs value={subTab} onValueChange={handleSubTabChange}>
        <TabsList className="bg-muted">
          <TabsTrigger
            value="Tendering"
            className="data-[state=active]:bg-slate-200 data-[state=active]:text-slate-900"
          >
            Tendering
          </TabsTrigger>
          <TabsTrigger
            value="Lost"
            className="data-[state=active]:bg-rose-100 data-[state=active]:text-rose-800"
          >
            Lost
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && !data?.length ? (
        <TableSkeleton />
      ) : (
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
          exportFileName={
            subTab === "Lost" ? "Lost_Projects" : "Tendering_Projects"
          }
        />
      )}
    </div>
  );
};

export default TenderingProjectsTable;
