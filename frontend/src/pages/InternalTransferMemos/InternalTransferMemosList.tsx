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
  itmTabColumnVisibility,
  type ITMListRow,
} from "./config/itmList.config";
import { useITMList, type ITMStatusFilter } from "./hooks/useITMList";

/**
 * Six-tab sidebar module for Internal Transfer Memos.
 *
 * Layout mirrors `ServiceRequestsTabs` — custom Tailwind tab buttons with an
 * optional admin-only group separated by a divider. Each tab mounts its own
 * instance of `ITMListBody` so `useServerDataTable`'s URL state + data cache
 * stay isolated per tab (avoids a mount loop when the user switches tabs).
 */

const DECISION_TABS = {
  PENDING: "Pending Approval",
  REJECTED: "Rejected",
  ALL: "All Requests",
} as const;

const STATUS_TABS = {
  APPROVED: "Approved",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
} as const;

type ITMTabValue =
  | typeof DECISION_TABS[keyof typeof DECISION_TABS]
  | typeof STATUS_TABS[keyof typeof STATUS_TABS];

interface TabConfig {
  value: ITMTabValue;
  label: string;
  /** null = no filter (All Requests); `['=', 'Status']` / `['in', [...]]` otherwise. */
  statusFilter: ITMStatusFilter;
  /** Stable namespace for URL state (keeps the 6 tabs from colliding). */
  urlSyncKey: string;
}

const DECISION_TAB_CONFIGS: readonly TabConfig[] = [
  {
    value: DECISION_TABS.PENDING,
    label: "Pending Approval",
    statusFilter: ["=", "Pending Approval"],
    urlSyncKey: "itm_pending",
  },
  {
    value: DECISION_TABS.REJECTED,
    label: "Rejected",
    statusFilter: ["=", "Rejected"],
    urlSyncKey: "itm_rejected",
  },
  {
    value: DECISION_TABS.ALL,
    label: "All Requests",
    statusFilter: null,
    urlSyncKey: "itm_all",
  },
];

const STATUS_TAB_CONFIGS: readonly TabConfig[] = [
  {
    value: STATUS_TABS.APPROVED,
    label: "Approved",
    statusFilter: ["=", "Approved"],
    urlSyncKey: "itm_approved",
  },
  {
    value: STATUS_TABS.DISPATCHED,
    label: "Dispatched",
    // Spec: Dispatched tab covers both in-flight states (Phase 2 populates).
    statusFilter: ["in", ["Dispatched", "Partially Delivered"]],
    urlSyncKey: "itm_dispatched",
  },
  {
    value: STATUS_TABS.DELIVERED,
    label: "Delivered",
    statusFilter: ["=", "Delivered"],
    urlSyncKey: "itm_delivered",
  },
];

/**
 * Admin + PMO see decision tabs (Pending Approval, Rejected, All Requests).
 * PMO can't approve/reject (ITM_APPROVE_ROLES = Admin only) but needs the
 * same visibility for triage + follow-up, so the guard here is intentionally
 * broader than ITM_APPROVE_ROLES.
 */
const DECISION_TAB_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
];

const DEFAULT_TAB_WITH_DECISION: ITMTabValue = DECISION_TABS.PENDING;
const DEFAULT_TAB_WITHOUT_DECISION: ITMTabValue = STATUS_TABS.APPROVED;

export const InternalTransferMemosList: React.FC = () => {
  const { role } = useUserData();

  const canViewDecisionTabs = useMemo(
    () => DECISION_TAB_ROLES.includes(role),
    [role]
  );

  const visibleTabs = useMemo<TabConfig[]>(
    () =>
      canViewDecisionTabs
        ? [...DECISION_TAB_CONFIGS, ...STATUS_TAB_CONFIGS]
        : [...STATUS_TAB_CONFIGS],
    [canViewDecisionTabs]
  );

  const defaultTab = canViewDecisionTabs
    ? DEFAULT_TAB_WITH_DECISION
    : DEFAULT_TAB_WITHOUT_DECISION;

  // --- Tab state synced with ?tab= URL param via urlStateManager ---
  const initialTab = useMemo(() => {
    const fromUrl = getUrlStringParam("tab", defaultTab) as ITMTabValue;
    return visibleTabs.some((t) => t.value === fromUrl) ? fromUrl : defaultTab;
  }, [defaultTab, visibleTabs]);

  const [tab, setTab] = useState<ITMTabValue>(initialTab);

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
      const newTab = (value || defaultTab) as ITMTabValue;
      if (!visibleTabValues.has(newTab)) return;
      setTab((prev) => (prev !== newTab ? newTab : prev));
    });
    return unsubscribe;
  }, [defaultTab, visibleTabValues]);

  const handleTabClick = useCallback(
    (value: ITMTabValue) => {
      if (tab !== value) setTab(value);
    },
    [tab]
  );

  // --- Role gate — after hooks so React rules-of-hooks is preserved ---
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

      {/* Tabs — Admin/PMO see decision group + divider + status group. */}
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
          {canViewDecisionTabs && (
            <>
              {DECISION_TAB_CONFIGS.map((t) => (
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
          {STATUS_TAB_CONFIGS.map((t) => (
            <TabButton
              key={t.value}
              label={t.label}
              isActive={tab === t.value}
              onClick={() => handleTabClick(t.value)}
            />
          ))}
        </div>
      </div>

      {/* One body per tab — remounts on tab change so URL state scopes cleanly. */}
      <ITMListBody key={activeTabConfig.value} config={activeTabConfig} />
    </div>
  );
};

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ label, isActive, onClick }) => (
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

  // Apply per-tab column visibility once the table is ready.
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
