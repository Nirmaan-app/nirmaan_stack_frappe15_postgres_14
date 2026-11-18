/**
 * The hub's parse and each sheet's automatic check, followed as background operations (ADR 0047; spec #1654, #1668).
 * Pure: the hub (`BoqHubPage`) and the review screen (`SheetReviewPage`) follow the operations with the shared
 * `useBackgroundOperation` hook; this module turns what the hook shows into what the screens show.
 *
 * - A Parse press starts `parse_run.run_parse` as an operation (slot `boq_parse:<boq>`). The hub shows
 *   "Waiting in the queue..." until a worker runs it, then "Parsing...". A failed or lost parse ends the wait with
 *   the server's words; the BoQ's own `parse_in_progress` flag never keeps it waiting after that.
 * - The finished parse's result names the check it started for each parsed sheet (`checks`, sheet -> op id). The hub
 *   follows each (slot `boq_ai_check:<boq>::<sheet>`, shared with the review screen, so the same tab picks it up
 *   there); a card's chip says the check waits in the queue until it runs.
 */
import { isInFlight, isRecord, type OpView } from "@/utils/backgroundOps/operationFollower";

import { CHECKING_ROWS_LABEL } from "./reviewCheckFlags";
import type { RevisionCarryBySheet } from "./revisionCarryReport";

export const RUN_PARSE_METHOD = "nirmaan_stack.api.boq.wizard.parse_run.run_parse";

/** The tab's slot for this BoQ's parse operation. */
export const parseSlot = (boq: string) => `boq_parse:${boq}`;
/** The tab's slot for one sheet's check operation: the hub and the review screen share it. */
export const checkSlot = (boq: string, sheetName: string) => `boq_ai_check:${boq}::${sheetName}`;

export const PARSE_QUEUED_LABEL = "Waiting in the queue...";
export const PARSING_LABEL = "Parsing...";
export const CHECK_QUEUED_LABEL = "Waiting to check rows…";

/** No sheet was eligible to parse: an advisory, shown as such (the parse finished; nothing failed). */
export const NOTHING_TO_PARSE_MESSAGE =
  "No sheets were eligible to parse. Mark at least one sheet as Config Done before parsing.";

export interface HubParse {
  /** A parse is queued or running: Parse and Re-parse are disabled. */
  inFlight: boolean;
  /** The Parse button's words while in flight, else null. */
  label: string | null;
}

/**
 * What the hub shows for its parse. `view` is the parse operation this tab follows; `flagSet` is the BoQ's own
 * `parse_in_progress`, which speaks only for a parse this tab does not follow (another tab or user).
 */
export function hubParseOf(view: OpView, flagSet: boolean): HubParse {
  if (isInFlight(view)) return { inFlight: true, label: view.phase === "running" ? PARSING_LABEL : PARSE_QUEUED_LABEL };
  if (view.phase === "idle" && flagSet) return { inFlight: true, label: PARSING_LABEL };
  return { inFlight: false, label: null };
}

export type ParseOutcome =
  | {
    kind: "parsed";
    parsed: string[];
    notParsed: string[];
    failed: string[];
    /** W5: per-sheet carry counts; absent off a revision parse. */
    carry: RevisionCarryBySheet | undefined;
    /** sheet (VERBATIM, #152) -> the operation id of the check the parse started for it. */
    checks: Record<string, string>;
  }
  | { kind: "nothing_to_parse" };

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** The finished parse operation's result (`parse_run._parse`), or null when it is not one. */
export function parseOutcomeOf(result: unknown): ParseOutcome | null {
  if (!isRecord(result)) return null;
  if (result.status === "nothing_to_parse") return { kind: "nothing_to_parse" };
  const checks: Record<string, string> = {};
  if (isRecord(result.checks)) {
    for (const [sheet, opId] of Object.entries(result.checks)) {
      if (typeof opId === "string") checks[sheet] = opId;
    }
  }
  return {
    kind: "parsed",
    parsed: names(result.parsed_sheets),
    notParsed: names(result.not_parsed_sheets),
    failed: names(result.failed_sheets),
    carry: isRecord(result.revision_carry) ? (result.revision_carry as RevisionCarryBySheet) : undefined,
    checks,
  };
}

/** A sheet's check chip from the check operation followed for it: queued apart from running; null otherwise. */
export function checkChipOf(view: OpView | undefined): string | null {
  if (!view) return null;
  if (view.phase === "starting" || view.phase === "queued") return CHECK_QUEUED_LABEL;
  if (view.phase === "running") return CHECKING_ROWS_LABEL;
  return null;
}
