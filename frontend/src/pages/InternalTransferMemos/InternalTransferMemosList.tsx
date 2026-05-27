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
  ITM_STATUS_FACET_OPTIONS,
  itmListColumns,
  itmTabColumnVisibility,
  type ITMListRow,
} from "./config/itmList.config";
import { useITMList, type ITMStatusFilter } from "./hooks/useITMList";

/**
 * List page for Internal Transfer Memos.
 *
 * After the ITR collapse there is no separate approval step — every ITM is
 * born in `Approved` status by `create_itms`. Tabs reflect the dispatch /
 * delivery lifecycle: Approved → Dispatched → Partially Delivered → Delivered.
 * Delete is exposed on the ITM detail page only — never inline in the list.
 */

interface TabConfig {
  value: string;
  label: string;
  statusFilter: ITMStatusFilter;
  urlSyncKey: string;
}

const ITM_TABS: readonly TabConfig[] = [
  {
    value: "Approved",
    label: "Approved",
    statusFilter: ["=", "Approved"],
    urlSyncKey: "itm_approved",
  },
  {
    value: "Dispatched",
    label: "Dispatched",
    statusFilter: ["=", "Dispatched"],
    urlSyncKey: "itm_dispatched",
  },
  {
    value: "Partially Delivered",
    label: "Partially Delivered",
    statusFilter: ["=", "Partially Delivered"],
    urlSyncKey: "itm_partially_delivered",
  },
  {
    value: "Delivered",
    label: "Delivered",
    statusFilter: ["=", "Delivered"],
    urlSyncKey: "itm_delivered",
  },
  {
    // Catch-all view across every status. Sits last so the lifecycle order
    // reads left-to-right (Approved → Dispatched → Partially Delivered → Delivered → All).
    value: "All",
    label: "All Requests",
    statusFilter: null,
    urlSyncKey: "itm_all",
  },
];

const DEFAULT_TAB = "Approved";

export const InternalTransferMemosList: React.FC = () => {
  const { role } = useUserData();

  const initialTab = useMemo(() => {
    const fromUrl = getUrlStringParam("tab", DEFAULT_TAB);
    return ITM_TABS.some((t) => t.value === fromUrl) ? fromUrl : DEFAULT_TAB;
  }, []);

  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (urlStateManager.getParam("tab") !== tab) {
      urlStateManager.updateParam("tab", tab);
    }
  }, [tab]);

  useEffect(() => {
    const validTabs = new Set(ITM_TABS.map((t) => t.value));
    const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
      const newTab = value || DEFAULT_TAB;
      if (!validTabs.has(newTab)) return;
      setTab((prev) => (prev !== newTab ? newTab : prev));
    });
    return unsubscribe;
  }, []);

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
    ITM_TABS.find((t) => t.value === tab) ?? ITM_TABS[0];

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg sm:text-xl font-semibold">
          Internal Transfer Memos
        </h1>
      </div>

      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex items-center gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
          {ITM_TABS.map((t, idx) => (
            <React.Fragment key={t.value}>
              {/* Visual separator between lifecycle tabs and the catch-all
                  "All Requests" tab — mirrors the PR list divider pattern. */}
              {t.value === "All" && idx > 0 && (
                <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
              )}
              <TabButton
                label={t.label}
                isActive={tab === t.value}
                onClick={() => handleTabClick(t.value)}
              />
            </React.Fragment>
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

  // Status facet is only meaningful on the catch-all "All Requests" tab,
  // where rows span every status. Other tabs are already pre-filtered to
  // a single status by the server-side ``statusFilter``.
  const facetFilterOptions = useMemo(
    () =>
      config.value === "All"
        ? { status: { title: "Status", options: ITM_STATUS_FACET_OPTIONS } }
        : undefined,
    [config.value]
  );

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
          columns={itmListColumns}
          isLoading={isLoading}
          error={error}
          totalCount={totalCount}
          searchFieldOptions={ITM_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          dateFilterColumns={ITM_DATE_COLUMNS}
          facetFilterOptions={facetFilterOptions}
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
