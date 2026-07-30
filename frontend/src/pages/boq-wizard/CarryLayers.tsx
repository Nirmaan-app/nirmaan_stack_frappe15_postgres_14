/**
 * CarryLayers -- the opt-in non-rate layer choice, shared by every carry surface.
 *
 * ADR-0014 Amendment E restored the four row-addressed layers the carry moves alongside rates,
 * OPT-IN and ATTRIBUTED. Amendment D's complaint was that carried records arrived UN-ASKED-FOR and
 * UN-ATTRIBUTED; this module is the "asked-for" half (the "attributed" half is the server's
 * provenance stamp). Every helper here is pure and unit-tested -- the component only renders them
 * (ADR-0010 F4).
 *
 * WBC-W1-S1: extracted VERBATIM from CrossBoqCarryDialog.tsx, where the block was a private
 * component and the helpers were exported but reachable only by importing the cross-BoQ dialog. The
 * within-BoQ "Copy rates forward" surface needs the same choice, and importing it out of a sibling
 * dialog is the smell this module removes. Nothing here changed behaviour in that move.
 *
 * ⚠️ `initialLayerChoices()` returning categories ON and the three annotation layers OFF is a UI
 * DEFAULT and lives ONLY here. The backend carries nothing it is not explicitly asked for -- do not
 * push this default down into the server.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CARRY_LAYER_KEYS } from "./boqTypes";
import type { CarryLayerChoice, CarryLayerKey, CarryLayerOutcome } from "./boqTypes";

// ── Pure helpers (vitest-tested in CrossBoqCarryDialog.test.ts + CopyForwardDialog.test.ts) ───────

/**
 * What this module needs to know about "the thing being carried from": its per-layer PREVIEW, and
 * nothing else.
 *
 * WBC-W3-S5: the helpers below were typed to the cross-BoQ dialog's concrete `CrossBoqCarrySheet`,
 * which S1 deliberately left alone because the within-BoQ preview shape was still being decided (S2
 * has now decided it: `get_copy_forward_plan` returns the same `layers` block on a response that is
 * NOT a sheet). Typing the shared seam to one caller's concrete type would have forced the other
 * caller to fake a sheet, so the parameter is now the single structural fact both responses share.
 *
 * `layers` stays OPTIONAL: a pre-Amendment-E/F server sends no preview, and both surfaces degrade to
 * "no counts, section hidden" rather than throwing.
 */
export interface CarryLayerSource {
  layers?: Partial<Record<CarryLayerKey, CarryLayerOutcome>>;
}

/** Display names for the four layers. Module-level so the dialog and its tests read the SAME
 *  strings. RENDER ORDER comes from CARRY_LAYER_KEYS, never from this map's key order. */
export const LAYER_LABEL: Record<CarryLayerKey, string> = {
  categories: "Categories",
  remarks: "Remarks",
  colors: "Cell colours",
  remark_dismissals: "Dismissed review flags",
};

/**
 * What the carry is copying INTO, as the block's copy names it. Two of the block's sentences have to
 * say this out loud, and the two surfaces do not agree on the word: across BoQs the destination is
 * "the revision", but within ONE BoQ there is no revision at all -- only an older and a current
 * VERSION of the same sheet, so "the revision" names nothing the user can see (owner ruling R9).
 *
 * Same shape S5 used for the block's subtext: a CROSS-BoQ default plus a per-surface variant, so
 * the cross-BoQ dialog renders byte-identically without being touched.
 *
 * Both wordings are owner-CONFIRMED (R3, WBC-S3a-rework).
 */
export const CARRY_DESTINATION_CROSS_BOQ = "the revision";
export const CARRY_DESTINATION_WITHIN_BOQ = "the current version";

/** What each layer actually is, in the reviewer's vocabulary -- these are opt-in choices, so the
 *  dialog has to say what is being opted into. Only COLOURS names the destination; the other three
 *  are surface-independent and come back identical whatever is passed. */
export function layerHint(
  key: CarryLayerKey,
  destination: string = CARRY_DESTINATION_CROSS_BOQ,
): string {
  switch (key) {
    case "categories":
      return "The classification verdict on each row.";
    case "remarks":
      return "Notes written against a cell.";
    case "colors":
      return `Colour marks. Only columns that still exist in ${destination} can carry.`;
    case "remark_dismissals":
      return "Review flags someone has already dismissed.";
  }
}

/** The user's choice for every layer (the dialog always holds all four; the WIRE gets only the
 *  ticked ones -- see buildLayersPayload). */
export type LayerChoices = Record<CarryLayerKey, CarryLayerChoice>;

/**
 * The dialog's default per-layer choice: CATEGORIES ON, the three annotation layers OFF
 * (ADR-0014 Amendment E, owner decision 6).
 *
 * ⚠️ The asymmetry is a UI DEFAULT and lives ONLY here. The backend carries nothing it is not
 * explicitly asked for, so an omitted/empty payload is rates-only -- which is exactly the
 * Amendment D behaviour. Do not push this default down into the server "for consistency": a
 * client that never learned about layers must keep getting rates only.
 */
export function initialLayerChoices(): LayerChoices {
  return {
    categories: { carry: true, overwrite: false },
    remarks: { carry: false, overwrite: false },
    colors: { carry: false, overwrite: false },
    remark_dismissals: { carry: false, overwrite: false },
  };
}

/** Safe read of one layer's PLANNED outcome. `sheet.layers` is optional so a response from a
 *  pre-Amendment-E server degrades to "no counts" instead of throwing. */
export function layerOutcomeFor(
  sheet: CarryLayerSource | null | undefined,
  key: CarryLayerKey,
): CarryLayerOutcome | null {
  return sheet?.layers?.[key] ?? null;
}

/**
 * Does this layer have anything to offer? The plan is walked with overwrite OFF, so:
 *   `carried` = destination rows that WOULD be written (they hold no record yet)
 *   `kept`    = destination rows that already hold one, left alone -- what Overwrite would replace
 * Either makes the layer a real choice. Zero of both means there is nothing to carry and nothing
 * to replace, so the row renders disabled rather than inviting a no-op.
 */
export function layerHasWork(outcome: CarryLayerOutcome | null | undefined): boolean {
  if (!outcome) return false;
  return outcome.carried + outcome.kept > 0;
}

/** How many destination records this layer would actually WRITE, given the overwrite choice.
 *  Arming Overwrite moves the `kept` rows into `replaced` without changing the walk's total --
 *  so what lands is `carried` plus, when armed, the ones it displaces. */
export function layerMoveCount(
  outcome: CarryLayerOutcome | null | undefined,
  overwrite: boolean,
): number {
  if (!outcome) return 0;
  return outcome.carried + (overwrite ? outcome.kept : 0);
}

/** One layer's counts line. "" when the layer has nothing to offer -- the caller renders a
 *  disabled row instead, rather than a line of zeros the reader has to interpret. */
export function layerCountsText(outcome: CarryLayerOutcome | null | undefined): string {
  if (!layerHasWork(outcome) || !outcome) return "";
  const parts: string[] = [];
  if (outcome.carried > 0) parts.push(`${outcome.carried} to copy`);
  if (outcome.kept > 0) parts.push(`${outcome.kept} already set`);
  return parts.join(" · ");
}

/**
 * The per-layer "and these can't come" note, for the two structural drop reasons the walk reports.
 * Both are worth saying out loud BEFORE the apply, because neither is recoverable by re-running:
 *   colours    -- the physical column letter did not survive into the revision
 *   categories -- the destination row is not Line Item / Preamble, so it cannot hold one
 * Every other layer reports 0 for both by construction, hence the key-specific reads.
 */
export function layerSkipNote(
  key: CarryLayerKey,
  outcome: CarryLayerOutcome | null | undefined,
  destination: string = CARRY_DESTINATION_CROSS_BOQ,
): string {
  if (!outcome) return "";
  if (key === "colors" && outcome.dropped > 0) {
    return `${outcome.dropped} skipped — that column is not in ${destination}`;
  }
  if (key === "categories" && outcome.ineligible > 0) {
    return `${outcome.ineligible} skipped — those rows cannot hold a category`;
  }
  return "";
}

/** Total destination records an ARMED layer would REPLACE -- the destructive footer's layer half.
 *  A layer that is not carrying contributes nothing however its overwrite flag is set. */
export function armedLayerReplacements(
  sheet: CarryLayerSource | null | undefined,
  choices: LayerChoices,
): number {
  let total = 0;
  for (const key of CARRY_LAYER_KEYS) {
    const choice = choices[key];
    if (!choice?.carry || !choice.overwrite) continue;
    total += layerOutcomeFor(sheet, key)?.kept ?? 0;
  }
  return total;
}

/** The `layers` POST field: only the ticked layers go on the wire. An untouched layer is OMITTED
 *  rather than sent as carry:false -- the server treats both identically, and omitting keeps the
 *  request describing what was asked for rather than everything that was not. */
export function buildLayersPayload(
  choices: LayerChoices,
): Partial<Record<CarryLayerKey, CarryLayerChoice>> {
  const out: Partial<Record<CarryLayerKey, CarryLayerChoice>> = {};
  for (const key of CARRY_LAYER_KEYS) {
    const choice = choices[key];
    if (choice?.carry) out[key] = { carry: true, overwrite: !!choice.overwrite };
  }
  return out;
}

/**
 * Is there NOTHING to carry? Replaces the pre-Amendment-E `selectedCount === 0` gate, which spanned
 * only the rate axis -- untick every rate but tick Categories and that is real work the apply
 * button would have refused.
 *
 * A layer counts only if it would actually move something: ticking Colours on a sheet whose colour
 * columns all vanished is not work, and must not enable an apply that would do nothing.
 */
export function nothingToCarry(
  selectedRateCells: number,
  sheet: CarryLayerSource | null | undefined,
  choices: LayerChoices,
): boolean {
  if (selectedRateCells > 0) return false;
  return CARRY_LAYER_KEYS.every((key) => {
    const choice = choices[key];
    if (!choice?.carry) return true;
    return layerMoveCount(layerOutcomeFor(sheet, key), !!choice.overwrite) === 0;
  });
}

/** Join a list of phrases the way a person would: "a", "a and b", "a, b and c". */
export function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Pluralise a count against its noun ("1 rate" / "12 rates"). */
export function countPhrase(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The payload phrase the apply BUTTON names, on both carry surfaces that name one.
 *
 * ⚠️ The noun is "changes", NOT "items" (owner ruling R13). `item` is already spent on this exact
 * grid -- `node_type === "Line Item"` is a real classification the reader sees in the row beside
 * this dialog -- so "42 items" reads as 42 BoQ rows. The figure is nothing of the sort: it counts
 * WRITES across the rate and layer axes, and one row can contribute several of them.
 *
 * At zero the figure is dropped rather than rendered as "0 changes": the button is DISABLED at zero
 * (R15), and a disabled button naming a quantity of nothing is noise.
 *
 * Module-level for the same reason `LAYER_LABEL` is -- two buttons say this word, and a noun
 * duplicated across two JSX strings is exactly the drift this shared module was extracted to stop.
 */
export function carryChangesPhrase(writeCount: number): string {
  return writeCount > 0 ? countPhrase(writeCount, "change", "changes") : "changes";
}

/**
 * ONE walk over everything the apply would write, producing BOTH the phrases the "Will copy ..."
 * line reads out and the single figure the apply BUTTON reports. Private on purpose: the two public
 * readers below are the interface, and they cannot disagree because there is only one walk.
 *
 * That is the whole point (owner ruling R11). The button used to name `selected.size` while the line
 * named the writes, so the pair could contradict each other by the number of un-armed conflicts --
 * "Copy 12 rates forward" sitting above "Will copy 30 categories", button enabled, apply writing no
 * rates at all. A second count derived separately would eventually drift back into that.
 */
interface CarryWriteBreakdown {
  /** One phrase per axis that would actually write something ("12 rates", "140 categories"). */
  parts: string[];
  /** The sum of the figures those phrases name. */
  total: number;
}

function carryWriteBreakdown(
  rateCellsThatWillWrite: number,
  sheet: CarryLayerSource | null | undefined,
  choices: LayerChoices,
): CarryWriteBreakdown {
  const parts: string[] = [];
  let total = 0;
  if (rateCellsThatWillWrite > 0) {
    parts.push(countPhrase(rateCellsThatWillWrite, "rate", "rates"));
    total += rateCellsThatWillWrite;
  }
  for (const key of CARRY_LAYER_KEYS) {
    const choice = choices[key];
    if (!choice?.carry) continue;
    const n = layerMoveCount(layerOutcomeFor(sheet, key), !!choice.overwrite);
    if (n === 0) continue;
    parts.push(`${n} ${LAYER_LABEL[key].toLowerCase()}`);
    total += n;
  }
  return { parts, total };
}

/**
 * The honest "what will move" line above the footer. Rates first, then each CARRYING layer that
 * would actually write something -- so the sentence never promises a layer that has nothing to do.
 * Returns "" when nothing would be written at all (the caller then hides the line).
 *
 * ⚠️ `rateCellsThatWillWrite` must be `rateWriteCount(...)`, NOT the raw selection size -- a
 * conflict left on Keep is selected but writes nothing. See that function for the live symptom.
 */
export function carrySelectionSummary(
  rateCellsThatWillWrite: number,
  sheet: CarryLayerSource | null | undefined,
  choices: LayerChoices,
): string {
  return joinPhrases(carryWriteBreakdown(rateCellsThatWillWrite, sheet, choices).parts);
}

/**
 * How many records the apply will write ACROSS BOTH AXES -- the figure the apply button names
 * (owner ruling R11). By construction it is the sum of the figures `carrySelectionSummary` names
 * directly above the button, so the two can never contradict each other.
 *
 * ⚠️ Same input rule as the line: pass `rateWriteCount(...)`, never `selected.size`.
 */
export function carryWriteCount(
  rateCellsThatWillWrite: number,
  sheet: CarryLayerSource | null | undefined,
  choices: LayerChoices,
): number {
  return carryWriteBreakdown(rateCellsThatWillWrite, sheet, choices).total;
}

// ── The opt-in non-rate layers block ───────────────────────────────────────────────

/**
 * The block's subtext on the CROSS-BoQ carry -- the original wording, kept VERBATIM and kept as the
 * prop default so the cross-BoQ dialog renders byte-identically without being touched.
 */
export const LAYER_BLOCK_SUBTEXT_CROSS_BOQ =
  "Optional. Anything copied is marked with the BoQ it came from, so it stays tellable apart " +
  "from work done on this revision.";

/**
 * The block's subtext on the WITHIN-BoQ version carry.
 *
 * ⚠️ It cannot say "the BoQ it came from": within one BoQ the source and the destination ARE the
 * same BoQ, so that sentence names the thing the user is already looking at and tells them nothing.
 * The distinguishing fact here is the VERSION -- which is exactly the reasoning behind owner ruling
 * R3, and why this string is parameterised rather than shared.
 *
 * ⚠️ PENDING OWNER CONFIRMATION (WBC-W3-S5).
 */
export const LAYER_BLOCK_SUBTEXT_WITHIN_BOQ =
  "Optional. Anything copied is marked with the version it came from, so it stays tellable apart " +
  "from work done on this version.";

export interface CarryLayersBlockProps {
  sheet: CarryLayerSource;
  choices: LayerChoices;
  /** The sheet is blocked by the mandatory amount-formula gate -- the server refuses the WHOLE
   *  call, layers included, so nothing here may be armed. */
  disabled: boolean;
  /** The one sentence that differs per surface (see the two consts above). Defaults to the
   *  cross-BoQ wording, so that caller needs no change. */
  subtext?: string;
  /** What the carry writes INTO, as two of the layer rows name it (R9). Defaults to the cross-BoQ
   *  wording for the same reason `subtext` does. */
  destination?: string;
  onChange: (key: CarryLayerKey, next: CarryLayerChoice) => void;
}

/**
 * The "Also carry" block: one opt-in row per non-rate layer, each showing what it WOULD do before
 * it is ticked. This is the UI half of Amendment E's answer to Amendment D -- a carried record is
 * only acceptable if it was ASKED FOR (here) and is ATTRIBUTED (the server's provenance stamp).
 *
 * ⚠️ Emerald is banned in this dialog (screen convention: it means priced/succeeded, and belongs
 * to the carry button and the post-apply line, not to a pending choice).
 */
export function CarryLayersBlock({
  sheet,
  choices,
  disabled,
  subtext = LAYER_BLOCK_SUBTEXT_CROSS_BOQ,
  destination = CARRY_DESTINATION_CROSS_BOQ,
  onChange,
}: CarryLayersBlockProps) {
  // A pre-Amendment-E server sends no `layers` block at all. Hide the section rather than render
  // four dead rows -- the rate carry still works, which is the graceful degradation.
  if (!sheet.layers) return null;

  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border/60 bg-muted/30 px-3 py-2">
        <p className="text-sm font-medium text-foreground">Also carry</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtext}</p>
      </div>
      <ul className="divide-y divide-border/60">
        {CARRY_LAYER_KEYS.map((key) => {
          const outcome = layerOutcomeFor(sheet, key);
          const choice = choices[key];
          const hasWork = layerHasWork(outcome);
          const rowDisabled = disabled || !hasWork;
          const counts = layerCountsText(outcome);
          const skipNote = layerSkipNote(key, outcome, destination);
          // Overwrite is only a real choice when something would actually be displaced.
          const showOverwrite = !rowDisabled && choice?.carry && (outcome?.kept ?? 0) > 0;

          return (
            <li key={key} className="flex items-start gap-2.5 px-3 py-2">
              <Checkbox
                checked={!!choice?.carry && hasWork}
                disabled={rowDisabled}
                onCheckedChange={(v) =>
                  onChange(key, { carry: v === true, overwrite: !!choice?.overwrite })
                }
                aria-label={`Carry ${LAYER_LABEL[key].toLowerCase()}`}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      rowDisabled ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {LAYER_LABEL[key]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {hasWork ? counts : "Nothing to carry"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {layerHint(key, destination)}
                </p>
                {skipNote && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{skipNote}</p>
                )}
              </div>

              {showOverwrite && (
                <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onChange(key, { carry: true, overwrite: false })}
                    className={cn(
                      "text-[11px]",
                      !choice?.overwrite ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    Keep
                  </button>
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    onClick={() => onChange(key, { carry: true, overwrite: true })}
                    className={cn(
                      "text-[11px]",
                      choice?.overwrite ? "font-semibold text-destructive" : "text-muted-foreground",
                    )}
                  >
                    Overwrite
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
