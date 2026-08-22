/**
 * Snag import wizard -- the ONE public entry point of `src/pages/SnagList/import/`.
 *
 * A three-step mini-wizard (plan §4): upload -> pick sheets -> a tab per ticked sheet,
 * then one Confirm that creates one Batch per sheet with per-sheet failure isolation.
 *
 * Ownership rules that hold this together:
 *  - ALL per-tab state lives HERE in `tabStates`, keyed by sheet name. Radix `TabsContent`
 *    unmounts inactive panels, so a tab that owned its own state would lose it on switch.
 *  - Errors render INLINE in the dialog, never as toasts (BoQ wizard convention).
 *  - `inspect_workbook` is the only raw `fetch` (multipart); the other calls go through
 *    `useFrappePostCall`.
 *  - No object/array is ever a `useEffect` dependency (frontend/CLAUDE.md § React Effects):
 *    both refetch effects depend on a derived STRING signature.
 *
 * ⚠️ TWO fetches feed a tab, and WHICH ONE OWNS THE COLUMNS is load-bearing (R3.1):
 *  - `get_sheet_columns` owns `columns` + the mapping re-guess. It needs NO mapping, so it can
 *    run on EVERY header-row change regardless of mapping validity.
 *  - `parse_preview` owns the rows. It HARD-REFUSES without a mapped Description, so it can
 *    never be the call that hands you the columns you need in order to pick one. Making it the
 *    only source of columns is what deadlocked the header-row override in Revision 2: a sheet
 *    whose header auto-detection failed could never populate its selects, and after the first
 *    header change a `mapping_guess: null` emptied the mapping and wedged every later one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  GetSheetColumnsResponse,
  IngestBatchesResponse,
  InspectWorkbookResponse,
  ParsePreviewResponse,
  SnagColumnMapping,
  WorkbookSheet,
} from "../types";
import { IngestResultScreen } from "./IngestResultScreen";
import { SheetPickStep } from "./SheetPickStep";
import { SheetTabPanel } from "./SheetTabPanel";
import { UploadStep } from "./UploadStep";
import {
  PREVIEW_DEBOUNCE_MS,
  buildIngestBatches,
  errorText,
  evaluateConfirmGate,
  headerRowSignature,
  initialMapping,
  initialSheetSelection,
  isMappingValid,
  mappingSignature,
  reconcileTabStates,
  seedTicksFromPreview,
  setTicks,
  tickedSheetNames,
  toggleTick,
  type TabState,
} from "./importState";

const SHEET_COLUMNS_METHOD = "nirmaan_stack.api.snags.import_wizard.get_sheet_columns";
const PARSE_PREVIEW_METHOD = "nirmaan_stack.api.snags.import_wizard.parse_preview";
const INGEST_METHOD = "nirmaan_stack.api.snags.import_wizard.ingest_batches";

type Step = "upload" | "sheets" | "tabs" | "result";

export interface SnagImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Called after a successful ingest so the caller can refetch. Receives the result. */
  onImported: (result: IngestBatchesResponse) => void;
}

export function SnagImportDialog({
  open,
  onOpenChange,
  projectId,
  onImported,
}: SnagImportDialogProps): JSX.Element {
  const [step, setStep] = useState<Step>("upload");
  const [inspect, setInspect] = useState<InspectWorkbookResponse | null>(null);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const [activeTab, setActiveTab] = useState<string>("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestBatchesResponse | null>(null);

  const { call: columnsCall } = useFrappePostCall<{ message: GetSheetColumnsResponse }>(
    SHEET_COLUMNS_METHOD,
  );
  const { call: previewCall } = useFrappePostCall<{ message: ParsePreviewResponse }>(
    PARSE_PREVIEW_METHOD,
  );
  const { call: ingestCall } = useFrappePostCall<{ message: IngestBatchesResponse }>(
    INGEST_METHOD,
  );

  const sheets: WorkbookSheet[] = useMemo(() => inspect?.sheets ?? [], [inspect]);
  const ticked = useMemo(
    () => tickedSheetNames(sheets, selection),
    [sheets, selection],
  );

  // -- refs the debounced fetcher reads, so the effect can stay free of object deps -----
  const tabStatesRef = useRef(tabStates);
  const tickedRef = useRef(ticked);
  const columnsCallRef = useRef(columnsCall);
  const previewCallRef = useRef(previewCall);
  const inspectRef = useRef(inspect);
  /** sheetName -> the request signature of the request currently in flight. */
  const inFlightRef = useRef<Record<string, string>>({});
  /** sheetName -> the request signature the current preview was fetched with. */
  const lastSigRef = useRef<Record<string, string>>({});
  /**
   * sheetName -> the HEADER-ROW signature of the `get_sheet_columns` call in flight. The
   * staleness guard: a reply is adopted only while this still matches the signature it was
   * issued with AND the tab still holds that header row, so a slow reply for row 8 can never
   * overwrite the columns of a newer row 12.
   */
  const columnsInFlightRef = useRef<Record<string, string>>({});
  /**
   * sheetName -> the header-row signature `columns` currently correspond to. SEEDED at tab
   * creation from the inspect guess (so the first render never re-fetches what
   * `inspect_workbook` already returned), then advanced by each columns reply -- including a
   * FAILED one, so a broken sheet reports its error once instead of retrying forever.
   */
  const columnsSigRef = useRef<Record<string, string>>({});
  /** Bumped on close/reset so a late response from a previous run is discarded. */
  const runIdRef = useRef(0);

  // Declared FIRST so it runs before the fetch effects on the same commit.
  useEffect(() => {
    tabStatesRef.current = tabStates;
    tickedRef.current = ticked;
    columnsCallRef.current = columnsCall;
    previewCallRef.current = previewCall;
    inspectRef.current = inspect;
  });

  // -- state writers -------------------------------------------------------------------
  const patchTab = useCallback(
    (sheetName: string, patch: (prev: TabState) => TabState) => {
      setTabStates((prev) => {
        const existing = prev[sheetName];
        if (!existing) return prev;
        const next = patch(existing);
        if (next === existing) return prev;
        return { ...prev, [sheetName]: next };
      });
    },
    [],
  );

  const resetAll = useCallback(() => {
    runIdRef.current += 1;
    inFlightRef.current = {};
    lastSigRef.current = {};
    columnsInFlightRef.current = {};
    columnsSigRef.current = {};
    setStep("upload");
    setInspect(null);
    setSelection({});
    setTabStates({});
    setActiveTab("");
    setIngesting(false);
    setIngestError(null);
    setResult(null);
  }, []);

  // Reset once the dialog is closed, so the next open starts clean. Depends on a boolean.
  useEffect(() => {
    if (!open) resetAll();
  }, [open, resetAll]);

  // -- the debounced per-sheet COLUMNS fetch (R3.1) -------------------------------------
  /**
   * Does a landed columns reply still answer the header row the tab holds RIGHT NOW? Reads the
   * ref, which the commit effect above keeps in step with the rendered state.
   */
  const columnsReplyIsCurrent = useCallback((sheetName: string, sig: string) => {
    const current = tabStatesRef.current[sheetName];
    return !!current && headerRowSignature(current.headerRow) === sig;
  }, []);

  /**
   * Re-read a sheet's columns for the header row the tab currently holds.
   *
   * This call takes NO mapping, and is issued INDEPENDENTLY of `isMappingValid` -- that
   * independence IS the fix. Gating a columns read behind a valid mapping is what made the
   * header-row override do nothing: the only way to get columns was `parse_preview`, which
   * refuses without a mapped Description, which you cannot choose without columns.
   */
  const fetchColumns = useCallback(
    async (sheetName: string, headerRow: number | null, sig: string, runId: number) => {
      const workbook = inspectRef.current;
      if (!workbook) return;

      columnsInFlightRef.current[sheetName] = sig;
      patchTab(sheetName, (prev) => ({
        ...prev,
        columnsLoading: true,
        columnsError: null,
      }));

      try {
        const res = await columnsCallRef.current({
          file_url: workbook.file_url,
          sheet_name: sheetName,
          header_row: headerRow,
        });
        // Superseded by a newer header row, or by a dialog reset -- drop it silently.
        if (runId !== runIdRef.current || columnsInFlightRef.current[sheetName] !== sig) return;
        delete columnsInFlightRef.current[sheetName];

        // ⚠️ Only a reply that still answers the CURRENT header row may advance the settled
        // signature. The case that forces this: the user types 12, then types 8 back again
        // before the 12 lands. The 8 needs no fetch (its columns are already settled), so no
        // newer request exists to supersede the 12 -- and banking "12" as settled would leave
        // `columnsSigRef` describing a header row the tab no longer has. The preview waits on
        // exactly that agreement, so it would never run again for this sheet.
        if (!columnsReplyIsCurrent(sheetName, sig)) {
          patchTab(sheetName, (prev) => ({ ...prev, columnsLoading: false }));
          return;
        }
        columnsSigRef.current[sheetName] = sig;

        const data = res?.message;
        if (!data) {
          patchTab(sheetName, (prev) => ({
            ...prev,
            columnsLoading: false,
            columnsError: "The column list came back empty.",
          }));
          return;
        }

        patchTab(sheetName, (prev) => {
          // Guard again against a header-row edit that landed in the same commit. Clearing the
          // spinner is not optional here -- a `prev` returned unchanged leaves the tab reading
          // "Reading column names…" with nothing left to deliver it.
          if (headerRowSignature(prev.headerRow) !== sig) {
            return { ...prev, columnsLoading: false };
          }
          const guess = data.mapping_guess;
          return {
            ...prev,
            columns: data.columns,
            // Q8a: a header-row change RESETS the mapping to the fresh auto-guess...
            mapping: guess ? initialMapping(guess) : prev.mapping,
            mappingReguessed: !!guess,
            // ...but ONLY when there IS one. Emptying the mapping because the new header row
            // is not header-shaped is half of the R3.1 defect: it throws away the user's picks
            // for no gain, since the letters they chose are still real columns. A letter that
            // has genuinely gone stale is already caught by `unknownMappedRoles` and called out
            // per field, so keeping it is safe as well as kinder.
            mappingKeptNoGuess: !guess,
            columnsLoading: false,
            columnsError: null,
          };
        });
      } catch (err) {
        if (runId !== runIdRef.current || columnsInFlightRef.current[sheetName] !== sig) return;
        delete columnsInFlightRef.current[sheetName];
        if (!columnsReplyIsCurrent(sheetName, sig)) {
          patchTab(sheetName, (prev) => ({ ...prev, columnsLoading: false }));
          return;
        }
        // Record the FAILED attempt as settled. Without this the sheet retries on every
        // render and the preview stays blocked behind a read that will never succeed -- a
        // second deadlock. The user's next header-row edit is what retries it.
        columnsSigRef.current[sheetName] = sig;
        patchTab(sheetName, (prev) => ({
          ...prev,
          columnsLoading: false,
          columnsError: errorText(
            err,
            "Could not read the column names for that header row.",
          ),
        }));
      }
    },
    [columnsReplyIsCurrent, patchTab],
  );

  /**
   * One entry per ticked sheet holding ONLY its header row -- the columns read's whole input.
   * A STRING, never the objects (frontend/CLAUDE.md § React Effects).
   */
  const columnsPlanKey = useMemo(
    () =>
      ticked
        .map((name) => `${name}\u0000${headerRowSignature(tabStates[name]?.headerRow)}`)
        .join("\u0001"),
    [ticked, tabStates],
  );

  useEffect(() => {
    if (step !== "tabs") return;
    const runId = runIdRef.current;
    const timer = window.setTimeout(() => {
      for (const name of tickedRef.current) {
        const state = tabStatesRef.current[name];
        if (!state) continue;
        const sig = headerRowSignature(state.headerRow);
        if (columnsInFlightRef.current[name] === sig) continue;
        if (columnsSigRef.current[name] === sig) continue;
        void fetchColumns(name, state.headerRow, sig, runId);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [step, columnsPlanKey, fetchColumns]);

  // -- the debounced per-sheet preview fetch -------------------------------------------
  const fetchPreview = useCallback(
    async (sheetName: string, sig: string, runId: number) => {
      const state = tabStatesRef.current[sheetName];
      const workbook = inspectRef.current;
      if (!state || !workbook) return;

      inFlightRef.current[sheetName] = sig;
      patchTab(sheetName, (prev) => ({
        ...prev,
        previewLoading: true,
        previewError: null,
      }));

      try {
        const res = await previewCallRef.current({
          project: projectId,
          file_url: workbook.file_url,
          sheet_name: sheetName,
          mapping: state.mapping,
          header_row: state.headerRow,
        });
        // Superseded by a newer mapping, or by a dialog reset -- drop it silently.
        if (runId !== runIdRef.current || inFlightRef.current[sheetName] !== sig) return;
        delete inFlightRef.current[sheetName];
        lastSigRef.current[sheetName] = sig;

        const data = res?.message;
        if (!data) {
          patchTab(sheetName, (prev) => ({
            ...prev,
            previewLoading: false,
            previewError: "The preview came back empty.",
          }));
          return;
        }

        patchTab(sheetName, (prev) => {
          // Guard again against a mapping / header-row edit that landed mid-flight.
          if (mappingSignature(prev.mapping, prev.headerRow) !== sig) return prev;
          return {
            ...prev,
            // Adopting the recomputed columns is harmless and keeps the preview
            // self-consistent -- they are computed for the SAME header row `fetchColumns`
            // already read. It must NOT re-guess the mapping: `get_sheet_columns` owns that,
            // and a second adopter here is how a `mapping_guess: null` used to empty a mapping
            // the user had just fixed by hand (R3.1 path B).
            columns: data.columns,
            preview: data,
            previewLoading: false,
            previewError: null,
            ticked: seedTicksFromPreview(data),
          };
        });
      } catch (err) {
        if (runId !== runIdRef.current || inFlightRef.current[sheetName] !== sig) return;
        delete inFlightRef.current[sheetName];
        delete lastSigRef.current[sheetName];
        patchTab(sheetName, (prev) => ({
          ...prev,
          preview: null,
          previewLoading: false,
          previewError: errorText(err, "Could not read this sheet with that mapping."),
          ticked: new Set<number>(),
        }));
      }
    },
    [patchTab, projectId],
  );

  /**
   * The effect's ONLY dependency that can change per keystroke, as a STRING: one entry per
   * ticked sheet holding that sheet's REQUEST signature -- mapping AND header row, so a
   * header-row override actually invalidates the preview. Never pass the objects themselves.
   *
   * `columnsLoading` is part of it, and must STAY part of it. The preview now WAITS for the
   * columns of the current header row (see the effect below), and that readiness lives in a
   * REF -- which cannot wake an effect. `columnsLoading` is the rendered shadow of the same
   * transition: it flips false the instant the columns settle (reply OR error), so the preview
   * re-evaluates exactly then. Without it, a re-guess that happens to leave the mapping
   * unchanged parks the preview forever.
   */
  const fetchPlanKey = useMemo(
    () =>
      ticked
        .map((name) => {
          const st = tabStates[name];
          const cols = st?.columnsLoading ? "loading" : "ready";
          return `${name}\u0000${mappingSignature(st?.mapping, st?.headerRow)}\u0000${cols}`;
        })
        .join("\u0001"),
    [ticked, tabStates],
  );

  useEffect(() => {
    if (step !== "tabs") return;
    const runId = runIdRef.current;
    const timer = window.setTimeout(() => {
      for (const name of tickedRef.current) {
        const state = tabStatesRef.current[name];
        if (!state) continue;
        const sig = mappingSignature(state.mapping, state.headerRow);

        // The columns for THIS header row have not landed yet. Previewing now would spend a
        // call whose reply the mid-flight guard then discards (the columns reply re-guesses
        // the mapping, which moves the signature), and would flash the old sheet's rows.
        if (columnsSigRef.current[name] !== headerRowSignature(state.headerRow)) continue;

        if (!isMappingValid(state.mapping, state.columns)) {
          delete lastSigRef.current[name];
          delete inFlightRef.current[name];
          if (state.preview || state.previewError || state.previewLoading) {
            patchTab(name, (prev) => ({
              ...prev,
              preview: null,
              previewLoading: false,
              previewError: null,
              ticked: new Set<number>(),
            }));
          }
          continue;
        }
        if (inFlightRef.current[name] === sig) continue;
        if (lastSigRef.current[name] === sig && state.preview) continue;
        void fetchPreview(name, sig, runId);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [step, fetchPlanKey, fetchPreview, patchTab]);

  // -- handlers ------------------------------------------------------------------------
  const handleInspected = useCallback(
    (_file: File, response: InspectWorkbookResponse) => {
      runIdRef.current += 1;
      inFlightRef.current = {};
      lastSigRef.current = {};
      columnsInFlightRef.current = {};
      columnsSigRef.current = {};
      setInspect(response);
      setSelection(initialSheetSelection(response.sheets));
      setTabStates({});
      setActiveTab("");
      setIngestError(null);
      setStep("sheets");
    },
    [],
  );

  const handleContinueToTabs = useCallback(() => {
    if (!inspect || ticked.length === 0) return;
    const next = reconcileTabStates(
      tabStatesRef.current,
      inspect.sheets,
      ticked,
      inspect.file_name,
    );
    setTabStates(next);
    // SEED the columns signature for every tab that now exists. `inspect_workbook` already
    // returned columns for its own guessed header row, so without this seed the columns
    // effect would immediately re-fetch what we already have on every entry to this step.
    // A tab carried over from a previous visit keeps whatever signature it had.
    for (const name of ticked) {
      if (columnsSigRef.current[name] === undefined) {
        columnsSigRef.current[name] = headerRowSignature(next[name]?.headerRow);
      }
    }
    setActiveTab((prev) => (prev && ticked.includes(prev) ? prev : ticked[0]));
    setStep("tabs");
  }, [inspect, ticked]);

  const handleBatchNameChange = useCallback(
    (sheetName: string, value: string) =>
      patchTab(sheetName, (prev) => ({ ...prev, batchName: value })),
    [patchTab],
  );

  const handleMappingChange = useCallback(
    (sheetName: string, mapping: SnagColumnMapping) =>
      // A hand edit answers BOTH header-row notes (re-guessed, or kept for want of a guess),
      // so they go away together.
      patchTab(sheetName, (prev) => ({
        ...prev,
        mapping,
        mappingReguessed: false,
        mappingKeptNoGuess: false,
      })),
    [patchTab],
  );

  /**
   * The header-row override (R2 change 2, fixed in R3.1).
   *
   * It stores the row and NOTHING else -- which is the point. Everything downstream is driven
   * off the stored value:
   *  - the COLUMNS effect sees its header signature move and re-reads the column list through
   *    `get_sheet_columns`, unconditionally. That call needs no mapping, so this works on a
   *    sheet whose auto-detection failed and whose selects are still empty.
   *  - `headerRow` is part of `mappingSignature`, so this also invalidates the preview and
   *    makes the in-flight guard reject a response computed for the OLD header row.
   *
   * There is deliberately NO "adopt the next reply's guess" intent flag any more. It existed
   * because the re-guess rode on `parse_preview`, which fires for a mapping edit too; the
   * columns read fires ONLY for a header-row change, so the intent is implicit in the call.
   */
  const handleHeaderRowChange = useCallback(
    (sheetName: string, headerRow: number | null) => {
      const current = tabStatesRef.current[sheetName];
      if (!current || current.headerRow === headerRow) return;
      patchTab(sheetName, (prev) => ({
        ...prev,
        headerRow,
        mappingReguessed: false,
        mappingKeptNoGuess: false,
      }));
    },
    [patchTab],
  );

  const handleToggleRow = useCallback(
    (sheetName: string, sourceRow: number) =>
      patchTab(sheetName, (prev) => ({
        ...prev,
        ticked: toggleTick(prev.ticked, sourceRow),
      })),
    [patchTab],
  );

  const handleSetRows = useCallback(
    (sheetName: string, rows: number[], next: boolean) =>
      patchTab(sheetName, (prev) => ({
        ...prev,
        ticked: setTicks(prev.ticked, rows, next),
      })),
    [patchTab],
  );

  const gate = useMemo(() => evaluateConfirmGate(ticked, tabStates), [ticked, tabStates]);

  const handleConfirm = useCallback(async () => {
    if (!inspect || !gate.ok) return;
    setIngesting(true);
    setIngestError(null);
    try {
      const res = await ingestCall({
        project: projectId,
        file_url: inspect.file_url,
        file_name: inspect.file_name,
        batches: buildIngestBatches(ticked, tabStates, inspect.file_name),
      });
      const payload = res?.message;
      if (!payload) {
        setIngestError("The import returned no result. Nothing was confirmed as imported.");
        return;
      }
      setResult(payload);
      setStep("result");
      onImported(payload);
    } catch (err) {
      setIngestError(errorText(err, "The import failed. Nothing was imported."));
    } finally {
      setIngesting(false);
    }
  }, [gate.ok, ingestCall, inspect, onImported, projectId, tabStates, ticked]);

  // -- render --------------------------------------------------------------------------
  const sheetsByName = useMemo(() => {
    const map: Record<string, WorkbookSheet> = {};
    for (const s of sheets) map[s.name] = s;
    return map;
  }, [sheets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b px-6 py-4">
          <DialogTitle>{TITLES[step]}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[step]}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === "upload" && (
            <UploadStep
              projectId={projectId}
              fileName={inspect?.file_name ?? null}
              onInspected={handleInspected}
            />
          )}

          {step === "sheets" && inspect && (
            <SheetPickStep
              fileName={inspect.file_name}
              sheets={sheets}
              selection={selection}
              onToggle={(name, next) =>
                setSelection((prev) => ({ ...prev, [name]: next }))
              }
            />
          )}

          {step === "tabs" && inspect && (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              {/* R2 change 3: the strip had no label of any kind. */}
              <div className="mb-1.5 text-xs font-medium text-muted-foreground" id="snag-current-sheet-label">
                Current Sheet
              </div>
              <TabsList
                aria-labelledby="snag-current-sheet-label"
                className="flex h-auto w-full flex-wrap justify-start gap-1"
              >
                {ticked.map((name) => {
                  const st = tabStates[name];
                  const count = st?.ticked.size ?? 0;
                  const warn = !st?.previewLoading && count === 0;
                  return (
                    <TabsTrigger key={name} value={name} className="gap-1.5">
                      {warn && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                          title="This sheet currently yields no rows"
                        />
                      )}
                      <span className="max-w-[12rem] truncate">{name}</span>
                      <Badge
                        variant={warn ? "yellow" : "secondary"}
                        className={cn("px-1.5 py-0 font-normal tabular-nums")}
                      >
                        {st?.previewLoading && !st?.preview ? "…" : count}
                      </Badge>
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {ticked.map((name) => {
                const sheet = sheetsByName[name];
                const st = tabStates[name];
                if (!sheet || !st) return null;
                return (
                  <TabsContent key={name} value={name} className="mt-4">
                    <SheetTabPanel
                      sheet={sheet}
                      state={st}
                      onBatchNameChange={handleBatchNameChange}
                      onHeaderRowChange={handleHeaderRowChange}
                      onMappingChange={handleMappingChange}
                      onToggleRow={handleToggleRow}
                      onSetRows={handleSetRows}
                    />
                  </TabsContent>
                );
              })}
            </Tabs>
          )}

          {step === "result" && result && <IngestResultScreen result={result} />}
        </div>

        <DialogFooter className="flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 text-left">
            {step === "tabs" && !gate.ok && (
              <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{gate.message}</span>
              </p>
            )}
            {step === "tabs" && gate.ok && !ingestError && (
              <p className="text-sm text-muted-foreground">
                {gate.totalRows} {gate.totalRows === 1 ? "snag" : "snags"} across{" "}
                {ticked.length} {ticked.length === 1 ? "sheet" : "sheets"}.
              </p>
            )}
            {ingestError && (
              <p className="text-sm text-destructive">{ingestError}</p>
            )}
            {step === "sheets" && ticked.length === 0 && (
              <p className="text-sm text-muted-foreground">Select at least one sheet.</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {step === "sheets" && (
              <Button variant="outline" onClick={() => setStep("upload")}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Button>
            )}
            {step === "tabs" && (
              <Button
                variant="outline"
                disabled={ingesting}
                onClick={() => setStep("sheets")}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Button>
            )}
            {step !== "result" && (
              <Button
                variant="ghost"
                disabled={ingesting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            )}

            {step === "sheets" && (
              <Button disabled={ticked.length === 0} onClick={handleContinueToTabs}>
                Continue
              </Button>
            )}
            {step === "tabs" && (
              <Button disabled={!gate.ok || ingesting} onClick={() => void handleConfirm()}>
                {ingesting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {ingesting ? "Importing…" : "Import"}
              </Button>
            )}
            {step === "result" && (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TITLES: Record<Step, string> = {
  upload: "Import snag list",
  sheets: "Choose worksheets",
  tabs: "Check what will be imported",
  result: "Import result",
};

const DESCRIPTIONS: Record<Step, string> = {
  upload: "Upload the consultant's snag list workbook. Nothing is saved until you confirm.",
  sheets: "Each worksheet you pick becomes its own batch.",
  tabs: "One tab per worksheet. Name the batch, confirm the columns, and untick anything that should not come in.",
  result: "One line per worksheet. A failure here imported nothing for that sheet.",
};
