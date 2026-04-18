import React, { useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ColumnDef, Row } from "@tanstack/react-table";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import { Link } from "react-router-dom";
import {
  useFrappeGetDocList,
  FrappeContext,
  FrappeConfig,
  FrappeDoc,
  GetDocListArgs,
  useFrappeUpdateDoc,
  useFrappeCreateDoc,
} from "frappe-react-sdk";
import memoize from "lodash/memoize";
import {
  CheckCheck,
  CheckCircle2,
  ListChecks,
  ListX,
  TrendingDown,
  TrendingUp,
  Undo2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import {
  NotificationType,
  useNotificationStore,
} from "@/zustand/useNotificationStore";

// --- Types ---
import {
  ServiceItemType,
  ServiceRequests,
} from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import {
  DEFAULT_SR_FIELDS_TO_FETCH,
  SR_DATE_COLUMNS,
  SR_SEARCHABLE_FIELDS,
} from "../config/srTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = "Service Requests";
const URL_SYNC_KEY = "sr_approve_select"; // Unique key for this table instance

// --- Component ---
export const ApproveSelectSR: React.FC = () => {
  const { db } = useContext(FrappeContext) as FrappeConfig;
  const { getTotalAmount } = useOrderTotals();
  const { ceoHoldProjectIds } = useCEOHoldProjects();

  // Row action state (approve/reject from the list)
  const [actionRow, setActionRow] = useState<ServiceRequests | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [isActing, setIsActing] = useState(false);

  const { updateDoc } = useFrappeUpdateDoc();
  const { createDoc } = useFrappeCreateDoc();

  const projectsFetchOptions = getProjectListOptions();

  // --- Generate Query Keys ---
  const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

  // --- Supporting Data & Hooks ---
  const {
    data: projects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useFrappeGetDocList<Projects>(
    "Projects",
    projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
    projectQueryKey
  );
  const {
    data: vendorsList,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList({ vendorTypes: ["Service", "Material & Service"] });

  const {
    data: userList,
    isLoading: userListLoading,
    error: userError,
  } = useUsersList(); // For owner display
  const { notifications, mark_seen_notification } = useNotificationStore();

  // --- Memoized Options & Calculations ---
  const projectOptions = useMemo(
    () =>
      projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
      })) || [],
    [projects]
  );
  const vendorOptions = useMemo(
    () =>
      vendorsList?.map((ven) => ({
        label: ven.vendor_name,
        value: ven.name,
      })) || [],
    [vendorsList]
  );

  const getVendorName = useCallback(
    memoize((vendorId: string | undefined): string => {
      return (
        vendorsList?.find((vendor) => vendor.name === vendorId)?.vendor_name ||
        vendorId ||
        "--"
      );
    }),
    [vendorsList]
  );

  // --- Notification Handling ---
  const handleNewSRSeen = useCallback(
    (notification: NotificationType | undefined) => {
      if (notification && notification.seen === "false") {
        mark_seen_notification(db, notification);
      }
    },
    [db, mark_seen_notification]
  );

  // --- Static Filters for this View ---
  const staticFilters = useMemo(
    () => [
      ["status", "=", "Vendor Selected"], // This view specifically handles SRs in "Vendor Selected" state
    ],
    []
  );
  // --- Fields to Fetch ---
  const fieldsToFetch = useMemo(
    () =>
      DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation",
        "modified",
        "service_order_list",
        "service_category_list",
      ]),
    []
  );

  const srSearchableFields = useMemo(
    () =>
      SR_SEARCHABLE_FIELDS.concat([
        {
          value: "owner",
          label: "Created By",
          placeholder: "Search by Created By...",
        },
      ]),
    []
  );

  // --- Date Filter Columns ---
  const dateColumns = useMemo(() => SR_DATE_COLUMNS, []);

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ServiceRequests>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#WO" />
        ),
        cell: ({ row }) => {
          const data = row.original;
          const srId = data.name;
          const isNew = notifications.find(
            (item) =>
              item.docname === srId &&
              item.seen === "false" &&
              item.event_id === "sr:vendorSelected" // Ensure this event_id is correct
          );
          return (
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleNewSRSeen(isNew)}
              className="font-medium flex items-center gap-2 relative group"
            >
              {isNew && (
                <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />
              )}
              {/* Link to the page where SR can be approved (e.g., service-request/:id?tab=approve-service-order) */}
              <Link
                className="underline hover:underline-offset-2 whitespace-nowrap"
                to={`/service-requests/${srId}?tab=approve-service-order`}
              >
                {srId?.slice(-5)}
              </Link>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDoc={data}
                  parentDoctype="Service Requests"
                  childTableName="service_order_list"
                  isSR
                />
              </div>
            </div>
          );
        },
        size: 75,
        meta: {
          exportHeaderName: "#SR",
          exportValue: (row) => {
            return row.name;
          },
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created On" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 110,
        meta: {
          exportHeaderName: "Created On",
          exportValue: (row) => {
            return formatDate(row.creation);
          },
        },
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const project = projectOptions.find(
            (p) => p.value === row.original.project
          );
          return (
            <div className="font-medium" title={project?.label}>
              {project?.label || row.original.project}
            </div>
          );
        },
        enableColumnFilter: true,
        size: 150,
        meta: {
          enableFacet: true,
          facetTitle: "Project",
          exportHeaderName: "Project",
          exportValue: (row) => {
            const project = projectOptions.find((p) => p.value === row.project);
            return project?.label || row.project;
          },
        },
      },
      {
        accessorKey: "vendor", // Filter by vendor ID
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Selected Vendor" />
        ),
        cell: ({ row }) => (
          <span
            className="inline-block max-w-full rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-semibold leading-tight whitespace-normal break-words line-clamp-2"
            title={getVendorName(row.original.vendor)}
          >
            {getVendorName(row.original.vendor)}
          </span>
        ),
        enableColumnFilter: true,
        size: 150,
        meta: {
          enableFacet: true,
          facetTitle: "Vendor",
          exportHeaderName: "Selected Vendor",
          exportValue: (row: ServiceRequests) => {
            return getVendorName(row.vendor);
          },
        },
      },
      {
        accessorKey: "service_category_list",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Categories" />
        ),
        cell: ({ row }) => {
          const categories = row.getValue("service_category_list") as
            | { list: { name: string }[] }
            | undefined;
          const categoryItems = Array.isArray(categories?.list)
            ? categories.list
            : [];
          return (
            <div className="flex flex-wrap gap-1 items-start justify-start max-w-[160px]">
              {categoryItems.length > 0
                ? categoryItems.map((obj) => (
                  <Badge key={obj.name} variant="outline" className="text-xs">
                    {obj.name}
                  </Badge>
                ))
                : "--"}
            </div>
          );
        },
        size: 160,
        enableSorting: false,
        meta: {
          exportHeaderName: "Categories",
          exportValue: (row: ServiceRequests) => {
            const categories = row.service_category_list as
              | { list: { name: string }[] }
              | undefined;
            return Array.isArray(categories?.list)
              ? categories.list.map((c) => c.name).join(", ")
              : "--";
          },
        },
      },
      {
        accessorKey: "owner",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created By" />
        ),
        cell: ({ row }) => {
          const ownerUser = userList?.find(
            (entry) => row.original?.owner === entry.name
          );
          return (
            <div className="font-medium truncate">
              {ownerUser?.full_name || row.original?.owner || "--"}
            </div>
          );
        },
        size: 130,
        meta: {
          exportHeaderName: "Created By",
          exportValue: (row: ServiceRequests) => {
            const ownerUser = userList?.find(
              (entry) => row.owner === entry.name
            );
            return ownerUser?.full_name || row.owner || "--";
          },
        },
      },
      {
        id: "sr_value",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Est. Value" />
        ),
        cell: ({ row }) => {
          const totals = getTotalAmount(row.original.name, "Service Requests");
          const diff = totals?.stdDiffPct;
          const isOver = diff !== null && diff !== undefined && diff > 0;
          const DiffIcon = isOver ? TrendingUp : TrendingDown;
          return (
            <div className="pr-2">
              <p className="font-medium leading-tight">
                {formatToRoundedIndianRupee(totals?.totalWithTax)}
              </p>
              {diff !== null && diff !== undefined && (
                <p
                  className={cn(
                    "text-[10px] font-semibold inline-flex items-center gap-0.5 mt-0.5",
                    isOver ? "text-red-600" : "text-emerald-600"
                  )}
                >
                  <DiffIcon className="h-2.5 w-2.5" />
                  {isOver ? "+" : ""}
                  {diff.toFixed(2)}%
                </p>
              )}
            </div>
          );
        },
        size: 95,
        enableSorting: false,
        meta: {
          exportHeaderName: "Est. Value",
          exportValue: (row: ServiceRequests) => {
            return formatForReport(
              getTotalAmount(row.name, "Service Requests")?.totalWithTax
            );
          },
        },
      },
      {
        id: "sr_actions",
        header: () => <span className="text-xs font-medium">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-3 pr-1">
            <button
              type="button"
              title="Approve"
              aria-label="Approve"
              className="text-emerald-600 hover:text-emerald-700 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setActionRow(row.original);
                setActionType("approve");
              }}
            >
              <CheckCircle2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Reject"
              aria-label="Reject"
              className="text-red-600 hover:text-red-700 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setActionRow(row.original);
                setActionType("reject");
                setRejectComment("");
              }}
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        ),
        size: 80,
        enableSorting: false,
      },
    ],
    [
      notifications,
      projectOptions,
      vendorOptions,
      userList,
      handleNewSRSeen,
      getVendorName,
      getTotalAmount,
    ]
  );

  // --- Use the Server Data Table Hook ---
  const {
    table,
    data,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    // globalFilter, setGlobalFilter,
    // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    columnFilters,
    isRowSelectionActive,
    refetch,
    exportAllRows,
    isExporting,
  } = useServerDataTable<ServiceRequests>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: fieldsToFetch,
    searchableFields: srSearchableFields,
    // globalSearchFieldList: globalSearchFields,
    // enableItemSearch: true, // If you want to search within service_order_list items
    urlSyncKey: URL_SYNC_KEY,
    defaultSort: "modified desc",
    enableRowSelection: false, // For bulk approval if needed
    additionalFilters: staticFilters,
  });

  // --- Dynamic Facet Values ---
  const {
    facetOptions: projectFacetOptions,
    isLoading: isProjectFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "project",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: true,
  });

  const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "vendor",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      },
      vendor: {
        title: "Vendor",
        options: vendorFacetOptions,
        isLoading: isVendorFacetLoading,
      },
    }),
    [
      projectFacetOptions,
      isProjectFacetLoading,
      vendorFacetOptions,
      isVendorFacetLoading,
    ]
  );

  // --- Combined Loading & Error States ---
  const isLoading = projectsLoading || vendorsLoading || userListLoading;
  const combinedError = projectsError || vendorsError || userError || listError;

  // --- CEO Hold Row Highlighting ---
  const getRowClassName = useCallback(
    (row: Row<ServiceRequests>) => {
      const projectId = row.original.project;
      if (projectId && ceoHoldProjectIds.has(projectId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      return undefined;
    },
    [ceoHoldProjectIds]
  );

  // --- Row Action Handlers (Approve / Reject from list) ---
  const closeActionDialog = useCallback(() => {
    setActionRow(null);
    setActionType(null);
    setRejectComment("");
    setIsActing(false);
  }, []);

  const handleConfirmApprove = useCallback(async () => {
    if (!actionRow) return;
    try {
      setIsActing(true);
      await updateDoc("Service Requests", actionRow.name, { status: "Approved" });
      toast({
        title: "Success!",
        description: `SR: ${actionRow.name} approved.`,
        variant: "success",
      });
      invalidateSidebarCounts();
      refetch();
      closeActionDialog();
    } catch (err) {
      toast({
        title: "Failed!",
        description: "Unable to approve service request.",
        variant: "destructive",
      });
      setIsActing(false);
    }
  }, [actionRow, updateDoc, refetch, closeActionDialog]);

  const handleConfirmReject = useCallback(async () => {
    if (!actionRow) return;
    try {
      setIsActing(true);
      await updateDoc("Service Requests", actionRow.name, { status: "Rejected" });
      if (rejectComment.trim()) {
        await createDoc("Nirmaan Comments", {
          comment_type: "Comment",
          reference_doctype: "Service Requests",
          reference_name: actionRow.name,
          content: rejectComment.trim(),
          subject: "rejecting sr",
        });
      }
      toast({
        title: "Success!",
        description: `SR: ${actionRow.name} rejected.`,
        variant: "success",
      });
      invalidateSidebarCounts();
      refetch();
      closeActionDialog();
    } catch (err) {
      toast({
        title: "Failed!",
        description: "Unable to reject service request.",
        variant: "destructive",
      });
      setIsActing(false);
    }
  }, [actionRow, rejectComment, updateDoc, createDoc, refetch, closeActionDialog]);

  if (combinedError) {
    return <AlertDestructive error={combinedError} />;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10
          ? "h-[calc(100vh-80px)]"
          : totalCount > 0
            ? "h-auto"
            : ""
      )}
    >
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <DataTable<ServiceRequests>
          table={table}
          columns={columns}
          isLoading={listIsLoading}
          error={listError}
          totalCount={totalCount}
          searchFieldOptions={srSearchableFields}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          // globalFilterValue={globalFilter}
          // onGlobalFilterChange={setGlobalFilter}
          // searchPlaceholder="Search SRs (Vendor Selected)..."
          // showItemSearchToggle={showItemSearchToggle}
          // itemSearchConfig={{
          //     isEnabled: isItemSearchEnabled,
          //     toggle: toggleItemSearch,
          //     label: "Service Item Search"
          // }}
          facetFilterOptions={facetFilterOptions}
          dateFilterColumns={dateColumns}
          showExportButton={true}
          onExport={"default"}
          onExportAll={exportAllRows}
          isExporting={isExporting}
          exportFileName={`Approve_WO_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}`}
          getRowClassName={getRowClassName}
        // toolbarActions={<Button size="sm">Bulk Approve...</Button>} // Placeholder for future actions
        />
      )}

      {/* Approve / Reject Row Action Dialog */}
      <AlertDialog
        open={!!actionRow && !!actionType}
        onOpenChange={(open) => {
          if (!open && !isActing) closeActionDialog();
        }}
      >
        <AlertDialogContent className="sm:max-w-[450px]">
          {(() => {
            if (!actionRow || !actionType) return null;
            const isApprove = actionType === "approve";
            const isOnHold = ceoHoldProjectIds.has(actionRow.project);
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {isApprove ? "Approve Service Request?" : "Reject Service Request?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <p className="text-sm">
                        SR:{" "}
                        <span className="font-semibold text-foreground">
                          {actionRow.name}
                        </span>
                      </p>
                      {isOnHold && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span className="text-xs leading-snug">
                            This project is currently on <strong>CEO Hold</strong>. Are
                            you sure you want to {isApprove ? "approve" : "reject"} it?
                          </span>
                        </div>
                      )}
                      {!isApprove && (
                        <div className="space-y-1.5">
                          <label
                            htmlFor="reject-comment"
                            className="text-xs font-medium text-foreground"
                          >
                            Comment (optional)
                          </label>
                          <textarea
                            id="reject-comment"
                            className="w-full border rounded-md p-2 text-sm min-h-[72px] focus:outline-none focus:ring-2 focus:ring-red-100"
                            value={rejectComment}
                            onChange={(e) => setRejectComment(e.target.value)}
                            placeholder="Reason for rejection..."
                          />
                        </div>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {isActing ? (
                  <div className="flex items-center justify-center py-4">
                    <TailSpin width={48} color={isApprove ? "#059669" : "#dc2626"} />
                  </div>
                ) : (
                  <AlertDialogFooter className="flex flex-row justify-end gap-2 items-center">
                    <AlertDialogCancel className="flex items-center gap-1 mt-0">
                      <Undo2 className="h-4 w-4" />
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      onClick={isApprove ? handleConfirmApprove : handleConfirmReject}
                      className={cn(
                        "flex items-center gap-1 text-white",
                        isApprove
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "bg-red-600 hover:bg-red-700"
                      )}
                    >
                      <CheckCheck className="h-4 w-4" />
                      Confirm {isApprove ? "Approve" : "Reject"}
                    </Button>
                  </AlertDialogFooter>
                )}
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ApproveSelectSR;
