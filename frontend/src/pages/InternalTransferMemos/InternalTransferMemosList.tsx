import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { TableSkeleton } from "@/components/ui/skeleton";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { urlStateManager } from "@/utils/urlStateManager";
import { cn } from "@/lib/utils";

import { ITM_VIEW_ROLES } from "@/constants/itm";

import {
  ITM_DATE_COLUMNS,
  ITM_SEARCHABLE_FIELDS,
  itmListColumns,
  getItrListColumns,
  itmTabColumnVisibility,
  type ITMListRow,
} from "./config/itmList.config";
import { useITMList, type ITMStatusFilter } from "./hooks/useITMList";

/**
 * Combined list page for ITRs (approval tabs) and ITMs (dispatch/delivery tabs).
 *
 * ITR tabs: Pending | Partially Fulfilled | Completed | Rejected
 * ITM tabs: Approved | Dispatched | Delivered
 *
 * ITR tabs query the "Internal Transfer Request" doctype.
 * ITM tabs query the "Internal Transfer Memo" doctype.
 */

type TabType = "itr" | "itm";

interface TabConfig {
  value: string;
  label: string;
  type: TabType;
  statusFilter: ITMStatusFilter;
  urlSyncKey: string;
}

const ITR_TABS: readonly TabConfig[] = [
  {
    value: "Pending",
    label: "Pending Approval",
    type: "itr",
    statusFilter: ["has_pending_items", "true"],
    urlSyncKey: "itr_pending",
  },
  {
    value: "Rejected",
    label: "Rejected",
    type: "itr",
    statusFilter: ["has_rejected_items", "true"],
    urlSyncKey: "itr_rejected",
  },
  {
    value: "All Requests",
    label: "All Requests",
    type: "itr",
    statusFilter: null,
    urlSyncKey: "itr_all",
  },
];

const ITM_TABS: readonly TabConfig[] = [
  {
    value: "Approved",
    label: "Approved",
    type: "itm",
    statusFilter: ["=", "Approved"],
    urlSyncKey: "itm_approved",
  },
  {
    value: "Dispatched",
    label: "Dispatched",
    type: "itm",
    statusFilter: ["in", ["Dispatched", "Partially Delivered"]],
    urlSyncKey: "itm_dispatched",
  },
  {
    value: "Delivered",
    label: "Delivered",
    type: "itm",
    statusFilter: ["=", "Delivered"],
    urlSyncKey: "itm_delivered",
  },
];

const DECISION_TAB_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
];

export const InternalTransferMemosList: React.FC = () => {
  const { role } = useUserData();

  const canViewDecisionTabs = useMemo(
    () => DECISION_TAB_ROLES.includes(role),
    [role]
  );

  const visibleTabs = useMemo<TabConfig[]>(
    () => (canViewDecisionTabs ? [...ITR_TABS, ...ITM_TABS] : [...ITM_TABS]),
    [canViewDecisionTabs]
  );

  const defaultTab = canViewDecisionTabs ? "Pending" : "Approved";

  const initialTab = useMemo(() => {
    const fromUrl = getUrlStringParam("tab", defaultTab);
    return visibleTabs.some((t) => t.value === fromUrl) ? fromUrl : defaultTab;
  }, [defaultTab, visibleTabs]);

  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (urlStateManager.getParam("tab") !== tab) {
      urlStateManager.updateParam("tab", tab);
    }
  }, [tab]);

  const visibleTabValues = useMemo(
    () => new Set(visibleTabs.map((t) => t.value)),
    [visibleTabs]
  );

  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
      const newTab = (value || defaultTab);
      if (!visibleTabValues.has(newTab)) return;
      setTab((prev) => (prev !== newTab ? newTab : prev));
    });
    return unsubscribe;
  }, [defaultTab, visibleTabValues]);

  const handleTabClick = useCallback(
    (value: string) => {
      if (tab !== value) setTab(value);
    },
    [tab]
  );

  if (role && role !== "Loading" && !ITM_VIEW_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }

  const activeTabConfig =
    visibleTabs.find((t) => t.value === tab) ?? visibleTabs[0];

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg sm:text-xl font-semibold">
          Internal Transfer Memos
        </h1>
      </div>

      {/* Tabs — ITR group | divider | ITM group */}
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
          {canViewDecisionTabs && (
            <>
              {ITR_TABS.map((t) => (
                <TabButton
                  key={t.value}
                  label={t.label}
                  isActive={tab === t.value}
                  onClick={() => handleTabClick(t.value)}
                />
              ))}
              <div className="w-px bg-gray-300 mx-1 self-stretch" />
            </>
          )}
          {ITM_TABS.map((t) => (
            <TabButton
              key={t.value}
              label={t.label}
              isActive={tab === t.value}
              onClick={() => handleTabClick(t.value)}
            />
          ))}
        </div>
      </div>

      <ITMListBody key={activeTabConfig.value} config={activeTabConfig} />
    </div>
  );
};

const TabButton: React.FC<{
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ label, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 whitespace-nowrap",
      isActive
        ? "bg-sky-500 text-white"
        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
    )}
  >
    {label}
  </button>
);

interface ITMListBodyProps {
  config: TabConfig;
}

const ITMListBody: React.FC<ITMListBodyProps> = ({ config }) => {
  const {
    table,
    totalCount,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
  } = useITMList({
    statusFilter: config.statusFilter,
    urlSyncKey: config.urlSyncKey,
    doctype: config.type === "itr" ? "Internal Transfer Request" : "Internal Transfer Memo",
    tabValue: config.value,
  });

  useEffect(() => {
    const visibility = itmTabColumnVisibility[config.value] ?? {};
    table.setColumnVisibility(visibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.value]);

  const exportFileName = useMemo(
    () =>
      `ITMs_${config.value.replace(/\s+/g, "_")}_${new Date()
        .toLocaleDateString("en-GB")
        .replace(/\//g, "-")}`,
    [config.value]
  );

  const activeColumns = config.type === "itr" ? getItrListColumns(config.value) : itmListColumns;

  if (error) return <AlertDestructive error={error} />;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10 ? "h-[calc(100vh-180px)]" : "h-auto"
      )}
    >
      {isLoading && totalCount === 0 ? (
        <TableSkeleton />
      ) : (
        <DataTable<ITMListRow>
          table={table}
          columns={activeColumns}
          isLoading={isLoading}
          error={error}
          totalCount={totalCount}
          searchFieldOptions={ITM_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          dateFilterColumns={ITM_DATE_COLUMNS}
          showExportButton={true}
          onExport={"default"}
          onExportAll={exportAllRows}
          isExporting={isExporting}
          exportFileName={exportFileName}
        />
      )}
    </div>
  );
};

export default InternalTransferMemosList;
