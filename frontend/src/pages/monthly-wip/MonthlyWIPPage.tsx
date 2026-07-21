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
  WipMonthlyRow,
} from "./useMonthlyWIPData";

type SortKey = "project_name" | "days_active" | "dpr" | "inventory" | "dc" | "dn";

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

/** Distinct statuses across a row's stints, e.g. "WIP + Handover". */
const rowStatuses = (r: WipMonthlyRow) =>
  Array.from(new Set(r.periods.map((p) => p.status))).join(" + ");

/** One flat CSV line — a project "Total" row, then a row per stint (multi-stint only). */
interface ExportRow {
  project: string;
  row: string;             // "Total" | "Stint 1" | "Stint 2" ...
  status: string;
  days: number;
  start_in_month: string;
  end_in_month: string;
  actual_start: string;
  actual_end: string;
  dpr: number;
  inventory: number;
  dc: number;
  dn: number;
}

const EXPORT_COLUMNS: ColumnDef<ExportRow, any>[] = [
  { accessorKey: "project", header: "Project", meta: { exportHeaderName: "Project" } },
  { accessorKey: "row", header: "Row", meta: { exportHeaderName: "Row" } },
  { accessorKey: "status", header: "Status", meta: { exportHeaderName: "Status" } },
  { accessorKey: "days", header: "Days", meta: { exportHeaderName: "Active / Stint Days" } },
  { accessorKey: "start_in_month", header: "Start", meta: { exportHeaderName: "Start (in month)" } },
  { accessorKey: "end_in_month", header: "End", meta: { exportHeaderName: "End (in month)" } },
  { accessorKey: "actual_start", header: "Actual Start", meta: { exportHeaderName: "Actual Start" } },
  { accessorKey: "actual_end", header: "Actual End", meta: { exportHeaderName: "Actual End" } },
  { accessorKey: "dpr", header: "DPR Count", meta: { exportHeaderName: "DPR Count" } },
  { accessorKey: "inventory", header: "Inventory Count", meta: { exportHeaderName: "Inventory Count" } },
  { accessorKey: "dc", header: "DC Count", meta: { exportHeaderName: "DC Count" } },
  { accessorKey: "dn", header: "DN Count", meta: { exportHeaderName: "DN Count" } },
];

/** Flatten to one Total row per project + a labeled row per stint (multi-stint only). */
function buildExportRows(rows: WipMonthlyRow[], month: string): ExportRow[] {
  const clamped = (start: string, end: string) => {
    const c = clampWip(start, end, month);
    return {
      startIn: c.dispStart + (c.carriedIn ? " (from earlier)" : ""),
      endIn: c.ongoing ? "Ongoing" : c.dispEnd + (c.carriedOut ? " (continues)" : ""),
    };
  };
  const fmtEnd = (end: string) => (end === "ongoing" ? "Ongoing" : formatDate(end));

  const out: ExportRow[] = [];
  for (const r of rows) {
    const t = clamped(r.active_start, r.active_end);
    out.push({
      project: r.project_name,
      row: "Total",
      status: rowStatuses(r),
      days: r.days_active,
      start_in_month: t.startIn,
      end_in_month: t.endIn,
      actual_start: formatDate(r.active_start),
      actual_end: fmtEnd(r.active_end),
      dpr: r.dpr, inventory: r.inventory, dc: r.dc, dn: r.dn,
    });
    if (r.stints > 1) {
      r.periods.forEach((p, i) => {
        const s = clamped(p.start, p.end);
        out.push({
          project: "",           // blank so the stint nests under its project's Total row
          row: `Stint ${i + 1}`,
          status: p.status,
          days: p.days,
          start_in_month: s.startIn,
          end_in_month: s.endIn,
          actual_start: formatDate(p.start),
          actual_end: fmtEnd(p.end),
          dpr: p.dpr, inventory: p.inventory, dc: p.dc, dn: p.dn,
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
  const [sortKey, setSortKey] = useState<SortKey>("days_active");
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
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, search, sortKey, sortDir]);

  const sortHead = (label: string, k: SortKey, align = false) => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
    return (
      <TableHead className={align ? "text-right" : ""}>
        <button
          type="button"
          onClick={() => handleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-foreground ${align ? "flex-row-reverse" : ""}`}
        >
          {label}
          <Icon className={`h-3 w-3 ${active ? "text-foreground" : "text-muted-foreground/50"}`} />
        </button>
      </TableHead>
    );
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (project: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(project) ? next.delete(project) : next.add(project);
      return next;
    });

  const handleExport = () => {
    if (!rows.length) return;
    exportToCsv(`Monthly_WIP_${reportMonth}`, buildExportRows(rows, reportMonth), EXPORT_COLUMNS);
  };

  const numFmt = (n: number) => (n ? n : <span className="text-muted-foreground">0</span>);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.dpr += r.dpr;
          acc.inventory += r.inventory;
          acc.dc += r.dc;
          acc.dn += r.dn;
          return acc;
        },
        { dpr: 0, inventory: 0, dc: 0, dn: 0 }
      ),
    [rows]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Monthly WIP &amp; Handover</h1>
          <p className="text-sm text-muted-foreground">
            Days each project was active (WIP or Handover), with DPR / Inventory / DC / DN activity.
            Dates show within the selected month — hover for the actual dates.
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
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length}>
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
          {rows.length > 0 && (
            <>
              {" "}· DPR {totals.dpr} · Inventory {totals.inventory} · DC {totals.dc} · DN {totals.dn}
            </>
          )}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              {sortHead("Project", "project_name")}
              {sortHead("Active Days", "days_active", true)}
              <TableHead>Active Start</TableHead>
              <TableHead>Active End</TableHead>
              {sortHead("DPR Count", "dpr", true)}
              {sortHead("Inventory Count", "inventory", true)}
              {sortHead("DC Count", "dc", true)}
              {sortHead("DN Count", "dn", true)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && !isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-destructive">
                  Failed to load the report.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && displayRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
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
                      <TableCell className="w-8 p-0 pl-2">
                        {canExpand ? (
                          isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          to={`/projects/${row.project}?page=overview`}
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.project_name}
                        </Link>
                        <span className="ml-2 inline-flex gap-1 align-middle">
                          {distinctStatuses.map((s) => (
                            <StatusBadge key={s} status={s} />
                          ))}
                        </span>
                        {canExpand && (
                          <span className="ml-2 text-xs text-muted-foreground">({row.stints} stints)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{row.days_active}</TableCell>
                      <TableCell title={c.tooltip}>
                        <div>
                          {c.dispStart}
                          {c.carriedIn && <CarriedIn />}
                        </div>
                        {c.carriedIn && <ActualLine date={c.actualStart} />}
                      </TableCell>
                      <TableCell title={c.tooltip}>
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
                      <TableCell className="text-right">{numFmt(row.dpr)}</TableCell>
                      <TableCell className="text-right">{numFmt(row.inventory)}</TableCell>
                      <TableCell className="text-right">{numFmt(row.dc)}</TableCell>
                      <TableCell className="text-right">{numFmt(row.dn)}</TableCell>
                    </TableRow>

                    {canExpand &&
                      isOpen &&
                      row.periods.map((p, i) => {
                        const cp = clampWip(p.start, p.end, reportMonth);
                        return (
                          <TableRow key={`${row.project}-stint-${i}`} className="bg-muted/40">
                            <TableCell className="w-8" />
                            <TableCell className="pl-8 text-sm text-muted-foreground">
                              <span className="mr-2">Stint {i + 1}</span>
                              <StatusBadge status={p.status} />
                            </TableCell>
                            <TableCell className="text-right text-sm">{p.days}</TableCell>
                            <TableCell className="text-sm" title={cp.tooltip}>
                              <div>
                                {cp.dispStart}
                                {cp.carriedIn && <CarriedIn />}
                              </div>
                              {cp.carriedIn && <ActualLine date={cp.actualStart} />}
                            </TableCell>
                            <TableCell className="text-sm" title={cp.tooltip}>
                              {cp.ongoing ? (
                                <OngoingBadge />
                              ) : (
                                <>
                                  <div>
                                    {cp.dispEnd}
                                    {cp.carriedOut && <CarriedOut />}
                                  </div>
                                  {cp.carriedOut && <ActualLine date={cp.actualEnd} />}
                                </>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">{numFmt(p.dpr)}</TableCell>
                            <TableCell className="text-right text-sm">{numFmt(p.inventory)}</TableCell>
                            <TableCell className="text-right text-sm">{numFmt(p.dc)}</TableCell>
                            <TableCell className="text-right text-sm">{numFmt(p.dn)}</TableCell>
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
