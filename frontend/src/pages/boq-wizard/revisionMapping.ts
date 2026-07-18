/**
 * Pure client-side bookkeeping for the revised-BoQ sheet-mapping screen (ADR-0014 D3, S3).
 *
 * The pairing AUTHORITY is the backend's N2 matcher -- this module never re-derives N2
 * (that would be the forked second copy D3 forbids). It only does the set-bookkeeping the
 * screen needs over the backend's proposal: which originals are still unclaimed, whether an
 * original was double-claimed (strict 1:1), whether every sheet has an explicit decision (the
 * Confirm gate / "unmatched = hard stop"), and the confirm payload. Unit-tested; the page is
 * a thin shell over it (ADR-0010 F4).
 */

/** Sentinel choice: the human declares this revised sheet brand-new (carries nothing). */
export const NEW_SHEET = "__NEW__";
/** Sentinel choice: undecided -- the hard-stop state that blocks Confirm. */
export const UNDECIDED = "";

/** A committed sheet of the original (Zone-1), as returned by get_revision_mapping_proposal. */
export interface CommittedSheet {
  sheet_name: string;
  commit_version: number;
  general_specs: boolean;
}

/** One revised tab's proposal (Zone-2), as returned by get_revision_mapping_proposal. */
export interface RevisedSheetProposal {
  sheet_name: string;
  sheet_order: number;
  proposed_source: string | null;
  status: "matched" | "unmatched";
  general_specs: boolean;
}

/** Per-revised-sheet human decision. `choice` is UNDECIDED / NEW_SHEET / an original sheet_name. */
export interface SheetDecision {
  choice: string;
  general_specs: boolean;
}

export type DecisionMap = Record<string, SheetDecision>;

/** One confirm-payload entry (matches confirm_revision_mapping's `mapping`). */
export interface MappingEntry {
  sheet_name: string;
  source_sheet_name: string | null; // set = mapped
  declared_new: boolean; // explicit New declaration (server refuses a null source without it)
  general_specs: boolean;
}

/** Seed the editable decisions from the backend proposal: matched -> pre-filled, else undecided. */
export function initDecisions(revised: RevisedSheetProposal[]): DecisionMap {
  const out: DecisionMap = {};
  for (const s of revised) {
    out[s.sheet_name] = {
      choice: s.status === "matched" && s.proposed_source ? s.proposed_source : UNDECIDED,
      general_specs: s.general_specs,
    };
  }
  return out;
}

/** Whether a chosen original is general-specs (the smart default on choice-change). */
export function isGeneralSpecsOriginal(committed: CommittedSheet[], choice: string): boolean {
  return committed.some((c) => c.sheet_name === choice && c.general_specs);
}

/** The originals currently claimed (a real original name, not UNDECIDED / NEW_SHEET). */
export function claimedOriginals(decisions: DecisionMap): string[] {
  return Object.values(decisions)
    .map((d) => d.choice)
    .filter((c) => c !== UNDECIDED && c !== NEW_SHEET);
}

/** Originals claimed by 2+ revised sheets (a strict-1:1 violation). */
export function duplicateClaims(decisions: DecisionMap): string[] {
  const counts = new Map<string, number>();
  for (const c of claimedOriginals(decisions)) {
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c);
}

/** Committed originals not claimed by any revised sheet (the live "won't carry" tail). */
export function unclaimedOriginals(
  committed: CommittedSheet[],
  decisions: DecisionMap
): CommittedSheet[] {
  const claimed = new Set(claimedOriginals(decisions));
  return committed.filter((c) => !claimed.has(c.sheet_name));
}

/**
 * The Confirm gate: every revised sheet has an explicit decision (no UNDECIDED -- the
 * "unmatched = hard stop" rule) AND no original is double-claimed (strict 1:1).
 */
export function isMappingComplete(
  revised: RevisedSheetProposal[],
  decisions: DecisionMap
): boolean {
  if (duplicateClaims(decisions).length > 0) return false;
  return revised.every((s) => (decisions[s.sheet_name]?.choice ?? UNDECIDED) !== UNDECIDED);
}

/** The confirm payload, in workbook tab order. NEW_SHEET / UNDECIDED -> null source. */
export function toConfirmPayload(
  revised: RevisedSheetProposal[],
  decisions: DecisionMap
): MappingEntry[] {
  return [...revised]
    .sort((a, b) => a.sheet_order - b.sheet_order)
    .map((s) => {
      const d = decisions[s.sheet_name] ?? { choice: UNDECIDED, general_specs: false };
      const mapped = d.choice !== UNDECIDED && d.choice !== NEW_SHEET;
      return {
        sheet_name: s.sheet_name,
        source_sheet_name: mapped ? d.choice : null,
        declared_new: d.choice === NEW_SHEET,
        general_specs: mapped ? d.general_specs : false,
      };
    });
}
