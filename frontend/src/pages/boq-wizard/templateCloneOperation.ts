/**
 * Create from Template's clone as a background operation (#1669, ADR 0047): `create_from_template` makes the BoQ
 * shell and starts the clone through `services/background_ops`, and `TemplateCreateFlow` follows it with
 * `useBackgroundOperation`. This reads what that operation's view means for the screen.
 */
import { isRecord, type OpView } from "@/utils/backgroundOps/operationFollower";

import { readBoqWorkerOutcome } from "@/utils/boq/boqWorkerOutcome";

export const CLONE_METHOD = "nirmaan_stack.api.boq.wizard.create_from_template.create_from_template";

/**
 * The screen's lifecycle.
 *   idle     - the picker
 *   creating - the create request is in flight
 *   queued   - the clone waits in the queue
 *   building - the clone is running
 *   done     - cloned; the BoQ is `boqName`
 *   error    - `message` says why
 */
export type CloneStatus = "idle" | "creating" | "queued" | "building" | "done" | "error";

export interface CloneOutcome {
  status: CloneStatus;
  boqName: string | null;
  message: string | null;
}

/** The words for a finished clone's `error_code` (`create_from_template._clone_worker`). */
const CLONE_ERROR_MSGS: Record<string, string> = {
  template_changed:
    "The master template changed while your BoQ was being built (a sheet you picked was removed). Please try again.",
};
const CLONE_ERROR_FALLBACK = "Something went wrong while building your BoQ. Please try again.";

export function cloneOutcome(view: OpView): CloneOutcome {
  const outcome = (status: CloneStatus, boqName: string | null = null, message: string | null = null) =>
    ({ status, boqName, message });
  switch (view.phase) {
    case "idle": return outcome("idle");
    case "starting": return outcome("creating");
    case "queued": return outcome("queued");
    case "running": return outcome("building");
    case "failed":
    case "lost": return outcome("error", null, view.error);
    case "finished": {
      const made = readBoqWorkerOutcome(view.result);
      return made.ok
        ? outcome("done", made.boqName)
        : outcome("error", null, CLONE_ERROR_MSGS[made.errorCode ?? ""] ?? CLONE_ERROR_FALLBACK);
    }
  }
}

/** What a clone started with, kept as the operation's context so a reload still says how many sheets it clones. */
export interface CloneContext {
  sheetCount: number;
}

export function cloneSheetCountOf(context: unknown): number | null {
  return isRecord(context) && typeof context.sheetCount === "number" ? context.sheetCount : null;
}
