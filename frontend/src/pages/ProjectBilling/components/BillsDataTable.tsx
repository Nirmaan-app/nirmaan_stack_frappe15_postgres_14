import { useCallback, useMemo, useState } from "react";
import type { Row as TanRow } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import {
  BILL_DATE_COLUMNS,
  BILL_DOCTYPE,
  BILL_FETCH_FIELDS,
  BILL_SEARCH_FIELDS,
  buildBillColumns,
} from "../config/bills.config";
import type { BillDoc, BillingTracker } from "../types";
import { assigneeOptions, isPending, managerNames, trackersAssignedTo } from "../utils/billingFormat";
import { AssignedFilterContext } from "./AssignedFilter";
import { BillDrawer } from "./BillDrawer";

// Matches no tracker: picking only people who manage nothing here must show no bills, not all of them.
const NO_TRACKER = "__none__";

interface BillsDataTableProps {
  /** Frappe filters that scope the rows AND the facet counts (project / my packages / manager…). */
  scopeFilters: any[];
  /** Trackers the bills can belong to: manager, PO value and Supply DC for the drawer. */
  trackers: BillingTracker[];
  projectNameOf: (project: string) => string;
  urlSyncKey: string;
  exportFileName: string;
  showProject?: boolean;
  showManager?: boolean;
  toolbarActions?: React.ReactNode;
  /** Shows "Add Bill" for one project, for the packages the user can edit there. */
  addBillFor?: { project: string; onSetupPackages?: () => void };
}

/**
 * Every bill list (project tab, View Bills, Bill Wise, My Bills): the app's standard DataTable with facets.
 * Everyone with billing access sees every bill; Add Bill and the pencil follow each package's
 * `can_edit_bills` (Admin, or one of its billing managers).
 */
export function BillsDataTable({
  scopeFilters,
  trackers,
  projectNameOf,
  urlSyncKey,
  exportFileName,
  showProject = false,
  showManager = false,
  toolbarActions,
  addBillFor,
}: BillsDataTableProps) {
  const trackerByName = useMemo(() => new Map(trackers.map((t) => [t.name, t])), [trackers]);
  const managersOf = useCallback(
    (tracker: string) => managerNames(trackerByName.get(tracker)?.billing_managers),
    [trackerByName],
  );
  const canEditRow = useCallback((tracker: string) => !!trackerByName.get(tracker)?.can_edit_bills, [trackerByName]);
  const showEdit = trackers.some((t) => t.can_edit_bills);
  // A new bill can go under any package of the project the user can edit.
  const addProject = addBillFor?.project;
  const addableTrackers = useMemo(
    () =>
      addProject ? trackers.filter((t) => t.can_edit_bills && (!t.project || t.project === addProject)) : [],
    [trackers, addProject],
  );

  const [drawer, setDrawer] = useState<{ open: boolean; bill: BillDoc | null }>({ open: false, bill: null });
  const onEdit = useCallback((bill: BillDoc) => setDrawer({ open: true, bill }), []);

  // Assigned filter: people picked in the Assigned column header, kept in the URL like the other filters.
  const assignedParam = `${urlSyncKey}_assigned`;
  const [assigned, setAssignedState] = useState<string[]>(() =>
    showManager ? (urlStateManager.getParam(assignedParam) || "").split(",").filter(Boolean) : [],
  );
  const setAssigned = useCallback(
    (people: string[]) => {
      setAssignedState(people);
      urlStateManager.updateParam(assignedParam, people.length ? people.join(",") : null);
    },
    [assignedParam],
  );
  const assignedOptions = useMemo(() => assigneeOptions(trackers), [trackers]);
  const assignedFilter = useMemo(
    () => ({ options: assignedOptions, selected: assigned, onChange: setAssigned }),
    [assignedOptions, assigned, setAssigned],
  );

  // The page's scope plus the Assigned filter; rows, facet counts and export all use this.
  const filters = useMemo(() => {
    if (!showManager || !assigned.length) return scopeFilters;
    const names = trackersAssignedTo(trackers, assigned);
    return [...scopeFilters, ["billing_tracker", "in", names.length ? names : [NO_TRACKER]]];
  }, [scopeFilters, showManager, assigned, trackers]);

  const columns = useMemo(
    () =>
      buildBillColumns({ showProject, showManager, showEdit, canEditRow, projectName: projectNameOf, managersOf, onEdit }),
    [showProject, showManager, showEdit, canEditRow, projectNameOf, managersOf, onEdit],
  );

  const {
    table,
    isLoading,
    error,
    totalCount,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
    refetch,
  } = useServerDataTable<BillDoc>({
    doctype: BILL_DOCTYPE,
    columns,
    fetchFields: BILL_FETCH_FIELDS as string[],
    searchableFields: BILL_SEARCH_FIELDS,
    urlSyncKey,
    additionalFilters: filters,
    defaultSort: "creation desc",
  });

  // Facet counts follow the same scope as the rows.
  const facetOverrides = useMemo(
    () => ({
      project: { additionalFilters: filters, enabled: showProject },
      package: { additionalFilters: filters },
      bill_type: { additionalFilters: filters },
      status: { additionalFilters: filters },
    }),
    [filters, showProject],
  );

  const getRowClassName = useCallback(
    (row: TanRow<BillDoc>) => (isPending(row.original.status) ? "bg-amber-50/60 hover:bg-amber-50" : undefined),
    [],
  );

  const drawerTrackers = drawer.bill
    ? [trackerByName.get(drawer.bill.billing_tracker)].filter((t): t is BillingTracker => !!t)
    : addableTrackers;
  const drawerProject = drawer.bill?.project || addBillFor?.project || "";

  if (error) return <AlertDestructive error={error} />;

  return (
    <AssignedFilterContext.Provider value={assignedFilter}>
      <DataTable<BillDoc>
        table={table}
        columns={columns}
        isLoading={isLoading}
        totalCount={totalCount}
        searchFieldOptions={BILL_SEARCH_FIELDS}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        facetDoctype={BILL_DOCTYPE}
        facetOverrides={facetOverrides}
        dateFilterColumns={BILL_DATE_COLUMNS}
        showExportButton
        onExport="default"
        onExportAll={exportAllRows}
        isExporting={isExporting}
        exportFileName={exportFileName}
        getRowClassName={getRowClassName}
        toolbarActions={
          <>
            {toolbarActions}
            {addableTrackers.length > 0 && (
              <Button size="sm" onClick={() => setDrawer({ open: true, bill: null })}>
                <Plus className="mr-1.5 h-4 w-4" /> Add Bill
              </Button>
            )}
          </>
        }
      />
      <BillDrawer
        open={drawer.open}
        onOpenChange={(open) => setDrawer((d) => ({ ...d, open }))}
        bill={drawer.bill}
        trackers={drawerTrackers}
        projectLabel={drawerProject ? projectNameOf(drawerProject) : ""}
        onSetupPackages={addBillFor?.onSetupPackages}
        onSaved={refetch}
      />
    </AssignedFilterContext.Provider>
  );
}
