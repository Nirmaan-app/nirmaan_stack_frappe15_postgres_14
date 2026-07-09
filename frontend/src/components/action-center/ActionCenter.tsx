/**
 * Action Center — a standalone, reusable dashboard panel.
 *
 * Surfaces the current user's pending Project Action Items (Surface A,
 * `get_my_action_items`) as category tabs (All / DPR / DN / DC) with a
 * project-wise, expandable pending list.
 *
 * Designed to be embedded across dashboards. Tune it per surface:
 *   - `className`  → override width / placement (merged via `cn`, so a wider
 *                    or full-width layout on another dashboard just passes e.g.
 *                    "xl:w-full xl:border-l-0").
 *   - `title`      → panel heading (default "Action Center").
 *   - `defaultTab` → initial tab (default "all").
 *
 * Future enhancement seams (kept intentionally simple for now): the tab set,
 * the per-type row → route mapping, and the empty-state copy are the natural
 * props to lift next when a dashboard needs a different behaviour.
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  ActionItemRow,
  GetActionItemsResponse,
} from "@/types/NirmaanStack/ProjectActionItem";
import { encodeFrappeId } from "@/pages/DeliveryNotes/constants";
import { cn } from "@/lib/utils";

export type ActionTab = "all" | "dpr" | "dn" | "dc";

export interface ActionCenterProps {
  /** Extra classes merged onto the panel container — override width / placement per dashboard. */
  className?: string;
  /** Panel heading. Defaults to "Action Center". */
  title?: string;
  /** Tab selected on first render. Defaults to "all". */
  defaultTab?: ActionTab;
}

interface ProjectGroupProps {
  projectName: string;
  count: number;
  items: ActionItemRow[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (item: ActionItemRow) => void;
}

function ProjectGroup({
  projectName,
  count,
  items,
  expanded,
  onToggle,
  onOpen,
}: ProjectGroupProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm ring-1 ring-transparent transition-all hover:border-gray-300 hover:shadow-md">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3.5 p-2 text-left transition-colors hover:bg-gray-50/70"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-red-600 text-lg font-bold uppercase text-white shadow-sm">
          {projectName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-gray-900">
            {projectName}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
            {count} pending
          </p>
        </div>
        <span className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-red-50 px-2.5 py-1 text-sm font-bold tabular-nums text-red-600">
          {count}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <ul className="divide-y divide-gray-200 border-t border-gray-200 bg-gray-50">
          {items.map((item) => (
            <li key={item.name}>
              <button
                onClick={() => onOpen(item)}
                className="group flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-red-50/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-600">
                      {item.action_type === "DN_PENDING" ? "DN" : "DC"}
                    </span>
                    <span className="min-w-0 break-all text-xs font-semibold text-gray-900">
                      {item.reference_name}
                    </span>
                  </div>
                  {item.vendor_name && (
                    <p className="mt-0.5 truncate text-[11px] text-sky-600">
                      {item.vendor_name}
                    </p>
                  )}
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-red-400 transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface StatTabProps {
  label: string;
  count: number;
  dot: string;
  active: boolean;
  onClick: () => void;
}

function StatTab({ label, count, dot, active, onClick }: StatTabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 transition-all ${
        active
          ? "border-gray-900 bg-gray-900 text-white shadow-sm"
          : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-base font-bold leading-none tabular-nums">{count}</span>
      </div>
      <span
        className={`text-[11px] font-medium ${active ? "text-white/80" : "text-gray-500"}`}
      >
        {label}
      </span>
    </button>
  );
}

const TAB_EMPTY_LABEL: Record<ActionTab, string> = {
  all: "delivery",
  dpr: "progress report",
  dn: "delivery note",
  dc: "delivery challan",
};

export function ActionCenter({
  className,
  title = "Action Center",
  defaultTab = "all",
}: ActionCenterProps = {}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ActionTab>(defaultTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The Pending section is collapsible but starts OPEN every time the panel mounts.
  const [pendingOpen, setPendingOpen] = useState(true);

  // Pending action items across the user's projects (Open rows only — Surface A).
  const { data, isLoading, error } = useFrappeGetCall<GetActionItemsResponse>(
    "nirmaan_stack.api.action_items.read.get_my_action_items",
    undefined,
    "action-center-my-items",
    { revalidateOnFocus: false }
  );
  const rows = useMemo(() => data?.message?.action_items ?? [], [data]);

  const dnCount = useMemo(
    () => rows.filter((r) => r.action_type === "DN_PENDING").length,
    [rows]
  );
  const dcCount = useMemo(
    () => rows.filter((r) => r.action_type === "DC_PENDING").length,
    [rows]
  );

  // Rows for the active tab (DPR has no Project Action Item source yet).
  const tabRows = useMemo(() => {
    if (tab === "dn") return rows.filter((r) => r.action_type === "DN_PENDING");
    if (tab === "dc") return rows.filter((r) => r.action_type === "DC_PENDING");
    if (tab === "dpr") return [];
    return rows;
  }, [rows, tab]);

  // Group the active-tab rows by project, most-pending first.
  const groups = useMemo(() => {
    const byProject: Record<string, ActionItemRow[]> = {};
    tabRows.forEach((r) => {
      if (!byProject[r.project]) byProject[r.project] = [];
      byProject[r.project].push(r);
    });
    return Object.entries(byProject)
      .map(([project, items]) => ({
        project,
        projectName: items[0]?.project_name || project,
        items,
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [tabRows]);

  const toggle = (project: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });

  return (
    <aside
      className={cn(
        "w-full shrink-0 border-t border-gray-200 bg-white p-6 xl:w-[360px] xl:border-l xl:border-t-0",
        className
      )}
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          LIVE
        </span>
      </div>

      {/* Category tabs */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <StatTab label="All" count={dnCount + dcCount} dot="bg-red-500" active={tab === "all"} onClick={() => setTab("all")} />
        <StatTab label="DPR" count={0} dot="bg-blue-500" active={tab === "dpr"} onClick={() => setTab("dpr")} />
        <StatTab label="DN" count={dnCount} dot="bg-emerald-500" active={tab === "dn"} onClick={() => setTab("dn")} />
        <StatTab label="DC" count={dcCount} dot="bg-amber-500" active={tab === "dc"} onClick={() => setTab("dc")} />
      </div>

      <hr className="mb-4 border-gray-200" />

      {/* Project-wise pending list for the active tab */}
      {isLoading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t load pending actions.
        </p>
      ) : tab === "dpr" ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
          Daily Progress Reports aren&rsquo;t tracked here yet.
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
          All clear — no pending {TAB_EMPTY_LABEL[tab]} actions.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setPendingOpen((open) => !open)}
            aria-expanded={pendingOpen}
            className="flex w-full items-center gap-2 bg-white px-3 py-2.5 transition-colors hover:bg-gray-50"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <p className="text-md font-semibold uppercase text-red-600">
              Pending ({tabRows.length})
            </p>
            <ChevronDown
              className={`ml-auto h-4 w-4 text-red-400 transition-transform ${
                pendingOpen ? "" : "-rotate-90"
              }`}
            />
          </button>
          {pendingOpen && (
            <div className="space-y-2.5 border-t border-gray-200 bg-gray-100/70 p-2.5">
              {groups.map((group) => (
                <ProjectGroup
                  key={group.project}
                  projectName={group.projectName}
                  count={group.items.length}
                  items={group.items}
                  expanded={expanded.has(group.project)}
                  onToggle={() => toggle(group.project)}
                  onOpen={(item) =>
                    navigate(
                      item.action_type === "DN_PENDING"
                        ? `/prs&milestones/delivery-notes/${encodeFrappeId(
                            item.reference_name
                          )}?mode=create`
                        : item.action_url
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
