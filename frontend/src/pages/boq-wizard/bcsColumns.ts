/**
 * bcsColumns -- the BCS two-column confirmation rules, client side (slice BCS-S2).
 *
 * BCS records what a row costs US against what we charge the CLIENT. To do that it needs two
 * numbers off the committed sheet -- the row's Total Quantity and its Amount (Combined) -- and
 * neither is a fixed column across BoQs. A sheet may express either as ONE scalar column or as
 * SEVERAL per-area columns that add up, so a human confirms which columns to use, once per
 * sheet+version, and the confirmation is stored re-resolvably.
 *
 * THE SERVER IS THE AUTHORITY. Every rule below mirrors
 * `nirmaan_stack/services/boq_bcs/sources.py` (slices S1a-S1c): the same conditions, in the same
 * PRECEDENCE, so the card can never say "looks fine" about a pick `confirm_bcs_columns` will
 * throw on. The WORDING is deliberately friendlier than a thrown error -- that is the only
 * licensed difference (ADR-0010 F1: a domain rule has one home, pinned to the backend's).
 *
 * PURE (ADR-0010 F4). No React import, no fetch, no component state -- so the whole rule set is
 * unit-testable in a repo that deliberately has NO DOM test environment. `BcsColumnsDialog` is a
 * thin renderer over these functions; do NOT let a second copy of any rule grow inside it.
 *
 * WHY A NARROWER MENU IS SAFE. `eligibleBcsColumns` offers only columns that could pass the
 * server's class check, so the card cannot even attempt most refusals. It is a NARROWING, never a
 * widening -- the refusals still reachable from the offered set (mixing a total with its own
 * parts; two columns that hold the same number) are exactly what `validateBcsPicks` catches.
 */
import type { BcsSource, ColumnDescriptor } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";

/** The two sides of the confirmation. */
export type BcsSide = "qty" | "amount";

/**
 * The stored `mode` of one side -- WHICH of the two shapes the sheet uses. A `*_by_area` mode
 * means the picked columns' values are SUMMED to make the row's number.
 */
export type BcsMode = "qty_total" | "qty_by_area" | "amount_total" | "amount_by_area";

/** The outcome of validating one side's picks: a save-able selection, or a refusal to voice. */
export type BcsSideValidation =
  | { ok: true; mode: BcsMode; summary: string }
  | { ok: false; message: string };

// ── The value_field vocabulary, mirroring sources.py's module constants ──────────
const QTY_SCALAR_VALUE_FIELD = "qty_total";
const QTY_AREA_VALUE_FIELD = "qty_by_area";
const AMOUNT_SCALAR_VALUE_FIELD = "amount_total";
const AMOUNT_AREA_VALUE_FIELD = "amount_by_area";
/**
 * A per-area amount column carries its KIND in the descriptor's third hop (`rate_subkey`):
 * "total" is the per-area COMBINED amount, while "supply" and "install" are the split halves.
 * Only the combined kind is what we charge the client -- accepting a half here would silently
 * compare our cost against a fraction of the charged amount.
 */
const AMOUNT_AREA_COMBINED_SUBKEY = "total";

/** Is this descriptor a quantity column BCS can read? (sources.build_qty_source's class check.) */
export function isBcsQtyColumn(d: ColumnDescriptor): boolean {
  return d.value_field === QTY_SCALAR_VALUE_FIELD || d.value_field === QTY_AREA_VALUE_FIELD;
}

/**
 * Is this descriptor a COMBINED amount column -- the thing we charge the client?
 * Mirrors `sources._is_combined_amount`: the scalar `amount_total`, or a per-area
 * `amount_by_area` whose kind is "total". The supply / install halves are NOT amounts here.
 */
export function isBcsAmountColumn(d: ColumnDescriptor): boolean {
  if (d.value_field === AMOUNT_SCALAR_VALUE_FIELD) return true;
  if (d.value_field === AMOUNT_AREA_VALUE_FIELD) {
    return d.rate_subkey === AMOUNT_AREA_COMBINED_SUBKEY;
  }
  return false;
}

/** The columns the card may offer for one side, in the descriptors' own (Excel) order. */
export function eligibleBcsColumns(
  side: BcsSide,
  descriptors: ColumnDescriptor[],
): ColumnDescriptor[] {
  const test = side === "qty" ? isBcsQtyColumn : isBcsAmountColumn;
  return descriptors.filter(test);
}

/**
 * How one column reads on a chip -- `Role` or `Role · Area`, the SAME convention
 * AmountFormulaBuilder's operand palette uses (labelFor), so a column is named identically
 * wherever the pricing editor names it. Falls back to the raw role for an unmapped label.
 */
export function bcsColumnLabel(d: ColumnDescriptor): string {
  const role = ROLE_LABELS[d.role] ?? d.role;
  return d.area ? `${role} · ${d.area}` : role;
}

/** {col letter -> descriptor} for one committed sheet -- the client twin of `_descriptor_index`. */
export function buildBcsDescriptorIndex(
  descriptors: ColumnDescriptor[],
): Map<string, ColumnDescriptor> {
  const m = new Map<string, ColumnDescriptor>();
  for (const d of descriptors) if (!m.has(d.col)) m.set(d.col, d);
  return m;
}

/** Per-side wording. The CONDITIONS are the server's; only these strings are ours. */
const SIDE_WORDS: Record<
  BcsSide,
  {
    empty: string;
    wrongClass: (cols: string) => string;
    mixed: string;
    tooMany: string;
    scalarMode: BcsMode;
    areaMode: BcsMode;
    scalarSummary: (col: string) => string;
    areaSummary: (cols: string[]) => string;
  }
> = {
  qty: {
    empty:
      "Pick the sheet's Total Quantity column, or the per-area quantity columns that add up to it.",
    wrongClass: (cols) => `Column ${cols} doesn't hold a quantity on this sheet.`,
    mixed:
      "Pick either the Total Quantity column or the per-area quantity columns — not both. " +
      "Adding a total to its own parts would count every quantity twice.",
    tooMany: "A sheet has one Total Quantity column. Pick one.",
    scalarMode: "qty_total",
    areaMode: "qty_by_area",
    scalarSummary: (col) => `Total Quantity comes from column ${col}.`,
    areaSummary: (cols) => `Total Quantity = column ${cols.join(" + column ")}, added up.`,
  },
  amount: {
    empty:
      "Pick the sheet's Amount (Combined) column, or the per-area Amount columns that add up to it.",
    wrongClass: (cols) =>
      `Column ${cols} isn't a combined Amount column. BCS compares what a row costs us against ` +
      `the amount charged to the client, so it needs the combined Amount — not a rate, and not ` +
      `the supply or install half of an amount.`,
    mixed:
      "Pick either the combined Amount column or the per-area Amount columns — not both. " +
      "Adding a total to its own parts would count every amount twice.",
    tooMany: "A sheet has one combined Amount column. Pick one.",
    scalarMode: "amount_total",
    areaMode: "amount_by_area",
    scalarSummary: (col) => `Amount comes from column ${col}.`,
    areaSummary: (cols) => `Amount = column ${cols.join(" + column ")}, added up.`,
  },
};

/**
 * Validate one side's picks against the sheet's REAL descriptors, or say why not.
 *
 * THE ORDER IS THE SPEC. It reproduces `sources.build_qty_source` / `build_amount_source`
 * exactly, because the order decides WHICH refusal a bad pick gets:
 *
 *   1. an empty selection
 *   2. `_resolve_picks`:
 *        a. a column the sheet does not have  (resolved FIRST, so an unknown column is
 *           reported as unknown -- the more fundamental fact -- not as a duplicate)
 *        b. the same column picked twice
 *        c. two DIFFERENT columns that resolve to the same value (BCS-S1c: the role map
 *           imposes no uniqueness on (role, area), so one number really can sit on two letters)
 *   3. a mapped column of the wrong class for this side
 *   4. a scalar total MIXED with its own per-area parts
 *   5. more than one scalar total
 *
 * Rule 5 is UNREACHABLE, on the client exactly as on the server: two scalar totals of one role
 * necessarily share a resolved identity, so rule 2c fires first and SHADOWS it. It is RETAINED,
 * not deleted -- it is the correctly voiced refusal should that key ever narrow, and the
 * shadowing itself is pinned by a test so the two layers cannot drift apart.
 */
export function validateBcsPicks(
  side: BcsSide,
  cols: string[],
  index: Map<string, ColumnDescriptor>,
): BcsSideValidation {
  const words = SIDE_WORDS[side];

  // 1. an empty selection.
  if (cols.length === 0) return { ok: false, message: words.empty };

  // 2a. resolve every pick against the sheet's real columns, unknown-first.
  const picked: ColumnDescriptor[] = [];
  for (const col of cols) {
    const d = index.get(col);
    if (!d) {
      const known = [...index.keys()].sort().join(", ");
      return {
        ok: false,
        message:
          `Column ${col} isn't a mapped column on this sheet.` +
          (known ? ` Mapped columns: ${known}.` : ""),
      };
    }
    picked.push(d);
  }

  // 2b. the same LETTER twice -- the degenerate case of 2c, voiced in its own words.
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const col of cols) {
    if (seen.has(col)) {
      if (!dupes.includes(col)) dupes.push(col);
    } else seen.add(col);
  }
  if (dupes.length > 0) {
    return {
      ok: false,
      message: `Column ${dupes.join(", ")} is picked twice. Pick each column once — repeating one would count its value twice.`,
    };
  }

  // 2c. two DIFFERENT letters carrying ONE number. Keyed on the RESOLVED identity
  // (value_field, value_key, rate_subkey), which SUBSUMES the letter case.
  const byValue = new Map<string, string[]>();
  for (const d of picked) {
    const key = `${d.value_field} ${d.value_key ?? ""} ${d.rate_subkey ?? ""}`;
    const group = byValue.get(key);
    if (group) group.push(d.col);
    else byValue.set(key, [d.col]);
  }
  const aliased = [...byValue.values()].filter((g) => g.length > 1);
  if (aliased.length > 0) {
    return {
      ok: false,
      message:
        `Column ${aliased.map((g) => g.join(", ")).join("; ")} hold the same number on this ` +
        `sheet, so picking them together would count it twice. Pick one column per value.`,
    };
  }

  // 3. the wrong class for this side.
  const test = side === "qty" ? isBcsQtyColumn : isBcsAmountColumn;
  const bad = picked.filter((d) => !test(d));
  if (bad.length > 0) {
    return { ok: false, message: words.wrongClass(bad.map((d) => d.col).join(", ")) };
  }

  // 4. a scalar total mixed with its own per-area parts.
  const fields = new Set(picked.map((d) => d.value_field));
  if (fields.size > 1) return { ok: false, message: words.mixed };

  // 5. more than one scalar total (shadowed by 2c -- see the docblock).
  const isScalar = fields.has(side === "qty" ? QTY_SCALAR_VALUE_FIELD : AMOUNT_SCALAR_VALUE_FIELD);
  if (isScalar) {
    if (picked.length !== 1) return { ok: false, message: words.tooMany };
    return {
      ok: true,
      mode: words.scalarMode,
      summary: words.scalarSummary(picked[0].col),
    };
  }
  return {
    ok: true,
    mode: words.areaMode,
    summary: words.areaSummary(picked.map((d) => d.col)),
  };
}

/** The Save gate: BOTH sides must be valid, because the server stores them together or not at all. */
export function bcsSelectionSaveable(
  qty: BcsSideValidation,
  amount: BcsSideValidation,
): boolean {
  return qty.ok && amount.ok;
}

/**
 * Why the BCS button is greyed, or null when it is live. Returns the FIRST failing reason so the
 * title names one honest cause, mirroring the `suggestRatesReason` chain in SheetPricingPage.
 *
 * The set is deliberate. `sheetLocked` is the DELIBERATE per-sheet lock, which the server itself
 * refuses BCS setup on (`_guard_sheet_not_locked` runs in both set_bcs_enabled and
 * confirm_bcs_columns). `viewingHistory` is not a server rule but a targeting one: BCS is
 * configured per sheet+version and the live version is the only one worth setting up.
 *
 * NOT in this set, on purpose: the single-editor CONCURRENCY lock. The BCS endpoints do not
 * acquire or check it, and the neighbouring Freeze Classification control is independent of it
 * for the same reason -- BCS setup is a separate axis from client-facing pricing.
 */
export function bcsSetupReason(state: {
  loading: boolean;
  error: boolean;
  committedVersion: number | null;
  viewingHistory: boolean;
  sheetLocked: boolean;
}): string | null {
  if (state.loading) return "Loading…";
  if (state.error) return "This sheet could not be loaded.";
  if (state.committedVersion === null) return "This sheet is not committed yet.";
  if (state.viewingHistory) return "You are viewing an earlier version. BCS is set up on the current version.";
  if (state.sheetLocked) return "This sheet is locked (read-only). Unlock it to set up BCS.";
  return null;
}

/** The picked column letters of a stored confirmation -- what re-opens the card pre-filled. */
export function bcsSourceCols(source: BcsSource | null | undefined): string[] {
  return (source?.columns ?? []).map((c) => c.col);
}

/**
 * The chip beside the button once BCS is confirmed, mirroring the existing
 * "Frozen · date · by" chip's shape. "" until BOTH sides are confirmed, so the caller renders
 * nothing rather than a half-truth.
 */
export function bcsChipLabel(
  qty: BcsSource | null | undefined,
  amount: BcsSource | null | undefined,
): string {
  const qtyCols = bcsSourceCols(qty);
  const amountCols = bcsSourceCols(amount);
  if (qtyCols.length === 0 || amountCols.length === 0) return "";
  return `Qty ${qtyCols.join("+")} · Amount ${amountCols.join("+")}`;
}
