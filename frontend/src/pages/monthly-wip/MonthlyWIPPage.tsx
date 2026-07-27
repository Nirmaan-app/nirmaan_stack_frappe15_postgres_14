import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "@/utils/FormatDate";
import { exportToCsv } from "@/utils/exportToCsv";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
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

// --------------------------------------------------------------------------- //
// Column model — the single source of truth for the numeric columns. The header
// (two-tier), the body cells, sorting and the group dividers all derive from it,
// so a column is added/renamed/reordered in ONE place.
// --------------------------------------------------------------------------- //

/** Month-scoped, day-based fields (present on both a project row AND its stints). */
type ComplianceField = keyof WipCompliance;
/** Lifetime, project-level fields (present only on the project row). */
type LifetimeField = "dispatched_po" | "total_dn" | "missing_dn" | "total_dc" | "missing_dc";
type NumericField = ComplianceField | LifetimeField;

type SortKey = "project_name" | NumericField;

interface NumericColumn {
  key: NumericField;
  label: string;
  /** First column of a group — draws the left divider. */
  groupStart?: boolean;
  /** Bold — the "base" figure of its group (Active Days, Dispatched POs). */
  emphasize?: boolean;
  /** Lifetime & project-level — stint sub-rows render "—" instead of a value. */
  lifetime?: boolean;
  /** A "missing" gap column — a non-zero value is shown red (0 stays muted). */
  danger?: boolean;
}

const NUMERIC_COLUMNS: NumericColumn[] = [
  { key: "active_working_days", label: "Active Days", groupStart: true, emphasize: true },
  { key: "total_dpr_days", label: "Total DPR" },
  { key: "missing_dpr_days", label: "Missing DPR", danger: true },
  { key: "expected_inventory", label: "Expected", groupStart: true },
  { key: "actual_inventory", label: "Actual" },
  { key: "missing_inventory", label: "Missing", danger: true },
  { key: "dispatched_po", label: "Disp.", groupStart: true, emphasize: true, lifetime: true },
  { key: "total_dn", label: "Total DN", lifetime: true },
  { key: "missing_dn", label: "Missing DN", lifetime: true, danger: true },
  { key: "total_dc", label: "Total DC", groupStart: true, lifetime: true },
  { key: "missing_dc", label: "Missing DC", lifetime: true, danger: true },
];

interface ColumnGroup {
  label: string;
  span: number;
}
const COLUMN_GROUPS: ColumnGroup[] = [
  { label: "Project", span: 3 },
  { label: "DPR · Daily (excl. Sun)", span: 3 },
  { label: "Inventory · Weekly (Mon)", span: 3 },
  { label: "Delivery Notes (ALL)", span: 3 },
  { label: "Delivery Chellans (All)", span: 2 },
];

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

const NumberCell = ({ value, col, small }: { value: number; col: NumericColumn; small?: boolean }) => (
  <TableCell
    className={cn(
      NUM_CELL,
      small && "text-sm",
      col.emphasize && "font-medium",
      col.danger && value > 0 && "font-semibold text-red-600 dark:text-red-500",
      col.groupStart ? GROUP_EDGE : LEAN_EDGE,
    )}
  >
    {numFmt(value)}
  </TableCell>
);

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
  { accessorKey: "missing_dn", header: "Missing DN", meta: { exportHeaderName: "Missing DN (lifetime)" } },
  { accessorKey: "total_dc", header: "Total DC", meta: { exportHeaderName: "Total DC (lifetime)" } },
  { accessorKey: "missing_dc", header: "Missing DC", meta: { exportHeaderName: "Missing DC (lifetime)" } },
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
    const filtered = q ? rows.filter((r) => r.project_name.toLowerCase().includes(q)) : rows;
    return [...filtered].sort((a, b) => {
      if (sortKey === "project_name") {
        const cmp = a.project_name.localeCompare(b.project_name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const diff = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, search, sortKey, sortDir]);

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
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Monthly WIP &amp; Handover</h1>
          <p className="text-sm text-muted-foreground">
            DPR (daily, Sundays excluded) and Inventory (weekly, each active Monday) are scoped to the
            selected month. PO Dispatch and DC are <span className="font-medium">lifetime</span> totals —
            unaffected by the month picker. Hover dates for the actuals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth} disabled={optionsLoading}>
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
        </div>
      </div>

      {/* Summary line */}
      {!isLoading && !error && (
        <p className="text-sm text-muted-foreground">
          {rows.length} project{rows.length === 1 ? "" : "s"} active during{" "}
          <span className="font-medium text-foreground">{monthLabel(options, month)}</span>
        </p>
      )}

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table className="table-fixed">
          <colgroup>
            <col style={{ width: COL_W.chevron }} />
            <col style={{ width: COL_W.project }} />
            <col style={{ width: COL_W.date }} />
            <col style={{ width: COL_W.date }} />
            {NUMERIC_COLUMNS.map((col) => (
              <col key={col.key} style={{ width: COL_W.num }} />
            ))}
          </colgroup>
          <TableHeader>
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
                    : "No projects match your search."}
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
                        <NumberCell key={col.key} value={row[col.key]} col={col} />
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
