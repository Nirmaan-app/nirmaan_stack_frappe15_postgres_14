/**
 * bcsColumns.test.ts -- the BCS two-column confirmation rules (slice BCS-S2).
 *
 * WHAT THESE TESTS ARE FOR. The card lets a human pick which columns hold the row's Total
 * Quantity and the Amount charged. The SERVER decides what a valid pick is
 * (`services/boq_bcs/sources.py`, slices S1a-S1c, widened at S2b) and REFUSES the rest. This
 * module mirrors those refusals so the card can never say "looks fine" about something the
 * server will throw on -- so every test below names the server rule it pins, and the ORDER of
 * the refusals is itself under test, because the server's order decides WHICH message a bad
 * pick gets.
 *
 * DIVERGENCE CUTS BOTH WAYS, and BCS-S2c was written for the quieter direction. A card that
 * REFUSES what the server accepts produces no error to investigate -- a legitimate sheet is
 * simply unusable. That is what happened between S2b and S2c: the server accepted the supply /
 * installation halves, the browser did not, and the owner's fix was invisible in the product.
 * Several tests here therefore assert the OPPOSITE of what they asserted before; each says so.
 *
 * The wording is deliberately friendlier than the server's; the CONDITIONS are identical.
 */
import { describe, expect, it } from "vitest";
// The SHARED rule-parity table (BCS-S2e). It climbs OUT of `frontend/` on purpose -- the table
// lives beside the AUTHORITY it describes (`services/boq_bcs/`), not beside this mirror, and
// `services/boq_bcs/test_sources.py` reads the very same file. See the "rule parity" group below
// for why this is an import rather than an inline parse, and the JSON's own `_readme` for why
// the table exists at all.
import PARITY_RAW from "../../../../nirmaan_stack/services/boq_bcs/parity_cases.json";
import type { AmountFormulaNode, BcsRateField, BcsSource, ColumnDescriptor } from "./boqTypes";
import type { BcsComputedCell, BcsRateKind } from "./bcsColumns";
import {
  bcsTotalCell,
  bcsAmountColumns,
  bcsQuantityColumns,
  marginCostOperandRefs,
  marginCostCell,
  defaultMarginCostFormula,
  boqTotalAmount,
  defaultBoqTotalFormula,
  defaultBcsTotalFormula,
  pickBcsTotalFormula,
  BCS_COMPUTED_KINDS,
  BCS_REFUSAL_CODES,
  BCS_REFUSAL_ORDER,
  BCS_RATE_FIELD,
  BCS_RATE_FIELDS,
  BCS_RATE_LABEL,
  bcsBlankReasonText,
  bcsChipLabel,
  bcsColumnAt,
  bcsColumnKeys,
  bcsMarginPercent,
  bcsRowAmount,
  bcsTenderedAmountCell,
  bcsTotalAmountCell,
  formatBcsMargin,
  isBcsInputColumn,
  bcsColumnLabel,
  bcsCostEntryReason,
  bcsLiveRateKinds,
  bcsRowQuantity,
  bcsSelectionSaveable,
  bcsTotalAmount,
  bcsUnitCost,
  gatherBcsRowRates,
  mergeBcsRowValues,
  bcsSetupReason,
  bcsSourceCols,
  bcsStoredSummary,
  bcsToggleState,
  buildBcsDescriptorIndex,
  eligibleBcsColumns,
  isBcsAmountColumn,
  isBcsQtyColumn,
  validateBcsPicks,
  type BcsMode,
} from "./bcsColumns";

// ── A committed sheet's descriptor set, in the exact shape review_screen
// ._build_column_descriptors emits (the resolver `_committed_descriptors` feeds the server). ──
function desc(
  col: string,
  role: string,
  value_field: string,
  area: string | null = null,
  rate_subkey: string | null = null,
): ColumnDescriptor {
  return { col, role, area, value_field, value_key: area, rate_subkey };
}

/** A scalar descriptor: value_key is null even when it is not area-bound. */
function scalar(col: string, role: string, value_field: string): ColumnDescriptor {
  return { col, role, area: null, value_field, value_key: null, rate_subkey: null };
}

const SHEET: ColumnDescriptor[] = [
  scalar("A", "description", "description"),
  desc("B", "qty", "qty_by_area", "Zone A"),
  desc("C", "qty", "qty_by_area", "Zone B"),
  scalar("D", "qty_total", "qty_total"),
  // E aliases B: review_screen imposes NO uniqueness on (role, area) across columns, so a
  // sheet really can map Zone A quantity twice (the S1c defect).
  desc("E", "qty", "qty_by_area", "Zone A"),
  scalar("F", "amount_total", "amount_total"),
  desc("G", "amount_total_by_area", "amount_by_area", "Zone A", "total"),
  desc("H", "amount_total_by_area", "amount_by_area", "Zone B", "total"),
  // ── The HALVES. Until BCS-S2b these were REFUSED as "a fraction of what we charge"; the
  // owner reversed that on 2026-08-02 because most real sheets have no combined Amount
  // column at all, which left this card's Amount list EMPTY on most of them. They are
  // eligible Amount columns now, in both shapes and both kinds. ──
  desc("I", "amount_supply_by_area", "amount_by_area", "Zone A", "supply"),
  scalar("J", "amount_supply", "amount_supply"),
  scalar("K", "rate_combined", "rate_combined"),
  // A second scalar total quantity (a sheet can map the role twice).
  scalar("L", "qty_total", "qty_total"),
  // The rest of the half vocabulary, so every one of the eight accepted amount shapes has
  // real columns to be built from. Letters P/R/S/T deliberately avoid M, N, X, Y, Z, QQ and
  // ZZ, which individual tests below mint ad hoc -- buildBcsDescriptorIndex keeps the FIRST
  // descriptor for a letter, so a collision here would silently SHADOW those fixtures.
  scalar("P", "amount_install", "amount_install"),
  desc("R", "amount_install_by_area", "amount_by_area", "Zone A", "install"),
  desc("S", "amount_supply_by_area", "amount_by_area", "Zone B", "supply"),
  desc("T", "amount_install_by_area", "amount_by_area", "Zone B", "install"),
];

const INDEX = buildBcsDescriptorIndex(SHEET);

// ===========================================================================
// Group 1: which columns each side may offer at all
// ===========================================================================
describe("eligibility -- what the card is allowed to offer", () => {
  it("counts the scalar total and the per-area quantity columns as quantity", () => {
    expect(isBcsQtyColumn(scalar("D", "qty_total", "qty_total"))).toBe(true);
    expect(isBcsQtyColumn(desc("B", "qty", "qty_by_area", "Zone A"))).toBe(true);
  });

  it("does not count an amount, a rate or a description as quantity", () => {
    expect(isBcsQtyColumn(scalar("F", "amount_total", "amount_total"))).toBe(false);
    expect(isBcsQtyColumn(scalar("K", "rate_combined", "rate_combined"))).toBe(false);
    expect(isBcsQtyColumn(scalar("A", "description", "description"))).toBe(false);
  });

  it("counts the COMBINED amounts -- the scalar total and the per-area 'total' subkey", () => {
    expect(isBcsAmountColumn(scalar("F", "amount_total", "amount_total"))).toBe(true);
    expect(
      isBcsAmountColumn(desc("G", "amount_total_by_area", "amount_by_area", "Zone A", "total")),
    ).toBe(true);
  });

  it("ACCEPTS the supply/install HALF of an amount, per-area and scalar alike", () => {
    // REWRITTEN at BCS-S2c. This test used to assert the exact opposite, and it was the
    // client's share of the refusal the owner REVERSED on 2026-08-02: most real sheets have
    // no single "Amount (Total)" column, so refusing the halves left this card's Amount list
    // EMPTY on most of them -- the feature was unusable, not merely strict. A one-sided
    // package is a genuine commercial shape. THE SAFETY IS THE DISCLOSURE SENTENCE (below),
    // not a block. Mirrors sources._amount_axes.
    expect(
      isBcsAmountColumn(desc("I", "amount_supply_by_area", "amount_by_area", "Zone A", "supply")),
    ).toBe(true);
    expect(
      isBcsAmountColumn(desc("X", "amount_install_by_area", "amount_by_area", "Zone A", "install")),
    ).toBe(true);
    expect(isBcsAmountColumn(scalar("J", "amount_supply", "amount_supply"))).toBe(true);
    expect(isBcsAmountColumn(scalar("Y", "amount_install", "amount_install"))).toBe(true);
  });

  it("still rejects a per-area column whose third hop is not an amount kind", () => {
    // The KIND axis widened; the CLASS check did not. rate_subkey is the per-area amount's
    // third hop, so an unrecognised subkey is not an amount column however it is shaped.
    expect(
      isBcsAmountColumn(desc("X", "amount_by_area", "amount_by_area", "Zone A", "sundry")),
    ).toBe(false);
    expect(isBcsAmountColumn(desc("X", "amount_by_area", "amount_by_area", "Zone A", null))).toBe(
      false,
    );
  });

  it("rejects a rate column as an amount (a rate is not what we charge)", () => {
    expect(isBcsAmountColumn(scalar("K", "rate_combined", "rate_combined"))).toBe(false);
  });

  it("offers exactly the eligible columns for each side, in sheet order", () => {
    expect(eligibleBcsColumns("qty", SHEET).map((d) => d.col)).toEqual(["B", "C", "D", "E", "L"]);
    // The halves are OFFERED now (I, J, P, R, S, T). This list being short is precisely what
    // the owner saw on real sheets: before S2b it was ["F", "G", "H"], and a sheet with no
    // combined Amount column at all offered nothing.
    expect(eligibleBcsColumns("amount", SHEET).map((d) => d.col)).toEqual([
      "F", "G", "H", "I", "J", "P", "R", "S", "T",
    ]);
  });

  it("offers something on a sheet that has ONLY halves -- the owner's real case", () => {
    const halvesOnly = [
      scalar("A", "description", "description"),
      scalar("B", "amount_supply", "amount_supply"),
      scalar("C", "amount_install", "amount_install"),
    ];
    expect(eligibleBcsColumns("amount", halvesOnly).map((d) => d.col)).toEqual(["B", "C"]);
  });

  it("offers nothing when the sheet maps nothing relevant", () => {
    const bare = [scalar("A", "description", "description")];
    expect(eligibleBcsColumns("qty", bare)).toEqual([]);
    expect(eligibleBcsColumns("amount", bare)).toEqual([]);
  });
});

// ===========================================================================
// Group 2: how a column is named on a chip (AmountFormulaBuilder's convention)
// ===========================================================================
describe("column labels", () => {
  it("names a scalar column by its role alone", () => {
    expect(bcsColumnLabel(scalar("D", "qty_total", "qty_total"))).toBe("Total Quantity");
  });

  it("names a per-area column Role · Area", () => {
    expect(bcsColumnLabel(desc("B", "qty", "qty_by_area", "Zone A"))).toBe("Quantity · Zone A");
  });

  it("falls back to the raw role when there is no friendly label", () => {
    expect(bcsColumnLabel(scalar("Z", "some_new_role", "qty_total"))).toBe("some_new_role");
  });

  it("omits the area when an area-bound column carries none", () => {
    expect(bcsColumnLabel(desc("B", "qty", "qty_by_area", null))).toBe("Quantity");
  });
});

// ===========================================================================
// Group 3: the refusals -- one per server rule, in the server's own precedence
// ===========================================================================
describe("quantity picks -- mirroring build_qty_source", () => {
  it("refuses an empty pick", () => {
    const v = validateBcsPicks("qty", [], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/pick/i);
  });

  it("refuses a column the sheet does not have", () => {
    const v = validateBcsPicks("qty", ["ZZ"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/ZZ/);
  });

  it("reports an unknown column as UNKNOWN even when it is also repeated", () => {
    // Server ordering promise: the resolve loop runs BEFORE the duplicate rule, so the more
    // fundamental fact about the column wins.
    const v = validateBcsPicks("qty", ["ZZ", "ZZ"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/mapped column/i);
  });

  it("refuses the same column picked twice", () => {
    const v = validateBcsPicks("qty", ["D", "D"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/twice|more than once/i);
  });

  it("refuses two DIFFERENT columns that resolve to the same number", () => {
    // B and E are both Zone A quantity. Summing them would count Zone A twice -- the S1c fix.
    const v = validateBcsPicks("qty", ["B", "E"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/same/i);
  });

  it("refuses a column that is not a quantity column", () => {
    const v = validateBcsPicks("qty", ["F"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/quantity/i);
    expect(!v.ok && v.message).toMatch(/F/);
  });

  it("refuses a scalar total MIXED with its own per-area parts", () => {
    const v = validateBcsPicks("qty", ["D", "B"], INDEX);
    expect(v.ok).toBe(false);
    // BCS-S2a / finding F8: /twice/i ALSO matches the duplicate-letter and same-number
    // refusals, so it passed no matter which rule fired and could not catch a precedence
    // regression -- the one thing this test exists for. Assert the mixing message's own words,
    // and assert the two rules that precede it did NOT speak.
    expect(!v.ok && v.message).toMatch(/not both/i);
    expect(!v.ok && v.message).toMatch(/its own parts/i);
    expect(!v.ok && v.message).not.toMatch(/picked twice|same number|mapped column/i);
  });

  it("checks the column CLASS before the mixed rule, as the server does", () => {
    // BCS-S2a / finding F9: the amount side pinned this; the quantity side did not.
    // ["D","F"] is both a wrong-class pick (F is an amount) and a would-be mix of two
    // value_fields. The server runs its class check first, so the message must name the
    // wrong column, not the mixing.
    const v = validateBcsPicks("qty", ["D", "F"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/F/);
    expect(!v.ok && v.message).toMatch(/doesn't hold a quantity/i);
    expect(!v.ok && v.message).not.toMatch(/not both/i);
  });

  it("keeps two DIFFERENT letters that hold DIFFERENT numbers pickable (finding F2)", () => {
    // The server keys the duplicate check on the RAW tuple (value_field, value_key,
    // rate_subkey), where None and "" are different keys. The client used to coerce a null
    // value_key to "", collapsing the two -- so it would have REFUSED this pick while the
    // server accepted it. That is the dangerous direction: the card contradicting the
    // authority, with no error anywhere to show for it.
    const nullKey = desc("M", "qty", "qty_by_area", null);
    const blankKey: ColumnDescriptor = {
      col: "N",
      role: "qty",
      area: "",
      value_field: "qty_by_area",
      value_key: "",
      rate_subkey: null,
    };
    const idx = buildBcsDescriptorIndex([...SHEET, nullKey, blankKey]);
    const v = validateBcsPicks("qty", ["M", "N"], idx);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_by_area");
  });

  it("still refuses two letters that DO share a resolved identity", () => {
    // The F2 fix must not loosen the real rule: two columns whose whole identity matches are
    // still one number picked twice.
    const twinA = desc("M", "qty", "qty_by_area", null);
    const twinB = desc("N", "qty", "qty_by_area", null);
    const idx = buildBcsDescriptorIndex([...SHEET, twinA, twinB]);
    const v = validateBcsPicks("qty", ["M", "N"], idx);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/same number/i);
  });

  it("lets the duplicate-value rule SHADOW the too-many-totals rule, exactly as the server does", () => {
    // D and L are both scalar qty_total, so they share a resolved identity. The server's
    // duplicate rule precedes the per-source rules, so "Too many total-quantity columns" is
    // unreachable -- and the client must not invent a different message than the server would.
    const v = validateBcsPicks("qty", ["D", "L"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/same/i);
  });

  it("accepts the lone scalar total and reports the scalar mode", () => {
    const v = validateBcsPicks("qty", ["D"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_total");
    expect(v.ok && v.summary).toMatch(/D/);
  });

  it("accepts several per-area columns and says they are added up", () => {
    const v = validateBcsPicks("qty", ["B", "C"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_by_area");
    expect(v.ok && v.summary).toMatch(/B/);
    expect(v.ok && v.summary).toMatch(/C/);
  });

  it("accepts a single per-area column (one area is still the per-area shape)", () => {
    const v = validateBcsPicks("qty", ["B"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_by_area");
  });
});

describe("amount picks -- mirroring build_amount_source", () => {
  it("refuses an empty pick", () => {
    const v = validateBcsPicks("amount", [], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/pick/i);
  });

  it("refuses a column the sheet does not have", () => {
    const v = validateBcsPicks("amount", ["QQ"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/QQ/);
  });

  // ── REWRITTEN at BCS-S2c: these two pinned "a half is refused". Reversed by the owner
  // 2026-08-02 -- adapt and disclose, never refuse. ──
  it("ACCEPTS a lone scalar supply half and states the formula in force", () => {
    const v = validateBcsPicks("amount", ["J"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("amount_supply_only");
  });

  it("ACCEPTS a lone per-area supply half", () => {
    const v = validateBcsPicks("amount", ["I"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("amount_by_area_supply_only");
  });

  it("refuses a rate column", () => {
    const v = validateBcsPicks("amount", ["K"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/K/);
  });

  it("refuses a quantity column on the amount side", () => {
    const v = validateBcsPicks("amount", ["D"], INDEX);
    expect(v.ok).toBe(false);
  });

  it("refuses the scalar amount MIXED with its own per-area parts", () => {
    const v = validateBcsPicks("amount", ["F", "G"], INDEX);
    expect(v.ok).toBe(false);
    // BCS-S2a / finding F8, amount side -- see the quantity twin above for why /twice/i was
    // not discriminating. The SHAPE refusal's own words (BCS-S2c reword).
    expect(!v.ok && v.message).toMatch(/one shape/i);
    expect(!v.ok && v.message).not.toMatch(/picked twice|same number|mapped column/i);
  });

  it("checks the column CLASS before every amount rule, as the server does", () => {
    // ["F","K"] is both a wrong-class pick (K is a RATE) and a would-be single-shape pick.
    // The class check runs first, so the message must name the rate column.
    const v = validateBcsPicks("amount", ["F", "K"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/K/);
    expect(!v.ok && v.message).not.toMatch(/one shape|already includes/i);
  });

  it("accepts the lone scalar combined amount", () => {
    const v = validateBcsPicks("amount", ["F"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("amount_total");
  });

  it("accepts several per-area combined amounts and says they are added up", () => {
    const v = validateBcsPicks("amount", ["G", "H"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("amount_by_area");
    expect(v.ok && v.summary).toMatch(/G/);
    expect(v.ok && v.summary).toMatch(/H/);
  });
});

// ===========================================================================
// Group 3b: the EIGHT accepted amount shapes (BCS-S2c mirrors BCS-S2b)
// ===========================================================================
// The server widened the amount rules along a second axis at BCS-S2b and the browser did
// not follow, so the owner's fix was real on the server and INVISIBLE in the product: the
// card still refused every half. These pin the mirror.
//
// The arithmetic is IDENTICAL in all eight -- resolve each stored entry and add them up.
// The mode exists for DISCLOSURE and REFUSAL only, which is why every test here checks the
// mode and the sentence rather than any computed number.
describe("the eight accepted amount shapes", () => {
  const CASES: Array<[string, string[], BcsMode]> = [
    ["a scalar combined Amount", ["F"], "amount_total"],
    ["both scalar halves", ["J", "P"], "amount_supply_plus_install"],
    ["a lone scalar supply half", ["J"], "amount_supply_only"],
    ["a lone scalar install half", ["P"], "amount_install_only"],
    ["per-area combined Amounts", ["G", "H"], "amount_by_area"],
    ["per-area halves of both kinds", ["I", "S", "R", "T"], "amount_by_area_supply_plus_install"],
    ["per-area supply halves only", ["I", "S"], "amount_by_area_supply_only"],
    ["per-area install halves only", ["R", "T"], "amount_by_area_install_only"],
  ];

  it.each(CASES)("accepts %s and stores the mode %s", (_label, cols, mode) => {
    const v = validateBcsPicks("amount", cols, INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe(mode);
  });

  it("gives each of the eight its OWN mode -- two formulas may never share one", () => {
    // The mode is a PERSISTED CONTRACT read by BCS-S3 to decide what to compute. Two shapes
    // sharing a mode would make the stored record unable to say which formula was in force.
    const modes = CASES.map(([, cols]) => {
      const v = validateBcsPicks("amount", cols, INDEX);
      return v.ok ? v.mode : "REFUSED";
    });
    expect(new Set(modes).size).toBe(8);
  });

  it("does not care which ORDER the halves were picked in", () => {
    const a = validateBcsPicks("amount", ["J", "P"], INDEX);
    const b = validateBcsPicks("amount", ["P", "J"], INDEX);
    expect(a.ok && a.mode).toBe("amount_supply_plus_install");
    expect(b.ok && b.mode).toBe(a.ok ? a.mode : "");
  });

  it("keeps the two pre-S2b modes BYTE-UNCHANGED, so stored confirmations still read back", () => {
    // amount_total and amount_by_area are the S1a modes. A confirmation saved before this
    // slice must resolve to exactly the same mode string, or every stored sheet re-reads wrong.
    expect(validateBcsPicks("amount", ["F"], INDEX)).toMatchObject({ mode: "amount_total" });
    expect(validateBcsPicks("amount", ["G", "H"], INDEX)).toMatchObject({
      mode: "amount_by_area",
    });
  });
});

// ===========================================================================
// Group 3c: the amount REFUSALS that survived, in the SERVER'S precedence
// ===========================================================================
// PRECEDENCE IS LOAD-BEARING. Same rules in a different order give a different complaint
// for the same input, which a user experiences as the screen and the server disagreeing.
// On the amount side KIND is checked BEFORE SHAPE.
describe("amount refusals -- kind before shape, as the server orders them", () => {
  it("refuses a scalar TOTAL picked together with a scalar half", () => {
    // The one piece of the half-refusal that survived: a total ALREADY CONTAINS its halves,
    // so adding one to it counts that half twice.
    for (const half of ["J", "P"]) {
      const v = validateBcsPicks("amount", ["F", half], INDEX);
      expect(v.ok).toBe(false);
      expect(!v.ok && v.message).toMatch(/already includes/i);
    }
  });

  it("refuses a per-area total picked together with a per-area half", () => {
    const v = validateBcsPicks("amount", ["G", "I"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/already includes/i);
  });

  it("refuses a half that poisons an otherwise valid per-area COMBINED selection", () => {
    const v = validateBcsPicks("amount", ["G", "H", "I"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/already includes/i);
  });

  it("checks KIND before SHAPE -- the same input, the server's own answer", () => {
    // ["F","I"] is BOTH kind-mixed (total + supply) and shape-mixed (scalar + per-area).
    // The server checks kind first, so the card must say "already includes", never "one
    // shape". Getting this backwards is invisible until a user reads two different reasons
    // for one pick on two screens.
    const v = validateBcsPicks("amount", ["F", "I"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/already includes/i);
    expect(!v.ok && v.message).not.toMatch(/one shape/i);
  });

  it("refuses a HALF-vs-HALF shape mix, and does NOT blame a total that was never picked", () => {
    // NEWLY REACHABLE at BCS-S2b: before it, every amount pick had to be the combined
    // amount, so a shape mix was necessarily a total beside its own per-area parts. J is the
    // scalar supply half and I is Zone A's supply half -- no total anywhere in the pick, so
    // the old wording ("Adding a total to its own parts") would have sent the user hunting
    // for a total they never chose. Corrected server-side at BCS-S2c and mirrored here.
    const v = validateBcsPicks("amount", ["J", "I"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/one shape/i);
    expect(!v.ok && v.message).not.toMatch(/a total to its own parts/i);
  });

  it("refuses the un-ruled shape -- one kind scalar, the other per-area", () => {
    // J is the scalar SUPPLY half, R is Zone A's INSTALL half. No owner ruling covers this,
    // so it stays refused rather than guessed at. A RULING, not a bug.
    const v = validateBcsPicks("amount", ["J", "R"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/one shape/i);
  });

  it("lets the duplicate-value rule SHADOW every amount rule, exactly as the server does", () => {
    // _resolve_picks runs BEFORE every per-source rule, so a duplicate shadows seven titles.
    const v = validateBcsPicks("amount", ["F", "F"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/twice/i);
    expect(!v.ok && v.message).not.toMatch(/already includes|one shape/i);
  });

  it("no longer claims a sheet has exactly ONE Amount column -- S2b made that false", () => {
    // The old copy read "A sheet has one combined Amount column. Pick one." A scalar sheet
    // legitimately contributes TWO columns now: its supply and its install.
    const v = validateBcsPicks("amount", ["J", "P"], INDEX);
    expect(v.ok).toBe(true);
  });
});

// ===========================================================================
// Group 3d: THE DISCLOSURE -- the owner's safety mechanism
// ===========================================================================
// "Adapt and disclose, never refuse." A one-sided sheet is ACCEPTED, and the software states
// the formula it is actually using. THE SENTENCE IS THE SAFETY: without it, acceptance is the
// failure mode, because a sheet silently measuring % Margin against supply alone looks
// exactly like one measuring it against the whole amount.
describe("the disclosure sentence", () => {
  const EIGHT: Array<[BcsMode, string[]]> = [
    ["amount_total", ["F"]],
    ["amount_supply_plus_install", ["J", "P"]],
    ["amount_supply_only", ["J"]],
    ["amount_install_only", ["P"]],
    ["amount_by_area", ["G", "H"]],
    ["amount_by_area_supply_plus_install", ["I", "S", "R", "T"]],
    ["amount_by_area_supply_only", ["I", "S"]],
    ["amount_by_area_install_only", ["R", "T"]],
  ];

  it.each(EIGHT)("states a formula for %s", (_mode, cols) => {
    const v = validateBcsPicks("amount", cols, INDEX);
    expect(v.ok).toBe(true);
    const summary = v.ok ? v.summary : "";
    expect(summary.length).toBeGreaterThan(20);
    // It must name every column it will read, or the human cannot check it.
    for (const c of cols) expect(summary).toContain(c);
  });

  it("gives all eight DIFFERENT sentences -- one per formula", () => {
    const sentences = EIGHT.map(([, cols]) => {
      const v = validateBcsPicks("amount", cols, INDEX);
      return v.ok ? v.summary : "";
    });
    expect(new Set(sentences).size).toBe(8);
  });

  it("says out loud when a half is being used ALONE, and which half is missing", () => {
    const supply = validateBcsPicks("amount", ["J"], INDEX);
    expect(supply.ok && supply.summary).toMatch(/Supply/);
    expect(supply.ok && supply.summary).toMatch(/Installation is not included/i);

    const install = validateBcsPicks("amount", ["P"], INDEX);
    expect(install.ok && install.summary).toMatch(/Installation/);
    expect(install.ok && install.summary).toMatch(/Supply is not included/i);
  });

  it("does NOT claim anything is missing when both halves are present", () => {
    const v = validateBcsPicks("amount", ["J", "P"], INDEX);
    expect(v.ok && v.summary).not.toMatch(/not included/i);
  });

  it("names % Margin, because that is what the choice actually changes", () => {
    for (const [, cols] of EIGHT) {
      const v = validateBcsPicks("amount", cols, INDEX);
      expect(v.ok && v.summary).toMatch(/% Margin/);
    }
  });

  // ── THE EIGHT SENTENCES, VERBATIM ─────────────────────────────────────────────
  // Pinned word for word ON PURPOSE. This copy is a DELIVERABLE, not decoration: it is the whole
  // of what the owner gets in exchange for the software accepting a one-sided sheet instead of
  // refusing it. A pin makes rewording a deliberate act with a visible diff, and it is the only
  // way a non-technical reader can be shown exactly what the screen will say. If the owner
  // corrects the voice, this is the one place to change.
  it("says exactly these eight sentences", () => {
    const say = (cols: string[]) => {
      const v = validateBcsPicks("amount", cols, INDEX);
      return v.ok ? v.summary : `REFUSED: ${!v.ok ? v.message : ""}`;
    };

    expect(say(["F"])).toBe(
      "% Margin is measured against the combined Amount in column F.",
    );
    expect(say(["J", "P"])).toBe(
      "% Margin is measured against the Supply amount plus the Installation amount " +
        "(columns J and P), added together.",
    );
    expect(say(["J"])).toBe(
      "% Margin is measured against the Supply amount alone (column J). Installation is " +
        "not included.",
    );
    expect(say(["P"])).toBe(
      "% Margin is measured against the Installation amount alone (column P). Supply is " +
        "not included.",
    );
    expect(say(["G", "H"])).toBe(
      "% Margin is measured against the combined Amount in columns G and H, added together.",
    );
    expect(say(["I", "S", "R", "T"])).toBe(
      "% Margin is measured against the Supply and Installation amounts in columns I, S, R " +
        "and T, all added together.",
    );
    expect(say(["I", "S"])).toBe(
      "% Margin is measured against the Supply amounts in columns I and S, added together. " +
        "Installation is not included.",
    );
    expect(say(["R", "T"])).toBe(
      "% Margin is measured against the Installation amounts in columns R and T, added " +
        "together. Supply is not included.",
    );
  });

  // ── THE RULE BEHIND THE PINS: state the formula, never the reason ─────────────
  // The block above pins the WORDS; this pins the RULE that produced them, so the defect
  // BCS-S2d repaired cannot return under different phrasing.
  //
  // WHAT WENT WRONG. Six of the eight opened "This sheet has no combined Amount column, so
  // ...". That clause was derived from what the user PICKED, never from what the sheet MAPS
  // -- and on a sheet carrying Amount (Total) AND both halves, picking the two halves is
  // correctly accepted, whereupon the card denied the Total existed directly beneath a
  // visible, pickable Total chip. The formula half of each sentence was true; the
  // justification half was false, and it failed in the WORST direction: it EXPLAINED AWAY
  // the very one-sidedness the sentence exists to flag. A reader who accepts the excuse
  // stops looking.
  //
  // OWNER RULING 2026-08-02: state what the formula USES and what it EXCLUDES -- never why.
  // A claim about the formula is checkable against the picked columns; a claim about the
  // sheet's other columns is not, and this function is not given them.
  it("never explains WHY -- no sentence makes a claim about the sheet's other columns", () => {
    for (const [mode, cols] of EIGHT) {
      const v = validateBcsPicks("amount", cols, INDEX);
      const s = v.ok ? v.summary : "";
      // The sentence describes the FORMULA, so it never has a subject other than % Margin.
      expect(s, `${mode} narrates the sheet`).not.toMatch(/This sheet/i);
      // "no combined Amount column" is the specific falsehood; it is unknowable from picks.
      expect(s, `${mode} claims a column is absent`).not.toMatch(/no combined Amount/i);
      // A causal ", so ..." is the shape the excuse arrived in.
      expect(s, `${mode} justifies itself`).not.toMatch(/, so /);
    }
  });

  // Dropping the clause must not cost a sentence its OPERANDS -- the risk the rewrite ran.
  // Every sentence still says which kind of amount it reads, so "columns G and H" can never
  // stand alone as an unexplained pair of letters.
  it("still names the KIND of amount being summed, not just the letters", () => {
    const kindWord = /combined Amount|Supply|Installation/;
    for (const [mode, cols] of EIGHT) {
      const v = validateBcsPicks("amount", cols, INDEX);
      expect(v.ok && v.summary, `${mode} names no amount kind`).toMatch(kindWord);
    }
  });
});

// ===========================================================================
// Group 3e: the mode is READ, never RE-DERIVED
// ===========================================================================
// The SERVER decided the mode. A client that recomputes it from the stored column list can
// disagree with the record after any rule change -- and would then disclose a formula that
// is not the one in force, which is the exact failure the disclosure exists to prevent.
describe("reading a STORED confirmation's mode", () => {
  const storedSupplyOnly = {
    mode: "amount_supply_only",
    columns: [
      { col: "J", role: "amount_supply", area: null, value_field: "amount_supply", value_key: null, rate_subkey: null },
    ],
  };

  it("states the formula from the STORED mode, not from the columns", () => {
    const s = bcsStoredSummary(storedSupplyOnly);
    expect(s).toMatch(/Supply/);
    expect(s).toMatch(/Installation is not included/i);
    expect(s).toContain("J");
  });

  it("BELIEVES THE STORED MODE even when the columns would suggest another", () => {
    // The load-bearing case. Here the stored record says amount_total while the column it
    // lists is a supply half -- which is what a server-side rule change looks like from the
    // client's side. The card must report what the record SAYS, because that is what the
    // server will compute from. Re-deriving would quietly invent a second opinion.
    const drifted = { mode: "amount_total", columns: storedSupplyOnly.columns };
    expect(bcsStoredSummary(drifted)).toMatch(/combined Amount/i);
    expect(bcsStoredSummary(drifted)).not.toMatch(/not included/i);
  });

  it("is honest about a mode it does not recognise, never silently blank or wrong", () => {
    const future = { mode: "amount_by_floor_and_phase", columns: storedSupplyOnly.columns };
    const s = bcsStoredSummary(future);
    expect(s).toMatch(/not recognise|does not recognise/i);
    expect(s).toContain("amount_by_floor_and_phase");
  });

  it("says nothing at all when there is no stored confirmation", () => {
    expect(bcsStoredSummary(null)).toBe("");
    expect(bcsStoredSummary(undefined)).toBe("");
  });

  it("reads a stored QUANTITY confirmation through the same one function", () => {
    const qty = {
      mode: "qty_by_area",
      columns: [
        { col: "B", role: "qty", area: "Zone A", value_field: "qty_by_area", value_key: "Zone A", rate_subkey: null },
        { col: "C", role: "qty", area: "Zone B", value_field: "qty_by_area", value_key: "Zone B", rate_subkey: null },
      ],
    };
    const s = bcsStoredSummary(qty);
    expect(s).toMatch(/Total Quantity/);
    expect(s).toContain("B");
    expect(s).toContain("C");
  });
});

// ===========================================================================
// Group 4: the Save gate -- BOTH sides must be valid
// ===========================================================================
describe("the Save gate", () => {
  it("is open only when both sides are valid", () => {
    const good = validateBcsPicks("qty", ["D"], INDEX);
    const bad = validateBcsPicks("amount", [], INDEX);
    const alsoGood = validateBcsPicks("amount", ["F"], INDEX);
    expect(bcsSelectionSaveable(good, alsoGood)).toBe(true);
    expect(bcsSelectionSaveable(good, bad)).toBe(false);
    expect(bcsSelectionSaveable(bad, alsoGood)).toBe(false);
    expect(bcsSelectionSaveable(bad, bad)).toBe(false);
  });
});

// ===========================================================================
// Group 5: the button's disabled reason (greyed with a reason, never hidden)
// ===========================================================================
describe("bcsSetupReason -- why the BCS button is greyed", () => {
  const ready = {
    sheetLoading: false,
    sheetError: false,
    committedVersion: 3,
    viewingHistory: false,
    sheetLocked: false,
    bcsLoading: false,
    bcsError: false,
  };

  it("gives no reason when the sheet is ready for setup", () => {
    expect(bcsSetupReason(ready)).toBeNull();
  });

  it("reports the SHEET loading first", () => {
    expect(bcsSetupReason({ ...ready, sheetLoading: true })).toMatch(/loading/i);
  });

  it("reports a sheet load error", () => {
    expect(bcsSetupReason({ ...ready, sheetError: true })).toBeTruthy();
  });

  it("reports an uncommitted sheet", () => {
    expect(bcsSetupReason({ ...ready, committedVersion: null })).toMatch(/committed/i);
  });

  it("reports history mode -- BCS belongs to the current version", () => {
    expect(bcsSetupReason({ ...ready, viewingHistory: true })).toMatch(/version/i);
  });

  it("reports the deliberate sheet lock, which the server also refuses", () => {
    expect(bcsSetupReason({ ...ready, sheetLocked: true })).toMatch(/lock/i);
  });

  it("prefers the earlier reason when several hold", () => {
    expect(bcsSetupReason({ ...ready, sheetLoading: true, sheetLocked: true })).toMatch(/loading/i);
  });

  // ── BCS-S2a / finding F1: the BCS state fetch has its OWN loading and error ────────
  // Before S2a this function was handed the PRICED fetch's flags twice and never saw the BCS
  // fetch at all, so a failed get_bcs_state returned NO reason -- the button stayed live and
  // rendered OFF on a sheet that was really on and confirmed.

  it("REFUSES setup while the BCS state itself is still loading", () => {
    const r = bcsSetupReason({ ...ready, bcsLoading: true });
    expect(r).toBeTruthy();
    // Must name BCS, so it is distinguishable from the sheet's own "Loading…".
    expect(r).toMatch(/BCS/);
  });

  it("REFUSES setup when the BCS state could not be read (finding F1)", () => {
    const r = bcsSetupReason({ ...ready, bcsError: true });
    expect(r).toBeTruthy();
    expect(r).toMatch(/BCS/);
  });

  it("keeps the BCS-state reasons SEPARATE from the sheet's own load reasons", () => {
    // Same failure on different fetches must not produce the same sentence, or the screen
    // cannot tell the user which thing broke.
    expect(bcsSetupReason({ ...ready, sheetError: true })).not.toEqual(
      bcsSetupReason({ ...ready, bcsError: true }),
    );
    expect(bcsSetupReason({ ...ready, sheetLoading: true })).not.toEqual(
      bcsSetupReason({ ...ready, bcsLoading: true }),
    );
  });

  it("puts the BCS-state reasons LAST -- they only matter once the sheet itself is usable", () => {
    // An uncommitted sheet, an earlier version and a locked sheet are all stable, explanatory
    // reasons; the BCS payload is meaningless in each. Ordering them ahead of it also stops a
    // routine SWR revalidation from flickering the title while the user browses history.
    expect(bcsSetupReason({ ...ready, committedVersion: null, bcsError: true })).toMatch(
      /committed/i,
    );
    expect(bcsSetupReason({ ...ready, viewingHistory: true, bcsError: true })).toMatch(/version/i);
    expect(bcsSetupReason({ ...ready, sheetLocked: true, bcsError: true })).toMatch(/lock/i);
  });

  it("reports the BCS load before the BCS error when both somehow hold", () => {
    expect(bcsSetupReason({ ...ready, bcsLoading: true, bcsError: true })).toEqual(
      bcsSetupReason({ ...ready, bcsLoading: true }),
    );
  });
});

// ===========================================================================
// Group 5b: what the button may honestly CLAIM about BCS being on or off
// ===========================================================================
// Finding F1's other half. The button used to render `bcsEnabled ? solid : outline`, where
// `bcsEnabled` was `payload?.bcs_enabled === 1` -- so "we have no payload" and "BCS is off"
// were the SAME pixel. This three-state exists so they cannot be. S3 hangs its cost cells off
// the same state and must make the same distinction.
describe("bcsToggleState -- on, off, or honestly unknown", () => {
  it("reads a loaded payload", () => {
    expect(bcsToggleState({ fetchFailed: false, enabled: 1 })).toBe("on");
    expect(bcsToggleState({ fetchFailed: false, enabled: 0 })).toBe("off");
  });

  it("is UNKNOWN before any payload has arrived -- never OFF", () => {
    expect(bcsToggleState({ fetchFailed: false, enabled: null })).toBe("unknown");
    expect(bcsToggleState({ fetchFailed: false, enabled: undefined })).toBe("unknown");
  });

  it("is UNKNOWN when the read failed, even though OFF is what S2 showed (finding F1)", () => {
    expect(bcsToggleState({ fetchFailed: true, enabled: null })).toBe("unknown");
  });

  it("does not trust a STALE payload behind a failed read", () => {
    // SWR keeps the last good data when a revalidation fails. That payload may no longer be
    // true, so a failed read means we do not know -- in either direction.
    expect(bcsToggleState({ fetchFailed: true, enabled: 1 })).toBe("unknown");
    expect(bcsToggleState({ fetchFailed: true, enabled: 0 })).toBe("unknown");
  });

  it("never answers OFF unless a successful read actually said so", () => {
    const offs = (
      [
        { fetchFailed: false, enabled: null },
        { fetchFailed: false, enabled: undefined },
        { fetchFailed: true, enabled: null },
        { fetchFailed: true, enabled: 0 },
        { fetchFailed: true, enabled: 1 },
      ] as const
    ).filter((a) => bcsToggleState(a) === "off");
    expect(offs).toEqual([]);
  });
});

// ===========================================================================
// Group 6: reading a stored confirmation back (hydrating the card + the chip)
// ===========================================================================
describe("reading a stored confirmation", () => {
  it("pulls the picked letters out of a stored source", () => {
    expect(
      bcsSourceCols({
        mode: "qty_by_area",
        columns: [
          { col: "B", role: "qty", area: "Zone A", value_field: "qty_by_area", value_key: "Zone A", rate_subkey: null },
          { col: "C", role: "qty", area: "Zone B", value_field: "qty_by_area", value_key: "Zone B", rate_subkey: null },
        ],
      }),
    ).toEqual(["B", "C"]);
  });

  it("reads an absent confirmation as no picks", () => {
    expect(bcsSourceCols(null)).toEqual([]);
    expect(bcsSourceCols(undefined)).toEqual([]);
  });

  it("summarises both confirmations for the chip beside the button", () => {
    const qty = {
      mode: "qty_total",
      columns: [
        { col: "D", role: "qty_total", area: null, value_field: "qty_total", value_key: null, rate_subkey: null },
      ],
    };
    const amount = {
      mode: "amount_by_area",
      columns: [
        { col: "G", role: "amount_total_by_area", area: "Zone A", value_field: "amount_by_area", value_key: "Zone A", rate_subkey: "total" },
        { col: "H", role: "amount_total_by_area", area: "Zone B", value_field: "amount_by_area", value_key: "Zone B", rate_subkey: "total" },
      ],
    };
    const label = bcsChipLabel(qty, amount);
    expect(label).toMatch(/D/);
    expect(label).toMatch(/G/);
    expect(label).toMatch(/H/);
  });

  it("has no chip text until BOTH sides are confirmed", () => {
    const qty = {
      mode: "qty_total",
      columns: [
        { col: "D", role: "qty_total", area: null, value_field: "qty_total", value_key: null, rate_subkey: null },
      ],
    };
    expect(bcsChipLabel(qty, null)).toBe("");
    expect(bcsChipLabel(null, null)).toBe("");
  });
});

// ===========================================================================
// Group 8 (BCS-S3a): COST ENTRY -- which boxes exist, what a save carries,
// and what the Total Amount reads
// ===========================================================================
//
// S1-S2d built storage, rules, a toggle and a confirmation card. Nothing was usable. These
// tests cover the four pure decisions that make it usable, and the FIRST of them is the one
// that would have shipped a silent data-loss bug: `save_row_bcs_rates` is a WHOLE-ROW
// snapshot write (bcs.py:444-536) that writes 0.0 for any rate it is not given, so wiring
// three boxes the way a client rate cell is wired -- one independent debounced save per box --
// would zero the siblings on every keystroke.

describe("bcsLiveRateKinds -- which cost boxes a sheet gets", () => {
  const rateCol = (col: string, role: string, value_field: string) =>
    scalar(col, role, value_field);
  // ⚠️ THE SUBKEY IS THE RATE VOCABULARY (`supply_rate` / `install_rate` / `combined_rate`),
  // and the ROLE is derived from it rather than the other way round. This helper used to take
  // the AMOUNT spelling and build `rate_${subkey}_by_area` from it, which produced the
  // never-real role `rate_total_by_area` and a subkey no per-area rate column carries -- the
  // fixture agreed with the bug it was supposed to catch. See the correction note on
  // PER_AREA_SUBKEY_TO_BCS_KIND.
  const AREA_ROLE: Record<string, string> = {
    supply_rate: "rate_supply_by_area",
    install_rate: "rate_install_by_area",
    combined_rate: "rate_combined_by_area",
  };
  const rateArea = (col: string, area: string, subkey: string) => ({
    col,
    role: AREA_ROLE[subkey] ?? `rate_${subkey}_by_area`,
    area,
    value_field: "rate_by_area",
    value_key: area,
    rate_subkey: subkey,
  });

  it("gives a split sheet a Supply box and an Install box", () => {
    expect(
      bcsLiveRateKinds([
        rateCol("E", "rate_supply", "rate_supply"),
        rateCol("F", "rate_install", "rate_install"),
      ]),
    ).toEqual(["supply", "install"]);
  });

  it("gives a sheet with no Rate (Supply) column no Supply box", () => {
    expect(bcsLiveRateKinds([rateCol("F", "rate_install", "rate_install")])).toEqual(["install"]);
  });

  it("gives a combined-rate sheet ONE undifferentiated box", () => {
    expect(bcsLiveRateKinds([rateCol("E", "rate_combined", "rate_combined")])).toEqual([
      "combined",
    ]);
  });

  it("reads the per-area rate columns through rate_subkey, not just the scalar fields", () => {
    expect(
      bcsLiveRateKinds([
        rateArea("E", "Zone A", "supply_rate"),
        rateArea("F", "Zone A", "install_rate"),
      ]),
    ).toEqual(["supply", "install"]);
    // The per-area COMBINED subkey is `combined_rate` -- classifier._RATE_ROLE_TO_KIND, the
    // module that WRITES this slot. `total` is the per-area AMOUNT's combined spelling.
    expect(bcsLiveRateKinds([rateArea("E", "Zone A", "combined_rate")])).toEqual(["combined"]);
  });

  it("mints NO box from the AMOUNT vocabulary sharing the same rate_subkey slot", () => {
    // ★ THE REGRESSION CASE. A per-area AMOUNT descriptor legitimately carries rate_subkey
    // "supply"; reading it as a rate is what the old map effectively did in reverse, and it
    // cost every per-area-rate sheet its cost boxes.
    expect(
      bcsLiveRateKinds([
        {
          col: "Q",
          role: "amount_supply_by_area",
          area: "Zone A",
          value_field: "amount_by_area",
          value_key: "Zone A",
          rate_subkey: "supply",
        },
      ]),
    ).toEqual([]);
  });

  it("does not mint a box from an amount or a quantity column", () => {
    expect(bcsLiveRateKinds(SHEET.filter((d) => d.value_field !== "rate_combined"))).toEqual([]);
  });

  it("gives a sheet with no rate column at all NO cost boxes -- BCS cannot be done there", () => {
    expect(bcsLiveRateKinds([scalar("D", "qty_total", "qty_total")])).toEqual([]);
  });

  it("THE HALVES WIN on a sheet that maps a combined rate BESIDE them", () => {
    // MEASURED, not hypothetical: 22 of 553 current committed sheets carry all three rate
    // kinds (Supply | Install | Total Rate is an ordinary BoQ layout). bcs.py:16 forbids
    // summing combined_rate with the two halves, so the live set must never contain both --
    // and the halves carry strictly more information than the total that contains them,
    // exactly as the AMOUNT side rules a total-beside-its-half a double count.
    expect(
      bcsLiveRateKinds([
        rateCol("E", "rate_supply", "rate_supply"),
        rateCol("F", "rate_install", "rate_install"),
        rateCol("G", "rate_combined", "rate_combined"),
      ]),
    ).toEqual(["supply", "install"]);
  });

  it("never returns a set that mixes combined with a half, whatever the column order", () => {
    for (const order of [
      ["rate_combined", "rate_supply"],
      ["rate_supply", "rate_combined"],
      ["rate_combined", "rate_install"],
    ]) {
      const kinds = bcsLiveRateKinds(
        order.map((vf, i) => rateCol(String.fromCharCode(69 + i), vf, vf)),
      );
      expect(kinds.includes("combined") && kinds.length > 1).toBe(false);
    }
  });

  it("orders the boxes canonically (supply, install) regardless of Excel column order", () => {
    expect(
      bcsLiveRateKinds([
        rateCol("F", "rate_install", "rate_install"),
        rateCol("E", "rate_supply", "rate_supply"),
      ]),
    ).toEqual(["supply", "install"]);
  });
});

describe("mergeBcsRowValues + gatherBcsRowRates -- THE WHOLE-ROW GATHER", () => {
  // save_row_bcs_rates takes supply/install/combined TOGETHER and coerces every absent one
  // to 0.0 (bcs.py `_num`, pinned by test_bcs.py:1013-1024). So every save must carry the
  // row's CURRENT draft-or-saved value for ALL THREE, not just the box that changed.

  it("carries the untouched siblings' SAVED values when one box is edited", () => {
    const saved = { supply_rate: 100, install_rate: 40, combined_rate: 0 };
    const merged = mergeBcsRowValues(saved, new Map([["supply_rate", "150"]]));
    expect(gatherBcsRowRates(merged)).toEqual({
      supply_rate: 150,
      install_rate: 40, // <- would have been 0.0 under a per-cell save
      combined_rate: 0,
    });
  });

  it("prefers a live draft over the saved value, per field", () => {
    const saved = { supply_rate: 100, install_rate: 40, combined_rate: 0 };
    const merged = mergeBcsRowValues(saved, new Map([["supply_rate", "150"], ["install_rate", "55"]]));
    expect(gatherBcsRowRates(merged)).toEqual({
      supply_rate: 150,
      install_rate: 55,
      combined_rate: 0,
    });
  });

  it("PRESERVES a stored value for a field this sheet no longer offers a box for", () => {
    // bcs.py:455 -- "a sheet that changes shape must never strand a number it already holds,
    // and a write that silently blanked the other field would do exactly that."
    const saved = { supply_rate: 0, install_rate: 0, combined_rate: 77 };
    const merged = mergeBcsRowValues(saved, new Map([["supply_rate", "12"]]));
    expect(gatherBcsRowRates(merged).combined_rate).toBe(77);
  });

  it("treats a CLEARED box as 0, not as absent", () => {
    const saved = { supply_rate: 100, install_rate: 40, combined_rate: 0 };
    const merged = mergeBcsRowValues(saved, new Map([["supply_rate", ""]]));
    expect(gatherBcsRowRates(merged).supply_rate).toBe(0);
    expect(gatherBcsRowRates(merged).install_rate).toBe(40);
  });

  it("starts a never-costed row at all-absent, and a first edit still sends all three", () => {
    expect(mergeBcsRowValues(undefined, new Map())).toEqual({
      supply_rate: null,
      install_rate: null,
      combined_rate: null,
    });
    expect(gatherBcsRowRates(mergeBcsRowValues(undefined, new Map([["supply_rate", "9"]])))).toEqual({
      supply_rate: 9,
      install_rate: 0,
      combined_rate: 0,
    });
  });

  it("coerces a partial decimal to 0 rather than NaN (mirrors commitRate)", () => {
    const merged = mergeBcsRowValues(undefined, new Map([["supply_rate", "-"], ["install_rate", "."]]));
    expect(gatherBcsRowRates(merged)).toEqual({
      supply_rate: 0,
      install_rate: 0,
      combined_rate: 0,
    });
  });

  it("reads a null stored field as 0, never as absent", () => {
    const merged = mergeBcsRowValues(
      { supply_rate: null, install_rate: 40, combined_rate: null },
      new Map(),
    );
    expect(merged.supply_rate).toBe("0");
    expect(gatherBcsRowRates(merged).supply_rate).toBe(0);
  });
});

describe("bcsUnitCost + bcsRowQuantity + bcsTotalAmount -- what Total Amount reads", () => {
  it("sums only the LIVE kinds", () => {
    const merged = mergeBcsRowValues(
      { supply_rate: 100, install_rate: 40, combined_rate: 999 },
      new Map(),
    );
    expect(bcsUnitCost(merged, ["supply", "install"])).toBe(140);
    expect(bcsUnitCost(merged, ["combined"])).toBe(999);
  });

  it("is BLANK, not 0, when nothing has been entered for any live kind", () => {
    expect(bcsUnitCost(mergeBcsRowValues(undefined, new Map()), ["supply", "install"])).toBeNull();
  });

  it("is 0 -- not blank -- once a row is genuinely costed at zero", () => {
    const merged = mergeBcsRowValues({ supply_rate: 0, install_rate: 0, combined_rate: 0 }, new Map());
    expect(bcsUnitCost(merged, ["supply", "install"])).toBe(0);
  });

  it("adds up the confirmed quantity columns, whatever the mode", () => {
    const source = {
      mode: "qty_by_area",
      columns: [
        { col: "B", role: "qty", area: "Zone A", value_field: "qty_by_area", value_key: "Zone A", rate_subkey: null },
        { col: "C", role: "qty", area: "Zone B", value_field: "qty_by_area", value_key: "Zone B", rate_subkey: null },
      ],
    };
    const vals: Record<string, unknown> = { B: 10, C: 5 };
    expect(bcsRowQuantity(source, (e) => vals[e.col])).toBe(15);
  });

  it("treats one absent per-area quantity as 0, but a row with NO quantity at all as blank", () => {
    const source = {
      mode: "qty_by_area",
      columns: [
        { col: "B", role: "qty", area: "Zone A", value_field: "qty_by_area", value_key: "Zone A", rate_subkey: null },
        { col: "C", role: "qty", area: "Zone B", value_field: "qty_by_area", value_key: "Zone B", rate_subkey: null },
      ],
    };
    expect(bcsRowQuantity(source, (e) => (e.col === "B" ? 10 : undefined))).toBe(10);
    expect(bcsRowQuantity(source, () => undefined)).toBeNull();
  });

  it("is blank with no confirmation at all -- never 0", () => {
    expect(bcsRowQuantity(null, () => 5)).toBeNull();
    expect(bcsRowQuantity({ mode: "qty_total", columns: [] }, () => 5)).toBeNull();
  });

  it("multiplies quantity by the per-unit cost, and stays blank if either side is blank", () => {
    expect(bcsTotalAmount(10, 140)).toBe(1400);
    expect(bcsTotalAmount(null, 140)).toBeNull();
    expect(bcsTotalAmount(10, null)).toBeNull();
    expect(bcsTotalAmount(10, 0)).toBe(0);
  });
});

describe("bcsCostEntryReason -- the parallel gate, in save_row_bcs_rates' OWN order", () => {
  // DELIBERATELY NOT the rate gate: save_row_bcs_rates runs FOUR gates (committed cell ->
  // sheet not locked -> BCS ready -> single-editor lock) and SKIPS the formula, priceability
  // and category gates on purpose (bcs.py:41-59). Reusing rateWritableAt here would silently
  // re-impose all three.
  const ok = {
    sheetLoading: false,
    sheetError: false,
    committedVersion: 3,
    viewingHistory: false,
    sheetLocked: false,
    editorLocked: false,
    bcsToggle: "on" as const,
    bcsReady: true,
  };

  it("permits cost entry when every BCS gate is clear", () => {
    expect(bcsCostEntryReason(ok)).toBeNull();
  });

  it("refuses on an uncommitted sheet, an earlier version, and a locked sheet", () => {
    expect(bcsCostEntryReason({ ...ok, committedVersion: null })).toMatch(/not committed/i);
    expect(bcsCostEntryReason({ ...ok, viewingHistory: true })).toMatch(/earlier version/i);
    expect(bcsCostEntryReason({ ...ok, sheetLocked: true })).toMatch(/locked/i);
  });

  it("refuses while BCS is off, unconfirmed, or unreadable -- and says which", () => {
    expect(bcsCostEntryReason({ ...ok, bcsToggle: "off" })).toMatch(/off/i);
    expect(bcsCostEntryReason({ ...ok, bcsReady: false })).toMatch(/confirm/i);
    expect(bcsCostEntryReason({ ...ok, bcsToggle: "unknown" })).toMatch(/could not be read/i);
  });

  it("puts the single-editor lock LAST, exactly where bcs.py runs it", () => {
    // A sheet that is BOTH unconfirmed and held by another editor must name the
    // confirmation -- that is the gate the server hits first, and the one the user can act on.
    expect(bcsCostEntryReason({ ...ok, bcsReady: false, editorLocked: true })).toMatch(/confirm/i);
    expect(bcsCostEntryReason({ ...ok, editorLocked: true })).toMatch(/editing/i);
  });

  it("does NOT consult the formula, priceability or category gates", () => {
    // The negative that keeps the asymmetry honest: nothing in the argument shape can express
    // them, so a future 'restore consistency with save_cell_price' edit fails to compile.
    expect(Object.keys(ok)).not.toContain("formulasComplete");
    expect(Object.keys(ok)).not.toContain("categoryGateOpen");
  });
});

describe("the BCS column block -- keys and geometry", () => {
  it("adds the computed tail after the cost boxes", () => {
    // SUPERSEDED TWICE. BCS-S3a asserted ONE trailing computed column ("bcs:total"); BCS-S3b
    // made it THREE by adding the amount charged and the margin. BCS-S8 (owner ruling
    // 2026-08-07) removed "bcs:tendered" again, so the tail is Total then % Margin. The amount
    // charged is still COMPUTED -- it is the margin's divisor -- it just has no column.
    expect(bcsColumnKeys(["supply", "install"])).toEqual([
      "bcs:supply",
      "bcs:install",
      "bcs:total",
      "bcs:margin",
    ]);
    expect(bcsColumnKeys(["combined"])).toEqual([
      "bcs:combined",
      "bcs:total",
      "bcs:margin",
    ]);
  });

  it("renders NO block at all -- not even a Total -- when the sheet has no cost box", () => {
    expect(bcsColumnKeys([])).toEqual([]);
  });

  it("places each column by its offset from the block start, and nothing outside it", () => {
    // SUPERSEDED AT BCS-S3b: offset 13 was the end of the block and is now Tendered. The
    // widened bound lives in `bcsColumnAt` and is re-pinned below in the S3b geometry group.
    const kinds = ["supply", "install"] as const;
    expect(bcsColumnAt(9, 10, kinds)).toBeNull();
    expect(bcsColumnAt(10, 10, kinds)).toBe("supply");
    expect(bcsColumnAt(11, 10, kinds)).toBe("install");
    expect(bcsColumnAt(12, 10, kinds)).toBe("total");
    expect(bcsColumnAt(15, 10, kinds)).toBeNull();
  });

  it("places nothing anywhere when the block is empty", () => {
    expect(bcsColumnAt(10, 10, [])).toBeNull();
  });

  it("names each box for the rate column it costs against", () => {
    expect(BCS_RATE_LABEL.supply).toMatch(/supply/i);
    expect(BCS_RATE_LABEL.install).toMatch(/install/i);
    expect(BCS_RATE_FIELD.supply).toBe("supply_rate");
    expect(BCS_RATE_FIELD.install).toBe("install_rate");
    expect(BCS_RATE_FIELD.combined).toBe("combined_rate");
  });

  // BCS-S7: the OWNER dictated these two strings verbatim ("BCS Cost (Supply)" /
  // "BCS Cost (Installation)", 2026-08-03). The expected values come from that ruling, not from
  // re-reading the module -- which is what makes this a pin rather than a tautology. The regex
  // test above still stands and is the one that would survive a future re-wording; this one
  // exists so a re-wording has to be a DECISION, taken against a named ruling, rather than a
  // tidy-up nobody notices.
  //
  // `combined` WAS deliberately unpinned here -- the owner had named only two of the three
  // boxes, so pinning a third string he never said would have laundered a guess into an
  // assertion. He ruled on it on 2026-08-07 ("BCS Cost"), so it joins the other two: all three
  // are now pinned against a named ruling rather than against the module's current contents.
  it("carries the owner's BCS-prefixed box names verbatim (BCS-S7, completed 2026-08-07)", () => {
    expect(BCS_RATE_LABEL.supply).toBe("BCS Cost (Supply)");
    expect(BCS_RATE_LABEL.install).toBe("BCS Cost (Installation)");
    expect(BCS_RATE_LABEL.combined).toBe("BCS Cost");
  });

  it("every cost box carries the BCS prefix -- that is what the prefix is FOR", () => {
    // The prefix marks which side of the sheet a figure belongs to, which matters because on a
    // wide sheet the internal and client-facing blocks scroll apart. One unprefixed box defeated
    // that on every combined-rate sheet.
    for (const label of Object.values(BCS_RATE_LABEL)) {
      expect(label.startsWith("BCS ")).toBe(true);
    }
  });
});

// ── BCS-S3a-fix: the two invariants S3a ASSERTED IN PROSE and enforced nowhere ──
//
// Neither of these can be shown RED without first introducing the defect it guards, so each was
// proven FALSIFIABLE instead (see the slice record): the field list was temporarily grown to
// four, and the live-kinds sweep was temporarily fed a producer that returns a mixed set.
describe("the invariants BCS-S3a claimed but did not enforce", () => {
  it("gatherBcsRowRates covers EVERY BCS_RATE_FIELDS key -- a fourth rate cannot be dropped", () => {
    // S3a's comment claimed this function "iterates BCS_RATE_FIELDS". It does not -- it names the
    // three fields. That is the right shape (BcsRowRates requires exactly these three, so a fourth
    // PAYLOAD field breaks the literal at compile time), but it leaves the other direction open: a
    // fourth field in BCS_RATE_FIELDS that mergeBcsRowValues produces would be dropped in silence.
    const merged = Object.fromEntries(BCS_RATE_FIELDS.map((f) => [f, "1"])) as Record<
      (typeof BCS_RATE_FIELDS)[number],
      string | null
    >;
    expect(Object.keys(gatherBcsRowRates(merged)).sort()).toEqual([...BCS_RATE_FIELDS].sort());
  });

  it("bcsLiveRateKinds NEVER returns a mixed set -- swept over EVERY rate-column combination", () => {
    // bcsUnitCost's signature does NOT forbid summing `combined` with the halves (it takes any
    // readonly BcsRateKind[]). The prohibition in bcs.py:16 rests entirely on this ONE producer,
    // so the producer is what gets swept -- all 2^6 subsets of the rate vocabulary.
    const all: ColumnDescriptor[] = [
      { col: "A", role: "r", area: null, value_field: "rate_supply", value_key: null, rate_subkey: null },
      { col: "B", role: "r", area: null, value_field: "rate_install", value_key: null, rate_subkey: null },
      { col: "C", role: "r", area: null, value_field: "rate_combined", value_key: null, rate_subkey: null },
      { col: "D", role: "r", area: null, value_field: "rate_by_area", value_key: null, rate_subkey: "supply_rate" },
      { col: "E", role: "r", area: null, value_field: "rate_by_area", value_key: null, rate_subkey: "install_rate" },
      { col: "F", role: "r", area: null, value_field: "rate_by_area", value_key: null, rate_subkey: "combined_rate" },
    ];
    let sawHalves = false;
    let sawCombined = false;
    for (let mask = 0; mask < 1 << all.length; mask++) {
      const picked = all.filter((_, i) => mask & (1 << i));
      const kinds = bcsLiveRateKinds(picked);
      const hasHalf = kinds.includes("supply") || kinds.includes("install");
      const hasCombined = kinds.includes("combined");
      expect(hasHalf && hasCombined).toBe(false); // THE INVARIANT
      expect(new Set(kinds).size).toBe(kinds.length); // and never a duplicate box
      if (hasHalf) sawHalves = true;
      if (hasCombined) sawCombined = true;
    }
    // Anti-vacuity: the sweep really did exercise both arms of the one branch.
    expect(sawHalves).toBe(true);
    expect(sawCombined).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BCS-S3b -- THE TENDERED AMOUNT AND THE MARGIN
// ═══════════════════════════════════════════════════════════════════════════════

describe("isBcsInputColumn -- the ONE 'may this column be typed in?' decision", () => {
  // THE TRAP THIS CLOSES. Before S3b, seven call sites asked `b !== "total"` to mean "this is a
  // cost box". A SECOND computed column does not match that literal, so it would fall through to
  // the editable branch and become a paste target -- silently, with no type error, on a column
  // whose whole nature is that it is computed. One guard, seven callers, and the question is now
  // answered by MEMBERSHIP in the computed set rather than by a string comparison.

  it("says yes to every cost box", () => {
    expect(isBcsInputColumn("supply")).toBe(true);
    expect(isBcsInputColumn("install")).toBe(true);
    expect(isBcsInputColumn("combined")).toBe(true);
  });

  it("says no to EVERY computed column -- swept, so a future one cannot slip through", () => {
    // The sweep is the point. A new computed kind added to BCS_COMPUTED_KINDS is excluded by
    // construction; a new kind added ONLY at a render site would fail this test.
    for (const k of BCS_COMPUTED_KINDS) expect(isBcsInputColumn(k)).toBe(false);
    expect(BCS_COMPUTED_KINDS).toContain("total");
    expect(BCS_COMPUTED_KINDS).toContain("margin");
    // BCS-S8: "tendered" is no longer a COLUMN, so it is no longer a computed kind. Kept as a
    // negative rather than deleted -- re-adding it here would put the column back in the block,
    // which is exactly what the owner ruling removed.
    expect(BCS_COMPUTED_KINDS).not.toContain("tendered");
    // ⚠️ NOTE THE DIRECTION OF THE HAZARD, because REMOVING a kind is the dangerous way round.
    // `isBcsInputColumn` answers "not one of the computed kinds", so a token dropped from this
    // list becomes TYPEABLE rather than inert. "tendered" is safe only because it also left the
    // `BcsComputedKind` union in the same edit, so no caller can produce it and `bcsColumnAt`
    // can never return it -- the TYPE, not this function, is what closes the hole. Anything
    // removed from BCS_COMPUTED_KINDS in future must leave the union too. (The block's offsets
    // are pinned in "the BCS block's geometry with the computed columns".)
  });

  it("says no outside the block entirely (bcsColumnAt's null)", () => {
    expect(isBcsInputColumn(null)).toBe(false);
    expect(isBcsInputColumn(undefined)).toBe(false);
  });

  it("agrees with bcsColumnAt across the WHOLE block, offset by offset", () => {
    const kinds = ["supply", "install"] as const;
    const start = 10;
    const inputOffsets: number[] = [];
    for (let c = start - 1; c <= start + 6; c++) {
      if (isBcsInputColumn(bcsColumnAt(c, start, kinds))) inputOffsets.push(c - start);
    }
    // EXACTLY the two cost boxes -- never a computed column, never outside the block.
    expect(inputOffsets).toEqual([0, 1]);
  });
});

describe("the BCS block's geometry with the computed columns", () => {
  it("appends the computed columns after the cost boxes, in render order", () => {
    // BCS-S8: two, not three -- "bcs:tendered" was removed by owner ruling 2026-08-07.
    expect(bcsColumnKeys(["supply", "install"])).toEqual([
      "bcs:supply",
      "bcs:install",
      "bcs:total",
      "bcs:margin",
    ]);
  });

  it("KEEPS the empty-block property -- no cost box, no computed columns either", () => {
    // Load-bearing: this is what makes every colIndex on a non-BCS sheet byte-identical to
    // pre-S3a. A % Margin column on a sheet with no cost box would have no numerator anyway.
    expect(bcsColumnKeys([])).toEqual([]);
    expect(bcsColumnAt(10, 10, [])).toBeNull();
  });

  it("places Total and % Margin at the two offsets after the boxes", () => {
    // BCS-S8: Tendered used to sit between them, at offset 13. The margin MOVED LEFT by one,
    // which is the half of this removal that could silently mis-target a keystroke -- the grid
    // renders the margin at `bcsColStart + kinds.length + 1` and this is what pins the two in
    // step. Offset 14 is now outside the block entirely.
    const kinds = ["supply", "install"] as const;
    expect(bcsColumnAt(10, 10, kinds)).toBe("supply");
    expect(bcsColumnAt(11, 10, kinds)).toBe("install");
    expect(bcsColumnAt(12, 10, kinds)).toBe("total");
    expect(bcsColumnAt(13, 10, kinds)).toBe("margin");
    expect(bcsColumnAt(14, 10, kinds)).toBeNull();
  });

  it("stops at the end of the block, and before its start", () => {
    const kinds = ["combined"] as const;
    expect(bcsColumnAt(9, 10, kinds)).toBeNull();
    expect(bcsColumnAt(10, 10, kinds)).toBe("combined");
    expect(bcsColumnAt(11, 10, kinds)).toBe("total");
    expect(bcsColumnAt(12, 10, kinds)).toBe("margin");
    expect(bcsColumnAt(13, 10, kinds)).toBeNull();
  });

  it("keeps the key list and the placement in step -- one length, never two", () => {
    for (const kinds of [["combined"], ["supply", "install"]] as const) {
      const keys = bcsColumnKeys(kinds);
      expect(keys.length).toBe(kinds.length + BCS_COMPUTED_KINDS.length);
      expect(bcsColumnAt(100 + keys.length - 1, 100, kinds)).not.toBeNull();
      expect(bcsColumnAt(100 + keys.length, 100, kinds)).toBeNull();
    }
  });
});

describe("bcsRowAmount -- THE DENOMINATOR, summed across the confirmed Amount columns", () => {
  // Nothing in the editor summed across a confirmed column set before this: evaluateAmountCell
  // is per-column at all five of its call sites. This mirrors `bcsRowQuantity` exactly -- same
  // caller-supplied resolver (so the module stays a type-only pure leaf), same absent-vs-blank
  // contract -- because the two sides of the confirmation are the same shape of question.
  const AMOUNT_SOURCE = {
    mode: "amount_by_area_supply_plus_install",
    columns: [
      { col: "I", role: "amount_supply_by_area", area: "Zone A", value_field: "amount_by_area", value_key: "Zone A", rate_subkey: "supply" },
      { col: "R", role: "amount_install_by_area", area: "Zone A", value_field: "amount_by_area", value_key: "Zone A", rate_subkey: "install" },
    ],
  };

  it("adds up the confirmed amount columns, whatever the mode", () => {
    const shown: Record<string, number | null> = { I: 1200, R: 300 };
    expect(bcsRowAmount(AMOUNT_SOURCE, (e) => shown[e.col])).toBe(1500);
  });

  it("treats ONE unresolved amount column as 0, so a half-priced row still reports a figure", () => {
    expect(bcsRowAmount(AMOUNT_SOURCE, (e) => (e.col === "I" ? 1200 : null))).toBe(1200);
  });

  it("is BLANK, never 0, when NOTHING resolves -- a 0 denominator is a claim, not an absence", () => {
    expect(bcsRowAmount(AMOUNT_SOURCE, () => null)).toBeNull();
  });

  it("is blank with no confirmation at all", () => {
    expect(bcsRowAmount(null, () => 5)).toBeNull();
    expect(bcsRowAmount(undefined, () => 5)).toBeNull();
    expect(bcsRowAmount({ mode: "amount_total", columns: [] }, () => 5)).toBeNull();
  });

  it("keeps a genuine 0 on one column distinct from an unresolved one", () => {
    // A column that really reads 0 CONTRIBUTES 0 and makes the row non-blank; an unresolved one
    // contributes 0 and does NOT. The difference decides whether % Margin renders at all.
    expect(bcsRowAmount(AMOUNT_SOURCE, () => 0)).toBe(0);
    expect(bcsRowAmount(AMOUNT_SOURCE, () => null)).toBeNull();
  });

  it("ignores a non-finite reading rather than poisoning the sum", () => {
    expect(bcsRowAmount(AMOUNT_SOURCE, (e) => (e.col === "I" ? NaN : 300))).toBe(300);
  });
});

describe("the three computed cells -- blank ALWAYS carries a reason", () => {
  it("Total Amount: a value, or WHICH of the two absences produced the blank", () => {
    expect(bcsTotalAmountCell(10, 140)).toEqual({ kind: "value", value: 1400 });
    expect(bcsTotalAmountCell(null, 140)).toEqual({ kind: "blank", reason: "no_quantity" });
    expect(bcsTotalAmountCell(10, null)).toEqual({ kind: "blank", reason: "no_cost" });
    // A genuinely zero-costed row is a VALUE, not an absence (the S3a distinction, preserved).
    expect(bcsTotalAmountCell(10, 0)).toEqual({ kind: "value", value: 0 });
  });

  it("Tendered Total Amount: a value, or the one absence it can have", () => {
    expect(bcsTenderedAmountCell(1500)).toEqual({ kind: "value", value: 1500 });
    expect(bcsTenderedAmountCell(null)).toEqual({ kind: "blank", reason: "no_amount" });
    expect(bcsTenderedAmountCell(0)).toEqual({ kind: "value", value: 0 });
  });

  it("keeps the S3a bare multiply intact beside the new cell shape", () => {
    // bcsTotalAmount is unchanged and still the arithmetic; the cell wraps it with the reason.
    expect(bcsTotalAmount(10, 140)).toBe(1400);
  });

  it("blanks a Total Amount that leaves the double range (BCS-S2e)", () => {
    // S3b invented `not_finite` for exactly this and then guarded only the margin with it, so
    // a product that overflows rendered as the string "Infinity" in a cost cell. Same argument
    // as the margin's: an Infinity displayed is not an answer, and an Infinity compared with
    // === is at least stable, unlike the NaN case -- but neither belongs on a cost screen.
    expect(bcsTotalAmountCell(1e308, 1e308)).toEqual({ kind: "blank", reason: "not_finite" });
    expect(bcsTotalAmountCell(-1e308, 1e308)).toEqual({ kind: "blank", reason: "not_finite" });
  });

  it("leaves every ordinary Total Amount exactly as it was", () => {
    // The finiteness guard must cost the normal path nothing -- including a legitimate 0.
    expect(bcsTotalAmountCell(10, 140)).toEqual({ kind: "value", value: 1400 });
    expect(bcsTotalAmountCell(0, 140)).toEqual({ kind: "value", value: 0 });
    expect(bcsTotalAmountCell(10, 0)).toEqual({ kind: "value", value: 0 });
    expect(bcsTotalAmountCell(2.5, -40)).toEqual({ kind: "value", value: -100 });
  });
});

describe("bcsMarginPercent -- (amount - cost) / amount, and the direction is SETTLED", () => {
  const cell = (value: number) => ({ kind: "value" as const, value });

  it("reports the margin a pricer would work out by hand", () => {
    // 1000 charged, 800 spent -> 200 profit on 1000 charged -> 20%. The expected value comes
    // from the worked example, not from re-running the formula.
    expect(bcsMarginPercent(cell(800), cell(1000))).toEqual({ kind: "value", value: 20 });
  });

  it("reads LOWER on a one-sided amount, and goes sharply NEGATIVE below the cost", () => {
    // ⚠️ THE DIRECTION IS OWNER-SETTLED and was relayed BACKWARDS once (at S2d), so it is pinned
    // here rather than left to the arithmetic. A sheet whose confirmation covers only the supply
    // half puts a SMALLER number in the denominator AND in the numerator; the margin falls, and
    // once the amount drops under the cost it goes hard negative. That visible collapse is the
    // safety the disclosure sentence promises -- it must never quietly read higher instead.
    const whole = bcsMarginPercent(cell(800), cell(1000));
    const oneSided = bcsMarginPercent(cell(800), cell(600));
    expect(whole).toEqual({ kind: "value", value: 20 });
    expect(oneSided.kind).toBe("value");
    if (oneSided.kind === "value" && whole.kind === "value") {
      expect(oneSided.value).toBeLessThan(whole.value);
      expect(oneSided.value).toBeLessThan(0);
      expect(oneSided.value).toBeCloseTo(-33.33, 2); // -200 on 600 charged
    }
  });

  it("a zero amount is a BLANK with its own reason -- never Infinity, never NaN", () => {
    // The memo compares this cell's value with ===, and NaN !== NaN, so a NaN here would
    // re-render that row forever. It is also simply not a percentage.
    expect(bcsMarginPercent(cell(800), cell(0))).toEqual({
      kind: "blank",
      reason: "zero_amount",
    });
  });

  it("carries the COST side's reason through, so the user learns what is actually missing", () => {
    expect(bcsMarginPercent({ kind: "blank", reason: "no_quantity" }, cell(1000))).toEqual({
      kind: "blank",
      reason: "no_quantity",
    });
    expect(bcsMarginPercent({ kind: "blank", reason: "no_cost" }, cell(1000))).toEqual({
      kind: "blank",
      reason: "no_cost",
    });
  });

  it("names the missing AMOUNT when that is the side that is absent", () => {
    expect(bcsMarginPercent(cell(800), { kind: "blank", reason: "no_amount" })).toEqual({
      kind: "blank",
      reason: "no_amount",
    });
  });

  it("puts the COST reason first when BOTH sides are blank", () => {
    // An uncosted row is the ordinary case on a fresh sheet; naming the amount there would send
    // the user to the sheet's Amount mapping when all they have to do is type a cost.
    expect(
      bcsMarginPercent({ kind: "blank", reason: "no_cost" }, { kind: "blank", reason: "no_amount" }),
    ).toEqual({ kind: "blank", reason: "no_cost" });
  });

  it("NEVER yields NaN or Infinity, swept over the awkward numbers", () => {
    const nasty = [0, -0, 1e-320, -1e-320, 1e308, -1e308, 0.1, -7.5];
    for (const c of nasty) {
      for (const a of nasty) {
        const out = bcsMarginPercent(cell(c), cell(a));
        if (out.kind === "value") {
          expect(Number.isFinite(out.value)).toBe(true);
        }
      }
    }
  });

  it("is 0% exactly when the amount equals the cost", () => {
    expect(bcsMarginPercent(cell(1234.5), cell(1234.5))).toEqual({ kind: "value", value: 0 });
  });

  // ── BCS-S2e: THE NEGATIVE-AMOUNT GUARD ────────────────────────────────────────
  it("★ a NEGATIVE amount is a blank with its own reason -- a loss must NEVER read as a profit", () => {
    // THE DEFECT THIS CLOSES (found in the BCS-S3b review). The guards were `=== 0` and
    // `!isFinite`; nothing looked at the SIGN. Amount -100 against cost 50:
    //   (-100 - 50) / -100 * 100 = +150%
    // -- a loss-making row displaying POSITIVE profit, the exact inverse of the property this
    // column exists to show. The expected value here comes from working the arithmetic by
    // hand, not from re-running the function.
    expect(bcsMarginPercent(cell(50), cell(-100))).toEqual({
      kind: "blank",
      reason: "negative_amount",
    });
  });

  it("blanks a negative amount rather than BLOCKING the entry (planner ruling 2026-08-03)", () => {
    // ADAPT AND DISCLOSE, the same ruling that governs a one-sided amount confirmation: the
    // margin goes blank WITH A REASON instead of refusing the number, which is safe whether or
    // not a negative amount is legitimate in this owner's BoQs. The COST side is untouched --
    // a negative cost against a positive amount still computes, and reads as a margin over
    // 100%, which is arithmetically what it is.
    const negCost = bcsMarginPercent(cell(-50), cell(100));
    expect(negCost).toEqual({ kind: "value", value: 150 });
  });

  it("★ never reports a PROFIT on a row whose amount is below its cost -- the SIGN, swept", () => {
    // ⚠️ THIS IS THE TEST THE OLD SWEEP SHOULD HAVE BEEN. The 8x8 sweep above already fed
    // bcsMarginPercent negative operands -- and asserted only that nothing non-finite escaped,
    // which is exactly why a +150% on a loss-making row survived it and shipped. Finiteness is
    // not the property; the SIGN is.
    //
    // THE INVARIANT: % Margin is positive if and only if the amount exceeds the cost.
    const nums = [0, -0, 1e-320, -1e-320, 1e308, -1e308, 0.1, -7.5, 50, -100, 100, 1234.5];
    let valuesProduced = 0;
    for (const c of nums) {
      for (const a of nums) {
        const out = bcsMarginPercent(cell(c), cell(a));
        if (out.kind !== "value") continue;
        valuesProduced += 1;
        if (a > c) expect(out.value, `cost ${c} amount ${a}`).toBeGreaterThan(0);
        else if (a < c) expect(out.value, `cost ${c} amount ${a}`).toBeLessThan(0);
        else expect(out.value, `cost ${c} amount ${a}`).toBe(0);
      }
    }
    // Anti-vacuity: a guard that blanked EVERYTHING would satisfy the loop above trivially.
    expect(valuesProduced).toBeGreaterThan(20);
  });
});

describe("bcsBlankReasonText -- why a computed cell is empty, in plain English", () => {
  // These are ROW-level facts, which is why BCS owns them rather than reusing
  // AmountCellResult's "not_yet" | "broken" -- those two describe ONE column's formula.
  it("states each reason verbatim", () => {
    expect(bcsBlankReasonText("no_quantity")).toBe("No quantity on this row.");
    expect(bcsBlankReasonText("no_cost")).toBe("No cost entered yet.");
    expect(bcsBlankReasonText("no_amount")).toBe(
      "No amount on this row yet — % Margin is measured against the amount charged, and this row has none to read.",
    );
    expect(bcsBlankReasonText("zero_amount")).toBe(
      "The amount charged on this row is zero, so there is no margin to measure against it.",
    );
    expect(bcsBlankReasonText("not_finite")).toBe(
      "The numbers on this row are too extreme to produce a percentage.",
    );
    expect(bcsBlankReasonText("negative_amount")).toBe(
      "The amount charged on this row is negative, so a percentage measured against it would read backwards — a loss would show as a profit.",
    );
  });

  it("makes an UNRECOGNISED reason an explicit unsupported state, never a silent blank", () => {
    // Same forward-compat honesty bcsSummaryForMode gives an unknown mode: a cell that cannot
    // explain itself says so, rather than looking like an ordinary empty cell.
    const text = bcsBlankReasonText("something_new");
    expect(text).not.toBe("");
    expect(text).toMatch(/does not recognise/i);
    expect(text).toContain("something_new");
  });

  it("has a sentence for EVERY reason the module can produce -- swept", () => {
    // ⚠️ WIDENED AT BCS-S2e, and the widening is the point. This claimed "EVERY reason the
    // module can produce" while producing only four of them -- `not_finite` was declared at
    // S3b and never driven here at all, so the claim was already broader than the sweep. Both
    // it and the new `negative_amount` are produced below, from real inputs, so the sentence
    // the test makes is the sentence it checks.
    const produced = new Set<string>();
    for (const c of [
      bcsTotalAmountCell(null, 1),
      bcsTotalAmountCell(1, null),
      bcsTotalAmountCell(1e308, 1e308), // overflows the double range -> not_finite
    ]) {
      if (c.kind === "blank") produced.add(c.reason);
    }
    const tendered = bcsTenderedAmountCell(null);
    if (tendered.kind === "blank") produced.add(tendered.reason);
    for (const m of [
      bcsMarginPercent({ kind: "value", value: 1 }, { kind: "value", value: 0 }),
      bcsMarginPercent({ kind: "value", value: 50 }, { kind: "value", value: -100 }),
      bcsMarginPercent({ kind: "value", value: -1e308 }, { kind: "value", value: 1e-320 }),
    ]) {
      if (m.kind === "blank") produced.add(m.reason);
    }
    expect(produced).toEqual(
      new Set([
        "no_quantity",
        "no_cost",
        "no_amount",
        "zero_amount",
        "not_finite",
        "negative_amount",
      ]),
    );
    for (const r of produced) expect(bcsBlankReasonText(r)).not.toMatch(/does not recognise/i);
  });
});

describe("formatBcsMargin -- how the percentage reads in the cell", () => {
  it("shows one decimal place and the unit", () => {
    expect(formatBcsMargin(20)).toBe("20.0%");
    expect(formatBcsMargin(33.333333)).toBe("33.3%");
  });

  it("keeps a loss visibly negative", () => {
    expect(formatBcsMargin(-33.333333)).toBe("-33.3%");
  });

  it("never renders a negative zero -- '-0.0%' would read as a loss that is not there", () => {
    expect(formatBcsMargin(-0.001)).toBe("0.0%");
    expect(formatBcsMargin(-0)).toBe("0.0%");
  });
});

// ===========================================================================
// Group: THE RULE PARITY TABLE (BCS-S2e) -- this side of it
// ===========================================================================
/**
 * ★ THE PARITY NET. One case table, `nirmaan_stack/services/boq_bcs/parity_cases.json`,
 * consumed by THIS suite and by `services/boq_bcs/test_sources.py`. If the two rule chains
 * disagree about any case, exactly one of the two suites goes red -- which is the whole point.
 *
 * WHY IT DID NOT EXIST BEFORE, AND WHAT HAD TO CHANGE. The two sides shared no refusal
 * IDENTIFIER: the server threw a (title, message) pair, this module returned {ok:false,
 * message}. Only the success `mode` was comparable, so a pin built on what was available would
 * have covered the ten modes and NONE of the refusal chain whose ORDER is load-bearing -- the
 * partial test that makes a gap look closed, which is worse than no test. BCS-S2e gave every
 * refusal a short CODE on both sides, minted where the condition is decided.
 *
 * WHAT IT IS NOT. It does not pin the WORDING. The card's sentences are deliberately friendlier
 * than a thrown error's, and forcing one voice on both would trade a real property for a fake
 * one. It pins the CONDITIONS and their PRECEDENCE -- what a user actually experiences.
 *
 * WHY A PLAIN `import`, AND NOT A HAND-ROLLED READ-AND-DECODE. The first draft pulled the file
 * in off `import.meta.url` and decoded it inline -- which WORKS, and which the ADR-0010 F2
 * ratchet correctly counted as one more inline decode under `pages/` (measured 208 -> 209: a
 * regression this slice introduced and had to answer rather than annotate). `resolveJsonModule`
 * is on, so the import hands back the same object with the decode done once by the toolchain --
 * which is what F2 asks for in the first place, not a way around it.
 *
 * ⚠️ AND THEN THE PROSE TRIPPED IT TOO. That ratchet is a LINE REGEX over `frontend/src/pages`,
 * so a comment merely NAMING the decoder counted as two more violations with no code behind
 * them -- 209 again, from a docblock. Hence the circumlocution above: it is not squeamishness,
 * and a future editor who "fixes" the wording by spelling the call out will push the count back
 * up and fail the gate for whoever commits next.
 *
 * The relative path climbs OUT of `frontend/` on purpose: the table lives beside the authority
 * it describes (`services/boq_bcs/`), not beside this mirror. See the file's own `_readme`.
 */
const PARITY = PARITY_RAW as unknown as {
  codes: Record<string, string>;
  order: Record<"qty" | "amount", string[]>;
  unreachable: Record<string, { why: string; shadowed_by: string[] }>;
  unconstructible_adjacencies: Array<{
    side: "qty" | "amount";
    earlier: string;
    later: string;
    why: string;
  }>;
  client_only_codes: Record<string, string>;
  descriptors: ColumnDescriptor[];
  cases: Array<{
    id: string;
    side: "qty" | "amount";
    cols: string[];
    expect: { ok: true; mode: string } | { ok: false; code: string };
    beats?: string;
    why: string;
  }>;
  derived_qty_cases: Array<{
    id: string;
    descriptors: ColumnDescriptor[];
    confirmed: BcsSource | null;
    expect: { columns: Array<{ col: string; value_field: string; value_key: string | null }> };
    why: string;
  }>;
  rate_kinds_cases: Array<{
    id: string;
    descriptors: ColumnDescriptor[];
    expect: { kinds: string[] };
    why: string;
  }>;
  derived_amount_cases: Array<{
    id: string;
    descriptors: ColumnDescriptor[];
    confirmed: BcsSource | null;
    expect: { columns: Array<{ col: string; value_field: string; value_key: string | null }> };
    why: string;
  }>;
};

describe("rule parity -- the shared case table, this side", () => {
  const index = buildBcsDescriptorIndex(PARITY.descriptors);

  it("agrees with the shared table on every case", () => {
    for (const c of PARITY.cases) {
      const out = validateBcsPicks(c.side, c.cols, index);
      expect(out.ok, `${c.id}: ${c.why}`).toBe(c.expect.ok);
      if (c.expect.ok && out.ok) {
        expect(out.mode, `${c.id}: ${c.why}`).toBe(c.expect.mode);
      } else if (!c.expect.ok && !out.ok) {
        expect(out.code, `${c.id}: ${c.why}`).toBe(c.expect.code);
      }
    }
  });

  it("still says something human about every refusal it codes", () => {
    // The code is for the parity table; the SENTENCE is for the user, and adding the first
    // must never quietly cost the second. Every refusal keeps a non-empty message.
    for (const c of PARITY.cases) {
      if (c.expect.ok) continue;
      const out = validateBcsPicks(c.side, c.cols, index);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.message.length, c.id).toBeGreaterThan(10);
    }
  });

  it("states the formula in force for every accepted case", () => {
    // Parity on the MODE alone would let this side agree about which formula is in force while
    // failing to SAY it -- and the disclosure sentence is the owner's whole safety mechanism
    // for "adapt and disclose, never refuse".
    for (const c of PARITY.cases) {
      if (!c.expect.ok) continue;
      const out = validateBcsPicks(c.side, c.cols, index);
      expect(out.ok, c.id).toBe(true);
      if (out.ok) {
        expect(out.summary, c.id).not.toBe("");
        expect(out.summary, c.id).not.toMatch(/does not recognise/i);
        for (const col of c.cols) expect(out.summary, c.id).toContain(col);
      }
    }
  });

  it("declares the SAME refusal order the table does", () => {
    // Not decoration: both suites assert the table's order against their OWN module's declared
    // chain, so a rule added to one side alone goes red on that side.
    expect(BCS_REFUSAL_ORDER.qty).toEqual(PARITY.order.qty);
    expect(BCS_REFUSAL_ORDER.amount).toEqual(PARITY.order.amount);
  });

  it("mints no code outside the shared vocabulary, and leaves none of it unchained", () => {
    const vocabulary = new Set(Object.keys(PARITY.codes));
    const chained = new Set([...BCS_REFUSAL_ORDER.qty, ...BCS_REFUSAL_ORDER.amount]);
    expect(chained).toEqual(vocabulary);
    expect(new Set(BCS_REFUSAL_CODES)).toEqual(vocabulary);
  });

  it("exercises every code in the chain, or declares it unreachable with the case that shadows it", () => {
    const answered = new Set(
      PARITY.cases.filter((c) => !c.expect.ok).map((c) => (c.expect as { code: string }).code),
    );
    for (const side of ["qty", "amount"] as const) {
      for (const code of BCS_REFUSAL_ORDER[side]) {
        expect(
          answered.has(code) || code in PARITY.unreachable,
          `${code} is in the ${side} chain but no case answers it and it is not declared unreachable`,
        ).toBe(true);
      }
    }
    for (const [code, note] of Object.entries(PARITY.unreachable)) {
      expect(answered.has(code), `${code} is declared unreachable but a case answers it`).toBe(false);
      for (const id of note.shadowed_by) {
        expect(PARITY.cases.find((c) => c.id === id)?.beats).toBe(code);
      }
    }
  });

  it("★ every precedence case names a LATER rule that is actually live", () => {
    // THE ANTI-VACUITY GUARD. A precedence case claims "this input violates BOTH rules and the
    // EARLIER one answers". Two things must hold or the claim is empty: the winner really comes
    // earlier in the declared chain, and the loser really is a rule that answers somewhere (or
    // is the declared-unreachable one). Without this, a `beats` case naming a rule that never
    // fires would pass forever while pinning nothing.
    const answered = new Set(
      PARITY.cases.filter((c) => !c.expect.ok).map((c) => (c.expect as { code: string }).code),
    );
    let checked = 0;
    for (const c of PARITY.cases) {
      if (!c.beats || c.expect.ok) continue;
      checked += 1;
      // Read as `readonly string[]`: the table's codes arrive from JSON as plain strings, and
      // whether each one IS a member of the chain is precisely what the next two assertions
      // ask. Narrowing here would answer that question by fiat instead of checking it.
      const order: readonly string[] = BCS_REFUSAL_ORDER[c.side];
      const winner = order.indexOf(c.expect.code);
      const loser = order.indexOf(c.beats);
      expect(winner, `${c.id}: winner not in chain`).toBeGreaterThanOrEqual(0);
      expect(loser, `${c.id}: loser not in chain`).toBeGreaterThanOrEqual(0);
      expect(winner, `${c.id}: a precedence case must name a LATER rule as the loser`).toBeLessThan(
        loser,
      );
      expect(
        answered.has(c.beats) || c.beats in PARITY.unreachable,
        `${c.beats} never answers any case, so beating it proves nothing`,
      ).toBe(true);
    }
    // The `checked >= 8` floor that used to close this test is GONE on purpose (BCS-S2e-fix):
    // the table carries 11, so it was three cases of slack, and a COUNT cannot say which
    // precedence claim went missing. The next test replaces it with the real property.
    expect(checked).toBe(PARITY.cases.filter((c) => !!c.beats && !c.expect.ok).length);
  });

  it("★ pins a precedence case for every constructible adjacency in each chain", () => {
    // THE COVERAGE FLOOR (BCS-S2e-fix), and it REPLACES a count. The old `>= 8` against a table
    // of 11 was not a hypothetical weakness: deleting `amount-precedence-kind-beats-shape` --
    // the case the table itself labels THE LOAD-BEARING ONE -- left BOTH suites green.
    //
    // So walk each side's declared chain PAIRWISE and require every neighbouring pair to be
    // settled: by a real `beats` case, or by an `unconstructible_adjacencies` entry saying why
    // no single input can violate both. Two properties follow that the count never had. A NAMED
    // case cannot be dropped in silence, because dropping it strands its pair. And adding a case
    // needs no edit here, so this guard cannot drift behind the table the way the number did.
    //
    // NOT BOTH, deliberately: an exemption CLAIMS a pair is unbuildable, so a table that also
    // builds it has one of the two wrong.
    //
    // Honest scope: this does not cover a NON-adjacent `beats` pair -- today only the
    // `aliased_columns` > `too_many_scalars` shadow on each side, which is pinned BY NAME through
    // `unreachable.shadowed_by` above. Between the two, all 11 precedence cases are load-bearing.
    for (const side of ["qty", "amount"] as const) {
      const order: readonly string[] = BCS_REFUSAL_ORDER[side];
      const covered = new Set(
        PARITY.cases
          .filter((c) => c.side === side && !!c.beats && !c.expect.ok)
          .map((c) => `${(c.expect as { code: string }).code}>${c.beats}`),
      );
      const exempt = new Set(
        PARITY.unconstructible_adjacencies
          .filter((e) => e.side === side)
          .map((e) => `${e.earlier}>${e.later}`),
      );
      for (let i = 0; i < order.length - 1; i += 1) {
        const pair = `${order[i]}>${order[i + 1]}`;
        expect(
          covered.has(pair) && exempt.has(pair),
          `${side} ${pair} is declared unconstructible AND a case constructs it -- one is wrong`,
        ).toBe(false);
        expect(
          covered.has(pair) || exempt.has(pair),
          `${side}: no case pins that ${order[i]} beats its neighbour ${order[i + 1]}, and the ` +
            `pair is not declared unconstructible. Add a \`beats\` case, or say in ` +
            `\`unconstructible_adjacencies\` why no input can violate both.`,
        ).toBe(true);
      }
    }
  });

  it("keeps every declared unconstructible adjacency a real neighbouring pair", () => {
    // The exemption list is the one way to satisfy the floor without a case, so it must be
    // unable to grow into a blanket. Every entry must name a pair that really IS adjacent in that
    // side's chain -- so a reorder that strands an exemption goes red rather than quietly
    // widening it -- and must carry a reason a reader can weigh.
    for (const e of PARITY.unconstructible_adjacencies) {
      const order: readonly string[] = BCS_REFUSAL_ORDER[e.side];
      const earlier = order.indexOf(e.earlier);
      const later = order.indexOf(e.later);
      expect(earlier, `${e.side} ${e.earlier}: not in the chain`).toBeGreaterThanOrEqual(0);
      expect(later, `${e.side} ${e.later}: not in the chain`).toBeGreaterThanOrEqual(0);
      expect(later, `${e.side} ${e.earlier}>${e.later}: exemptions excuse ADJACENT rules only`).toBe(
        earlier + 1,
      );
      expect(e.why.length, `${e.side} ${e.earlier}>${e.later}`).toBeGreaterThan(30);
    }
  });

  it("is not a trivially satisfiable table", () => {
    // The other end of anti-vacuity: a table of only-accepts (or only-refuses) would sail
    // through both suites while comparing almost nothing.
    const accepted = PARITY.cases.filter((c) => c.expect.ok);
    const refused = PARITY.cases.filter((c) => !c.expect.ok);
    expect(accepted.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    // All TEN stored modes -- the persisted contract this module states in words and BCS-S3
    // computes against. A mode missing here is a formula neither suite is comparing.
    const modes = new Set(accepted.map((c) => (c.expect as { mode: BcsMode }).mode));
    expect(modes).toEqual(
      new Set<BcsMode>([
        "qty_total",
        "qty_by_area",
        "amount_total",
        "amount_supply_plus_install",
        "amount_supply_only",
        "amount_install_only",
        "amount_by_area",
        "amount_by_area_supply_plus_install",
        "amount_by_area_supply_only",
        "amount_by_area_install_only",
      ]),
    );
  });

  it("keeps the client-only code deliberately OUTSIDE the parity vocabulary", () => {
    // The ONE place the two sides answer differently on purpose. This module's amount-mode
    // table miss returns a refusal; the server's equivalent is a bare KeyError on
    // `_AMOUNT_MODES` -- "fail loudly rather than mint a plausible mode for a shape nobody
    // ruled on". Both are unreachable by construction. The asymmetry is RECORDED in the table
    // rather than papered over, and pinned here so nobody "restores consistency" by adding it.
    for (const code of Object.keys(PARITY.client_only_codes)) {
      expect(Object.keys(PARITY.codes)).not.toContain(code);
      expect(BCS_REFUSAL_ORDER.qty).not.toContain(code);
      expect(BCS_REFUSAL_ORDER.amount).not.toContain(code);
    }
  });
});

// ── BCS-S9: BCS Total Amount as an editable formula ───────────────────────────
//
// The load-bearing property is the FIRST describe: the seed must reproduce, exactly, the
// number the hardcoded rule produced. Everything else in this slice is reversible; a seed
// that computes something else silently moves money on sheets nobody touched.
describe("BCS-S9 -- the seed reproduces the built-in rule exactly", () => {
  const merged = (supply: string | null, install: string | null, combined: string | null = null) =>
    ({ supply_rate: supply, install_rate: install, combined_rate: combined }) as Record<
      BcsRateField,
      string | null
    >;

  const CASES: Array<[string, BcsRateKind[], Record<BcsRateField, string | null>]> = [
    ["two boxes", ["supply", "install"], merged("30", "20")],
    ["combined only", ["combined"], merged(null, null, "45")],
    ["supply only", ["supply"], merged("12", null)],
    ["zero cost is a real 0", ["supply", "install"], merged("0", "0")],
  ];

  it.each(CASES)("%s: formula result === built-in result", (_n, kinds, m) => {
    const qty = 10;
    const builtIn = bcsTotalCell(null, qty, m, kinds);
    const seeded = bcsTotalCell(defaultBcsTotalFormula(kinds), qty, m, kinds);
    expect(seeded).toEqual(builtIn);
  });

  it("(Supply + Install) x Quantity is the arithmetic, not something that merely agrees once", () => {
    const cell = bcsTotalCell(
      defaultBcsTotalFormula(["supply", "install"]),
      10,
      merged("30", "20"),
      ["supply", "install"],
    );
    expect(cell).toEqual({ kind: "value", value: 500 }); // (30 + 20) * 10
  });

  it("a combined-rate sheet's seed is ONE box x quantity, never a sum with the halves", () => {
    const tree = defaultBcsTotalFormula(["combined"]);
    // bcs.py forbids summing combined_rate with the halves; bcsLiveRateKinds never returns
    // both, so the seed structurally cannot express it -- one leaf, not a "+" node.
    expect(tree).toEqual({
      op: "*",
      operands: [
        { ref: { value_field: "bcs_combined", value_key: null, rate_subkey: null } },
        { ref: { value_field: "bcs_qty", value_key: null, rate_subkey: null } },
      ],
    });
  });

  it("no cost box -> no seed (nothing to total)", () => {
    expect(defaultBcsTotalFormula([])).toBeNull();
  });
});

describe("BCS-S9 -- a blank still knows why on the formula path", () => {
  const m = (s: string | null, i: string | null) =>
    ({ supply_rate: s, install_rate: i, combined_rate: null }) as Record<
      BcsRateField,
      string | null
    >;
  const kinds: BcsRateKind[] = ["supply", "install"];
  const tree = defaultBcsTotalFormula(kinds)!;

  it("an uncosted row reads no_cost, NOT 0", () => {
    expect(bcsTotalCell(tree, 10, m(null, null), kinds)).toEqual({
      kind: "blank",
      reason: "no_cost",
    });
  });

  it("a row with no quantity reads no_quantity, NOT 0", () => {
    expect(bcsTotalCell(tree, null, m("30", "20"), kinds)).toEqual({
      kind: "blank",
      reason: "no_quantity",
    });
  });

  it("a divide-by-zero blanks rather than rendering Infinity", () => {
    const div: AmountFormulaNode = {
      op: "/",
      operands: [
        { ref: { value_field: "bcs_supply", value_key: null, rate_subkey: null } },
        { ref: { value_field: "bcs_install", value_key: null, rate_subkey: null } },
      ],
    };
    const cell = bcsTotalCell(div, 10, m("100", "0"), kinds);
    expect(cell.kind).toBe("blank");
  });

  it("an operand outside the BCS vocabulary blanks -- never silently resolves", () => {
    const stray: AmountFormulaNode = {
      ref: { value_field: "rate_supply", value_key: null, rate_subkey: null },
    };
    expect(bcsTotalCell(stray, 10, m("30", "20"), kinds).kind).toBe("blank");
  });
});

describe("BCS-S9 -- pickBcsTotalFormula", () => {
  const tree: AmountFormulaNode = {
    ref: { value_field: "bcs_qty", value_key: null, rate_subkey: null },
  };
  const rec = (tvf: string, f: AmountFormulaNode | null) => ({
    target_value_field: tvf,
    target_value_key: null,
    target_rate_subkey: null,
    target_col: null,
    formula: f,
  });

  it("finds the bcs_total record and ignores amount ones", () => {
    expect(pickBcsTotalFormula([rec("amount_total", null), rec("bcs_total", tree)])).toEqual(tree);
  });

  it("returns null when the sheet has declared none -- the built-in rule then applies", () => {
    expect(pickBcsTotalFormula([rec("amount_total", tree)])).toBeNull();
    expect(pickBcsTotalFormula([])).toBeNull();
    expect(pickBcsTotalFormula(undefined)).toBeNull();
  });
});

// ── The % Margin identity (owner formula, 2026-08-07) ─────────────────────────
//
// The owner specified `% Margin = (1 - BCS/BOQ) x 100`. The implementation computes
// `((amount - cost) / amount) x 100`, which is the SAME expression rearranged:
//
//     (1 - c/a) x 100  =  (a/a - c/a) x 100  =  ((a - c)/a) x 100
//
// So `% Profit -> % Margin` was a RENAME, with no arithmetic change. This pins the identity
// rather than leaving it as a claim in a commit message -- and it is the guard that would fire
// if anyone later "implements the owner's formula" and accidentally writes `1 - (c/a) x 100`,
// which reads identically in prose and returns -49 where the right answer is 50.
describe("% Margin -- the owner's formula and the implementation are the same expression", () => {
  const cell = (value: number): BcsComputedCell => ({ kind: "value", value });
  /** The owner's form, written literally, with the intended grouping. */
  const ownerForm = (cost: number, boq: number) => (1 - cost / boq) * 100;

  const PAIRS: Array<[number, number]> = [
    [600, 1000],
    [800, 1000],
    [0, 1000],
    [1000, 1000],
    [1200, 1000], // a loss: cost above the amount charged -> negative margin
    [1, 3], // non-terminating decimal
    [12345.67, 98765.43],
  ];

  it.each(PAIRS)("cost %d against BOQ %d agrees to floating-point exactness", (cost, boq) => {
    const impl = bcsMarginPercent(cell(cost), cell(boq));
    expect(impl.kind).toBe("value");
    expect((impl as { kind: "value"; value: number }).value).toBeCloseTo(ownerForm(cost, boq), 10);
  });

  it("the worked example from the spec: 600 cost, 1000 charged -> 40%", () => {
    expect(bcsMarginPercent(cell(600), cell(1000))).toEqual({ kind: "value", value: 40 });
  });

  it("⚠️ the MISREAD grouping is NOT what we compute -- it returns a nonsense negative", () => {
    // Written without the outer bracket, normal precedence makes it 1 - ((c/a) x 100):
    // 1 - 0.6*100 = -59, where the right answer is +40. Not a rounding difference -- a
    // different sign and a different magnitude, which is why the grouping had to be settled
    // before this was implemented rather than after.
    const misread = 1 - (600 / 1000) * 100;
    expect(misread).toBeCloseTo(-59, 10);
    expect(bcsMarginPercent(cell(600), cell(1000))).not.toEqual({ kind: "value", value: misread });
  });
});

// ── BCS-S10: BOQ Total (the % Margin denominator) as an editable formula ──────
describe("BCS-S10 -- the denominator's seed reproduces the confirmed-columns sum", () => {
  const src = (...cols: string[]): BcsSource => ({
    mode: "amount_supply_plus_install",
    columns: cols.map((col) => ({
      col,
      role: "amount",
      area: null,
      value_field: `amount_${col}`,
      value_key: null,
      rate_subkey: null,
    })),
  }) as unknown as BcsSource;

  // Resolve each confirmed entry to a number, standing in for the caller's on-screen resolver.
  const values: Record<string, number> = { amount_G: 600, amount_H: 400 };
  const evaluate = (e: { value_field: string }) => values[e.value_field] ?? null;

  it("no formula -> the built-in confirmed-columns sum", () => {
    expect(boqTotalAmount(null, src("G", "H"), evaluate as never)).toBe(1000);
  });

  it("the SEED computes the identical number", () => {
    const s = src("G", "H");
    expect(boqTotalAmount(defaultBoqTotalFormula(s), s, evaluate as never)).toBe(1000);
  });

  it("a single confirmed column seeds to a bare leaf, not a one-operand sum", () => {
    expect(defaultBoqTotalFormula(src("G"))).toEqual({
      ref: { value_field: "amount_G", value_key: null, rate_subkey: null },
    });
  });

  it("no confirmed columns -> no seed", () => {
    expect(defaultBoqTotalFormula(null)).toBeNull();
    expect(defaultBoqTotalFormula(src())).toBeNull();
  });

  it("an EDITED formula changes the denominator -- the whole point", () => {
    const s = src("G", "H");
    const supplyOnly: AmountFormulaNode = {
      ref: { value_field: "amount_G", value_key: null, rate_subkey: null },
    };
    expect(boqTotalAmount(supplyOnly, s, evaluate as never)).toBe(600);
  });

  it("an unresolvable operand blanks the denominator rather than part-summing it", () => {
    const s = src("G", "H");
    const missing: AmountFormulaNode = {
      op: "+",
      operands: [
        { ref: { value_field: "amount_G", value_key: null, rate_subkey: null } },
        { ref: { value_field: "amount_NOPE", value_key: null, rate_subkey: null } },
      ],
    };
    expect(boqTotalAmount(missing, s, evaluate as never)).toBeNull();
  });
});

// ⚠️ The guards are the reason the margin's SHAPE stays in code while only its denominator is
// editable. These assert they still bite whatever the denominator came from.
describe("BCS-S10 -- bcsMarginPercent's guards survive an editable denominator", () => {
  const cell = (value: number): BcsComputedCell => ({ kind: "value", value });

  it("a zero denominator is refused, not divided by", () => {
    expect(bcsMarginPercent(cell(50), cell(0))).toEqual({
      kind: "blank",
      reason: "zero_amount",
    });
  });

  it("★ a NEGATIVE denominator is refused -- a loss must never read as a positive margin", () => {
    // -100 charged against 50 cost computes +150% through the raw formula. That is the failure
    // a user-editable margin SHAPE would have reintroduced, which is why only the denominator
    // is editable.
    expect((1 - 50 / -100) * 100).toBeCloseTo(150, 10);
    expect(bcsMarginPercent(cell(50), cell(-100))).toEqual({
      kind: "blank",
      reason: "negative_amount",
    });
  });

  it("a blank denominator propagates its reason", () => {
    expect(bcsMarginPercent(cell(50), { kind: "blank", reason: "no_amount" })).toEqual({
      kind: "blank",
      reason: "no_amount",
    });
  });
});

// ── BCS-S11: the % Margin NUMERATOR (cost side) as an editable formula ────────
describe("BCS-S11 -- the cost side is choosable, the ratio is not", () => {
  const merged = (s: string | null, i: string | null) =>
    ({ supply_rate: s, install_rate: i, combined_rate: null }) as Record<
      BcsRateField,
      string | null
    >;
  const total = (v: number): BcsComputedCell => ({ kind: "value", value: v });

  it("no formula -> the BCS Total cell itself, unchanged", () => {
    expect(marginCostCell(null, total(500), merged("30", "20"))).toEqual(total(500));
  });

  it("the SEED is BCS Total, so it reproduces the built-in exactly", () => {
    expect(marginCostCell(defaultMarginCostFormula(), total(500), merged("30", "20"))).toEqual(
      total(500),
    );
  });

  it("★ the cost side can be re-pointed at the raw boxes -- the owner's ask", () => {
    const supplyPlusInstall: AmountFormulaNode = {
      op: "+",
      operands: [
        { ref: { value_field: "bcs_supply", value_key: null, rate_subkey: null } },
        { ref: { value_field: "bcs_install", value_key: null, rate_subkey: null } },
      ],
    };
    expect(marginCostCell(supplyPlusInstall, total(500), merged("30", "20"))).toEqual(total(50));
  });

  it("choosing BCS Total resolves it LIVE, not as a frozen copy of its rule", () => {
    const tree = defaultMarginCostFormula();
    // Same formula, two different BCS Total values -> two different numerators.
    expect(marginCostCell(tree, total(500), merged("30", "20"))).toEqual(total(500));
    expect(marginCostCell(tree, total(900), merged("30", "20"))).toEqual(total(900));
  });

  it("a blank BCS Total propagates as a blank cost, never as 0", () => {
    const cell = marginCostCell(
      defaultMarginCostFormula(),
      { kind: "blank", reason: "no_cost" },
      merged("30", "20"),
    );
    expect(cell.kind).toBe("blank");
  });

  it("an uncosted box blanks the numerator rather than treating it as 0", () => {
    const supplyOnly: AmountFormulaNode = {
      ref: { value_field: "bcs_supply", value_key: null, rate_subkey: null },
    };
    expect(marginCostCell(supplyOnly, total(500), merged(null, null)).kind).toBe("blank");
  });

  it("an operand outside the numerator's vocabulary blanks", () => {
    const stray: AmountFormulaNode = {
      ref: { value_field: "amount_total", value_key: null, rate_subkey: null },
    };
    expect(marginCostCell(stray, total(500), merged("30", "20")).kind).toBe("blank");
  });

  it("⚠️ the ratio's guards still bite whatever the cost side was set to", () => {
    // A re-pointed numerator cannot reach past the denominator guards -- that separation is
    // exactly why only the two SLOTS are editable and never the `(1 - c/a) x 100` wrapper.
    const cost = marginCostCell(defaultMarginCostFormula(), total(50), merged("30", "20"));
    expect(bcsMarginPercent(cost, { kind: "value", value: -100 })).toEqual({
      kind: "blank",
      reason: "negative_amount",
    });
    expect(bcsMarginPercent(cost, { kind: "value", value: 0 })).toEqual({
      kind: "blank",
      reason: "zero_amount",
    });
  });
});

// ── BCS-S11b: the margin cost side can be rebuilt to a ROW TOTAL ──────────────
//
// BCS Total Amount is `(cost boxes) x Total Quantity` -- a ROW total. The cost boxes on their
// own are PER-UNIT rates. Offering the boxes without Total Quantity made the only reachable
// formula divide a per-unit rate by BOQ Total (a row amount): dimensionally wrong, and wrong in
// a way that still renders a plausible percentage.
describe("BCS-S11b -- Total Quantity is reachable from the margin's cost side", () => {
  const merged = (s: string | null, i: string | null) =>
    ({ supply_rate: s, install_rate: i, combined_rate: null }) as Record<
      BcsRateField,
      string | null
    >;
  const total = (v: number): BcsComputedCell => ({ kind: "value", value: v });

  it("the palette offers the quantity, not just the cost boxes", () => {
    const fields = marginCostOperandRefs(["supply", "install"]).map((r) => r.value_field);
    expect(fields).toContain("bcs_qty");
    expect(fields).toContain("bcs_total");
    expect(fields).toContain("bcs_supply");
  });

  it("★ a hand-built (Supply + Install) x Quantity equals BCS Total Amount", () => {
    const handBuilt: AmountFormulaNode = {
      op: "*",
      operands: [
        {
          op: "+",
          operands: [
            { ref: { value_field: "bcs_supply", value_key: null, rate_subkey: null } },
            { ref: { value_field: "bcs_install", value_key: null, rate_subkey: null } },
          ],
        },
        { ref: { value_field: "bcs_qty", value_key: null, rate_subkey: null } },
      ],
    };
    // (30 + 20) x 10 = 500, which is what BCS Total Amount computes for the same row.
    expect(marginCostCell(handBuilt, total(500), merged("30", "20"), 10)).toEqual(total(500));
  });

  it("a missing quantity blanks with its OWN reason, not a generic one", () => {
    const withQty: AmountFormulaNode = {
      op: "*",
      operands: [
        { ref: { value_field: "bcs_supply", value_key: null, rate_subkey: null } },
        { ref: { value_field: "bcs_qty", value_key: null, rate_subkey: null } },
      ],
    };
    expect(marginCostCell(withQty, total(500), merged("30", "20"), null)).toEqual({
      kind: "blank",
      reason: "no_quantity",
    });
  });
});

// ── BCS-S12b: the seed with no confirmation, and the total-vs-halves rule ─────
describe("BCS-S12b -- defaultBoqTotalFormula derives from the sheet when nothing is confirmed", () => {
  const desc = (value_field: string, col = "X"): ColumnDescriptor =>
    ({ col, role: value_field, area: null, value_field, value_key: null, rate_subkey: null }) as ColumnDescriptor;

  it("★ a scalar Amount (Total) is used DIRECTLY, never summed with the halves", () => {
    // Summing all three would count every amount twice and HALVE every margin -- wrong in a way
    // that still renders a plausible percentage. Mirrors sources.py's "a total already contains
    // its halves" refusal, which this seed replaces.
    const tree = defaultBoqTotalFormula(null, [
      desc("amount_supply", "G"),
      desc("amount_install", "H"),
      desc("amount_total", "I"),
    ]);
    expect(tree).toEqual({ ref: { value_field: "amount_total", value_key: null, rate_subkey: null } });
  });

  it("with no Total column, the two halves are summed", () => {
    const tree = defaultBoqTotalFormula(null, [desc("amount_supply", "G"), desc("amount_install", "H")]);
    expect(tree).toEqual({
      op: "+",
      operands: [
        { ref: { value_field: "amount_supply", value_key: null, rate_subkey: null } },
        { ref: { value_field: "amount_install", value_key: null, rate_subkey: null } },
      ],
    });
  });

  it("a single half on its own is a bare leaf", () => {
    expect(defaultBoqTotalFormula(null, [desc("amount_supply", "G")])).toEqual({
      ref: { value_field: "amount_supply", value_key: null, rate_subkey: null },
    });
  });

  it("a PRE-S12 confirmation still wins -- that sheet's margin must not move", () => {
    const confirmed = {
      mode: "amount_supply_plus_install",
      columns: [{ col: "G", value_field: "amount_supply", value_key: null, rate_subkey: null }],
    } as unknown as BcsSource;
    // Even though the sheet also has an amount_total column, the stored confirmation governs.
    const tree = defaultBoqTotalFormula(confirmed, [desc("amount_total", "I")]);
    expect(tree).toEqual({ ref: { value_field: "amount_supply", value_key: null, rate_subkey: null } });
  });

  it("no confirmation and no amount columns -> no seed", () => {
    expect(defaultBoqTotalFormula(null, [])).toBeNull();
    expect(defaultBoqTotalFormula(null)).toBeNull();
  });
});

// ── BCS-S12c: quantity resolves to the sheet's REAL column ───────────────────
//
// THE LIVE REGRESSION THIS CLOSES. S12 removed the Quantity picker but left quantity resolving
// ONLY through the confirmation it wrote, so every sheet enabled afterwards produced qty=null ->
// BCS Total blank (`no_quantity`) -> % Margin blank, with both cost boxes filled. Measured on
// the bench: 3 of 8 BCS-enabled sheets, and ONGOING -- a brand-new sheet landed broken.
describe("BCS-S12c -- bcsQuantityColumns", () => {
  const desc = (value_field: string, col = "D"): ColumnDescriptor =>
    ({ col, role: value_field, area: null, value_field, value_key: null, rate_subkey: null }) as ColumnDescriptor;
  const src = (col: string): BcsSource =>
    ({ mode: "qty_total", columns: [{ col, value_field: "qty_total", value_key: null, rate_subkey: null }] }) as unknown as BcsSource;

  it("a stored confirmation WINS -- pre-S12 sheets resolve exactly as before", () => {
    const cols = bcsQuantityColumns(src("Z"), [desc("qty_total", "D")]);
    expect(cols).toHaveLength(1);
    expect(cols[0].col).toBe("Z");
  });

  it("★ with NO confirmation it falls back to the sheet's own qty_total column", () => {
    const cols = bcsQuantityColumns(null, [desc("qty_total", "D"), desc("amount_total", "I")]);
    expect(cols.map((c) => c.col)).toEqual(["D"]);
  });

  it("a per-area sheet falls back to every qty_by_area column", () => {
    const cols = bcsQuantityColumns(null, [desc("qty_by_area", "E"), desc("qty_by_area", "F")]);
    expect(cols.map((c) => c.col)).toEqual(["E", "F"]);
  });

  it("a scalar total is preferred over per-area columns, never summed with them", () => {
    const cols = bcsQuantityColumns(null, [desc("qty_by_area", "E"), desc("qty_total", "D")]);
    expect(cols.map((c) => c.col)).toEqual(["D"]);
  });

  it("no confirmation and no qty column -> nothing (an honestly quantity-less sheet)", () => {
    expect(bcsQuantityColumns(null, [desc("amount_total", "I")])).toHaveLength(0);
    expect(bcsQuantityColumns(null, [])).toHaveLength(0);
  });
});

describe("BCS-S12c -- the seed emits the real column, never the abstraction", () => {
  const desc = (value_field: string, col = "D"): ColumnDescriptor =>
    ({ col, role: value_field, area: null, value_field, value_key: null, rate_subkey: null }) as ColumnDescriptor;

  it("★ the quantity leaf is qty_total, not bcs_qty", () => {
    const tree = defaultBcsTotalFormula(["supply", "install"], [desc("qty_total", "D")]);
    const fields: string[] = [];
    const walk = (n: AmountFormulaNode) =>
      "ref" in n ? fields.push(n.ref.value_field) : n.operands.forEach(walk);
    walk(tree!);
    expect(fields).toContain("qty_total");
    expect(fields).not.toContain("bcs_qty");
  });

  it("with no qty column mapped it still yields the legacy leaf rather than nothing", () => {
    const tree = defaultBcsTotalFormula(["combined"], []);
    const fields: string[] = [];
    const walk = (n: AmountFormulaNode) =>
      "ref" in n ? fields.push(n.ref.value_field) : n.operands.forEach(walk);
    walk(tree!);
    expect(fields).toContain("bcs_qty");
  });

  it("the seed still computes (Supply + Install) x Quantity", () => {
    const tree = defaultBcsTotalFormula(["supply", "install"], [desc("qty_total", "D")])!;
    const merged = { supply_rate: "30", install_rate: "20", combined_rate: null } as Record<
      BcsRateField,
      string | null
    >;
    // qty arrives through the sheet-column resolver, as it does in the grid.
    const cell = bcsTotalCell(tree, null, merged, ["supply", "install"], (ref) =>
      ref.value_field === "qty_total" ? 10 : null,
    );
    expect(cell).toEqual({ kind: "value", value: 500 });
  });
});

// ── BCS-S12e: the AMOUNT side needed the same fallback the quantity side got ──
//
// THE SECOND HALF OF A BUG WHOSE FIRST HALF SHIPPED ALONE. S12 removed both column pickers;
// quantity got a descriptor fallback and amount did not. On a sheet with no confirmation BCS
// Total therefore computed correctly while % Margin stayed blank -- its DENOMINATOR resolved to
// null. Symmetric problem, symmetric fix; these tests exist so the two sides stay symmetric.
describe("BCS-S12e -- bcsAmountColumns mirrors bcsQuantityColumns", () => {
  const desc = (value_field: string, col: string): ColumnDescriptor =>
    ({ col, role: value_field, area: null, value_field, value_key: null, rate_subkey: null }) as ColumnDescriptor;
  const src = (col: string): BcsSource =>
    ({ mode: "amount_total", columns: [{ col, value_field: "amount_total", value_key: null, rate_subkey: null }] }) as unknown as BcsSource;

  it("a stored confirmation WINS -- pre-S12 sheets are unchanged", () => {
    expect(bcsAmountColumns(src("Z"), [desc("amount_total", "R")]).map((c) => c.col)).toEqual(["Z"]);
  });

  it("★ with NO confirmation it falls back to the sheet's own amount column", () => {
    expect(bcsAmountColumns(null, [desc("amount_total", "R")]).map((c) => c.col)).toEqual(["R"]);
  });

  it("a scalar total is used ALONE, never summed with the halves", () => {
    const cols = bcsAmountColumns(null, [
      desc("amount_supply", "G"), desc("amount_install", "H"), desc("amount_total", "R"),
    ]);
    expect(cols.map((c) => c.col)).toEqual(["R"]);
  });

  it("no total -> the halves summed", () => {
    const cols = bcsAmountColumns(null, [desc("amount_supply", "G"), desc("amount_install", "H")]);
    expect(cols.map((c) => c.col)).toEqual(["G", "H"]);
  });

  it("★ the denominator RESOLVES with no confirmation -- the blank-margin regression", () => {
    const amount = bcsRowAmount(
      null,
      (e) => (e.value_field === "amount_total" ? 28500 : null),
      [desc("amount_total", "R")],
    );
    expect(amount).toBe(28500);
  });

  it("and the margin therefore computes end to end (the reported case)", () => {
    // Cost 900 x qty 95 = 85500 against an amount of 28500 -> a real LOSS of -200%.
    const cost: BcsComputedCell = { kind: "value", value: 85500 };
    const amount = bcsRowAmount(
      null,
      (e) => (e.value_field === "amount_total" ? 28500 : null),
      [desc("amount_total", "R")],
    );
    expect(bcsMarginPercent(cost, bcsTenderedAmountCell(amount))).toEqual({
      kind: "value",
      value: -200,
    });
  });

  it("the SEED and the fallback pick the same columns -- opening the ƒ must not move a margin", () => {
    const ds = [desc("amount_supply", "G"), desc("amount_install", "H")];
    const seeded = defaultBoqTotalFormula(null, ds);
    const viaSeed = boqTotalAmount(seeded, null, (e) => (e.value_field === "amount_supply" ? 100 : 40), ds);
    const viaFallback = boqTotalAmount(null, null, (e) => (e.value_field === "amount_supply" ? 100 : 40), ds);
    expect(viaSeed).toBe(viaFallback);
  });
});

// ===========================================================================
// Group: THE TWO DERIVATIONS -- this side of their half of the table
// ===========================================================================
/**
 * ★ `bcsQuantityColumns` / `bcsLiveRateKinds` answer the question that comes BEFORE a pick
 * exists: given only the sheet's own shape, which columns does BCS use? `sources.
 * derive_qty_columns` / `sources.live_rate_kinds` answer it on the server, and the same shared
 * table covers both.
 *
 * WHY THE SERVER GAINED A COPY. It never computed a BCS number before; the BCS export does, so
 * it has to know which cost boxes a sheet has and where its quantity lives. The CONFIRMATION
 * cannot supply that -- BCS-S12 removed both column pickers, so `confirm_bcs_columns` has had no
 * caller in the product since and six of the seven live BCS-enabled sheets carry no
 * `bcs_qty_source` at all.
 *
 * ⚠️ AND THIS SIDE WAS THE WRONG ONE. The rate map here keyed the per-area AMOUNT spelling, so a
 * sheet whose rates are mapped per-area got NO cost boxes -- with the unit fixtures above
 * carrying the same wrong spelling, so mirror and test were green together. The Python suite
 * anchors the fixtures to `classifier`'s own maps rather than to this file agreeing with the
 * server, because agreement between two mirrors is exactly what did not catch it.
 */
describe("derivation parity -- the shared case table, this side", () => {
  it("agrees with the shared table on every derived-quantity case", () => {
    for (const c of PARITY.derived_qty_cases) {
      const out = bcsQuantityColumns(c.confirmed, c.descriptors);
      expect(
        out.map((e) => [e.col, e.value_field, e.value_key ?? null]),
        `${c.id}: ${c.why}`,
      ).toEqual(c.expect.columns.map((e) => [e.col, e.value_field, e.value_key]));
    }
  });

  it("agrees with the shared table on every rate-kinds case", () => {
    for (const c of PARITY.rate_kinds_cases) {
      expect(bcsLiveRateKinds(c.descriptors), `${c.id}: ${c.why}`).toEqual(c.expect.kinds);
    }
  });

  it("agrees with the shared table on every derived-amount case", () => {
    // ★ The THIRD derivation (BCS export slice 6). `bcsAmountColumns` decides what % Margin
    // divides BY, and the export now writes that division into the client's workbook as a
    // live Excel formula -- so a drift between the two sides is a wrong PERCENTAGE in a file
    // sent to a human, not merely an inconsistency.
    for (const c of PARITY.derived_amount_cases) {
      const out = bcsAmountColumns(c.confirmed, c.descriptors);
      expect(
        out.map((e) => [e.col, e.value_field, e.value_key ?? null]),
        `${c.id}: ${c.why}`,
      ).toEqual(c.expect.columns.map((e) => [e.col, e.value_field, e.value_key]));
    }
  });

  it("runs an amount table that exercises every tier -- anti-vacuity", () => {
    // Two of the tiers exist ONLY to prevent a double count (a total already contains its
    // halves; a scalar already contains its per-area parts), which are the same two harms
    // the pick path refuses as `mixed_kinds` and `mixed_shapes`. A table missing one leaves
    // a hole straight through those refusals.
    const outs = PARITY.derived_amount_cases.map(
      (c) => [c, bcsAmountColumns(c.confirmed, c.descriptors)] as const,
    );
    const fields = new Set(outs.flatMap(([, out]) => out.map((e) => e.value_field)));
    for (const f of ["amount_total", "amount_supply", "amount_by_area"]) {
      expect(fields.has(f), `no case lands on the ${f} tier`).toBe(true);
    }
    expect(
      PARITY.derived_amount_cases.some((c) => c.confirmed && c.confirmed.columns.length > 0),
      "no case exercises the confirmed branch",
    ).toBe(true);
    expect(outs.some(([, out]) => out.length === 0)).toBe(true);

    // The double count itself, asserted over every case rather than the one fixture.
    for (const [c, out] of outs) {
      const got = new Set(out.map((e) => e.value_field));
      if (got.has("amount_total")) {
        expect(
          got.has("amount_supply") || got.has("amount_install"),
          `${c.id}: a total was returned beside a half it already contains`,
        ).toBe(false);
      }
      if (got.has("amount_by_area")) {
        expect(got.size, `${c.id}: per-area mixed with a scalar`).toBe(1);
      }
    }
  });

  it("runs a table that exercises both shapes and every box -- anti-vacuity", () => {
    // The mirror of the Python suite's guard. A table of only scalar cases would compare
    // nothing about the half that was broken, and would have been green throughout the bug.
    const shapes = new Set(
      PARITY.rate_kinds_cases.flatMap((c) => c.descriptors.map((d) => d.value_field)),
    );
    expect(shapes.has("rate_by_area"), "no case uses a PER-AREA rate column").toBe(true);
    const kinds = new Set(PARITY.rate_kinds_cases.flatMap((c) => c.expect.kinds));
    expect([...kinds].sort()).toEqual(["combined", "install", "supply"]);
    expect(PARITY.rate_kinds_cases.some((c) => c.expect.kinds.length === 0)).toBe(true);
    const fields = new Set(
      PARITY.derived_qty_cases.flatMap((c) => c.expect.columns.map((e) => e.value_field)),
    );
    expect(fields.has("qty_total"), "no case lands on the scalar branch").toBe(true);
    expect(fields.has("qty_by_area"), "no case lands on the per-area branch").toBe(true);
    expect(
      PARITY.derived_qty_cases.some((c) => c.confirmed && c.confirmed.columns.length > 0),
      "no case exercises the confirmed branch",
    ).toBe(true);
    expect(PARITY.derived_qty_cases.some((c) => c.expect.columns.length === 0)).toBe(true);
  });

  it("every fixture descriptor has the shape the builder emits", () => {
    // Same guard as the Python side: a descriptor with an invented shape is how this file's
    // own fixtures came to agree with its own bug.
    const keys = ["area", "col", "rate_subkey", "role", "value_field", "value_key"];
    for (const c of [
      ...PARITY.derived_qty_cases,
      ...PARITY.rate_kinds_cases,
      ...PARITY.derived_amount_cases,
    ]) {
      for (const d of c.descriptors) {
        expect(Object.keys(d).sort(), `${c.id}: ${d.col}`).toEqual(keys);
      }
    }
  });
});
