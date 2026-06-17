import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { Projects } from "@/types/NirmaanStack/Projects";

import TenderingOverviewTab from "./TenderingOverviewTab";
import BoqProjectTab from "@/pages/boq-wizard/BoqProjectTab";

interface TenderingProjectViewProps {
  /** The loaded Projects doc whose `tendering_status` is NOT "Won". */
  data: Projects;
  /** SWR mutate for the project doc — refreshes the view after a mutation. */
  onRefresh?: () => void;
}

/**
 * Tabbed detail shell for a pre-Won (Tendering or Lost) Projects record.
 *
 * `project.tsx` early-returns this view whenever `tendering_status !== "Won"`,
 * so the heavy role-based operational-tab machinery (Procurement, Financials,
 * DC/MIR, etc.) never runs for a stub. This shell mirrors the won-project
 * detail page: a `?page=`-synced custom button tab-bar over two tabs —
 *   - Overview: the stub details card + tendering lifecycle actions
 *               (Edit / Convert / Mark-as-Lost / Delete, gated to managers),
 *   - BOQs:     the shared BoqProjectTab.
 *
 * The status badge + banner + actions live inside the Overview tab; the shell
 * header carries only the back button + project identity so the BOQs tab still
 * has context. The full edit-project form is intentionally NOT reachable here.
 */

const TENDERING_TABS = {
  OVERVIEW: "overview",
  BOQ: "boq",
} as const;

type TenderingTabValue = (typeof TENDERING_TABS)[keyof typeof TENDERING_TABS];

const TAB_ITEMS: { key: TenderingTabValue; label: string }[] = [
  { key: TENDERING_TABS.OVERVIEW, label: "Overview" },
  { key: TENDERING_TABS.BOQ, label: "BOQs" },
];

const TenderingProjectView = ({ data, onRefresh }: TenderingProjectViewProps) => {
  const navigate = useNavigate();

  // --- Tab state synced to the `page` URL param (mirrors project.tsx) ---
  const initialActivePage = useMemo(
    () =>
      getUrlStringParam("page", TENDERING_TABS.OVERVIEW) as TenderingTabValue,
    []
  ); // calculate once

  const [activePage, setActivePage] =
    useState<TenderingTabValue>(initialActivePage);

  // Prevent the state->URL effect from overwriting an incoming `?page=` on mount.
  const isInitialMount = useRef(true);

  // state -> URL
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (urlStateManager.getParam("page") !== activePage) {
      urlStateManager.updateParam("page", activePage);
    }
  }, [activePage]);

  // URL -> state (popstate / direct URL load)
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("page", (_, value) => {
      const newPage = (value ||
        TENDERING_TABS.OVERVIEW) as TenderingTabValue;
      if (activePage !== newPage) {
        setActivePage(newPage);
      }
    });
    const currentUrlPage = urlStateManager.getParam(
      "page"
    ) as TenderingTabValue | null;
    if (currentUrlPage && activePage !== currentUrlPage) {
      setActivePage(currentUrlPage);
    }
    return unsubscribe;
  }, [activePage]);

  return (
    <div className="flex-1 space-y-4 py-2">
      {/* Header: back + project identity (status badge lives in the Overview tab) */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/projects?tab=tendering")}
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {data.project_name || data.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            Project ID: <span className="font-mono">{data.name}</span>
          </p>
        </div>
      </div>

      {/* Tab bar — mirrors the won-project detail page button bar */}
      <div className="w-full">
        <div className="flex flex-wrap gap-2">
          {TAB_ITEMS.map((item) => {
            const isActive = activePage === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActivePage(item.key)}
                className={
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap " +
                  (isActive
                    ? "bg-[#D03B45] text-white shadow-sm"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-[#FFD3CC] hover:text-[#D03B45] hover:border-[#FFD3CC]")
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab content */}
      {activePage === TENDERING_TABS.BOQ ? (
        <BoqProjectTab projectId={data.name} />
      ) : (
        <TenderingOverviewTab data={data} onRefresh={onRefresh} />
      )}
    </div>
  );
};

export default TenderingProjectView;
