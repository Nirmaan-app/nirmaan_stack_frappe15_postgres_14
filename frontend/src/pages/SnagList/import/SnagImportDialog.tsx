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
 *  - `inspect_workbook` is the only raw `fetch` (multipart); the other two calls go through
 *    `useFrappePostCall`.
 *  - No object/array is ever a `useEffect` dependency (frontend/CLAUDE.md § React Effects):
 *    the preview-refetch effect depends on a derived STRING signature.
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
  const previewCallRef = useRef(previewCall);
  const inspectRef = useRef(inspect);
  /** sheetName -> the request signature of the request currently in flight. */
  const inFlightRef = useRef<Record<string, string>>({});
  /** sheetName -> the request signature the current preview was fetched with. */
  const lastSigRef = useRef<Record<string, string>>({});
  /**
   * sheetName -> "the user changed the header row; adopt the server's fresh `mapping_guess`
   * when the next preview lands" (owner decision Q8a).
   *
   * It has to be an explicit INTENT flag rather than a comparison against the previous
   * response: `parse_preview` returns `mapping_guess` on EVERY call, so adopting it
   * unconditionally would stomp the mapping the user just edited by hand — and, since a
   * mapping edit is itself what triggered that call, would loop.
   */
  const pendingReguessRef = useRef<Record<string, boolean>>({});
  /** Bumped on close/reset so a late response from a previous run is discarded. */
  const runIdRef = useRef(0);

  // Declared FIRST so it runs before the fetch effect on the same commit.
  useEffect(() => {
    tabStatesRef.current = tabStates;
    tickedRef.current = ticked;
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
    pendingReguessRef.current = {};
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
        const reguess = pendingReguessRef.current[sheetName] === true;
        delete pendingReguessRef.current[sheetName];

        patchTab(sheetName, (prev) => {
          // Guard again against a mapping / header-row edit that landed mid-flight.
          if (mappingSignature(prev.mapping, prev.headerRow) !== sig) return prev;
          return {
            ...prev,
            // ALWAYS adopt the recomputed columns: their labels are literally the cells of
            // the header row that was used, so the selects must render from these.
            columns: data.columns,
            // The mapping is only overwritten when the user CHANGED the header row (Q8a).
            mapping: reguess ? initialMapping(data.mapping_guess) : prev.mapping,
            mappingReguessed: reguess ? true : prev.mappingReguessed,
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
   */
  const fetchPlanKey = useMemo(
    () =>
      ticked
        .map((name) => {
          const st = tabStates[name];
          return `${name}\u0000${mappingSignature(st?.mapping, st?.headerRow)}`;
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
      pendingReguessRef.current = {};
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
    setTabStates((prev) =>
      reconcileTabStates(prev, inspect.sheets, ticked, inspect.file_name),
    );
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
      // A hand edit answers the re-guess note, so it goes away.
      patchTab(sheetName, (prev) => ({ ...prev, mapping, mappingReguessed: false })),
    [patchTab],
  );

  /**
   * The header-row override (R2 change 2).
   *
   * Two things have to happen together, and both are easy to lose:
   *  - `headerRow` is part of `mappingSignature`, so this alone invalidates the preview and
   *    makes the in-flight guard reject a response computed for the OLD header row.
   *  - the flag tells the NEXT response to reset the mapping to its fresh `mapping_guess`
   *    (Q8a). `reconcileTabStates` preserves an existing tab's state, so nothing else would
   *    ever re-guess a tab that already exists -- the overwrite has to be explicit.
   */
  const handleHeaderRowChange = useCallback(
    (sheetName: string, headerRow: number | null) => {
      const current = tabStatesRef.current[sheetName];
      if (!current || current.headerRow === headerRow) return;
      // Set OUTSIDE the state updater: an updater may be invoked more than once per commit,
      // and a ref write belongs in the event handler, not in render.
      pendingReguessRef.current[sheetName] = true;
      patchTab(sheetName, (prev) => ({ ...prev, headerRow, mappingReguessed: false }));
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
