import { CSSProperties, ReactNode, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Inbox, Loader2, LucideIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { cn } from "@/lib/utils";
import { urlStateManager } from "@/utils/urlStateManager";

import { useAuditViewData } from "../hooks/useAuditViewData";
import { useFillWindowHeight } from "../hooks/useFillWindowHeight";
import { useReportDateStore, useSharedReportDateRange } from "../store/useReportDateStore";
import { TabBar, TabDetails } from "./audit-view/AuditTabBar";
import { SummaryStrip } from "./audit-view/AuditSummaryStrip";
import { AuditViewTable } from "./audit-view/AuditViewTable";
import { InfoTip } from "./audit-view/InfoTip";
import { AUDIT_RANGE_PARAM, AUDIT_TAB_META, AUDIT_TAB_PARAM, AUDIT_TABS, auditRangeChosenAtLoad, AuditTab, AuditView, auditRangeLabel, auditTabSources, isAuditTabDisabled, resolveAuditTab, toAuditApiDate } from "../utils/auditView";

/** Step 1 before any pick: an empty range, which the shared filter shows as "Pick a date range". */
const NO_RANGE_PICKED: DateRange = { from: undefined };

interface AuditViewReportProps {
  view: AuditView;
}

/**
 * Reports → Audit View: every order, approved invoice and paid payment in one date range, each tab
 * dated by its own date. All Project View covers POs, WOs and project expenses; Non Project View the
 * non-project expenses (no Orders tab). Admin, Accountant and Accountant Lead
 * (`AUDIT_VIEW_PROFILES`, enforced by the server).
 */
export default function AuditViewReport({ view }: AuditViewReportProps) {
  const { dateRange, onChange: onDateChange, onClear: onDateClear } = useSharedReportDateRange();
  const fromDate = toAuditApiDate(dateRange?.from);
  const toDate = toAuditApiDate(dateRange?.to);

  // Step 1: nothing loads until a range has been picked here. A range carried in from another report
  // (or the URL) counts; the shared default "ALL" does not -- ALL has to be picked on purpose. Being done is
  // kept in the URL (`audit_range`), so a refresh keeps an ALL pick, and the open tab with it.
  const [chosenAtLoad] = useState(() =>
    auditRangeChosenAtLoad(useReportDateStore.getState().selection.kind, urlStateManager.getParam(AUDIT_RANGE_PARAM)),
  );
  const [rangeChosen, setRangeChosen] = useState(chosenAtLoad);
  useEffect(() => { urlStateManager.updateParam(AUDIT_RANGE_PARAM, rangeChosen ? "1" : null); }, [rangeChosen]);
  const handleDateChange = useCallback((range?: DateRange) => { setRangeChosen(true); onDateChange(range); }, [onDateChange]);
  const handleDateClear = useCallback(() => { setRangeChosen(true); onDateClear(); }, [onDateClear]);

  // Step 2: the open tab is kept in the URL (`audit_tab`); none is open until the user picks one.
  // A tab in the URL is honoured only when step 1 is done too (a refresh or a shared link); otherwise a stale
  // `audit_tab` from an earlier visit would skip step 2. Orders in Non Project View falls back to Invoices.
  const [askedTab, setAskedTab] = useState<string | null>(() => {
    if (chosenAtLoad) return urlStateManager.getParam(AUDIT_TAB_PARAM);
    urlStateManager.updateParam(AUDIT_TAB_PARAM, null);
    return null;
  });
  useEffect(() => urlStateManager.subscribe(AUDIT_TAB_PARAM, (_, v) => setAskedTab(v)), []);
  const tab: AuditTab | null =
    rangeChosen && AUDIT_TABS.some((t) => t === askedTab) ? resolveAuditTab(view, askedTab) : null;
  // Switching Report Type (All Project <-> Non Project) starts over from step 1: the date box goes back to
  // "Pick a date range" and the open tab is cleared, so neither the range nor a tab from the other view is
  // carried over pre-selected. The shared report date itself is left alone (other reports use it); the next
  // pick here sets it. Skips the first render (URL restore).
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    setRangeChosen(false);
    setAskedTab(null);
    urlStateManager.updateParam(AUDIT_TAB_PARAM, null);
  }, [view]);

  const selectTab = useCallback((next: AuditTab) => {
    setAskedTab(next);
    urlStateManager.updateParam(AUDIT_TAB_PARAM, next);
  }, []);
  const [showDetails, setShowDetails] = useState(false);

  // The tab highlights at once (`tab`); the panel follows a deferred copy (`panelTab`), so React
  // renders the new tab's table in the background and keeps the old one on screen, dimmed, until it
  // is ready -- no skeleton flash, and the click never waits on a 10,000-row table mount.
  const panelTab = useDeferredValue(tab);
  const switching = panelTab !== null && panelTab !== tab;

  const { summary, isSummaryLoading, rows, isRowsLoading, rowsError } = useAuditViewData(
    view, panelTab, fromDate, toDate, rangeChosen,
  );

  // Laptop / desktop (lg+): once a tab is open the card fills the rest of the window, like Projects -> Cash
  // Sheet, so the page itself never scrolls -- only the table body does. Phones keep the page scroll.
  const step2State: StepState = !rangeChosen ? "todo" : tab ? "done" : "current";
  const sectionRef = useRef<HTMLElement>(null);
  const fillHeight = useFillWindowHeight(sectionRef, panelTab !== null);

  return (
    <section
      ref={sectionRef}
      style={{ "--audit-fill-h": fillHeight } as CSSProperties}
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        // Steps, tabs and strip keep their height; the panel takes the rest. overflow-y-auto is only a
        // fallback for a very short window (or Show details open), never the normal case.
        fillHeight && "lg:flex lg:h-[var(--audit-fill-h)] lg:flex-col lg:overflow-y-auto",
      )}
    >
      <Step n={1} state={rangeChosen ? "done" : "current"} title="Select date range"
        hint="Each tab applies it to its own date: created, invoice or payment date.">
        {/* The shared filter prints its own "Selected Date Range:" label (its root's first child); the step
            title already says it, so it is hidden here. components/ui is not hand-edited. */}
        <div className={cn("w-fit rounded-md [&>div>div:first-child]:hidden", !rangeChosen && "ring-2 ring-red-500/40 ring-offset-2")}>
          {/* Until a range is picked here, the box shows "Pick a date range", not the shared default ALL:
              an empty value reads as ALL in the shared filter, and ALL would look picked while the tabs stay
              locked. Picking ALL (or Reset) marks the range chosen, and the box then shows ALL. */}
          <StandaloneDateFilter
            value={rangeChosen ? dateRange : NO_RANGE_PICKED}
            onChange={handleDateChange}
            onClear={handleDateClear}
            className={cn(!rangeChosen && "text-muted-foreground")}
          />
        </div>
      </Step>
      {/* Step 2 is its own line; its tabs sit directly below it. */}
      <Step n={2} state={step2State} title="Select the Report View"
        hint={!rangeChosen ? "Pick a date range first." : tab ? "Switch tabs at any time; the range stays." : "Click a tab below to load its report."}
        divider />

      <TabBar
        view={view}
        tab={tab}
        locked={!rangeChosen}
        onSelect={selectTab}
        summary={summary}
        isLoading={rangeChosen && isSummaryLoading}
        showDetails={showDetails}
        onToggleDetails={() => setShowDetails((v) => !v)}
      />
      {rangeChosen && showDetails && (
        <TabDetails view={view} tab={tab} onSelect={selectTab} summary={summary} isLoading={isSummaryLoading} />
      )}

      <div
        role="tabpanel"
        id="audit-view-panel"
        aria-labelledby={panelTab ? `audit-tab-${panelTab}` : undefined}
        aria-busy={switching}
        className={cn(
          "flex flex-col gap-4 p-3 transition-opacity duration-150 sm:p-4",
          fillHeight && "lg:min-h-[22rem] lg:flex-1",
          switching && "pointer-events-none opacity-60",
        )}
      >
        {!rangeChosen ? (
          <PanelPrompt icon={CalendarDays} title="Start by picking a date range"
            text="Step 1 above. The tabs unlock once a range is chosen." />
        ) : !panelTab ? (
          <PanelPrompt icon={Inbox}
            title={isAuditTabDisabled(view, "orders") ? "Now choose Invoices or Payments" : "Now choose Orders, Invoices or Payments"}
            text="Nothing is loaded yet. Click one of the tabs to load its summary and table." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 font-medium text-foreground/80">
                <CalendarDays className="h-3.5 w-3.5 text-red-600" />
                Dated by <b className="font-semibold text-foreground">{AUDIT_TAB_META[panelTab].basis}</b>
              </span>
              <b className="font-semibold text-foreground">{auditRangeLabel(fromDate, toDate)}</b>
              <span className="hidden h-1 w-1 rounded-full bg-muted-foreground/50 sm:block" />
              <span>{auditTabSources(view, panelTab)}</span>
              {/* The tab's filter (e.g. "PO status not Inactive, Cancelled or Merged") is behind the ⓘ. */}
              <InfoTip note={AUDIT_TAB_META[panelTab].scope} />
            </div>
            {rowsError ? (
              <AlertDestructive error={rowsError} />
            ) : isRowsLoading || !rows ? (
              <div className="flex flex-col gap-3">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                  Loading {AUDIT_TAB_META[panelTab].title.toLowerCase()}…
                </span>
                <TableSkeleton />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState tab={panelTab} fromDate={fromDate} toDate={toDate} />
            ) : (
              <div key={`${view}-${panelTab}`} className={cn("flex flex-col gap-3 animate-in fade-in duration-200", fillHeight && "lg:min-h-0 lg:flex-1")}>
                <SummaryStrip view={view} tab={panelTab} rows={rows} />
                {/* A long table scrolls INSIDE this box, with its header row and the pager always in view, and
                    the table's row virtualizer then draws only the visible rows (10,000 rows per page stays fast).
                    lg+ with the card fixed to the window: the rest of the card. Otherwise (phones, or a window
                    too short to fix the card): at most one screen tall (the app's <main> scrolls; its header +
                    padding take ~7rem). A short table keeps its natural height. */}
                <div className={cn("flex max-h-[calc(100dvh-7rem)] min-h-0 flex-col", fillHeight && "lg:max-h-none lg:flex-1")}>
                  <AuditViewTable view={view} tab={panelTab} rows={rows} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** One numbered step on a single line: number, title, its control (if any), then the hint. */
type StepState = "todo" | "current" | "done";

function Step({ n, state, title, hint, divider, className, children }: {
  n: number; state: StepState; title: string; hint: string; divider?: boolean; className?: string; children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3", divider && "border-t", className)}>
      <StepBadge n={n} state={state} />
      <span className="flex items-center gap-1.5">
        <b className="whitespace-nowrap text-sm font-semibold">{title}</b>
        {/* The step's guidance is behind the ⓘ (hover / focus), not printed on the line. */}
        <InfoTip note={hint} />
      </span>
      {children}
    </div>
  );
}

/** A step's round marker: its number, red while it is the current step, a green tick once done. */
function StepBadge({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      className={cn(
        "grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold transition-colors",
        state === "done" && "bg-green-700 text-white",
        state === "current" && "bg-red-600 text-white ring-4 ring-red-100 dark:ring-red-950",
        state === "todo" && "bg-muted text-muted-foreground",
      )}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

function PanelPrompt({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-5 py-10 text-center animate-in fade-in duration-200">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------------------------

function EmptyState({ tab, fromDate, toDate }: { tab: AuditTab; fromDate?: string; toDate?: string }) {
  const meta = AUDIT_TAB_META[tab];
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No {meta.title.toLowerCase()} dated in this range</p>
      <p className="text-xs text-muted-foreground">
        {fromDate || toDate
          ? `Nothing has a ${meta.basis} in ${auditRangeLabel(fromDate, toDate)}. Try a wider range.`
          : `Nothing to show.`}
      </p>
    </div>
  );
}
