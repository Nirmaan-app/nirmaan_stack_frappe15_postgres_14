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
import type {
  BcsColumnEntry,
  BcsRateField,
  BcsRowRates,
  BcsSource,
  ColumnDescriptor,
} from "./boqTypes";
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

/**
 * ★ THE REFUSAL VOCABULARY (BCS-S2e) -- the ONE thing this module and `services/boq_bcs/
 * sources.py` can actually compare, and the reason a parity test finally exists.
 *
 * WHY A CODE WAS NEEDED AT ALL. The two sides refuse in deliberately different voices: the
 * server throws a (title, message) pair, this card renders a friendlier sentence. Only the
 * success `mode` was ever comparable, so a parity test built on what existed would have covered
 * the ten modes and NONE of the refusal chain whose ORDER is load-bearing -- the partial test
 * that makes a gap look closed, which is worse than no test at all. ADR-0010 F1 asks for a
 * mirror to be pinned; this is what made it possible.
 *
 * ⚠️ THE CODE IS THE CONTRACT; THE WORDING IS NOT. Reword any message below freely -- that is
 * the licensed difference between the two sides. Change a code, or the ORDER, and you are
 * changing what the server must mirror: update `nirmaan_stack/services/boq_bcs/
 * parity_cases.json` in the same edit, or both suites will tell you.
 *
 * `unruled_combination` is DELIBERATELY OUTSIDE the parity vocabulary. It is this module's
 * amount-mode table miss; the server's equivalent is a bare `KeyError` on `_AMOUNT_MODES`
 * ("fail loudly rather than mint a plausible mode for a shape nobody ruled on"). Both are
 * unreachable by construction and the two answer differently ON PURPOSE, so the code is
 * recorded in the table under `client_only_codes` and pinned OUT of `order` by a test on each
 * side -- never quietly added to "restore consistency".
 */
export type BcsRefusalCode =
  | "no_pick"
  | "unknown_column"
  | "duplicate_column"
  | "aliased_columns"
  | "wrong_class"
  | "mixed_kinds"
  | "mixed_shapes"
  | "too_many_scalars";

/** The parity vocabulary. `unruled_combination` is not a member -- see above. */
export const BCS_REFUSAL_CODES: readonly BcsRefusalCode[] = [
  "no_pick",
  "unknown_column",
  "duplicate_column",
  "aliased_columns",
  "wrong_class",
  "mixed_kinds",
  "mixed_shapes",
  "too_many_scalars",
];

/**
 * THE ORDER IS THE SPEC, declared here so both suites can assert against it. It decides WHICH
 * refusal a bad pick gets, and a user does not experience a different complaint for the same
 * pick as a wording nit -- it reads as the screen and the server disagreeing about their sheet.
 *
 * `too_many_scalars` is RETAINED-but-shadowed on both sides (a scalar column's kind IS its
 * value_field, so two picks of one kind necessarily alias and rule 2c answers first). The
 * table records that under `unreachable` and pins the shadowing inputs as cases, rather than
 * letting a dead rule look exercised.
 */
export const BCS_REFUSAL_ORDER: Record<BcsSide, readonly BcsRefusalCode[]> = {
  qty: [
    "no_pick",
    "unknown_column",
    "duplicate_column",
    "aliased_columns",
    "wrong_class",
    "mixed_shapes",
    "too_many_scalars",
  ],
  amount: [
    "no_pick",
    "unknown_column",
    "duplicate_column",
    "aliased_columns",
    "wrong_class",
    "mixed_kinds",
    "mixed_shapes",
    "too_many_scalars",
  ],
};

/**
 * The outcome of validating one side's picks: a save-able selection, or a refusal to voice.
 *
 * The refusal carries BOTH a `code` (what the server must agree about) and a `message` (what
 * the user reads, in this screen's own friendlier voice). `BcsColumnsDialog` renders the
 * message and never reads the code -- adding it was purely additive.
 */
export type BcsSideValidation =
  | { ok: true; mode: BcsMode; summary: string }
  | { ok: false; code: BcsRefusalCode | "unruled_combination"; message: string };

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
  if (cols.length === 0) return { ok: false, code: "no_pick", message: words.empty };

  // 2a. resolve every pick against the sheet's real columns, unknown-first.
  const picked: ColumnDescriptor[] = [];
  for (const col of cols) {
    const d = index.get(col);
    if (!d) {
      const known = [...index.keys()].sort().join(", ");
      return {
        ok: false,
        code: "unknown_column",
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
      code: "duplicate_column",
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
      code: "aliased_columns",
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
    return {
      ok: false,
      code: "wrong_class",
      message: words.wrongClass(bad.map((d) => d.col).join(", ")),
    };
  }

  // From here the two sides diverge -- see the docblock's per-side tails.
  return side === "qty" ? qtyTail(picked, words) : amountTail(picked, words);
}

/** Mirrors the tail of `sources.build_qty_source`. BYTE-UNCHANGED by BCS-S2c. */
function qtyTail(picked: ColumnDescriptor[], words: SideWords): BcsSideValidation {
  // 4. a scalar total mixed with its own per-area parts.
  const fields = new Set(picked.map((d) => d.value_field));
  if (fields.size > 1) return { ok: false, code: "mixed_shapes", message: words.mixedShapes };

  // 5. more than one scalar total (shadowed by 2c -- see the docblock).
  if (fields.has(QTY_SCALAR_VALUE_FIELD)) {
    if (picked.length !== 1) {
      return { ok: false, code: "too_many_scalars", message: words.tooMany };
    }
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
    return { ok: false, code: "mixed_kinds", message: MIXED_KINDS_MESSAGE };
  }

  // 5. the SHAPE axis. Deliberately NOT widened: no owner ruling covers a sheet that genuinely
  // splits one kind scalar and the other per area, so that stays refused rather than guessed at.
  // A RULING, not a bug, if such a sheet turns up.
  if (shapes.size > 1) return { ok: false, code: "mixed_shapes", message: words.mixedShapes };

  const shape = axes[0].shape;

  // 6. RETAINED and UNREACHABLE by construction, the same disposition rule 5 has on the quantity
  // side. On the scalar shape a column's kind IS its value_field, so two picks of one kind
  // necessarily share a resolved identity and rule 2c has already refused them. Note what this is
  // NOT: the pre-S2b "a sheet has exactly one Amount column" rule, which the widening made simply
  // FALSE -- a scalar sheet legitimately contributes TWO columns now, its supply and its install.
  if (shape === "scalar" && picked.length !== kinds.size) {
    return { ok: false, code: "too_many_scalars", message: words.tooMany };
  }

  // Looked up, NOT built by concatenation: every (shape, kinds) pair the guards above permit is
  // in the table, so a miss can only mean a new amount KIND arrived without anyone deciding what
  // formula it stores. That must fail visibly rather than mint a plausible-looking mode string.
  //
  // ⚠️ `unruled_combination` IS THE ONE CODE OUTSIDE THE PARITY VOCABULARY, and the asymmetry
  // is deliberate: the server's equivalent miss raises a bare KeyError on `_AMOUNT_MODES`
  // rather than voicing anything. Both are unreachable by construction. Recorded in
  // `parity_cases.json` under `client_only_codes`; a test on each side keeps it out of `order`.
  const mode = AMOUNT_MODES[amountModeKey(shape, kinds)];
  if (!mode) {
    return {
      ok: false,
      code: "unruled_combination",
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

// ═══════════════════════════════════════════════════════════════════════════════
//  BCS-S3a -- COST ENTRY. Everything below is the usable half: which boxes exist,
//  what a save carries, what Total Amount reads, and when a box may be typed in.
// ═══════════════════════════════════════════════════════════════════════════════

/** The three cost inputs BCS can store, as KINDS. `combined` is the undifferentiated one. */
export type BcsRateKind = "supply" | "install" | "combined";
// The stored field each kind writes is the WIRE shape (`boqTypes.BcsRateField`) -- re-exported
// here so a reader of the rules never has to know which file the spelling lives in.
export type { BcsRateField, BcsRowRates };

export const BCS_RATE_FIELD: Record<BcsRateKind, BcsRateField> = {
  supply: "supply_rate",
  install: "install_rate",
  combined: "combined_rate",
};
/**
 * Every stored field, in the order `save_row_bcs_rates` declares them.
 *
 * ⚠️ CORRECTED AT BCS-S3b. This said "THE gather iterates this -- so a fourth field could never
 * be silently omitted from a write". It is the SAME false claim BCS-S3a-fix corrected on
 * `gatherBcsRowRates` itself; only the twin was fixed, and this copy survived to be read by the
 * next person. `gatherBcsRowRates` does NOT iterate -- it names the three fields, which is the
 * right shape, and the direction this sentence claimed is guarded by a TEST
 * (`gatherBcsRowRates covers every BCS_RATE_FIELDS key`), not by the code. What DOES iterate
 * this list is `mergeBcsRowValues` and `PricingGrid.bcsDraftsForRow`.
 *
 * The lesson is the correction's, not the claim's: a sentence copied to two places has to be
 * corrected in two places, and finding one of them is not finding both.
 */
export const BCS_RATE_FIELDS: readonly BcsRateField[] = [
  "supply_rate",
  "install_rate",
  "combined_rate",
];
/**
 * Column headers. Named for the RATE column each box costs against, so a pricer reading across
 * the row sees "Rate (Supply)" beside "BCS Cost (Supply)" and the pairing needs no explanation.
 *
 * ⚠️ THE `BCS ` PREFIX AND THE WORD "Installation" ARE AN OWNER RULING (2026-08-03), pinned by
 * test. The prefix is what tells a pricer at a glance which side of the sheet a figure belongs
 * to: everything named BCS is what the work costs US, everything else is what we charge the
 * CLIENT. On a wide sheet the two blocks scroll apart, and an unprefixed "Cost (Supply)" beside
 * "Amount (Supply)" gives no clue which is which.
 *
 * ⚠️ THE MIRROR IS NO LONGER WORD-FOR-WORD, and that is deliberate rather than an oversight to
 * be tidied: the sheet's own role label is "Rate (Install)" (boqTypes `ROLE_LABEL`) while this
 * box is "BCS Cost (Installation)". The owner chose the longer word for the header a pricer
 * reads; the role vocabulary is the parser's and is not his to re-word. Do NOT "restore
 * consistency" by shortening this one -- it would silently overturn a ruling.
 *
 * ⚠️ `combined` IS UNPREFIXED, AND IT IS AN OPEN QUESTION, NOT A DECISION. The owner named the
 * two split boxes and the Total; a combined-rate sheet gets ONE box (`bcsLiveRateKinds` returns
 * `["combined"]`) and it still reads "Cost". Prefixing it was NOT ruled on, so it was left alone
 * and reported at BCS-S7 rather than guessed at. If a ruling arrives, change it here and add it
 * to the pin beside the other two.
 */
export const BCS_RATE_LABEL: Record<BcsRateKind, string> = {
  supply: "BCS Cost (Supply)",
  install: "BCS Cost (Installation)",
  combined: "Cost",
};

// The RATE vocabulary this reads, mirroring PricingGrid's SCALAR_RATE_FIELDS /
// PER_AREA_RATE_FIELD / PER_AREA_AMOUNT_TO_RATE_KIND. Duplicated here rather than imported
// because PricingGrid imports THIS module: importing back would be a cycle, and this file's
// whole point is being a pure leaf. The three tokens are the sheet's own role vocabulary and
// have not changed since the parser shipped.
const SCALAR_RATE_FIELD_TO_BCS_KIND: Record<string, BcsRateKind> = {
  rate_supply: "supply",
  rate_install: "install",
  rate_combined: "combined",
};
const PER_AREA_RATE_FIELD = "rate_by_area";
// A per-area rate carries its kind in `rate_subkey`, where the COMBINED one is spelled
// "total" (PER_AREA_AMOUNT_TO_RATE_KIND: total -> combined_rate). Same three-hop asymmetry the
// amount side has, for the same reason: all per-area rates share one value_field.
const PER_AREA_SUBKEY_TO_BCS_KIND: Record<string, BcsRateKind> = {
  supply: "supply",
  install: "install",
  total: "combined",
};
/** Canonical box order -- NEVER the sheet's Excel column order, so two sheets that map the same
 *  two rates in different orders present the same two boxes in the same places. */
const BCS_KIND_ORDER: readonly BcsRateKind[] = ["supply", "install", "combined"];

/**
 * WHICH COST BOXES A SHEET GETS -- derived from the sheet's OWN rate columns (owner ruling
 * 2026-08-02): no Rate (Supply) column means no Supply box; a combined-rate sheet gets ONE
 * undifferentiated box; a sheet with no rate column at all cannot do BCS and gets none.
 *
 * ⚠️ THE HALVES WIN OVER A COMBINED RATE MAPPED BESIDE THEM, and that is a RULING, not a
 * detail. `bcs.py:16` forbids summing `combined_rate` with the two halves -- "never sum it with
 * them, never derive it from them" -- so the live set must never contain both, or Total Amount
 * double-counts. This makes the prohibition STRUCTURAL: the arithmetic downstream cannot express
 * the forbidden sum because the set it is given never holds both.
 *
 * WHY THE HALVES AND NOT THE TOTAL. Measured on the live bench: 22 of 553 current committed
 * sheets map all three (a Supply | Install | Total Rate layout is ordinary), so this is a real
 * shape, not a hypothetical. On such a sheet the combined column is the sheet's OWN sum of its
 * halves, and the halves carry strictly more information -- exactly the reading the AMOUNT side
 * already takes when it refuses a total picked beside the half it contains. Collapsing such a
 * sheet to one box would throw away the supply/install split the sheet is built around.
 *
 * ⚠️ IT IS A NARROWING, NEVER A WIDENING -- the same safety argument `eligibleBcsColumns` makes.
 * Reversing it is a one-function change; nothing downstream reads the rate columns again.
 */
export function bcsLiveRateKinds(descriptors: readonly ColumnDescriptor[]): BcsRateKind[] {
  const present = new Set<BcsRateKind>();
  for (const d of descriptors) {
    const scalar = SCALAR_RATE_FIELD_TO_BCS_KIND[d.value_field];
    if (scalar) {
      present.add(scalar);
      continue;
    }
    if (d.value_field === PER_AREA_RATE_FIELD && d.rate_subkey) {
      const area = PER_AREA_SUBKEY_TO_BCS_KIND[d.rate_subkey];
      if (area) present.add(area);
    }
  }
  const halves = BCS_KIND_ORDER.filter((k) => k !== "combined" && present.has(k));
  if (halves.length > 0) return halves;
  return present.has("combined") ? ["combined"] : [];
}

/**
 * One row's cost values as DISPLAY STRINGS: the live draft when there is one, else the stored
 * value, else `null` for "nothing has ever been entered". Three states, deliberately -- `""` (a
 * box the user emptied, which SAVES as 0) is not the same fact as `null` (a row nobody has
 * costed, whose Total Amount must stay blank rather than read 0).
 *
 * ONE MERGE, TWO READERS: `gatherBcsRowRates` turns it into the save payload and `bcsUnitCost`
 * turns it into the Total's multiplicand. Sharing it is what stops the number a user sees from
 * differing from the number that gets written.
 *
 * ⚠️ `drafts` IS A `ReadonlyMap`, AND THE MAP IS THE POINT -- DO NOT "SIMPLIFY" IT TO AN OBJECT.
 * The grid's cost drafts live in a `Record<string, string>` keyed `${row_index}:${field}`; this
 * function reads BARE `BcsRateField` keys. As a plain object parameter the two are STRUCTURALLY
 * ASSIGNABLE -- an all-optional target accepts any string-indexed source -- so handing the wrong
 * key space over compiles CLEANLY, finds nothing, and (this shipped at BCS-S3a) reverts a
 * controlled cost `<Input>` on every keystroke while the debounce saves a number nobody typed.
 * A `Record` is NOT assignable to a `Map`, so the mistake is now a COMPILE ERROR. Measured: with
 * an object parameter `tsc` reported nothing, with or without the `as` cast S3a carried.
 * `PricingGrid.bcsDraftsForRow` is the one blessed producer.
 */
export function mergeBcsRowValues(
  saved: Partial<Record<BcsRateField, number | null | undefined>> | null | undefined,
  drafts: ReadonlyMap<BcsRateField, string>,
): Record<BcsRateField, string | null> {
  const out = {} as Record<BcsRateField, string | null>;
  for (const f of BCS_RATE_FIELDS) {
    const draft = drafts.get(f);
    if (draft !== undefined) out[f] = draft;
    else if (saved) out[f] = String(saved[f] ?? 0);
    else out[f] = null;
  }
  return out;
}

/**
 * ★ THE WHOLE-ROW GATHER -- the single most important function in this slice.
 *
 * `save_row_bcs_rates` is a WHOLE-ROW SNAPSHOT WRITE: it takes supply / install / combined
 * together and coerces every one it is NOT given to 0.0 (`bcs.py` `_num`, pinned by
 * `test_bcs.py:1013-1024`). A client rate cell saves PER CELL -- type in one, that one saves --
 * and porting that shape naively to three cost boxes would have zeroed the untouched siblings on
 * every keystroke debounce. It would have looked correct while typing and been wrong the moment
 * anyone looked away.
 *
 * So every save carries ALL THREE, gathered from the row's current draft-or-saved values. This
 * is the ONLY function that builds that payload; there is no second path a future edit could
 * take.
 *
 * ⚠️ CORRECTED AT BCS-S3a-fix: this used to claim it "iterates BCS_RATE_FIELDS, so a fourth
 * stored rate could not be silently dropped". IT DOES NOT ITERATE -- it names the three fields
 * explicitly, and that is the RIGHT shape, because `BcsRowRates` requires exactly these three, so
 * a fourth field added to the PAYLOAD type breaks this literal at compile time. What the old
 * wording claimed but nothing enforced is the OTHER direction: a fourth field added to
 * `BCS_RATE_FIELDS` (so `mergeBcsRowValues` produces it) while `BcsRowRates` stays at three would
 * be dropped here in silence. `test: gatherBcsRowRates covers every BCS_RATE_FIELDS key` closes
 * exactly that gap -- keep the two lists in step or that test fires.
 *
 * Absent / blank / partial-decimal -> 0, mirroring `commitRate`'s parseFloat semantics exactly
 * (and the server's own coercion), so a cleared box and a typed "-" both save as 0.
 */
export function gatherBcsRowRates(merged: Record<BcsRateField, string | null>): BcsRowRates {
  const num = (v: string | null): number => {
    if (v === null || v === "") return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    supply_rate: num(merged.supply_rate),
    install_rate: num(merged.install_rate),
    combined_rate: num(merged.combined_rate),
  };
}

/**
 * The per-unit cost: the sum of the LIVE kinds only, or `null` when none of them has ever been
 * entered. Blank-not-zero is the point -- an uncosted row showing a Total Amount of 0 reads as
 * "this costs us nothing", which is a claim, not an absence.
 *
 * ⚠️ CORRECTED AT BCS-S3a-fix. This used to say the forbidden `combined + halves` sum "cannot be
 * expressed". It CAN be: `kinds` is `readonly BcsRateKind[]`, so `["supply", "combined"]` type-
 * checks here and would be summed. The guarantee is a PRODUCER guarantee, not a type guarantee --
 * `bcsLiveRateKinds` is the only thing that builds this argument and its one branch returns either
 * the halves present or `["combined"]`, never both (that is how `bcs.py:16`'s "never sum it with
 * them" is honoured). It is pinned by `test: bcsLiveRateKinds NEVER returns a mixed set`, swept
 * over every descriptor combination, rather than by the signature.
 *
 * A discriminated `["combined"] | BcsHalfKind[]` union WOULD make it a type guarantee and was
 * weighed at S3a-fix; it was declined as disproportionate -- `bcsKinds` is threaded through two
 * ~5,000-line components, a grid prop, a row prop and the colIndex geometry, so the union ripples
 * far wider than the one-line risk it removes. If a SECOND producer of `kinds` ever appears, that
 * trade flips: introduce the union then, because the producer guarantee is what is holding this up.
 */
export function bcsUnitCost(
  merged: Record<BcsRateField, string | null>,
  kinds: readonly BcsRateKind[],
): number | null {
  let any = false;
  let total = 0;
  for (const k of kinds) {
    const v = merged[BCS_RATE_FIELD[k]];
    if (v === null) continue;
    any = true;
    const n = parseFloat(v);
    if (Number.isFinite(n)) total += n;
  }
  return any ? total : null;
}

/**
 * The row's Total Quantity, from the CONFIRMED quantity columns. The stored `mode` never
 * branches this arithmetic (see BcsMode): in every one of the ten it is "resolve each stored
 * entry and add them up". `resolve` is supplied by the caller -- the grid passes
 * `resolveDescriptorValue`, which keeps this module a pure leaf with type-only imports.
 *
 * A per-area column that does not apply to this row contributes 0; a row where NOTHING resolves
 * is genuinely quantity-less and returns `null` (blank Total), not 0.
 */
export function bcsRowQuantity(
  source: BcsSource | null | undefined,
  resolve: (entry: BcsColumnEntry) => unknown,
): number | null {
  const cols = source?.columns ?? [];
  if (cols.length === 0) return null;
  let any = false;
  let total = 0;
  for (const entry of cols) {
    const v = resolve(entry);
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (!Number.isFinite(n)) continue;
    any = true;
    total += n;
  }
  return any ? total : null;
}

/**
 * BCS-S3b -- THE DENOMINATOR: the row's Amount charged, summed across the CONFIRMED amount
 * columns. It mirrors `bcsRowQuantity` deliberately, function for function, because the two
 * sides of the confirmation are the same shape of question and answering them differently is
 * how the number under the margin drifts away from the number beside it.
 *
 * ⚠️ `evaluate` MUST RETURN THE FIGURE THE AMOUNT CELL IS SHOWING (owner ruling). Not the
 * committed value, not the raw formula result -- the number ON SCREEN, which means the caller
 * resolves the formula AND the document-vs-formula reconciliation choice before handing it here.
 * The Tendered column exists precisely to put the denominator in front of the user; if it showed
 * one number while % Profit divided by another, the column would be worse than useless. The
 * callback is what keeps that rule at the caller (where `reconChoiceMap` and the row's live rate
 * drafts are) while this module stays a pure leaf with type-only imports.
 *
 * A column that does not resolve contributes 0; a row where NOTHING resolves is genuinely
 * amount-less and returns `null`, not 0. A 0 denominator is a claim ("we charge nothing"); an
 * absent one is the absence of a claim, and only the first of those can be a real margin.
 */
export function bcsRowAmount(
  source: BcsSource | null | undefined,
  evaluate: (entry: BcsColumnEntry) => number | null,
): number | null {
  const cols = source?.columns ?? [];
  if (cols.length === 0) return null;
  let any = false;
  let total = 0;
  for (const entry of cols) {
    const v = evaluate(entry);
    if (v === null || !Number.isFinite(v)) continue;
    any = true;
    total += v;
  }
  return any ? total : null;
}

/** Total Amount = quantity x the per-unit cost. Blank if either side is blank -- never a
 *  half-computed figure, which on a cost screen is worse than an empty cell. */
export function bcsTotalAmount(qty: number | null, unitCost: number | null): number | null {
  if (qty === null || unitCost === null) return null;
  return qty * unitCost;
}

// ── BCS-S3b: the computed columns speak ONE language ─────────────────────────────

/**
 * Why a computed BCS cell is blank. These are ROW-LEVEL facts, which is why BCS owns them
 * instead of reusing `AmountCellResult`'s `not_yet | broken` -- those two describe ONE column's
 * formula, and "this row has no quantity" is not a statement about a formula.
 *
 * `not_finite` is the defensive arm: every operand reaching the margin is finite by
 * construction, but a denormal-tiny amount beside a huge cost can still divide out past the
 * double range, and a rendered "Infinity" is not an answer.
 *
 * `negative_amount` (BCS-S2e) is the SIGN arm, and it is not defensive -- it closes a real
 * inversion. See `bcsMarginPercent` for what it costs to leave out.
 */
export type BcsBlankReason =
  | "no_quantity"
  | "no_cost"
  | "no_amount"
  | "zero_amount"
  | "negative_amount"
  | "not_finite";

/** One computed cell: a number, or a blank that KNOWS WHY. Mirrors `AmountCellResult`'s
 *  discriminated shape so the render stays a pure map and no blank is ever unexplained. */
export type BcsComputedCell =
  | { kind: "value"; value: number }
  | { kind: "blank"; reason: BcsBlankReason };

/**
 * The Total Amount cell -- S3a's `bcsTotalAmount` with the reason it always had and never said.
 *
 * UPGRADED AT BCS-S3b so the three computed columns explain themselves the same way. S3a
 * computed a bare `number | null` and reconstructed the reason at the render site with a nested
 * ternary over `bcsQty`; with two more computed columns arriving, that would have been three
 * render sites each re-deriving its own explanation. The arithmetic is untouched --
 * `bcsTotalAmount` is still the multiply, and is still exported and tested.
 */
export function bcsTotalAmountCell(qty: number | null, unitCost: number | null): BcsComputedCell {
  if (qty === null) return { kind: "blank", reason: "no_quantity" };
  if (unitCost === null) return { kind: "blank", reason: "no_cost" };
  // BCS-S2e: the finiteness guard S3b invented `not_finite` for and then gave only to the
  // margin. A product that overflows the double range rendered here as the literal string
  // "Infinity" in a cost cell. Cheap, and it costs the ordinary path nothing -- a legitimate
  // 0 (a zero quantity, or a zero cost) is finite and still reads 0.
  const total = qty * unitCost;
  if (!Number.isFinite(total)) return { kind: "blank", reason: "not_finite" };
  return { kind: "value", value: total };
}

/** The Tendered Total Amount cell -- the ONE place a null sum is decided to mean "no amount". */
export function bcsTenderedAmountCell(amount: number | null): BcsComputedCell {
  return amount === null ? { kind: "blank", reason: "no_amount" } : { kind: "value", value: amount };
}

/**
 * ★ % PROFIT = (amount − cost) / amount × 100, over the two cells beside it.
 *
 * ⚠️ THE DIRECTION IS OWNER-SETTLED AND WAS ONCE RELAYED BACKWARDS (at BCS-S2d, corrected
 * since). Dividing by the AMOUNT means a one-sided confirmation -- a sheet whose Amount columns
 * cover only the supply half, which `bcsSummaryForMode` discloses in words -- makes the margin
 * read LOWER, and once the amount falls below the cost it goes sharply negative. That visible
 * collapse IS the safety the disclosure promises. Do not re-derive this as cost-over-amount or
 * as a mark-up on cost; both read HIGHER on exactly the sheets that need a warning.
 *
 * IT TAKES THE TWO CELLS, NOT TWO NUMBERS, so a blank arrives with its reason attached and the
 * margin can say what is missing instead of just being empty. The COST side is checked first: on
 * a fresh sheet an uncosted row is the ordinary case, and naming the amount there would send a
 * user to the sheet's Amount mapping when all they have to do is type a cost.
 *
 * NEVER NaN, NEVER Infinity. A zero denominator is refused before the division, and a result
 * that leaves the double range is refused after it. Both matter twice over: a `NaN` displayed is
 * nonsense, and a `NaN` compared with `===` (`NaN !== NaN`) would defeat a React.memo for the
 * lifetime of the row.
 *
 * ★ AND NEVER A PROFIT ON A LOSS (`negative_amount`, BCS-S2e -- found in the BCS-S3b review).
 * The guards were `=== 0` and `!isFinite`; NOTHING LOOKED AT THE SIGN. A negative denominator
 * FLIPS THE INEQUALITY: amount -100 against cost 50 gives (-100 - 50) / -100 * 100 = +150%, so
 * a loss-making row displayed positive profit -- the exact inverse of the property this column
 * exists to show, and the one failure mode that is worse than a blank cell, because it is
 * confidently wrong rather than visibly absent.
 *
 * IT WAS UNREACHABLE FROM DATA AND REACHABLE BY TYPING. Measured: 0 negative amounts across
 * 65,340 committed nodes -- but neither cost input carries a `min=`, and `pricing.py` has no
 * negative validation, so a typed minus sign gets there.
 *
 * ⚠️ BLANK WITH A REASON, NOT A BLOCKED INPUT (planner ruling 2026-08-03). Same shape as the
 * four reasons beside it, and the same "adapt and disclose" the one-sided amount confirmation
 * takes: refusing the keystroke would be a guess about whether negative amounts are legitimate
 * in this owner's BoQs, and this way is safe either way. Do NOT convert it into a validation.
 *
 * THE COST SIDE IS DELIBERATELY UNGUARDED. A negative cost against a positive amount is
 * arithmetically a margin above 100%, which is what it should read; only the DENOMINATOR's
 * sign inverts the comparison.
 */
export function bcsMarginPercent(
  cost: BcsComputedCell,
  amount: BcsComputedCell,
): BcsComputedCell {
  if (cost.kind === "blank") return cost;
  if (amount.kind === "blank") return amount;
  // `-0 === 0` is true, so a negative zero is caught here and never reaches the sign test.
  if (amount.value === 0) return { kind: "blank", reason: "zero_amount" };
  if (amount.value < 0) return { kind: "blank", reason: "negative_amount" };
  const pct = ((amount.value - cost.value) / amount.value) * 100;
  if (!Number.isFinite(pct)) return { kind: "blank", reason: "not_finite" };
  return { kind: "value", value: pct };
}

/**
 * Why this computed cell is empty, in a sentence -- the cell's `title`.
 *
 * AN UNRECOGNISED REASON IS AN EXPLICIT UNSUPPORTED STATE, never a silent blank: the same
 * forward-compat honesty `bcsSummaryForMode` gives an unknown mode and `ratePipelineInterpreter`
 * gives an unknown step type. A cell that cannot explain itself must not look like an ordinary
 * empty cell, because an empty cell on a cost screen reads as "nothing to see here".
 */
export function bcsBlankReasonText(reason: string): string {
  switch (reason) {
    case "no_quantity":
      return "No quantity on this row.";
    case "no_cost":
      return "No cost entered yet.";
    case "no_amount":
      return (
        "No amount on this row yet — % Profit is measured against the amount charged, and this " +
        "row has none to read."
      );
    case "zero_amount":
      return "The amount charged on this row is zero, so there is no margin to measure against it.";
    case "negative_amount":
      // States the fact AND why the cell is blank rather than computed. The second half is
      // load-bearing: without it a reader assumes the software simply could not cope, and the
      // ONE thing they must not do is work the percentage out by hand instead.
      return (
        "The amount charged on this row is negative, so a percentage measured against it " +
        "would read backwards — a loss would show as a profit."
      );
    case "not_finite":
      return "The numbers on this row are too extreme to produce a percentage.";
    default:
      return (
        `This cell is blank for a reason this screen does not recognise ("${reason}"). Ask the ` +
        `team before relying on it.`
      );
  }
}

/**
 * % Profit as it reads in the cell. It needs its OWN formatter -- `renderDescriptorCell` is the
 * sheet's money/quantity formatter and has no percent unit, so a margin rendered through it
 * would sit in the row looking like another amount.
 *
 * ONE decimal place, and NEVER "-0.0%": a rounded-away loss of a hundredth of a percent must not
 * present as a loss at all.
 */
export function formatBcsMargin(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${(rounded === 0 ? 0 : rounded).toFixed(1)}%`;
}

/**
 * Why a cost box is read-only, or null when it may be typed in. THE PARALLEL PREDICATE.
 *
 * ⚠️ IT IS NOT `rateWritableAt`, AND MUST NEVER BECOME IT. A client rate cell gates on
 * `formulasComplete` and `categoryGateOpen`; `save_row_bcs_rates` runs FOUR gates and SKIPS
 * those three on purpose (`bcs.py:41-59`: "Do NOT add any of the three 'to restore consistency
 * with save_cell_price' -- the asymmetry IS the decision"). Cost is a separate axis: someone
 * must be able to cost a job while the amount formulas are still being declared and the rows are
 * still being categorised. Reusing the rate predicate here would silently re-impose all three,
 * and nothing would fail -- the boxes would just be inexplicably dead on a normal sheet.
 *
 * THE ORDER MIRRORS THE SERVER'S GATE ORDER, so the reason a user reads is the gate the server
 * would actually hit: committed cell exists -> sheet not deliberately locked -> BCS ready ->
 * single-editor lock. The lock is LAST for the same reason it is fourth in `bcs.py`: it is the
 * only one of the four that is someone else's transient state rather than this sheet's own
 * setup, so naming it first would hide the gate the user can actually act on.
 *
 * The two BCS-state fields are NAMED APART from the sheet's, exactly as `bcsSetupReason` learned
 * to at S2a (finding F1) -- passing one fetch's flags into the other's slot type-checks fine and
 * produces a screen that lies.
 */
export function bcsCostEntryReason(state: {
  /** The PRICED rows fetch (get_priced_rows) -- the sheet itself. */
  sheetLoading: boolean;
  sheetError: boolean;
  committedVersion: number | null;
  viewingHistory: boolean;
  /** The DELIBERATE per-sheet read-only lock (_guard_sheet_not_locked). */
  sheetLocked: boolean;
  /** The SINGLE-EDITOR concurrency lock: held by someone else, or taken over mid-edit. */
  editorLocked: boolean;
  /** The BCS state fetch -- three-valued, so an unreadable payload never presents as "off". */
  bcsToggle: BcsToggleState;
  bcsReady: boolean;
}): string | null {
  if (state.sheetLoading) return "Loading…";
  if (state.sheetError) return "This sheet could not be loaded.";
  if (state.committedVersion === null) return "This sheet is not committed yet.";
  if (state.viewingHistory)
    return "You are viewing an earlier version. Costs are entered on the current version.";
  if (state.sheetLocked) return "This sheet is locked (read-only). Unlock it to enter costs.";
  if (state.bcsToggle === "unknown")
    return "The BCS setup could not be read. Reload the page to try again.";
  if (state.bcsToggle === "off") return "BCS is off on this sheet. Turn it on to enter costs.";
  if (!state.bcsReady)
    return "Confirm this sheet's Total Quantity and Amount columns before entering any cost.";
  if (state.editorLocked) return "Someone else is editing this sheet.";
  return null;
}

/**
 * The COMPUTED columns of the block, in render order after the cost boxes. NONE of them is
 * stored and NONE of them is typeable -- they are read out of the row every render, so a stored
 * copy can never disagree with the live sheet (`bcs.py`'s property 1).
 *
 * ⚠️ THIS LIST IS THE TRAP'S ONLY DEFENCE, so add a computed column HERE FIRST. Until BCS-S3b
 * seven call sites asked `b !== "total"` to mean "this is a cost box a user may type in". A
 * SECOND computed token does not match that literal: it falls through to the editable branch,
 * takes a keystroke and accepts a pasted block -- silently, with no type error, on a column whose
 * whole nature is that it is derived. `isBcsInputColumn` replaced all seven, and it answers by
 * MEMBERSHIP in this list rather than by a comparison, so a column added here is excluded from
 * every write path by construction rather than by seven remembered edits.
 */
export type BcsComputedKind = "total" | "tendered" | "margin";
export const BCS_COMPUTED_KINDS: readonly BcsComputedKind[] = ["total", "tendered", "margin"];
const BCS_COMPUTED_SET: ReadonlySet<string> = new Set<string>(BCS_COMPUTED_KINDS);

/** The Total Amount column's width/render key -- not a cost box, so it has its own token. */
export const BCS_TOTAL_COL_KEY = "bcs:total";
/** BCS-S3b: the client-facing amount, and the margin between it and the cost. */
export const BCS_TENDERED_COL_KEY = "bcs:tendered";
export const BCS_MARGIN_COL_KEY = "bcs:margin";
/** Every computed column's width/render key, so the key list is derived, never re-listed. */
export const BCS_COMPUTED_COL_KEY: Record<BcsComputedKind, string> = {
  total: BCS_TOTAL_COL_KEY,
  tendered: BCS_TENDERED_COL_KEY,
  margin: BCS_MARGIN_COL_KEY,
};
/** One cost box's width/render key. Kind-keyed (survives a change to the sheet's rate mapping). */
export function bcsWidthKey(kind: BcsRateKind): string {
  return `bcs:${kind}`;
}

/**
 * ★ MAY THIS COLUMN BE TYPED IN? The ONE decision, and a TYPE GUARD so a caller that passes it
 * comes out holding a `BcsRateKind` -- which is what makes `BCS_RATE_FIELD[b]` legal afterwards
 * without a cast at seven separate call sites.
 *
 * It is written as "not one of the computed kinds", NOT as "is one of the rate kinds", and the
 * direction is deliberate: a token this build has never heard of is refused rather than admitted.
 * Refusing wrongly costs a dead cell someone reports; admitting wrongly writes a number into a
 * column that has no storage.
 */
export function isBcsInputColumn(
  b: BcsRateKind | BcsComputedKind | null | undefined,
): b is BcsRateKind {
  return b !== null && b !== undefined && !BCS_COMPUTED_SET.has(b);
}

/**
 * The BCS block's columns, left to right: one per live cost box, then the computed tail
 * (Total Amount · Tendered Total Amount · % Profit).
 *
 * EMPTY IN, EMPTY OUT -- a sheet with no cost box gets no computed columns either. This is what
 * keeps every colIndex on a non-BCS sheet byte-identical to pre-S3a, and it is also just true:
 * % Profit has no numerator without a cost, and a Total above rows nobody can cost can only ever
 * be blank.
 */
export function bcsColumnKeys(kinds: readonly BcsRateKind[]): string[] {
  if (kinds.length === 0) return [];
  return [...kinds.map(bcsWidthKey), ...BCS_COMPUTED_KINDS.map((k) => BCS_COMPUTED_COL_KEY[k])];
}

/** What sits at grid colIndex `c`: a cost box's kind, one of the computed columns, or null when
 *  `c` is outside the BCS block entirely. The block is contiguous and starts at `bcsColStart`.
 *  The upper bound is PARAMETRIC over the computed list -- it used to hardcode the single
 *  trailing Total (`off > kinds.length`), which would have placed nothing at the two new
 *  columns while their `<td>`s rendered anyway. */
export function bcsColumnAt(
  c: number,
  bcsColStart: number,
  kinds: readonly BcsRateKind[],
): BcsRateKind | BcsComputedKind | null {
  if (kinds.length === 0) return null;
  const off = c - bcsColStart;
  if (off < 0) return null;
  if (off < kinds.length) return kinds[off];
  return BCS_COMPUTED_KINDS[off - kinds.length] ?? null;
}
