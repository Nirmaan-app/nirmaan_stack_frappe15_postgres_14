/**
 * bcsColumns -- the BCS two-column confirmation rules, client side (slice BCS-S2).
 *
 * BCS records what a row costs US against what we charge the CLIENT. To do that it needs two
 * numbers off the committed sheet -- the row's Total Quantity and the Amount charged -- and
 * neither is a fixed column across BoQs. A sheet may express either as ONE scalar column or as
 * SEVERAL per-area columns that add up, so a human confirms which columns to use, once per
 * sheet+version, and the confirmation is stored re-resolvably.
 *
 * THE SERVER IS THE AUTHORITY. Every rule below mirrors
 * `nirmaan_stack/services/boq_bcs/sources.py` (slices S1a-S1c, widened at S2b): the same
 * conditions, in the same PRECEDENCE, so the card can never say "looks fine" about a pick
 * `confirm_bcs_columns` will throw on. The WORDING is deliberately friendlier than a thrown error
 * -- that is the only licensed difference (ADR-0010 F1: a domain rule has one home, pinned to the
 * backend's).
 *
 * DIVERGENCE IS A DEFECT IN BOTH DIRECTIONS, and the second one is the quiet one. The card saying
 * "valid" about something the server rejects produces a thrown error a user can report. The card
 * REFUSING something the server would accept produces nothing at all -- a legitimate sheet is
 * simply unusable, with no message to investigate. That second failure is exactly what BCS-S2c
 * exists to repair.
 *
 * WHAT S2b WIDENED, AND WHY THIS FILE HAD TO FOLLOW (owner ruling 2026-08-02). The amount varies
 * along TWO axes: the SHAPE axis (one scalar column, or N per-area columns that sum) and the KIND
 * axis (the combined total, or the supply / installation HALVES). S1 accepted only the combined
 * kind. Most real sheets turned out to have no single "Amount (Total)" column at all, so this
 * card's Amount list came up EMPTY on most of them and the owner could not use the feature. S2b
 * widened the KIND axis on the server; until S2c the browser still refused every half, which made
 * the fix real in principle and invisible in practice.
 *
 * ADAPT AND DISCLOSE, NEVER REFUSE. A sheet carrying only ONE half is ACCEPTED, and the software
 * STATES the formula it is actually using (`bcsSummaryForMode`). THE SENTENCE IS THE SAFETY: a
 * sheet whose % Profit is measured against supply alone looks identical to one measured against
 * the whole amount, so without the disclosure, acceptance IS the failure mode. Do not reinstate
 * the refusal, and do not let the sentence become decoration.
 *
 * PURE (ADR-0010 F4). No React import, no fetch, no component state -- so the whole rule set is
 * unit-testable in a repo that deliberately has NO DOM test environment. `BcsColumnsDialog` is a
 * thin renderer over these functions; do NOT let a second copy of any rule grow inside it.
 *
 * WHY A NARROWER MENU IS SAFE. `eligibleBcsColumns` offers only columns that could pass the
 * server's class check, so the card cannot even attempt most refusals. It is a NARROWING, never a
 * widening -- the refusals still reachable from the offered set (a total picked beside a half;
 * mixing the two shapes; two columns that hold the same number) are exactly what
 * `validateBcsPicks` catches.
 *
 * THIS FILE CONTAINS NO CONTROL CHARACTERS, DELIBERATELY (BCS-S2a, finding F4). It briefly
 * contained a raw NUL byte as a key separator, which made the whole module read as BINARY:
 * `file` reported "data" and `grep` skipped it without `-a`, so audit and ratchet tooling
 * silently passed over every rule in here. Never introduce a control character; escape it or
 * encode it.
 *
 * CORRECTED AT BCS-S2c: this said "THIS FILE IS PLAIN ASCII", which was simply false -- it
 * carries 70 non-ASCII bytes (box-drawing rules, middots, em-dashes, an ellipsis and a warning
 * sign) and did on the day the claim was written. The distinction matters because the two
 * sentences ask for different things and only one of them is the actual invariant: printable
 * UTF-8 is fine and is used throughout this codebase, while a CONTROL byte is what re-classifies
 * the file as binary and hides it from the tooling. A false blanket rule gets discovered to be
 * false and then discarded WHOLE, taking the true rule under it along.
 */
import type { BcsSource, ColumnDescriptor } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";

/** The two sides of the confirmation. */
export type BcsSide = "qty" | "amount";

/**
 * The stored `mode` of one side -- WHICH shape the sheet uses, and on the amount side WHICH
 * KINDS of amount. A `*_by_area` mode means the picked columns' values are SUMMED.
 *
 * TEN MEMBERS since BCS-S2c (two quantity, eight amount), mirroring `sources._AMOUNT_MODES`
 * exactly. `amount_total` and `amount_by_area` are BYTE-UNCHANGED from S1a, so confirmations
 * stored before the widening read back identically.
 *
 * ⚠️ THE MODE NEVER BRANCHES THE ARITHMETIC. In every one of the ten the computation is
 * "resolve each stored entry and add them up" -- no coefficient, no subtraction, no dropped
 * column. The mode exists for DISCLOSURE (which sentence to say) and for REFUSAL. Two different
 * formulas may therefore never share a mode: BCS-S3 reads the stored mode to know what it is
 * computing, so a reader of the record must be able to tell which formula was in force.
 */
export type BcsMode =
  | "qty_total"
  | "qty_by_area"
  | "amount_total"
  | "amount_supply_plus_install"
  | "amount_supply_only"
  | "amount_install_only"
  | "amount_by_area"
  | "amount_by_area_supply_plus_install"
  | "amount_by_area_supply_only"
  | "amount_by_area_install_only";

/** The outcome of validating one side's picks: a save-able selection, or a refusal to voice. */
export type BcsSideValidation =
  | { ok: true; mode: BcsMode; summary: string }
  | { ok: false; message: string };

// ── The value_field vocabulary, mirroring sources.py's module constants ──────────
const QTY_SCALAR_VALUE_FIELD = "qty_total";
const QTY_AREA_VALUE_FIELD = "qty_by_area";
const AMOUNT_AREA_VALUE_FIELD = "amount_by_area";

/** The AMOUNT axes, mirroring sources.py. Kept apart because the rules read them separately. */
export type BcsAmountKind = "total" | "supply" | "install";
export type BcsAmountShape = "scalar" | "area";

/**
 * WHERE a column's kind is written differs by shape -- the one genuine asymmetry, and the reason
 * this is a lookup rather than a predicate. A SCALAR amount carries its kind in the value_field
 * itself (one hop, no subkey); a PER-AREA amount carries it in the descriptor's THIRD hop,
 * `rate_subkey`, because all three per-area kinds share the one value_field `amount_by_area`.
 */
const SCALAR_AMOUNT_FIELD_TO_KIND: Record<string, BcsAmountKind> = {
  amount_total: "total",
  amount_supply: "supply",
  amount_install: "install",
};
const AREA_AMOUNT_KINDS = new Set<string>(["total", "supply", "install"]);

/** Is this descriptor a quantity column BCS can read? (sources.build_qty_source's class check.) */
export function isBcsQtyColumn(d: ColumnDescriptor): boolean {
  return d.value_field === QTY_SCALAR_VALUE_FIELD || d.value_field === QTY_AREA_VALUE_FIELD;
}

/**
 * Place one descriptor on the two amount axes, or null if it is not an amount column at all.
 * Mirrors `sources._amount_axes`, which REPLACED the old `_is_combined_amount` at BCS-S2b.
 *
 * That replacement is the shape of the whole widening: the old predicate answered one yes/no
 * question -- "is this THE combined amount?" -- which is exactly the question that stopped being
 * the right one when the halves became acceptable. A pick is no longer judged on its own; it is
 * judged against the OTHER picks (a half is fine; a half beside the total that contains it is
 * not), so this READS each column's position and the rules compare positions afterwards.
 */
export function bcsAmountAxes(
  d: ColumnDescriptor,
): { shape: BcsAmountShape; kind: BcsAmountKind } | null {
  const scalarKind = SCALAR_AMOUNT_FIELD_TO_KIND[d.value_field];
  if (scalarKind) return { shape: "scalar", kind: scalarKind };
  if (d.value_field === AMOUNT_AREA_VALUE_FIELD) {
    const subkey = d.rate_subkey;
    if (subkey && AREA_AMOUNT_KINDS.has(subkey)) {
      return { shape: "area", kind: subkey as BcsAmountKind };
    }
  }
  return null;
}

/**
 * Is this descriptor an Amount column BCS can read -- combined OR half, in either shape?
 *
 * WIDENED AT BCS-S2c. It used to return false for both halves and its comment cited
 * `sources._is_combined_amount`, a function BCS-S2b deleted. Widening the KIND axis does NOT
 * widen this class check: a rate column or a quantity column is still not an amount, however the
 * rest of the pick is shaped.
 */
export function isBcsAmountColumn(d: ColumnDescriptor): boolean {
  return bcsAmountAxes(d) !== null;
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

/** "column G" / "columns G and H" / "columns G, H and I" -- so a sentence reads like English. */
function columnPhrase(cols: string[]): string {
  if (cols.length === 0) return "no columns";
  if (cols.length === 1) return `column ${cols[0]}`;
  return `columns ${cols.slice(0, -1).join(", ")} and ${cols[cols.length - 1]}`;
}

/**
 * THE DISCLOSURE. One sentence per mode, stating the formula ACTUALLY IN FORCE.
 *
 * This is the owner's safety mechanism, not decoration. The ruling is "adapt and disclose, never
 * refuse": a one-sided sheet is accepted, and in exchange the software says out loud what it is
 * measuring % Profit against. Without the sentence, acceptance is the failure mode -- a sheet
 * costed against the supply half alone renders identically to one costed against the whole
 * amount, and nobody finds out until the margin is wrong.
 *
 * THE MODE SELECTS THE TEMPLATE; `cols` FILLS IT. The mode carries the formula's SHAPE and
 * nothing else -- no column letters, no area names, no count -- which is why every sentence takes
 * its operands from the picked/stored columns rather than from the mode string.
 *
 * ONE FUNCTION, TWO CALLERS, DELIBERATELY. `validateBcsPicks` uses it to PREDICT what the server
 * will decide about a live pick; `bcsStoredSummary` uses it to REPORT what the server already
 * decided. Sharing the templates is what stops the sentence a user reads before saving from
 * differing from the one they read after.
 *
 * ⚠️ STATE THE FORMULA AND THE EXCLUSION. NEVER THE REASON. (OWNER RULING 2026-08-02, BCS-S2d.)
 * A sentence here may say what the formula USES ("the Supply amount alone (column J)") and what it
 * LEAVES OUT ("Installation is not included"). It may NOT say why -- not "this sheet has no
 * combined Amount column", not "this sheet splits its amounts across areas", not any other claim
 * about the sheet.
 *
 * WHY THAT IS A RULE AND NOT A STYLE PREFERENCE. This function is given a mode and a list of
 * PICKED columns. It is never given the sheet's OTHER columns, so every "why" it could offer is
 * an inference from the pick -- and the inference is wrong on a sheet that maps Amount (Total)
 * AND both halves, where picking the two halves is legitimately accepted. Six of these eight
 * sentences used to open "This sheet has no combined Amount column, so ...", which on exactly
 * that sheet denied the Total existed while the user looked at a pickable Total chip.
 *
 * AND IT FAILED IN THE WORST DIRECTION. This sentence is the entire safety mechanism for the
 * "adapt and disclose, never refuse" ruling -- a one-sided sheet is accepted BECAUSE the software
 * promises to say so. A false justification does not merely add noise: it EXPLAINS AWAY the
 * one-sidedness the sentence exists to flag, and a reader who accepts the excuse stops looking.
 * The excuse was also pinned by a test and transcribed into the plan doc, so it had been ratified
 * twice before anyone read it against a real sheet.
 *
 * A claim about the formula is checkable against the columns named beside it. A claim about the
 * sheet is not, and it goes stale the moment the sheet's mapping changes underneath a stored
 * confirmation. Two tests hold this line: the eight sentences pinned VERBATIM, and a rule test
 * asserting none of them narrates the sheet or justifies itself with ", so".
 */
export function bcsSummaryForMode(mode: string, cols: string[]): string {
  const where = columnPhrase(cols);
  switch (mode) {
    // -- quantity: unchanged wording, because the qty rules are byte-identical to BCS-S1c --
    case "qty_total":
      return `Total Quantity comes from ${where}.`;
    case "qty_by_area":
      return `Total Quantity = column ${cols.join(" + column ")}, added up.`;

    // -- amount: the eight, in the same order as sources._AMOUNT_MODES --
    case "amount_total":
      return `% Profit is measured against the combined Amount in ${where}.`;
    case "amount_supply_plus_install":
      return (
        `% Profit is measured against the Supply amount plus the Installation amount ` +
        `(${where}), added together.`
      );
    case "amount_supply_only":
      return (
        `% Profit is measured against the Supply amount alone (${where}). Installation is ` +
        `not included.`
      );
    case "amount_install_only":
      return (
        `% Profit is measured against the Installation amount alone (${where}). Supply is ` +
        `not included.`
      );
    case "amount_by_area":
      return `% Profit is measured against the combined Amount in ${where}, added together.`;
    case "amount_by_area_supply_plus_install":
      return (
        `% Profit is measured against the Supply and Installation amounts in ${where}, all ` +
        `added together.`
      );
    case "amount_by_area_supply_only":
      return (
        `% Profit is measured against the Supply amounts in ${where}, added together. ` +
        `Installation is not included.`
      );
    case "amount_by_area_install_only":
      return (
        `% Profit is measured against the Installation amounts in ${where}, added together. ` +
        `Supply is not included.`
      );

    // An UNRECOGNISED mode is an explicit unsupported state, never a silent blank and never a
    // guess -- the same forward-compat honesty `ratePipelineInterpreter` gives an unknown step
    // type. If the server grows a ninth mode before this file does, the card says so rather
    // than describing a formula that is not the one in force.
    default:
      return (
        `This sheet's Amount setup uses a mode this screen does not recognise ("${mode}"), so ` +
        `the formula in force cannot be stated here. Ask the team before relying on % Profit.`
      );
  }
}

/**
 * The formula in force for an ALREADY-STORED confirmation, read from its OWN `mode`.
 *
 * ⚠️ NEVER RECOMPUTE THE MODE FROM THE COLUMN LIST. The server decided it and will compute from
 * it; a client that re-derives can disagree with the record after any rule change, and would then
 * disclose a formula that is not the one in force -- the precise failure the disclosure exists to
 * prevent. Read `source.mode`; pass it through. "" when there is nothing stored, so a caller
 * renders nothing rather than a half-truth.
 */
export function bcsStoredSummary(source: BcsSource | null | undefined): string {
  if (!source || !source.mode) return "";
  return bcsSummaryForMode(source.mode, bcsSourceCols(source));
}

/**
 * Per-side wording for the REFUSALS. The CONDITIONS are the server's; only these strings are ours.
 *
 * The amount side gained `mixedKinds` at BCS-S2c and lost its half-blaming class message. The
 * shape message (`mixedShapes`) mirrors the server's BCS-S2c reword: it no longer says "Adding a
 * total to its own parts", which the widening made false for the half-vs-half mixes that can now
 * reach it -- there is no total in those picks, and blaming one sends the user hunting for a
 * column they never chose.
 */
interface SideWords {
  empty: string;
  wrongClass: (cols: string) => string;
  mixedShapes: string;
  tooMany: string;
}

const SIDE_WORDS: Record<BcsSide, SideWords> = {
  qty: {
    empty:
      "Pick the sheet's Total Quantity column, or the per-area quantity columns that add up to it.",
    wrongClass: (cols) => `Column ${cols} doesn't hold a quantity on this sheet.`,
    mixedShapes:
      "Pick either the Total Quantity column or the per-area quantity columns — not both. " +
      "Adding a total to its own parts would count every quantity twice.",
    tooMany: "A sheet has one Total Quantity column. Pick one.",
  },
  amount: {
    empty:
      "Pick the sheet's Amount column, the per-area Amount columns that add up to it, or its " +
      "Supply and Installation amounts.",
    wrongClass: (cols) =>
      `Column ${cols} isn't an Amount column on this sheet. BCS compares what a row costs us ` +
      `against the amount charged to the client, so it needs an Amount column — not a rate, and ` +
      `not a quantity.`,
    mixedShapes:
      "Pick Amount columns of one shape — either the scalar Amount column(s) or the per-area " +
      "Amount columns, not a mix of the two. A scalar column holds the row's whole figure while " +
      "the per-area columns split a figure across areas, so mixing them either counts the same " +
      "amount twice or combines two figures BCS has no rule for adding together.",
    tooMany:
      "Pick each scalar Amount column once — one combined Amount, or one Supply and one " +
      "Installation amount.",
  },
};

/**
 * THE EIGHT ACCEPTED AMOUNT SHAPES, and the `mode` each stores -- the client twin of
 * `sources._AMOUNT_MODES`.
 *
 * A TABLE, not a string built by concatenation, for the same reason the server keeps one: the
 * accepted set has to be ENUMERABLE at a glance, and a combination nobody ruled on must be
 * impossible to express rather than quietly producing a plausible-looking mode string.
 *
 * The key mirrors Python's `frozenset` by SORTING the kinds, so the order the user clicked the
 * columns in cannot change the mode.
 */
const AMOUNT_MODES: Record<string, BcsMode> = {
  "scalar|total": "amount_total",
  "scalar|install,supply": "amount_supply_plus_install",
  "scalar|supply": "amount_supply_only",
  "scalar|install": "amount_install_only",
  "area|total": "amount_by_area",
  "area|install,supply": "amount_by_area_supply_plus_install",
  "area|supply": "amount_by_area_supply_only",
  "area|install": "amount_by_area_install_only",
};

function amountModeKey(shape: BcsAmountShape, kinds: Set<BcsAmountKind>): string {
  return `${shape}|${[...kinds].sort().join(",")}`;
}

/** The KIND refusal -- the ONE piece of the half-refusal that survived the S2b reversal. */
const MIXED_KINDS_MESSAGE =
  "Pick either the sheet's combined Amount column(s) or its Supply and Installation amounts — " +
  "not both. The combined Amount already includes the supply and installation halves, so adding " +
  "one to it would count that half twice.";

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
 *   then the per-side tail, because the two sides diverge from here (BCS-S2c):
 *     QUANTITY  4. a scalar total MIXED with its own per-area parts
 *               5. more than one scalar total
 *     AMOUNT    4. a TOTAL picked together with a half        <- KIND, checked FIRST
 *               5. scalar amounts mixed with per-area ones    <- SHAPE
 *               6. more than one scalar amount of a kind
 *
 * ON THE AMOUNT SIDE, KIND IS CHECKED BEFORE SHAPE, and that is not cosmetic. ["F","I"] (a scalar
 * total beside a per-area supply half) violates BOTH; the server answers "the combined Amount
 * already includes the halves", so this must too. The same rules in a different order give a
 * different complaint for the same input, which a user does not experience as a wording nit -- it
 * reads as the screen and the server disagreeing about their sheet.
 *
 * The last rule of each tail is UNREACHABLE, on the client exactly as on the server: two scalar
 * columns of one kind necessarily share a resolved identity, so rule 2c fires first and SHADOWS
 * it. RETAINED, not deleted -- it is the correctly voiced refusal should that key ever narrow,
 * and the shadowing itself is pinned by a test so the two layers cannot drift apart.
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
  //
  // THE KEY IS JSON, AND THAT CLOSES TWO FINDINGS AT ONCE (BCS-S2a).
  //
  //   F2 -- it keeps null DISTINCT from "". The server keys the RAW tuple
  //   `(value_field, value_key, rate_subkey)` (sources.py `_resolve_picks`), where
  //   `None != ""`. This used to interpolate `?? ""`, collapsing the two, so the client would
  //   have REFUSED a pair the server accepts. That is the dangerous direction: the card
  //   contradicting the authority it exists to mirror, with no error anywhere to show for it.
  //   JSON renders them `null` and `""`, exactly as the server tells them apart.
  //
  //   F4 -- it is plain ASCII. The separator was a raw NUL byte; see the module docblock for
  //   what that cost.
  //
  // JSON also removes the ambiguity every delimiter carries: ["a","b"] and ["ab"] cannot
  // collide, whatever the values contain.
  const byValue = new Map<string, string[]>();
  for (const d of picked) {
    const key = JSON.stringify([d.value_field, d.value_key ?? null, d.rate_subkey ?? null]);
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

  // 3. the wrong class for this side. Widening the KIND axis did NOT widen this: a rate or a
  // quantity column is still not an amount, however the rest of the pick is shaped.
  const test = side === "qty" ? isBcsQtyColumn : isBcsAmountColumn;
  const bad = picked.filter((d) => !test(d));
  if (bad.length > 0) {
    return { ok: false, message: words.wrongClass(bad.map((d) => d.col).join(", ")) };
  }

  // From here the two sides diverge -- see the docblock's per-side tails.
  return side === "qty" ? qtyTail(picked, words) : amountTail(picked, words);
}

/** Mirrors the tail of `sources.build_qty_source`. BYTE-UNCHANGED by BCS-S2c. */
function qtyTail(picked: ColumnDescriptor[], words: SideWords): BcsSideValidation {
  // 4. a scalar total mixed with its own per-area parts.
  const fields = new Set(picked.map((d) => d.value_field));
  if (fields.size > 1) return { ok: false, message: words.mixedShapes };

  // 5. more than one scalar total (shadowed by 2c -- see the docblock).
  if (fields.has(QTY_SCALAR_VALUE_FIELD)) {
    if (picked.length !== 1) return { ok: false, message: words.tooMany };
    return { ok: true, mode: "qty_total", summary: bcsSummaryForMode("qty_total", [picked[0].col]) };
  }
  const cols = picked.map((d) => d.col);
  return { ok: true, mode: "qty_by_area", summary: bcsSummaryForMode("qty_by_area", cols) };
}

/**
 * Mirrors the tail of `sources.build_amount_source`, WIDENED at BCS-S2b along the KIND axis.
 *
 * Every pick here has already passed the class check, so each one has axes. The rules compare
 * those axes ACROSS the picked set -- a half is judged by what it sits beside, never on its own.
 */
function amountTail(picked: ColumnDescriptor[], words: SideWords): BcsSideValidation {
  const axes = picked.map((d) => bcsAmountAxes(d)!);
  const shapes = new Set(axes.map((a) => a.shape));
  const kinds = new Set(axes.map((a) => a.kind));
  const cols = picked.map((d) => d.col);

  // 4. the KIND axis: a TOTAL already CONTAINS its halves. THE ONE PIECE OF THE HALF-REFUSAL
  // THAT SURVIVED THE REVERSAL -- a lone half is perfectly acceptable now; a half sitting beside
  // the total that already includes it is a double-count, exactly like a total beside its own
  // per-area parts. Checked BEFORE the shape rule, mirroring the server.
  if (kinds.has("total") && kinds.size > 1) {
    return { ok: false, message: MIXED_KINDS_MESSAGE };
  }

  // 5. the SHAPE axis. Deliberately NOT widened: no owner ruling covers a sheet that genuinely
  // splits one kind scalar and the other per area, so that stays refused rather than guessed at.
  // A RULING, not a bug, if such a sheet turns up.
  if (shapes.size > 1) return { ok: false, message: words.mixedShapes };

  const shape = axes[0].shape;

  // 6. RETAINED and UNREACHABLE by construction, the same disposition rule 5 has on the quantity
  // side. On the scalar shape a column's kind IS its value_field, so two picks of one kind
  // necessarily share a resolved identity and rule 2c has already refused them. Note what this is
  // NOT: the pre-S2b "a sheet has exactly one Amount column" rule, which the widening made simply
  // FALSE -- a scalar sheet legitimately contributes TWO columns now, its supply and its install.
  if (shape === "scalar" && picked.length !== kinds.size) {
    return { ok: false, message: words.tooMany };
  }

  // Looked up, NOT built by concatenation: every (shape, kinds) pair the guards above permit is
  // in the table, so a miss can only mean a new amount KIND arrived without anyone deciding what
  // formula it stores. That must fail visibly rather than mint a plausible-looking mode string.
  const mode = AMOUNT_MODES[amountModeKey(shape, kinds)];
  if (!mode) {
    return {
      ok: false,
      message:
        `This combination of Amount columns (${columnPhrase(cols)}) is not one BCS has a rule ` +
        `for. Pick the combined Amount, or the Supply and Installation amounts, in one shape.`,
    };
  }
  return { ok: true, mode, summary: bcsSummaryForMode(mode, cols) };
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
 * TWO FETCHES FEED THIS, AND THEY ARE NAMED APART ON PURPOSE (BCS-S2a, finding F1). The fields
 * used to be a bare `loading` / `error`, and the page passed the PRICED rows fetch's flags into
 * them while `get_bcs_state`'s own flags went unread. Nothing typed-checked wrong, so the bug was
 * invisible: a failed BCS read left no reason at all, the button stayed live, and -- because a
 * missing payload rendered exactly like `bcs_enabled = 0` -- an enabled, fully confirmed sheet
 * displayed as OFF with its chip gone and its amber banner suppressed. `sheetLoading` /
 * `sheetError` are the SHEET's; `bcsLoading` / `bcsError` are the BCS state's. Keep them apart.
 *
 * WHY THE BCS PAIR SITS LAST. An uncommitted sheet, an earlier version and a locked sheet are all
 * stable, self-explanatory reasons, and the BCS payload is meaningless in every one of them --
 * so they are the better sentence to show. Ordering them first also stops a routine SWR
 * revalidation from flickering the title while someone browses history.
 *
 * The set is deliberate. `sheetLocked` is the DELIBERATE per-sheet lock, which the server itself
 * refuses BCS setup on (`_guard_sheet_not_locked` runs in both set_bcs_enabled and
 * confirm_bcs_columns). `viewingHistory` is not a server rule but a targeting one: BCS is
 * configured per sheet+version and the live version is the only one worth setting up.
 *
 * NOT in this set, on purpose: the single-editor CONCURRENCY lock. The BCS SETUP endpoints --
 * `set_bcs_enabled`, `confirm_bcs_columns` and the `get_bcs_state` read -- neither acquire nor
 * check it, and the neighbouring Freeze Classification control is independent of it for the same
 * reason: choosing which columns BCS reads is a separate axis from client-facing pricing.
 *
 * ⚠️ THAT IS TRUE OF SETUP ONLY (corrected at BCS-S2a, finding F3 -- the earlier note said "the
 * BCS endpoints", full stop, which is wrong and points the wrong way for whoever wires up cost
 * entry). The cost-entry write `save_row_bcs_rates` DOES take the single-editor lock: it calls
 * `pricing_lock.acquire_or_refresh` after its guards and before the write, exactly as
 * `save_cell_price` does. So an S3 cost cell is subject to the concurrency lock even though this
 * setup button is not, and its own gating must account for that.
 */
export function bcsSetupReason(state: {
  /** The PRICED rows fetch (get_priced_rows) -- the sheet itself. */
  sheetLoading: boolean;
  sheetError: boolean;
  committedVersion: number | null;
  viewingHistory: boolean;
  sheetLocked: boolean;
  /** The BCS state fetch (get_bcs_state) -- its OWN flags, never the sheet's. */
  bcsLoading: boolean;
  bcsError: boolean;
}): string | null {
  if (state.sheetLoading) return "Loading…";
  if (state.sheetError) return "This sheet could not be loaded.";
  if (state.committedVersion === null) return "This sheet is not committed yet.";
  if (state.viewingHistory) return "You are viewing an earlier version. BCS is set up on the current version.";
  if (state.sheetLocked) return "This sheet is locked (read-only). Unlock it to set up BCS.";
  if (state.bcsLoading) return "Checking the BCS setup…";
  if (state.bcsError) return "The BCS setup could not be read. Reload the page to try again.";
  return null;
}

/** What the BCS control may honestly claim about the cost section being on. */
export type BcsToggleState = "unknown" | "off" | "on";

/**
 * On, off, or honestly unknown -- the other half of finding F1 (BCS-S2a).
 *
 * S2 rendered the button as `bcs_enabled === 1 ? solid : outline`, which made "we have no
 * payload" and "BCS is off" THE SAME PIXEL. A failed read therefore showed an enabled, confirmed
 * sheet as off and invited a click. Absence of knowledge is not knowledge of absence, and this
 * three-state is what keeps the two apart at every surface that renders BCS.
 *
 * A STALE PAYLOAD BEHIND A FAILED READ IS ALSO UNKNOWN. SWR keeps the last good `data` when a
 * revalidation fails, so a payload can outlive its own truth; if the most recent read did not
 * succeed we do not claim currency, in either direction.
 *
 * Use this rather than re-deriving `bcs_enabled === 1` at a render site -- that re-derivation IS
 * the finding. Slice S3 hangs its cost cells off the same state and must make the same
 * distinction: an unknown state must not present as an empty, editable cost cell.
 */
export function bcsToggleState(args: {
  /** The BCS state fetch errored (SWR `error` is set). */
  fetchFailed: boolean;
  /** `bcs_enabled` off the payload; null / undefined when no payload has arrived. */
  enabled: 0 | 1 | null | undefined;
}): BcsToggleState {
  if (args.fetchFailed) return "unknown";
  if (args.enabled === null || args.enabled === undefined) return "unknown";
  return args.enabled === 1 ? "on" : "off";
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
