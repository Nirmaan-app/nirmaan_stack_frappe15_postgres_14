import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, CalendarDays, ChevronDown, ExternalLink, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { useBillingProjects, useManagerSummary, useMyBills } from "./data/useBillingQueries";
import type { BillingProjectRow, BillingTracker, ManagerSummaryResponse, SummaryCounts } from "./types";
import {
  TONE_CLASSES,
  Tone,
  columnTone,
  UNASSIGNED,
  assigneeOptions,
  dcFreshness,
  deadlineFilters,
  managerNames,
  projectStatusTone,
  statusTone,
  trackersAssignedTo,
} from "./utils/billingFormat";
import {
  ApprovalBar,
  ApprovalLegend,
  EtaCell,
  Money,
  PackageChip,
  PersonChip,
  SegmentedTabs,
  ToneTag,
} from "./components/BillingBits";
import { BillsDataTable } from "./components/BillsDataTable";
import { SupplyDcSheet } from "./components/SupplyDcSheet";

type View = "project" | "bill" | "mine";
const VIEWS: { value: View; label: string }[] = [
  { value: "project", label: "Project Wise" },
  { value: "bill", label: "Bill Wise" },
  { value: "mine", label: "My Bills" },
];

// Headers that wrap, for tables that must fit the page width without scrolling sideways.
const TH_FIT = "px-3 py-3 text-left text-[11px] font-semibold leading-tight tracking-wider text-muted-foreground xl:px-4";
const ALL = "__all__";

export default function BillingTrackerPage() {
  const [view, setView] = useState<View>(() => getUrlStringParam("tab", "project") as View);
  useEffect(() => {
    if (urlStateManager.getParam("tab") !== view) urlStateManager.updateParam("tab", view);
  }, [view]);

  const { data: projectsData } = useBillingProjects();
  const totals = projectsData?.message?.totals;
  // "—" until the first response, so the header never flashes zeros.
  const stat = (n?: number) => (totals ? n ?? 0 : "—");

  return (
    <div className="flex-1 space-y-5 pt-6 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-6 px-2">
        <div>
          <h2 className="border-l-4 border-primary pl-3 text-2xl font-bold tracking-tight text-gray-900">Billing Tracker</h2>
          <p className="mt-1 pl-4 text-sm text-muted-foreground">Track client billing progress across projects</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border">
          <div className="px-6 py-3 text-center">
            <div className="text-2xl font-bold">{stat(totals?.project_count)}</div>
            <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">PROJECTS</div>
          </div>
          <div className="border-l px-6 py-3 text-center">
            <div className="text-2xl font-bold">{stat(totals?.bill_count)}</div>
            <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">BILLS TRACKED</div>
          </div>
          <div className="border-l bg-amber-50 px-6 py-3 text-center">
            <div className="text-2xl font-bold text-amber-700">
              {stat(totals?.pending_count)}
              <span className="text-sm text-gray-400">/{stat(totals?.bill_count)}</span>
            </div>
            <div className="text-[10px] font-semibold tracking-wider text-amber-700">PENDING</div>
          </div>
        </div>
      </div>

      <div className="px-2">
        <SegmentedTabs value={view} onChange={setView} options={VIEWS} />
      </div>

      <div className="px-2">
        {view === "project" && <ProjectWiseView rows={projectsData?.message?.projects} />}
        {view === "bill" && <BillWiseView rows={projectsData?.message?.projects} />}
        {view === "mine" && <MyBillsView />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Project Wise */

/** A package's "next bill" line: the pending bill with the earliest ETA, picked by the server. */
function nextBillOf(pkg: BillingTracker): { billType: string; status: string; tone: Tone; eta: string | null } {
  if (pkg.next_bill) {
    return {
      billType: pkg.next_bill.bill_type,
      status: pkg.next_bill.status,
      tone: statusTone(pkg.next_bill.status),
      eta: pkg.next_bill.eta_date,
    };
  }
  if (pkg.bill_count > 0) return { billType: "—", status: "All bills approved", tone: "good", eta: null };
  return { billType: "—", status: "No bills yet", tone: "neutral", eta: null };
}

/** PO value, approved/awaiting bar and legend; the bar measures against the PO once one is entered. */
function PoProgress({ po, approved, billed, thin }: { po: number; approved: number; billed: number; thin?: boolean }) {
  return (
    <>
      <div className={cn("font-bold text-gray-900", thin ? "mb-1 text-[13px]" : "mb-1.5 text-sm")}>
        {po > 0 ? <Money value={po} /> : "—"}
      </div>
      <ApprovalBar approved={approved} billed={billed} total={po > 0 ? po : billed} />
      <ApprovalLegend approved={approved} billed={billed} />
    </>
  );
}

function ProjectWiseView({ rows }: { rows?: BillingProjectRow[] }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter(
      (r) => !q || `${r.project_name} ${r.project} ${r.managers.join(" ")}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  if (!rows) return <TableSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative min-w-[280px] flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
          <Input
            className="h-10 pl-10"
            placeholder="Search by project name or manager…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {visible.length} of {rows.length} projects
        </span>
      </div>

      {!visible.length ? (
        <div className="rounded-xl border bg-white px-6 py-14 text-center text-sm text-muted-foreground">
          {rows.length ? "No projects match this search." : "No project has billing set up yet. Set it up from a project's Billing tab."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full border-collapse tabular-nums">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className={TH_FIT}>PROJECT</th>
                <th className={TH_FIT}>ASSIGNED</th>
                <th className={TH_FIT}>PROJECT TOTAL · APPROVED · AWAITING</th>
                <th className={cn(TH_FIT, "text-right")}>SUPPLY DC TILL DATE</th>
                <th className={cn(TH_FIT, "text-right")}>BILLS</th>
              </tr>
            </thead>
            {visible.map((row) => {
              const open = !!expanded[row.project];
              const notes = row.packages.filter((p) => p.remarks?.trim());
              return (
                <tbody key={row.project}>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-3 xl:px-4">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <button
                          type="button"
                          aria-label={open ? "Hide packages and notes" : "Show packages and notes"}
                          aria-expanded={open}
                          onClick={() => setExpanded((e) => ({ ...e, [row.project]: !open }))}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border bg-white"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                        </button>
                        <span className="text-sm font-semibold">{row.project_name}</span>
                        {row.status && (
                          <span
                            className={cn(
                              "rounded-[5px] border px-2 py-0.5 text-[11px] font-bold",
                              TONE_CLASSES[projectStatusTone(row.status)],
                            )}
                          >
                            {row.status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 xl:px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {row.managers.map((m) => (
                          <PersonChip key={m} label={m} className="whitespace-normal" />
                        ))}
                      </div>
                    </td>
                    <td className="min-w-[170px] px-3 py-3 xl:min-w-[240px] xl:px-4">
                      <PoProgress po={row.po_value} approved={row.approved} billed={row.billed} />
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-medium xl:px-4">
                      {row.supply_dc ? <Money value={row.supply_dc} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right xl:px-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/billing-tracker/${encodeURIComponent(row.project)}`)}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold text-primary hover:underline"
                      >
                        View Bills <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>

                  {open &&
                    row.packages.map((pkg) => {
                      const next = nextBillOf(pkg);
                      return (
                        <tr key={pkg.name} className="border-b border-gray-100 bg-gray-50/60">
                          <td colSpan={5} className="p-0">
                            {/* One line on wide screens (fixed columns, aligned across packages); wraps below xl. */}
                            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-2.5 pl-12 pr-4 xl:grid xl:grid-cols-[14px_110px_130px_120px_170px_minmax(0,1fr)_240px] xl:gap-x-3">
                              <span
                                aria-hidden
                                className="mt-1.5 h-[9px] w-3.5 shrink-0 border-b-[1.5px] border-l-[1.5px] border-gray-300"
                              />
                              <div className="min-w-[110px]">
                                <PackageChip label={pkg.package} />
                              </div>
                              <div className="min-w-[120px] pt-0.5 text-xs text-muted-foreground">
                                {managerNames(pkg.billing_managers).join(", ") || "Unassigned"}
                              </div>
                              <div className="flex min-w-[110px] items-baseline gap-1.5 pt-0.5">
                                <span className="text-[11px] text-gray-400">Next bill</span>
                                <span className="text-[13px] font-semibold text-gray-700">{next.billType}</span>
                              </div>
                              <div className="min-w-[150px]">
                                <span
                                  className={cn(
                                    "inline-block rounded-[5px] border px-2 py-0.5 text-[11px] font-semibold",
                                    TONE_CLASSES[next.tone],
                                  )}
                                >
                                  {next.status}
                                </span>
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-[11px] text-gray-400">Deadline</span>
                                <EtaCell eta={next.eta} className="flex-wrap gap-y-1" />
                              </div>
                              <div className="ml-auto w-[240px] max-w-full xl:ml-0 xl:w-auto">
                                <PoProgress po={pkg.po_value} approved={pkg.approved} billed={pkg.billed} thin />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                  {open && (
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <td colSpan={5} className="p-0">
                        <div className="flex items-start gap-2.5 pb-3.5 pl-12 pr-4 pt-2.5">
                          <span className="mt-px text-[11px] font-bold tracking-wider text-gray-400">NOTES</span>
                          {notes.length ? (
                            <div className="space-y-0.5 text-[13px] text-gray-600">
                              {notes.map((p) => (
                                <div key={p.name}>
                                  <span className="font-semibold text-gray-700">{p.package}:</span> {p.remarks}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[13px] text-gray-600">No notes recorded.</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Bill Wise */

function BillWiseView({ rows }: { rows?: BillingProjectRow[] }) {
  const [manager, setManager] = useState(ALL);
  const [deadline, setDeadline] = useState(ALL);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data: summaryData } = useManagerSummary(deadline === ALL ? undefined : deadline);
  const summary = summaryData?.message;

  const trackers = useMemo(() => (rows ?? []).flatMap((r) => r.packages), [rows]);
  const projectNames = useMemo(() => new Map((rows ?? []).map((r) => [r.project, r.project_name])), [rows]);
  const projectNameOf = useCallback((project: string) => projectNames.get(project) || project, [projectNames]);
  const managers = useMemo(() => assigneeOptions(trackers), [trackers]);

  // Managers live on the package tracker, so "manager" filters to the trackers they are one of the managers of.
  // Both filters drive the summary grid AND the bills table below.
  const scopeFilters = useMemo(() => {
    const filters: any[] = [];
    if (manager !== ALL) {
      const theirs = trackersAssignedTo(trackers, [manager]);
      filters.push(["billing_tracker", "in", theirs.length ? theirs : ["__none__"]]);
    }
    if (deadline !== ALL) filters.push(...deadlineFilters(deadline));
    return filters;
  }, [manager, deadline, trackers]);
  const summaryRows = useMemo(
    () =>
      (summary?.managers ?? []).filter(
        (m) => manager === ALL || (manager === UNASSIGNED ? !m.manager : m.manager === manager),
      ),
    [summary, manager],
  );

  if (!summary || !rows) return <TableSkeleton />;

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-[15px] font-bold">Billing Manager Summary</span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
            {summaryRows.length} manager{summaryRows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-5 py-3">
          <label className="flex items-center gap-2.5 text-sm font-semibold text-gray-700">
            Manager
            <Select value={manager} onValueChange={setManager}>
              <SelectTrigger className="h-9 w-[200px] bg-white font-normal" aria-label="Manager">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All managers</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-gray-700">
            Deadline
            <Select value={deadline} onValueChange={setDeadline}>
              <SelectTrigger className="h-9 w-[190px] bg-white font-normal" aria-label="Deadline">
                <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All deadlines</SelectItem>
                <SelectItem value="week">Due within 7 days</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="none">No ETA set</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="overflow-hidden">
          <table className="w-full border-collapse tabular-nums">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className={cn(TH_FIT, "px-5")}>BILLING MANAGER</th>
                {summary?.columns.map((c) => (
                  <th key={c.key} className={cn(TH_FIT, "text-center")}>
                    <span className="inline-flex items-center justify-center gap-1">
                      {c.label.toUpperCase()}
                      <ColumnInfo column={c} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {summaryRows.map((m) => {
              const key = m.manager || "unassigned";
              const open = !!expanded[key];
              return (
                <tbody key={key}>
                  <tr className="border-b border-gray-100">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          aria-label="Show projects"
                          onClick={() => setExpanded((e) => ({ ...e, [key]: !open }))}
                          className="flex h-6 w-6 items-center justify-center rounded border bg-white"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                        </button>
                        <span className="text-sm font-semibold">{m.manager_name}</span>
                        <span className="text-xs text-gray-400">
                          {m.projects.length} project{m.projects.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </td>
                    {summary!.columns.map((c) => (
                      <CountCell key={c.key} n={m.counts[c.key]} column={c} byStatus={m.by_status} />
                    ))}
                  </tr>
                  {open &&
                    m.projects.map((p) => (
                      <tr key={p.project} className="border-b border-gray-100 bg-gray-50/60">
                        <td className="whitespace-nowrap px-5 py-2 pl-14 text-[13px] text-gray-700">{p.project_name}</td>
                        {summary!.columns.map((c) => (
                          <CountCell key={c.key} n={p.counts[c.key]} column={c} byStatus={p.by_status} small />
                        ))}
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>

      <BillsDataTable
        scopeFilters={scopeFilters}
        trackers={trackers}
        projectNameOf={projectNameOf}
        showProject
        showManager
        urlSyncKey="billing_bill_wise"
        exportFileName="Bills"
      />
    </div>
  );
}

type SummaryColumn = ManagerSummaryResponse["columns"][number];

/** The (i) beside a summary column's header: which bill statuses that column counts. */
function ColumnInfo({ column }: { column: SummaryColumn }) {
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`What ${column.label} counts`}
          className="text-gray-400 transition-colors hover:text-gray-700"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-auto p-2.5 normal-case tracking-normal">
        <div className="mb-1.5 text-xs font-semibold text-gray-900">{column.label} counts</div>
        <div className="flex flex-col items-start gap-1">
          {column.statuses.map((status) => (
            <ToneTag key={status} label={status} tone={statusTone(status)} />
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function CountCell({
  n,
  column,
  byStatus,
  small,
}: {
  n?: number;
  column: SummaryColumn;
  byStatus: SummaryCounts;
  small?: boolean;
}) {
  // Only the statuses this count is actually made of.
  const parts = column.statuses.filter((status) => byStatus[status] > 0);
  return (
    <td className="px-3.5 py-2.5 text-center">
      {n ? (
        <HoverCard openDelay={150} closeDelay={100}>
          <HoverCardTrigger asChild>
            <span
              className={cn(
                "inline-block min-w-[30px] cursor-default rounded-md border px-2 py-0.5 font-semibold",
                small ? "text-xs" : "text-[13px]",
                TONE_CLASSES[columnTone(column.statuses)],
              )}
            >
              {n}
            </span>
          </HoverCardTrigger>
          <HoverCardContent side="top" align="center" className="w-auto min-w-[170px] p-2.5">
            <div className="mb-1.5 text-xs font-semibold text-gray-900">
              {column.label} · {n} bill{n === 1 ? "" : "s"}
            </div>
            <div className="space-y-1">
              {parts.map((status) => (
                <div key={status} className="flex items-center justify-between gap-4">
                  <ToneTag label={status} tone={statusTone(status)} />
                  <span className="text-xs font-semibold tabular-nums text-gray-900">{byStatus[status]}</span>
                </div>
              ))}
            </div>
          </HoverCardContent>
        </HoverCard>
      ) : (
        <span className="text-sm text-gray-300">–</span>
      )}
    </td>
  );
}

/* ---------------------------------------------------------------- My Bills */

function MyBillsView() {
  const { data, isLoading } = useMyBills();
  const mine = data?.message;
  const [dcOpen, setDcOpen] = useState(false);

  const trackers = useMemo(() => mine?.trackers ?? [], [mine]);
  const projectNames = useMemo(() => new Map(trackers.map((t) => [t.project || "", t.project_name || ""])), [trackers]);
  const projectNameOf = useCallback((project: string) => projectNames.get(project) || project, [projectNames]);
  const scopeFilters = useMemo(() => [["billing_tracker", "in", trackers.map((t) => t.name)]], [trackers]);
  // The packages this user may log Supply DC for (here: the ones they manage).
  const dcTrackers = useMemo(() => trackers.filter((t) => t.can_edit_bills), [trackers]);

  if (isLoading || !mine) return <TableSkeleton />;

  const stale = dcTrackers.filter((t) => !dcFreshness(t.dc_updated_on).isToday).length;
  const initials = (mine.user_name || mine.user)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">
              {initials}
            </div>
            <div>
              <h3 className="text-lg font-bold">{mine.user_name}</h3>
              <p className="text-sm text-muted-foreground">
                {mine.trackers.length
                  ? `Billing manager · ${mine.trackers.length} package${mine.trackers.length === 1 ? "" : "s"} · ${mine.counts.total} bill${mine.counts.total === 1 ? "" : "s"}`
                  : "No billing packages are assigned to you"}
              </p>
            </div>
          </div>
          {dcTrackers.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setDcOpen(true)}
              className={cn(stale && "border-amber-200 bg-amber-50 text-amber-700")}
            >
              <BarChart3 className="mr-2 h-4 w-4" /> Update Supply DC
              <span
                className={cn(
                  "ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold",
                  stale ? "bg-primary text-white" : "bg-green-50 text-green-700",
                )}
              >
                {stale}
              </span>
            </Button>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4">
          {[
            { label: "MY BILLS", value: mine.counts.total, cls: "" },
            { label: "PENDING", value: mine.counts.pending, cls: "bg-amber-50 text-amber-700" },
            { label: "DUE IN 7 DAYS", value: mine.counts.due_in_7_days, cls: "bg-blue-50 text-blue-700" },
            {
              label: "OVERDUE",
              value: mine.counts.overdue,
              cls: mine.counts.overdue ? "text-red-700" : "text-green-700",
            },
          ].map((s, i) => (
            <div key={s.label} className={cn("px-5 py-3.5", i > 0 && "border-l", s.cls)}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-[10px] font-semibold tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {trackers.length ? (
        <BillsDataTable
          scopeFilters={scopeFilters}
          trackers={trackers}
          projectNameOf={projectNameOf}
          showProject
          urlSyncKey="billing_my_bills"
          exportFileName="My_Bills"
        />
      ) : (
        <div className="rounded-xl border bg-white px-6 py-14 text-center text-sm text-muted-foreground">
          No bills are assigned to you yet.
        </div>
      )}
      <SupplyDcSheet open={dcOpen} onOpenChange={setDcOpen} trackers={dcTrackers} showProject />
    </div>
  );
}
