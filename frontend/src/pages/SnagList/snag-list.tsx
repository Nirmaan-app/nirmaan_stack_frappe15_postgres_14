/**
 * Snag List — the CROSS-PROJECT grid behind the `/snag-list` sidebar item.
 *
 * This page is the roll-up half of the feature. The per-project half is unchanged:
 * `SnagListTab`, which this page's detail route (`/snag-list/:id`) renders and the
 * Project page still renders as a tab. Neither is a copy of the other — there is one
 * table, mounted in two places.
 *
 * Shape of record: the Design Tracker list (`pages/ProjectDesignTracker/design-tracker-list.tsx`)
 * — the same header strip, search + `ProjectStatusFilter` row, and card grid, so the two
 * sidebar pages read as one family.
 *
 * ONE DIFFERENCE THAT IS DELIBERATE: the status filter starts EMPTY (= no narrowing),
 * where the design tracker starts on WIP + Handover + CEO Hold. This endpoint already
 * returns only projects that HAVE snags, and snags outlive a project's WIP stage — a
 * default filter would silently hide the Completed project someone came here to close out.
 */

import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappePostCall } from "frappe-react-sdk";
import { ChevronDown, EyeOff, Search, TriangleAlert } from "lucide-react";

import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { ProjectStatus } from "@/components/common/projectStatus";
import { ProjectStatusFilter } from "@/components/common/ProjectStatusFilter";
import { useUserData } from "@/hooks/useUserData";

import { ProjectSnagCard } from "./components/ProjectSnagCard";
import { useProjectSnagSummaries } from "./hooks/useProjectSnagSummaries";

/**
 * Who may hide/unhide a project's snag list.
 *
 * Admin + PMO — the SAME pair `module_controls.MODULE_CONTROL_PROFILES` enforces, which
 * is the real boundary; this is UX only, so the server refusing is not a bug here.
 */
const MODULE_CONTROL_PROFILES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
];

export const SnagListPage: React.FC = () => {
  const navigate = useNavigate();
  const { role, user_id } = useUserData();
  const { summaries, isLoading, error, mutate } = useProjectSnagSummaries();

  const canToggleModule =
    user_id === "Administrator" ||
    MODULE_CONTROL_PROFILES.includes(role as string);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus[]>([]);
  const [isHiddenSectionOpen, setIsHiddenSectionOpen] = useState(false);
  const [togglingProject, setTogglingProject] = useState<string | null>(null);

  const { call: enableModule } = useFrappePostCall(
    "nirmaan_stack.api.projects.module_controls.enable_module"
  );
  const { call: disableModule } = useFrappePostCall(
    "nirmaan_stack.api.projects.module_controls.disable_module"
  );

  const handleHideToggle = useCallback(
    async (projectId: string, nextHidden: boolean) => {
      setTogglingProject(projectId);
      try {
        const call = nextHidden ? disableModule : enableModule;
        await call({ project: projectId, module_type: "snag_list" });
        // Refetch rather than patch locally: the server decides who still sees a
        // hidden card, so the authoritative answer is the next payload.
        await mutate();
        toast({
          title: nextHidden ? "Snag List hidden" : "Snag List visible",
          description: nextHidden
            ? "Hidden from everyone except Admin and PMO."
            : "Visible to everyone with snag list access again.",
        });
      } catch (err: any) {
        toast({
          title: "Error",
          description: err?.message || "Failed to update the Snag List module.",
          variant: "destructive",
        });
      } finally {
        setTogglingProject(null);
      }
    },
    [disableModule, enableModule, mutate]
  );

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return summaries.filter((s) => {
      const matchesSearch =
        !needle ||
        s.project_name.toLowerCase().includes(needle) ||
        s.name.toLowerCase().includes(needle) ||
        (s.project_city || "").toLowerCase().includes(needle);

      const matchesStatus =
        statusFilter.length === 0 ||
        statusFilter.includes(s.status_of_project as ProjectStatus);

      return matchesSearch && matchesStatus;
    });
  }, [summaries, searchTerm, statusFilter]);

  // Hidden projects only ever reach a viewer who may see them (the server drops them
  // for everyone else), so this split needs no permission test of its own.
  const activeSummaries = useMemo(
    () => filtered.filter((s) => s.is_hidden !== 1),
    [filtered]
  );
  const hiddenSummaries = useMemo(
    () => filtered.filter((s) => s.is_hidden === 1),
    [filtered]
  );

  // The strip totals the ACTIVE set. A hidden project is switched off, so folding its
  // snags into the headline would make the number disagree with the grid under it.
  const totals = useMemo(() => {
    return activeSummaries.reduce(
      (acc, s) => {
        acc.projects += 1;
        acc.pending += s.by_status.Pending ?? 0;
        acc.wip += s.by_status.WIP ?? 0;
        acc.completed += s.by_status.Completed ?? 0;
        acc.trackable +=
          Math.max(s.total - (s.by_status["Not Applicable"] ?? 0), 0);
        return acc;
      },
      { projects: 0, pending: 0, wip: 0, completed: 0, trackable: 0 }
    );
  }, [activeSummaries]);

  if (isLoading) return <TableSkeleton />;
  if (error) return <AlertDestructive error={error} />;

  return (
    <div className="flex-1 space-y-5">
      {/* ── Header: title + totals ─────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 md:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Snag Lists</h1>
            <p className="text-sm text-gray-500">
              Open snags across every project
            </p>
          </div>

          <div className="flex items-stretch gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
            <div className="flex flex-col items-center justify-center px-4 py-2 bg-white min-w-[64px]">
              <span className="text-lg font-bold text-gray-900 tabular-nums leading-none">
                {totals.projects}
              </span>
              <span className="text-[10px] text-gray-400 font-medium mt-1 uppercase tracking-wider">
                Projects
              </span>
            </div>

            <div className="flex flex-col items-center justify-center px-4 py-2 bg-amber-50/60 min-w-[64px]">
              <span className="text-lg font-bold text-amber-700 tabular-nums leading-none">
                {totals.pending}
              </span>
              <span className="text-[10px] text-amber-600/70 font-medium mt-1 uppercase tracking-wider">
                Pending
              </span>
            </div>

            <div className="flex flex-col items-center justify-center px-4 py-2 bg-sky-50/60 min-w-[64px]">
              <span className="text-lg font-bold text-sky-700 tabular-nums leading-none">
                {totals.wip}
              </span>
              <span className="text-[10px] text-sky-600/70 font-medium mt-1 uppercase tracking-wider">
                WIP
              </span>
            </div>

            <div className="flex flex-col items-center justify-center px-4 py-2 bg-green-50/60 min-w-[64px]">
              <div className="flex items-baseline gap-0.5 leading-none">
                <span className="text-lg font-bold text-green-700 tabular-nums">
                  {totals.completed}
                </span>
                <span className="text-xs text-green-600/50 font-medium">
                  /{totals.trackable}
                </span>
              </div>
              <span className="text-[10px] text-green-600/70 font-medium mt-1 uppercase tracking-wider">
                Completed
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Search + status filter ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 px-4 md:px-6">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="Search by project name, ID or city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-11 border-gray-300 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <span className="text-sm text-gray-500 whitespace-nowrap self-center">
          {filtered.length} of {summaries.length} projects
        </span>

        <ProjectStatusFilter
          editable
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* ── Card grid ──────────────────────────────────────────────── */}
      <div className="space-y-4 px-4 md:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-5">
          {filtered.length === 0 ? (
            <div className="col-span-full">
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                  {summaries.length === 0 ? (
                    <TriangleAlert className="h-8 w-8 text-gray-400" />
                  ) : (
                    <Search className="h-8 w-8 text-gray-400" />
                  )}
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  {summaries.length === 0
                    ? "No snag lists yet"
                    : "No projects found"}
                </h3>
                <p className="text-sm text-gray-500 max-w-sm">
                  {summaries.length === 0
                    ? "A snag list starts on a project's own Snag List tab — import a walk-through sheet there and the project appears here."
                    : "Try adjusting your search or status filter"}
                </p>
              </div>
            </div>
          ) : activeSummaries.length === 0 ? (
            <div className="col-span-full">
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <p className="text-sm text-gray-500">
                  No active snag lists. Check the hidden section below.
                </p>
              </div>
            </div>
          ) : (
            activeSummaries.map((summary) => (
              <div key={summary.name} className="h-full">
                <ProjectSnagCard
                  summary={summary}
                  onClick={() => navigate(`/snag-list/${summary.name}`)}
                  onHideToggle={canToggleModule ? handleHideToggle : undefined}
                  isToggling={togglingProject === summary.name}
                />
              </div>
            ))
          )}
        </div>

        {/* Hidden projects. Only ever non-empty for Admin / PMO — the server drops
            hidden cards for everyone else — so this section needs no role test. */}
        {hiddenSummaries.length > 0 && (
          <Collapsible
            open={isHiddenSectionOpen}
            onOpenChange={setIsHiddenSectionOpen}
            className="mt-6"
          >
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 w-full px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors">
                <EyeOff className="h-4 w-4 text-orange-600" />
                <span className="text-sm font-medium text-orange-700">
                  Hidden Snag Lists
                </span>
                <Badge
                  variant="secondary"
                  className="px-2 py-0.5 text-xs bg-orange-200 text-orange-800 border-0"
                >
                  {hiddenSummaries.length}
                </Badge>
                <ChevronDown
                  className={`h-4 w-4 text-orange-600 ml-auto transition-transform duration-200 ${
                    isHiddenSectionOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-5">
                {hiddenSummaries.map((summary) => (
                  <div key={summary.name} className="h-full">
                    <ProjectSnagCard
                      summary={summary}
                      onClick={() => navigate(`/snag-list/${summary.name}`)}
                      onHideToggle={
                        canToggleModule ? handleHideToggle : undefined
                      }
                      isToggling={togglingProject === summary.name}
                    />
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
};

export default SnagListPage;
