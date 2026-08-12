import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import { formatDate } from "@/utils/FormatDate";
import { exportToCsv } from "@/utils/exportToCsv";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  Search,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useMonthlyWIPData,
  useWipMonthOptions,
  WipCompliance,
  WipMonthlyRow,
  WipPeriod,
} from "./useMonthlyWIPData";
import { WipFormulaDialog } from "./WipFormulaDialog";

// Column model lives in wipColumns.ts — shared with WipFormulaDialog, which renders
// its help text from the SAME arrays that drive this table, so a rule change updates
// both in one edit. It sits in its own module so the page and the dialog never import
// each other in a cycle.
import {
  COLUMN_GROUPS,
  NUMERIC_COLUMNS,
  type NumericColumn,
  type SortKey,
} from "./wipColumns";

/** A visible vertical divider between column groups — runs continuously through
 *  the header band and every body row (applied to each group's first column). */
const GROUP_EDGE = "border-l-2 border-muted-foreground/40";
/** A very lean 1px rule between the individual columns WITHIN a group. */
const LEAN_EDGE = "border-l border-border/50";
/** Layout widths as PERCENTAGES so the table always fills the viewport exactly —
 *  no horizontal scroll on a laptop; every column scales with the available width.
 *  Sum: 2 + 14 + 9·2 + 6·11 = 100. Numeric columns stay tight (the group header
 *  carries the wider context). */
const COL_W = { chevron: "2%", project: "14%", date: "9%", num: "6%" } as const;
/** chevron + project + start + end + every numeric column. */
const TOTAL_COLS = 4 + NUMERIC_COLUMNS.length;

/** 0 rendered muted so real gaps read louder than compliant zeros. */
const numFmt = (n: number) => (n ? n : <span className="text-muted-foreground">0</span>);

const monthLabel = (options: { value: string; label: string }[], month: string) =>
  options.find((o) => o.value === month)?.label ?? month;

/**
 * Clamp an active period's actual start/end to the SELECTED month for display.
 * The `days_active` figure is already month-scoped; the dates must read the same
 * way. Actual (lifetime) dates go into `tooltip` for hover ("show both").
 */
interface ClampedWip {
  dispStart: string;   // formatted, clamped to month start
  dispEnd: string;     // formatted (clamped) or "Ongoing"
  carriedIn: boolean;  // WIP began before this month
  carriedOut: boolean; // WIP continues after this month (or ongoing)
  ongoing: boolean;
  tooltip: string;     // actual lifetime range
  actualStart: string; // formatted actual entry date
  actualEnd: string;   // formatted actual exit date, or "Ongoing"
}

function clampWip(actualStart: string, actualEnd: string, month: string): ClampedWip {
  const [y, m] = month.split("-").map(Number);              // m is 1-based
  const monthStart = new Date(y, m - 1, 1);
  const monthEndExcl = new Date(y, m, 1);                    // first of next month
  const monthLastDay = new Date(y, m, 0);                    // last day of this month

  const start = new Date(`${actualStart}T00:00:00`);
  const ongoing = actualEnd === "ongoing";
  const end = ongoing ? null : new Date(`${actualEnd}T00:00:00`);

  const carriedIn = start < monthStart;
  const dispStart = formatDate(carriedIn ? monthStart : start);

  let dispEnd: string;
  let carriedOut = false;
  if (ongoing) {
    dispEnd = "Ongoing";
    carriedOut = true;
  } else if (end! >= monthEndExcl) {
    carriedOut = true;                                        // left after this month
    dispEnd = formatDate(monthLastDay);
  } else {
    dispEnd = formatDate(end!);                               // left within this month
  }

  const actualStartFmt = formatDate(start);
  const actualEndFmt = ongoing ? "Ongoing" : formatDate(end!);
  const tooltip = `Actual: ${actualStartFmt} → ${actualEndFmt}`;
  return {
    dispStart,
    dispEnd,
    carriedIn,
    carriedOut,
    ongoing,
    tooltip,
    actualStart: actualStartFmt,
    actualEnd: actualEndFmt,
  };
}

// --------------------------------------------------------------------------- //
// Presentational cells (shared by the project row and its stint sub-rows).
// --------------------------------------------------------------------------- //

/** Small muted "actual: <date>" line shown under a clamped date when they differ. */
const ActualLine = ({ date }: { date: string }) => (
  <div className="text-[10px] text-muted-foreground">actual: {date}</div>
);

const CarriedIn = () => (
  <span className="ml-1 text-[10px] text-muted-foreground" title="Was already active before this month">
    ← earlier
  </span>
);
const CarriedOut = () => (
  <span className="ml-1 text-[10px] text-muted-foreground" title="Still active after this month">
    continues →
  </span>
);
const BADGE_SIZE = "px-1.5 py-0 text-[10px] font-normal leading-tight";

const OngoingBadge = () => (
  <Badge variant="outline" className={`${BADGE_SIZE} border-green-500 text-green-600`}>
    Ongoing
  </Badge>
);

/** WIP = sky, Handover = amber — a compact status chip. */
const StatusBadge = ({ status }: { status: string }) => (
  <Badge
    variant="outline"
    className={`${BADGE_SIZE} ${
      status === "Handover"
        ? "border-amber-500 text-amber-600"
        : "border-sky-500 text-sky-600"
    }`}
  >
    {status}
  </Badge>
);

const StartCell = ({ c, small }: { c: ClampedWip; small?: boolean }) => (
  <TableCell className={cn(LEAN_EDGE, small && "text-sm")} title={c.tooltip}>
    <div>
      {c.dispStart}
      {c.carriedIn && <CarriedIn />}
    </div>
    {c.carriedIn && <ActualLine date={c.actualStart} />}
  </TableCell>
);

const EndCell = ({ c, small }: { c: ClampedWip; small?: boolean }) => (
  <TableCell className={cn(LEAN_EDGE, small && "text-sm")} title={c.tooltip}>
    {c.ongoing ? (
      <OngoingBadge />
    ) : (
      <>
        <div>
          {c.dispEnd}
          {c.carriedOut && <CarriedOut />}
        </div>
        {c.carriedOut && <ActualLine date={c.actualEnd} />}
      </>
    )}
  </TableCell>
);

// Numeric columns are tight (see COL_W.num) — trim shadcn's default p-4 side padding.
const NUM_CELL = "text-center tabular-nums !px-2";

/** Deep link into a project's DN > DC report with one status pre-selected.
 *  `dcmir_tab` / `dcmir_parent` are the params ProjectDCMIRTab already reads on mount;
 *  `dndc_status` is read by DNDCQuantityReport to seed its Status filter. */
const dndcReportHref = (project: string, status: string) =>
  `/projects/${project}?page=projectdcmir&dcmir_tab=DN_DC&dcmir_parent=PO&dndc_status=${status}`;

/** "N Billable · M Non-Billable" for the two columns that count both, else undefined.
 *  Guarded on the field being a number: an older payload carries neither, and
 *  "undefined Billable · NaN Non-Billable" is worse than no tooltip at all. */
const billableSplitHint = (row: WipMonthlyRow, key: NumericColumn["key"]) => {
  const billable =
    key === "total_dn"
      ? row.total_dn_billable
      : key === "dispatched_po"
        ? row.dispatched_po_billable
        : undefined;
  if (typeof billable !== "number") return undefined;
  return `${billable} Billable · ${row[key] - billable} Non-Billable`;
};

const NumberCell = ({
  value,
  col,
  small,
  project,
  hint,
}: {
  value: number;
  col: NumericColumn;
  small?: boolean;
  /** Hover text for the cell. Used by Total DN to show its Billable split. */
  hint?: string;
  /** Present on a project row, absent on a stint sub-row. A cell only links when the
   *  column declares a `linkStatus` AND the value is non-zero — linking a 0 would land
   *  the reader on an empty report. */
  project?: string;
}) => {
  const linkable = project && col.linkStatus && value > 0;

  // `inline`, not `inline-flex`: text-decoration does not run across a flex container's
  // items, so the icon would sit outside the underline. Inline layout puts the number and
  // the SVG in the same line box, and the hover underline spans both.
  const body = linkable ? (
    <Link
      to={dndcReportHref(project!, col.linkStatus!)}
      className="inline text-red-600 underline-offset-2 hover:underline dark:text-blue-400"
    >
      {numFmt(value)}
      <ExternalLink className="ml-1 text-blue-600 inline h-3 w-3 align-text-top" aria-hidden="true" />
    </Link>
  ) : (
    numFmt(value)
  );

  const cell = (
    <TableCell
      className={cn(
        NUM_CELL,
        // A hover with no visual cue is a feature nobody finds. The dotted underline is
        // the conventional "there is more here" affordance and costs no row height.
        hint && "decoration-dotted underline underline-offset-4 decoration-muted-foreground/50",
        small && "text-sm",
        col.emphasize && "font-medium",
        // A linked cell owns its own colour (blue); the danger red would fight it.
        col.danger && value > 0 && !linkable && "font-semibold text-red-600 dark:text-red-500",
        col.groupStart ? GROUP_EDGE : LEAN_EDGE,
      )}
    >
      {body}
    </TableCell>
  );

  // A real Tooltip rather than a native `title`: the native one waits ~1s, is unstyled and
  // is easy to miss entirely — which is exactly what happened with the Total DN split.
  if (!hint) return cell;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>{cell}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/** Lifetime column on a stint row — a muted em-dash (G4/G5 are project-level). */
const DashCell = ({ col }: { col: NumericColumn }) => (
  <TableCell className={cn(NUM_CELL, "text-sm text-muted-foreground/40", col.groupStart ? GROUP_EDGE : LEAN_EDGE)}>
    —
  </TableCell>
);

/** Distinct statuses across a row's stints, e.g. "WIP + Handover". */
const rowStatuses = (r: WipMonthlyRow) =>
  Array.from(new Set(r.periods.map((p) => p.status))).join(" + ");

// --------------------------------------------------------------------------- //
// CSV export — one "Total" row per project + a labeled row per stint (multi-stint
// only). G4/G5 are lifetime & project-level, so they carry "" on stint rows.
// --------------------------------------------------------------------------- //
interface ExportRow {
  project: string;
  row: string;             // "Total" | "Stint 1" | "Stint 2" ...
  status: string;
  start_in_month: string;
  end_in_month: string;
  actual_start: string;
  actual_end: string;
  active_days: number;     // active working days (excl. Sundays)
  total_dpr_days: number;
  missing_dpr_days: number;
  expected_inventory: number;
  actual_inventory: number;
  missing_inventory: number;
  dispatched_po: number | "";
  total_dn: number | "";
  missing_dn: number | "";
  total_dc: number | "";
  missing_dc: number | "";
}

const EXPORT_COLUMNS: ColumnDef<ExportRow, any>[] = [
  { accessorKey: "project", header: "Project", meta: { exportHeaderName: "Project" } },
  { accessorKey: "row", header: "Row", meta: { exportHeaderName: "Row" } },
  { accessorKey: "status", header: "Status", meta: { exportHeaderName: "Status" } },
  { accessorKey: "start_in_month", header: "Start", meta: { exportHeaderName: "Start (in month)" } },
  { accessorKey: "end_in_month", header: "End", meta: { exportHeaderName: "End (in month)" } },
  { accessorKey: "actual_start", header: "Actual Start", meta: { exportHeaderName: "Actual Start" } },
  { accessorKey: "actual_end", header: "Actual End", meta: { exportHeaderName: "Actual End" } },
  { accessorKey: "active_days", header: "Active Days", meta: { exportHeaderName: "Active Days (excl. Sun)" } },
  { accessorKey: "total_dpr_days", header: "Total DPR Days", meta: { exportHeaderName: "Total DPR Days" } },
  { accessorKey: "missing_dpr_days", header: "Missing DPR Days", meta: { exportHeaderName: "Missing DPR Days" } },
  { accessorKey: "expected_inventory", header: "Expected Inventory", meta: { exportHeaderName: "Expected Inventory" } },
  { accessorKey: "actual_inventory", header: "Actual Inventory", meta: { exportHeaderName: "Actual Inventory" } },
  { accessorKey: "missing_inventory", header: "Missing Inventory", meta: { exportHeaderName: "Missing Inventory" } },
  { accessorKey: "dispatched_po", header: "Dispatched POs", meta: { exportHeaderName: "Dispatched POs (lifetime)" } },
  { accessorKey: "total_dn", header: "Total DN", meta: { exportHeaderName: "Total DN (lifetime)" } },
  { accessorKey: "missing_dn", header: "Missing DN", meta: { exportHeaderName: "Missing DN (POs, lifetime)" } },
  { accessorKey: "total_dc", header: "Total DC", meta: { exportHeaderName: "Total DC (lifetime)" } },
  { accessorKey: "missing_dc", header: "Missing DC", meta: { exportHeaderName: "Missing DC (POs, lifetime)" } },
];

/** Group-header row for the CSV (merged-cell style — label at each group's first
 *  column, aligned with the on-screen two-tier header). Keyed by accessorKey. */
const EXPORT_GROUP_HEADERS: Record<string, string> = {
  active_days: "DPR · Daily (excl. Sun)",
  expected_inventory: "Inventory · Weekly (Mon)",
  dispatched_po: "PO Dispatch · Lifetime",
  total_dc: "DC · Lifetime",
};

function buildExportRows(rows: WipMonthlyRow[], month: string): ExportRow[] {
  const clampedLabels = (start: string, end: string) => {
    const c = clampWip(start, end, month);
    return {
      startIn: c.dispStart + (c.carriedIn ? " (from earlier)" : ""),
      endIn: c.ongoing ? "Ongoing" : c.dispEnd + (c.carriedOut ? " (continues)" : ""),
    };
  };
  const fmtEnd = (end: string) => (end === "ongoing" ? "Ongoing" : formatDate(end));

  // Fields shared by a project Total row and its stint rows (the day-based block).
  const compliance = (x: WipCompliance) => ({
    active_days: x.active_working_days,
    total_dpr_days: x.total_dpr_days,
    missing_dpr_days: x.missing_dpr_days,
    expected_inventory: x.expected_inventory,
    actual_inventory: x.actual_inventory,
    missing_inventory: x.missing_inventory,
  });

  const out: ExportRow[] = [];
  for (const r of rows) {
    const t = clampedLabels(r.active_start, r.active_end);
    out.push({
      project: r.project_name,
      row: "Total",
      status: rowStatuses(r),
      start_in_month: t.startIn,
      end_in_month: t.endIn,
      actual_start: formatDate(r.active_start),
      actual_end: fmtEnd(r.active_end),
      ...compliance(r),
      dispatched_po: r.dispatched_po,
      total_dn: r.total_dn,
      missing_dn: r.missing_dn,
      total_dc: r.total_dc,
      missing_dc: r.missing_dc,
    });
    if (r.stints > 1) {
      r.periods.forEach((p, i) => {
        const s = clampedLabels(p.start, p.end);
        out.push({
          project: "",           // blank so the stint nests under its project's Total row
          row: `Stint ${i + 1}`,
          status: p.status,
          start_in_month: s.startIn,
          end_in_month: s.endIn,
          actual_start: formatDate(p.start),
          actual_end: fmtEnd(p.end),
          ...compliance(p),
          // G4/G5 are lifetime & project-level — blank on stint rows.
          dispatched_po: "", total_dn: "", missing_dn: "", total_dc: "", missing_dc: "",
        });
      });
    }
  }
  return out;
}

export default function MonthlyWIPPage() {
  const { options, isLoading: optionsLoading } = useWipMonthOptions();
  const [month, setMonth] = useState<string>("");

  // Default to the most-recent month once the dropdown options arrive.
  useEffect(() => {
    if (!month && options.length) setMonth(options[0].value);
  }, [options, month]);

  const { report, isLoading, error } = useMonthlyWIPData(month);
  const rows = report?.rows ?? [];
  const reportMonth = report?.month ?? month;

  const [search, setSearch] = useState("");
  /** Multi-select project facet — holds project DOCNAMES (`row.project`), not names. */
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());

  // A project selected in one month may not be active in another, so carrying the
  // selection across a month switch can filter the new month down to an empty table
  // that reads as a broken report. Clear it and always show the new month's real set.
  const handleMonthChange = (next: string) => {
    setMonth(next);
    setProjectFilter(new Set());
  };

  /**
   * Facet options come from the ALREADY-FETCHED rows, so the list offers exactly the
   * projects that have a row this month — a project that could only ever yield zero
   * rows is never offered. No fetch, and nothing to keep in sync with the row set.
   *
   * Keyed on `project` (the docname) rather than `project_name`: unlike the sibling
   * DC/DN reports, that makes it duplicate-name-safe. No `(count)` suffix either —
   * a project has exactly ONE row per month, so every count would read "(1)".
   */
  const projectFacetOptions = useMemo(
    () =>
      rows
        .map((r) => ({ label: r.project_name || r.project, value: r.project }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rows]
  );

  const [sortKey, setSortKey] = useState<SortKey>("active_working_days");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "project_name" ? "asc" : "desc");
    }
  };

  const displayRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = q ? rows.filter((r) => r.project_name.toLowerCase().includes(q)) : rows;
    // Composes with search (both narrow) and runs BEFORE the sort. `expanded` needs no
    // cleanup — a filtered-out project's key just stops being rendered.
    if (projectFilter.size) filtered = filtered.filter((r) => projectFilter.has(r.project));
    return [...filtered].sort((a, b) => {
      if (sortKey === "project_name") {
        const cmp = a.project_name.localeCompare(b.project_name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const diff = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, search, projectFilter, sortKey, sortDir]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (project: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(project) ? next.delete(project) : next.add(project);
      return next;
    });

  // Export mirrors what's on screen — current sort + search, not the raw payload.
  const handleExport = () => {
    if (!displayRows.length) return;
    exportToCsv(`Monthly_WIP_${reportMonth}`, buildExportRows(displayRows, reportMonth), EXPORT_COLUMNS, {
      groupHeaders: EXPORT_GROUP_HEADERS,
    });
  };

  const sortHead = (label: string, k: SortKey, align = false, extraClass = "") => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
    return (
      <TableHead key={k} className={cn(align && "text-center !px-2 text-xs whitespace-normal break-words", extraClass)}>
        <button
          type="button"
          onClick={() => handleSort(k)}
          className={cn("inline-flex items-center gap-1 hover:text-foreground", align && "justify-center")}
        >
          {label}
          <Icon className={cn("h-3 w-3", active ? "text-foreground" : "text-muted-foreground/50")} />
        </button>
      </TableHead>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header line — title + count pill on the left, controls right-aligned. The
          explanatory paragraph sits BELOW this row (see next block) so the title and the
          month picker land on the same line and the eye reaches the controls first. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Monthly WIP &amp; Handover</h1>
          {/* Absorbs the old "N projects active during <month>" line. Shows the VISIBLE
              count when the list is narrowed, so the pill can never contradict the table. */}
          {!isLoading && !error && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {displayRows.length === rows.length
                ? `${rows.length} project${rows.length === 1 ? "" : "s"}`
                : `${displayRows.length} of ${rows.length} projects`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={handleMonthChange} disabled={optionsLoading}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Select month" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!displayRows.length}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <WipFormulaDialog />
        </div>
      </div>

      {/* Moved down from beside the title. Carries the active month, which the count
          pill above deliberately does not repeat. */}
      <p className="text-sm text-muted-foreground">
        Active during{" "}
        <span className="font-medium text-foreground">{monthLabel(options, month)}</span>. DPR
        (daily, Sundays excluded) and Inventory (weekly, each active Monday) are scoped to the
        selected month. PO Dispatch and DC are <span className="font-medium">lifetime</span>{" "}
        totals — unaffected by the month picker. Hover dates for the actuals.
      </p>

      {/* Search + project facet */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search project…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <SimpleFacetedFilter
          title="Project"
          triggerLabel="Filter projects"
          contentClassName="w-[280px]"
          options={projectFacetOptions}
          selectedValues={projectFilter}
          onSelectedValuesChange={setProjectFilter}
        />
      </div>

      {/* Table.
          `max-h` + `overflow-auto` make this a BOUNDED scroll container, which is what
          lets the header stick (a sticky <thead> has nothing to stick to while the page
          itself is the scroller — and `overflow-x: auto` alone already computes
          `overflow-y` to auto, so the sticky was inert either way).
          Mirrors the DN > DC report's table, which is the established pattern here. */}
      <div className="rounded-md border overflow-auto max-h-[70vh]">
        {/* min-w is what fixes tablet/mobile. The colgroup below is PERCENTAGES, so a
            table-fixed layout can never exceed its container — it just squeezes every
            column until the whole grid is unreadable, and the wrapper's overflow-x never
            engages. The floor is those same percentages at their smallest readable size:
            chevron 22 + project 154 + dates 99x2 + numeric 66x11 = 1100. At any content
            width at or above that the percentages fill exactly as before, so desktop is
            unchanged; below it the table holds its width and scrolls sideways instead. */}
        <Table className="table-fixed min-w-[1100px]">
          <colgroup>
            <col style={{ width: COL_W.chevron }} />
            <col style={{ width: COL_W.project }} />
            <col style={{ width: COL_W.date }} />
            <col style={{ width: COL_W.date }} />
            {NUMERIC_COLUMNS.map((col) => (
              <col key={col.key} style={{ width: COL_W.num }} />
            ))}
          </colgroup>
          {/* Opaque background is load-bearing: the group row's bg-muted/60 is
              semi-transparent, so rows would scroll through it without this. */}
          <TableHeader className="sticky top-0 z-20 bg-background">
            {/* Group row — a distinct banded header so each group reads as a block */}
            <TableRow className="border-b-0 bg-muted/60 hover:bg-muted/60">
              <TableHead rowSpan={2} />
              {COLUMN_GROUPS.map((g, i) => (
                <TableHead
                  key={g.label}
                  colSpan={g.span}
                  className={cn(
                    "h-9 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground",
                    i > 0 && GROUP_EDGE
                  )}
                >
                  {g.label}
                </TableHead>
              ))}
            </TableRow>
            {/* Column row */}
            <TableRow className="hover:bg-transparent">
              {sortHead("Project", "project_name", false, LEAN_EDGE)}
              <TableHead className={LEAN_EDGE}>Active Start</TableHead>
              <TableHead className={LEAN_EDGE}>Active End</TableHead>
              {NUMERIC_COLUMNS.map((col) =>
                sortHead(col.label, col.key, true, col.groupStart ? GROUP_EDGE : LEAN_EDGE)
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={TOTAL_COLS} className="h-24 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && !isLoading && (
              <TableRow>
                <TableCell colSpan={TOTAL_COLS} className="h-24 text-center text-destructive">
                  Failed to load the report.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && displayRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={TOTAL_COLS} className="h-24 text-center text-muted-foreground">
                  {rows.length === 0
                    ? "No projects were active (WIP or Handover) during this month."
                    : "No projects match your search or project filter."}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !error &&
              displayRows.map((row) => {
                const isOpen = expanded.has(row.project);
                const canExpand = row.stints > 1;
                const c = clampWip(row.active_start, row.active_end, reportMonth);
                const distinctStatuses = Array.from(new Set(row.periods.map((p) => p.status)));
                return (
                  <Fragment key={row.project}>
                    <TableRow
                      className={canExpand ? "cursor-pointer" : ""}
                      onClick={canExpand ? () => toggle(row.project) : undefined}
                    >
                      <TableCell className="bg-muted/60 p-0 pl-2">
                        {canExpand ? (
                          isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className={cn("font-medium break-words", LEAN_EDGE)}>
                        <Link
                          to={`/projects/${row.project}?page=overview`}
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.project_name}
                        </Link>
                        <div className="mt-1 flex items-center gap-1">
                          {distinctStatuses.map((s) => (
                            <StatusBadge key={s} status={s} />
                          ))}
                          {canExpand && (
                            <span className="text-xs text-muted-foreground">({row.stints} stints)</span>
                          )}
                        </div>
                      </TableCell>
                      <StartCell c={c} />
                      <EndCell c={c} />
                      {NUMERIC_COLUMNS.map((col) => (
                        <NumberCell
                          key={col.key}
                          value={row[col.key]}
                          col={col}
                          project={row.project}
                          hint={billableSplitHint(row, col.key)}
                        />
                      ))}
                    </TableRow>

                    {canExpand &&
                      isOpen &&
                      row.periods.map((p, i) => {
                        const cp = clampWip(p.start, p.end, reportMonth);
                        return (
                          <TableRow
                            key={`${row.project}-stint-${i}`}
                            className="bg-sky-50 hover:bg-sky-50 dark:bg-sky-950/30 dark:hover:bg-sky-950/30"
                          >
                            <TableCell className="bg-muted/60" />
                            <TableCell className={cn("pl-8 text-sm text-muted-foreground", LEAN_EDGE)}>
                              <span className="mr-2">Stint {i + 1}</span>
                              <StatusBadge status={p.status} />
                            </TableCell>
                            <StartCell c={cp} small />
                            <EndCell c={cp} small />
                            {NUMERIC_COLUMNS.map((col) =>
                              col.lifetime ? (
                                <DashCell key={col.key} col={col} />
                              ) : (
                                <NumberCell
                                  key={col.key}
                                  value={p[col.key as keyof WipPeriod] as number}
                                  col={col}
                                  small
                                />
                              )
                            )}
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
