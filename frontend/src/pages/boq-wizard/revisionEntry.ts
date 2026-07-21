/**
 * Entry un-lock decision (ADR-0014 Amendment B W3) -- PURE, no React.
 *
 * The New|Revise radio and the original picker used to FREEZE the moment a file dropped,
 * because `origin` / `source_boq` are baked into the BOQs doc at insert. They are now live:
 * a change after the upload is pushed to the server through
 * `revision.convert_revision_entry`, which is the one owner of those two fields.
 *
 * This module owns the "what does this change mean" question so the panel stays a thin
 * renderer (ADR-0010 F4). Four outcomes, and only one of them talks to the server:
 *
 *   local        -- no BOQs doc yet: the store value IS the truth, it rides the upload POST
 *                   (byte-identical to the pre-W3 flow).
 *   await-source -- Revise picked but no original yet: the convert endpoint REQUIRES
 *                   source_boq, so we wait for the picker instead of throwing at the user.
 *   noop         -- the server already holds exactly this entry (the endpoint is idempotent,
 *                   but a call that cannot change anything is still a call).
 *   convert      -- push it.
 *
 * Unknown server state (`serverOrigin` undefined/null while the doc is still loading) resolves
 * to CONVERT, never to noop: a redundant convert is idempotent server-side, whereas a wrongly
 * skipped one would leave the radio disagreeing with the doc.
 */
import type { RevisionMode } from "@/zustand/useBoqWizardStore";

export type EntryAction =
  | { kind: "local" }
  | { kind: "await-source" }
  | { kind: "noop" }
  | { kind: "convert"; mode: RevisionMode; sourceBoq: string | null };

export interface EntryChangeInput {
  /** The created BOQs docname, or null while the upload has not produced one yet. */
  boqDocName: string | null;
  /** The entry the user just selected. */
  mode: RevisionMode;
  /** The original picked for a revision (null = not picked yet). */
  sourceBoq: string | null;
  /** `BOQs.origin` as last read from the server; null/undefined while unknown. */
  serverOrigin?: string | null;
  /** `BOQs.source_boq` as last read from the server. */
  serverSourceBoq?: string | null;
}

export function planEntryChange({
  boqDocName,
  mode,
  sourceBoq,
  serverOrigin,
  serverSourceBoq,
}: EntryChangeInput): EntryAction {
  if (!boqDocName) return { kind: "local" };

  if (mode === "revise") {
    if (!sourceBoq) return { kind: "await-source" };
    if (serverOrigin === "revision" && serverSourceBoq === sourceBoq) {
      return { kind: "noop" };
    }
    return { kind: "convert", mode: "revise", sourceBoq };
  }

  // Back to New. Skip only when we positively KNOW the doc is not a revision.
  if (serverOrigin != null && serverOrigin !== "revision") return { kind: "noop" };
  return { kind: "convert", mode: "new", sourceBoq: null };
}
