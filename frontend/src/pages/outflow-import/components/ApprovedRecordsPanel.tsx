// src/pages/outflow-import/components/ApprovedRecordsPanel.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { exportToCsv } from "@/utils/exportToCsv";

import { ExportButton } from "./ExportButton";
import { TablePagination } from "./OutflowRowsTable";
import { describeFrappeError, ledgerLabel, settlementLink } from "../outflowTableModel";
import type {
    ApprovedRecord,
    ApprovedRecordsPage,
} from "@/types/NirmaanStack/OutflowImportBatch";

const PAGE_SIZE = 50;

/**
 * The filename stem for this panel's download.
 *
 * ⚠️ NOT `exportFileBase`, AND NOT A SCOPE. That helper names files of TRANSFERS by which tab they
 * came from; this panel holds no transfer at all — it reads the three LEDGERS, forwards, for what is
 * approved and still unpaid. Passing a scope it does not have would fall through to the bare
 * `outflow-transfers` stem, which is a claim about the file's contents that is simply false.
 *
 * ⚠️ NO TIMESTAMP — `exportToCsv` appends its own, and two stamps would be taken at two moments.
 */
const APPROVED_EXPORT_FILE_BASE = "outflow-approved-not-yet-paid";

/**
 * This panel's columns, as `exportToCsv` reads them.
 *
 * ⚠️ ITS OWN LIST, NOT `toExportColumns(OUTFLOW_COLUMNS)`. That one adapts `OutflowColumn`s over an
 * `OutflowImportRow`; an `ApprovedRecord` is a different entity with a different shape, and there is
 * no import row anywhere in this panel — the same reason it shares no search, no funnel and no
 * `tab_counts` with the table above it.
 *
 * ⚠️ `Approved on` AND `Updated on` ARE TWO COLUMNS AND MUST STAY TWO (`ledger_read` asymmetry 1).
 * Only `Project Payments` records an approval date; the two expense doctypes have no approval date,
 * no approver and no approval step at all, so a row fills exactly one of these. On screen the single
 * cell can qualify itself — it prefixes "updated" when it is showing the second — but a CSV column
 * headed `Approved` holding a modification timestamp is a lie with nothing beside it to catch it,
 * and a spreadsheet outlives the session that produced it.
 *
 * ⚠️ A BLANK AMOUNT IS NOT A ZERO, exactly as in the table below. `null` means the stored value
 * could not be read as a number (`Project Expenses.amount` is a Data column); a `0` in that cell
 * would claim the record costs nothing.
 */
interface ApprovedExportColumn {
    id: string;
    header: string;
    meta: {
        exportHeaderName: string;
        exportValue: (row: ApprovedRecord) => string | number | null | undefined;
    };
}

const approvedColumn = (
    id: string,
    header: string,
    exportValue: (row: ApprovedRecord) => string | number | null | undefined
): ApprovedExportColumn => ({
    id,
    header,
    // Both keys, as `toExportColumns` does: `exportHeaderName` is what the writer prefers and
    // `header` is what it falls back to, so the headings cannot depend on which branch ran.
    meta: { exportHeaderName: header, exportValue },
});

const APPROVED_EXPORT_COLUMNS: ApprovedExportColumn[] = [
    // The LABEL the screen shows, not the raw doctype — the file should read the way the panel did.
    approvedColumn("ledger", "Ledger", (r) => ledgerLabel(r.target_doctype)),
    approvedColumn("name", "Record", (r) => r.name),
    // ⚠️ NEVER HEADED "PO" — a quarter of the payments are against a Service Request.
    approvedColumn("order_name", "Order", (r) => r.order_name ?? ""),
    approvedColumn("expense_type", "Expense type", (r) => r.expense_type ?? ""),
    approvedColumn("vendor_name", "Vendor", (r) => r.vendor_name ?? ""),
    approvedColumn("project_name", "Project", (r) => r.project_name ?? ""),
    approvedColumn("status", "Status", (r) => r.status ?? ""),
    approvedColumn("approved_on", "Approved on", (r) => approvedDateCell(r.approved_on)),
    approvedColumn("updated_on", "Updated on", (r) => approvedDateCell(r.updated_on)),
    approvedColumn("amount", "Amount", (r) => (r.amount == null ? "" : r.amount)),
];

/** `dd-MMM-yyyy`, the app-wide date format, from the stored `YYYY-MM-DD HH:MM:SS`. */
const approvedDateCell = (value?: string | null) =>
    value ? formatDate(String(value).split(/[ T]/)[0]) : "";

/**
 * Everything approved and not yet paid, across all three ledgers.
 *
 * ⚠️ IT READS A DIFFERENT ENTITY FROM EVERYTHING ELSE ON THIS SCREEN, and that is why it shares
 * nothing with the transfers table above it — not the search, not the column funnels, not
 * `tab_counts`, not the row selection. Those all describe `Outflow Import Row`; there is no import
 * row anywhere in this panel. Reusing them would have meant one set of controls meaning two
 * different things depending on which tab was open.
 *
 * ⚠️ IT IS NOT THE DELETED REVERSE VIEW. `get_reconciliation_report` went at V5 and answered "is
 * every payment we recorded backed by a real transfer?", reading backwards from records already
 * Paid. This reads FORWARDS from records still Approved: the queue the import exists to consume.
 *
 * ⚠️ READ-ONLY, DELIBERATELY. Settling is still reached from a TRANSFER, through `settle_row`. A
 * screen that could mark an approved payment Paid with no transfer in front of it would be a second,
 * quieter way to spend money.
 */
export const ApprovedRecordsPanel = () => {
    const [search, setSearch] = useState("");
    const [debounced, setDebounced] = useState("");
    const [ledger, setLedger] = useState("");
    const [project, setProject] = useState("");
    const [sort, setSort] = useState("decided_on");
    const [page, setPage] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        setPage(0);
    }, [debounced, ledger, project, sort]);

    /**
     * What this panel is asking for, minus the paging.
     *
     * ⚠️ ONE OBJECT, READ BY THE PAGE FETCH AND BY THE EXPORT. `export_approved_records` takes
     * exactly these parameters and reads through the same `ledger_read.approved_rows`; splitting
     * them into two literals would let the downloaded file and the list on screen be selected under
     * different filters, with nothing anywhere putting the two side by side to reveal it.
     */
    const filterParams = useMemo(
        () => ({
            ledger,
            search: debounced,
            project,
            sort_by: sort,
            sort_dir: sort === "amount" ? "desc" : "desc",
        }),
        [ledger, debounced, project, sort]
    );

    const params = useMemo(
        () => ({
            ...filterParams,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        }),
        [filterParams, page]
    );

    const { data, isLoading } = useFrappeGetCall<{ message: ApprovedRecordsPage }>(
        "nirmaan_stack.api.outflow_import.approved.list_approved_records",
        params,
        `outflow-approved-${JSON.stringify(params)}`
    );

    const { data: projectsData } = useFrappeGetCall<{ message: { projects: string[] } }>(
        "nirmaan_stack.api.outflow_import.approved.get_approved_projects",
        {},
        "outflow-approved-projects"
    );

    const [exportError, setExportError] = useState<string | null>(null);
    const { call: callExport } = useFrappePostCall<{
        message: { rows: ApprovedRecord[]; total: number };
    }>("nirmaan_stack.api.outflow_import.approved.export_approved_records");

    /**
     * The whole filtered set of approved-and-unpaid records, unpaged.
     *
     * ⚠️ IT SENDS `filterParams`, WITHOUT `limit`/`offset` — exporting one page of a filtered set is
     * the defect the endpoint exists to remove. The server counts under the same filters and
     * REFUSES over its ceiling rather than truncating; the refusal names both numbers and the levers
     * that narrow, so it is rendered verbatim rather than rewritten here.
     */
    const handleExport = useCallback(async () => {
        setExportError(null);
        try {
            const response = await callExport(filterParams);
            exportToCsv(
                APPROVED_EXPORT_FILE_BASE,
                response?.message?.rows ?? [],
                // The shape `exportToCsv` actually reads; TanStack's `ColumnDef` cannot express it
                // without augmenting `ColumnMeta` app-wide.
                APPROVED_EXPORT_COLUMNS as any
            );
        } catch (err) {
            setExportError(describeFrappeError(err, "The export failed."));
        }
    }, [callExport, filterParams]);

    const rows = data?.message?.rows ?? [];
    const total = data?.message?.total ?? 0;
    const value = data?.message?.value ?? 0;
    const byLedger = data?.message?.by_ledger ?? {};
    const projects = projectsData?.message?.projects ?? [];

    return (
        <div className="space-y-4">
            {/* ⚠️ THE SPLIT IS THE HEADLINE, NOT THE TOTAL. On the live ledgers it is roughly 253
                payments against 68 non-project and 11 project expenses — one number would hide that
                two of the three are rounding errors beside the first. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                <span>
                    <span className="text-lg font-semibold tabular-nums">{total}</span>{" "}
                    <span className="text-muted-foreground">approved and not yet paid</span>
                </span>
                <span className="font-medium tabular-nums">
                    {formatToRoundedIndianRupee(value)}
                </span>
                <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {Object.entries(byLedger).map(([doctype, split]) => (
                        <span key={doctype}>
                            <span className="font-medium tabular-nums text-foreground">
                                {split.count}
                            </span>{" "}
                            {ledgerLabel(doctype)}
                        </span>
                    ))}
                </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="h-8 pl-8 pr-8"
                        placeholder="Record, vendor, project or order…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            onClick={() => setSearch("")}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                <Select
                    value={ledger || "any"}
                    onValueChange={(v) => setLedger(v === "any" ? "" : v)}
                >
                    <SelectTrigger className="h-8 w-[180px]">
                        <SelectValue placeholder="Ledger" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="any">All ledgers</SelectItem>
                        <SelectItem value="Project Payments">Payments</SelectItem>
                        <SelectItem value="Project Expenses">Project expenses</SelectItem>
                        <SelectItem value="Non Project Expenses">Non-project expenses</SelectItem>
                    </SelectContent>
                </Select>

                {/* ⚠️ ONLY PROJECTS THAT HAVE SOMETHING APPROVED. Offering all 194 when 24 of them
                    qualify is a list you scroll past rather than use. */}
                <Select
                    value={project || "any"}
                    onValueChange={(v) => setProject(v === "any" ? "" : v)}
                >
                    <SelectTrigger className="h-8 w-[200px]">
                        <SelectValue placeholder="Project" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="any">All projects</SelectItem>
                        {projects.map((name) => (
                            <SelectItem key={name} value={name}>
                                {name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="h-8 w-[170px]">
                        <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="decided_on">Newest first</SelectItem>
                        <SelectItem value="amount">Largest first</SelectItem>
                        <SelectItem value="vendor_name">Vendor</SelectItem>
                        <SelectItem value="project_name">Project</SelectItem>
                    </SelectContent>
                </Select>

                {/* ⚠️ RIGHT-ALIGNED, AWAY FROM THE FOUR CONTROLS TO ITS LEFT. Search, Ledger,
                    Project and Sort all CHANGE what this panel shows; Export takes it with you. A
                    fifth control sitting among them would read as a fifth way to narrow the list.
                    Its `total` is the headline card's own figure above, which is the number the
                    server will count again under the same filters. */}
                <ExportButton className="ml-auto" total={total} onExport={handleExport} />
            </div>

            {/* The server's own sentence, unrewritten — the same treatment the transfers table
                gives an export refusal. */}
            <AlertDialog
                open={exportError !== null}
                onOpenChange={(next) => !next && setExportError(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Could not export</AlertDialogTitle>
                        <AlertDialogDescription>{exportError}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setExportError(null)}>
                            Close
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {isLoading && !rows.length ? (
                <div className="flex h-40 items-center justify-center">
                    <TailSpin color="#D03B45" height={30} width={30} />
                </div>
            ) : rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                    Nothing is approved and waiting under these filters.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-muted/60">
                            <tr className="text-left">
                                {["Record", "Vendor", "Project", "Approved", "Amount"].map(
                                    (heading, i) => (
                                        <th
                                            key={heading}
                                            className={`px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground ${
                                                i === 4 ? "text-right" : ""
                                            }`}
                                        >
                                            {heading}
                                        </th>
                                    )
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const link = settlementLink(row.target_doctype, row.name, false, row.order_name);
                                return (
                                    <tr
                                        key={`${row.target_doctype}|${row.name}`}
                                        className="border-t align-top hover:bg-muted/30"
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <Badge
                                                    variant="outline"
                                                    className="border-0 bg-muted text-[10px]"
                                                >
                                                    {ledgerLabel(row.target_doctype)}
                                                </Badge>
                                                {/* ⚠️ `<Link>`, NEVER A RAW `<a href>` — THIS WAS A
                                                    PRODUCTION-ONLY DEFECT (slice E3, 2026-08-12).
                                                    `App.tsx` sets the router's `basename` from
                                                    `VITE_BASE_NAME`, which is "" in dev and
                                                    'frontend' in production. React Router prepends
                                                    that basename; a raw anchor does not, so this
                                                    link resolved to the SERVER ROOT and 404'd in
                                                    production while working perfectly in dev — the
                                                    exact shape that survives every local test.
                                                    Any in-app navigation added here must go
                                                    through the router for the same reason. */}
                                                {link ? (
                                                    <Link
                                                        to={link.href}
                                                        title={link.title}
                                                        className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                                                    >
                                                        {row.name}
                                                    </Link>
                                                ) : (
                                                    <span className="font-mono text-xs">
                                                        {row.name}
                                                    </span>
                                                )}
                                            </div>
                                            {/* ⚠️ NEVER LABELLED "PO" UNLESS IT IS ONE — a quarter
                                                of the payments are against a Service Request. */}
                                            {row.order_name && (
                                                <div className="font-mono text-[11px] text-muted-foreground">
                                                    {row.order_name}
                                                </div>
                                            )}
                                            {row.expense_type && (
                                                <div className="text-[11px] text-muted-foreground">
                                                    {row.expense_type}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            {row.vendor_name || (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            {row.project_name || (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        {/* ⚠️ THE COLUMN SAYS WHICH DATE IT IS SHOWING. Only
                                            `Project Payments` records an approval; the expenses have
                                            only a modification timestamp, and presenting that as an
                                            approval would be false on every expense in the list
                                            (owner ruling 2026-08-06). */}
                                        <td className="px-3 py-2 text-xs">
                                            {row.approved_on ? (
                                                formatDate(row.approved_on.split(/[ T]/)[0])
                                            ) : row.updated_on ? (
                                                <span className="text-muted-foreground">
                                                    updated{" "}
                                                    {formatDate(row.updated_on.split(/[ T]/)[0])}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        {/* ⚠️ A BLANK IS NOT A ZERO. `null` means the stored amount
                                            could not be read as a number — `Project Expenses.amount`
                                            is a Data column. Rendering 0 would claim the record
                                            costs nothing. */}
                                        <td className="px-3 py-2 text-right text-sm tabular-nums">
                                            {row.amount == null ? (
                                                <span
                                                    className="text-muted-foreground"
                                                    title="The stored amount could not be read as a number"
                                                >
                                                    —
                                                </span>
                                            ) : (
                                                formatToRoundedIndianRupee(row.amount)
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {total > PAGE_SIZE && (
                <TablePagination
                    total={total}
                    limit={PAGE_SIZE}
                    offset={page * PAGE_SIZE}
                    busy={isLoading}
                    onPage={setPage}
                />
            )}
        </div>
    );
};
