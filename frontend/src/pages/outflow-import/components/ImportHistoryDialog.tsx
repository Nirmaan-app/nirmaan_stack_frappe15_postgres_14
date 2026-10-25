// src/pages/outflow-import/components/ImportHistoryDialog.tsx

import { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OutflowImportOption } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { isPorterImport } from "../porterImport";

import {
    historyEmptyLabel,
    importCountLabel,
    historySubtitle,
    importsInTab,
    initialHistoryMonth,
    initialHistoryTab,
    matchesEveryToken,
    monthKey,
    monthLabel,
    monthsBetween,
    shiftMonth,
    tabCounts,
    type MonthKey,
} from "../importHistoryView";
import {
    importPeriodLabel,
    importStatusTone,
    importUploaderLabel,
    repeatsNotSavedLabel,
    SOURCE_OPTIONS,
} from "../outflowTableModel";

/**
 * The prefix of every SWR key this dialog reads. `refreshAll` on the page revalidates by it, so a
 * statement imported a moment ago is listed — and its month offered — the next time the dialog opens.
 */
export const HISTORY_KEY_PREFIX = "outflow-import-history-";

/** The statement the screen has open, as the dialog needs it: where to open, and what to mark. */
export interface HistorySelection {
    name: string;
    source?: string;
    period_from?: string;
    period_to?: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * The screen's Source scope. READ ONCE, to choose the tab the dialog opens on — never written
     * back, and never a filter on the list (owner ruling 2026-10-14). See `initialHistoryTab`.
     */
    screenSources: readonly string[];
    /**
     * The statement currently pinned, if any. Marked rather than hidden, and the dialog opens on its
     * tab and month. It carries its own period because a deep-linked statement can sit outside the
     * picker's sixty, so the page passes it from the pinned summary rather than from that list.
     */
    selected?: HistorySelection;
    /** Select a statement. The dialog closes itself; the caller navigates. */
    onSelectImport: (batch: string) => void;
    /**
     * Open a Porter import's own dialog instead (#1444). Its lines are not bank lines, so pinning the
     * table to it would show nothing; its invoices' check is what a reader comes back for.
     */
    onOpenPorterImport?: (batch: string) => void;
}

/**
 * Every statement, by source and Statement month (owner ruling 2026-10-14).
 *
 * ⚠️ IT REPLACED "THE LAST TEN", AND THE RULING IT REVERSES IS WORTH RECORDING. The dialog used to
 * be a glance — a hard stop at ten, no paging, on the grounds that the Import selector was the
 * control for finding an old statement. That selector is itself capped at sixty, and the site held
 * 186 statements within three months of the feature shipping (76 Cashfree statements in one month
 * alone), so an older statement was reachable from NEITHER surface. A month at a time, per source,
 * is a bounded list a reader can always finish, and every statement has exactly one place to look.
 *
 * ⚠️ IT NOW FILTERS BY A MONTH, AND THAT DOES NOT REOPEN THE OLD "SOURCE YES, PERIOD NO" OBJECTION.
 * That objection was to filtering a list of FILES by the screen's Period — when the money MOVED —
 * which would make each file's own period column half-true. The month here is a STATEMENT MONTH
 * (GLOSSARY): a month the file's declared period overlaps, so the column and the filter describe the
 * same thing. A statement spanning two months is listed under both.
 *
 * ⚠️ STILL ONE READER (slice CF/S4). The rows come from `list_imports`, the endpoint the Import
 * selector reads, called with `month` — so the two cannot disagree about what a statement looks like
 * or which statements exist.
 *
 * ⚠️ EVERY FIGURE IS THE SERVER'S. Nothing here counts or sums money; `list_imports` returns
 * `successful_rows` and `gross_amount` already paired to the same population. The tab counts are
 * counts of STATEMENTS on the list, not figures about them.
 */
export const ImportHistoryDialog = ({
    open,
    onOpenChange,
    screenSources,
    selected,
    onSelectImport,
    onOpenPorterImport,
}: Props) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
            {/* ⚠️ THE BODY IS ITS OWN COMPONENT SO ITS STATE STARTS FRESH ON EVERY OPEN. Radix
                unmounts `DialogContent` when the dialog closes, so the tab, the month and the search
                are seeded from their initialisers each time it opens (owner ruling: the dialog does
                not remember them) — with no effect watching `open`, per the React-effects rule. */}
            <HistoryBody
                screenSources={screenSources}
                selected={selected}
                onSelect={(batch, source) => {
                    if (onOpenPorterImport && isPorterImport(source)) onOpenPorterImport(batch);
                    else onSelectImport(batch);
                    onOpenChange(false);
                }}
            />
        </DialogContent>
    </Dialog>
);

const HistoryBody = ({
    screenSources,
    selected,
    onSelect,
}: {
    screenSources: readonly string[];
    selected?: HistorySelection;
    onSelect: (batch: string, source?: string) => void;
}) => {
    const [tab, setTab] = useState(() => initialHistoryTab(selected?.source, screenSources));
    const [month, setMonth] = useState<MonthKey>(() => initialHistoryMonth(selected, new Date()));
    const [search, setSearch] = useState("");

    const { data: earliestData } = useFrappeGetCall<{ message: MonthKey | null }>(
        "nirmaan_stack.api.outflow_import.review.earliest_import_month",
        undefined,
        `${HISTORY_KEY_PREFIX}earliest`
    );
    const months = useMemo(
        () => monthsBetween(earliestData?.message, monthKey(new Date())),
        [earliestData]
    );

    /**
     * ⚠️ ALL THREE SOURCES IN ONE CALL, SPLIT HERE. The tabs show a count each, and switching tab is
     * then instant — one request per month rather than one per tab per month. `keepPreviousData`
     * keeps the last month on screen while the next one loads, rather than flashing empty.
     */
    const { data, isLoading, isValidating } = useFrappeGetCall<{ message: OutflowImportOption[] }>(
        "nirmaan_stack.api.outflow_import.review.list_imports",
        { month },
        `${HISTORY_KEY_PREFIX}month-${month}`,
        { keepPreviousData: true }
    );
    const imports = useMemo(() => data?.message ?? [], [data]);
    const counts = useMemo(() => tabCounts(imports), [imports]);

    const oldest = months[months.length - 1];
    const newest = months[0];

    return (
        <>
            <DialogHeader>
                <DialogTitle>Import history</DialogTitle>
                <DialogDescription>{historySubtitle(tab, month)}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={month <= oldest}
                    onClick={() => setMonth(shiftMonth(month, -1))}
                    aria-label="Previous month"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger className="h-8 w-[170px]" aria-label="Statement month">
                        <SelectValue>{monthLabel(month)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        {months.map((key) => (
                            <SelectItem key={key} value={key}>
                                {monthLabel(key)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={month >= newest}
                    onClick={() => setMonth(shiftMonth(month, 1))}
                    aria-label="Next month"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
                {isValidating && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                {/* Its own full-width line on a phone; beside the month from `sm` up. */}
                <div className="relative w-full sm:ml-auto sm:w-[220px]">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search statements…"
                        className="h-8 pl-7 text-sm"
                    />
                </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="h-auto w-full flex-wrap justify-start">
                    {SOURCE_OPTIONS.map((source) => (
                        <TabsTrigger key={source} value={source}>
                            {source}
                            <span className="ml-1.5 tabular-nums text-muted-foreground">
                                ({counts[source] ?? 0})
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>
                {SOURCE_OPTIONS.map((source) => (
                    <TabsContent key={source} value={source} className="mt-2">
                        <HistoryList
                            imports={importsInTab(imports, source)}
                            source={source}
                            month={month}
                            search={search}
                            loading={isLoading && !imports.length}
                            selectedImport={selected?.name}
                            onSelect={onSelect}
                        />
                    </TabsContent>
                ))}
            </Tabs>
        </>
    );
};

/**
 * One tab's statements for the month, narrowed by the search.
 *
 * The search reads the words a person knows a statement by — filename, uploader and the period
 * text — through the same `matchesEveryToken` the Import selector uses, so a word that finds a
 * statement there finds it here.
 */
const HistoryList = ({
    imports,
    source,
    month,
    search,
    loading,
    selectedImport,
    onSelect,
}: {
    imports: OutflowImportOption[];
    source: string;
    month: MonthKey;
    search: string;
    loading: boolean;
    selectedImport?: string;
    onSelect: (batch: string, source?: string) => void;
}) => {
    const shown = useMemo(
        () =>
            imports.filter((option) =>
                matchesEveryToken(
                    [
                        option.original_filename || option.name,
                        option.uploaded_by ?? "",
                        importUploaderLabel(option),
                        importPeriodLabel(option),
                    ].join(" "),
                    search
                )
            ),
        [imports, search]
    );

    if (loading) {
        return <p className="py-6 text-center text-sm text-muted-foreground">Loading statements…</p>;
    }
    if (!shown.length) {
        /* An empty month says so plainly; the arrows and the tabs beside it are the way on. */
        return (
            <p className="py-6 text-center text-sm text-muted-foreground">
                {historyEmptyLabel(source, month, search)}
            </p>
        );
    }
    /* ⚠️ THE LIST SCROLLS, THE CONTROLS DO NOT. A busy Cashfree month runs to seventy-odd rows, and
       a dialog that grew with them would push the month and the tabs off the screen. */
    return (
        <ul className="-mx-2 max-h-[55vh] divide-y overflow-y-auto">
            {shown.map((option) => (
                <HistoryRow
                    key={option.name}
                    option={option}
                    current={option.name === selectedImport}
                    onSelect={() => onSelect(option.name, option.source)}
                />
            ))}
        </ul>
    );
};

/**
 * One statement.
 *
 * ⚠️ THE COUNT IS `successful_rows`, NEVER `total_rows`, BECAUSE IT SITS BESIDE `gross_amount`.
 * That amount has excluded bank-refused transfers since parse time (invariant 13), so pairing it
 * with a count that includes them would put two figures describing different populations on one
 * line — the same defect as a chip reading 20 that opens a list of 47.
 *
 * ⚠️ SINCE #1287 THAT AMOUNT IS ALSO DEBIT-ONLY, and `successful_rows` was narrowed with it, in
 * `review.list_imports`. The pair must move TOGETHER or this row reports a count and an amount over
 * different populations again — which is the whole point of the note above, on a second axis.
 */
const HistoryRow = ({
    option,
    current,
    onSelect,
}: {
    option: OutflowImportOption;
    current: boolean;
    onSelect: () => void;
}) => {
    const transfers = option.successful_rows ?? 0;
    /**
     * ⚠️ THE UPLOADER READS THE SAME HERE AS IN THE IMPORT PICKER, AND THAT IS THE REASON IT IS
     * HERE AT ALL. Both surfaces are fed by the SAME `list_imports`, and both exist to let a reader
     * identify a statement — so if they disagreed about what one looks like, the reader would have
     * to learn two descriptions of one file. Period first, then the uploader, in both.
     *
     * ⚠️ BLANK DROPS THE SEPARATOR WITH IT. A dangling ` · ` reads as a value that failed to render
     * rather than one that was never recorded. The full user id goes in `title`, which is the
     * display/stored split `importUploaderLabel` documents.
     */
    const uploader = importUploaderLabel(option);
    /** ADR-0031: the lines this import left out as already imported. Not saved, so only counted. */
    const repeats = repeatsNotSavedLabel(option.repeats_not_saved);

    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-current={current ? "true" : undefined}
                className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    current ? "bg-muted/40" : ""
                }`}
            >
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                            {option.original_filename || option.name}
                        </span>
                        {/* The source is a KIND, not a status — a quiet micro-label rather than a
                            second chip competing with the one that carries the actionable fact. */}
                        {option.source && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {option.source}
                            </span>
                        )}
                        {current && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-primary">
                                Open
                            </span>
                        )}
                    </div>
                    <div
                        className="truncate text-xs text-muted-foreground"
                        title={option.uploaded_by || undefined}
                    >
                        {importPeriodLabel(option)}
                        {uploader ? ` · ${uploader}` : ""}
                    </div>
                    {repeats && (
                        <div className="truncate text-xs text-muted-foreground">{repeats}</div>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    {/* `tabular-nums` on both figures so they align down the list. A month of
                        right-aligned money is the one place proportional digits cost real
                        scanning speed. */}
                    <div className="text-right">
                        <div className="text-sm font-medium tabular-nums">
                            {formatToRoundedIndianRupee(option.gross_amount ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                            {importCountLabel(option.source, transfers)}
                        </div>
                    </div>
                    <span
                        className={`w-[92px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] ${importStatusTone(
                            option.status
                        )}`}
                    >
                        {option.status || "—"}
                    </span>
                </div>
            </button>
        </li>
    );
};
