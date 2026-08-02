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
import type { ColumnDescriptor } from "./boqTypes";
import {
  bcsChipLabel,
  bcsColumnLabel,
  bcsSelectionSaveable,
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
// failure mode, because a sheet silently measuring % Profit against supply alone looks
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

  it("names % Profit, because that is what the choice actually changes", () => {
    for (const [, cols] of EIGHT) {
      const v = validateBcsPicks("amount", cols, INDEX);
      expect(v.ok && v.summary).toMatch(/% Profit/);
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
      "% Profit is measured against the combined Amount in column F.",
    );
    expect(say(["J", "P"])).toBe(
      "% Profit is measured against the Supply amount plus the Installation amount " +
        "(columns J and P), added together.",
    );
    expect(say(["J"])).toBe(
      "% Profit is measured against the Supply amount alone (column J). Installation is " +
        "not included.",
    );
    expect(say(["P"])).toBe(
      "% Profit is measured against the Installation amount alone (column P). Supply is " +
        "not included.",
    );
    expect(say(["G", "H"])).toBe(
      "% Profit is measured against the combined Amount in columns G and H, added together.",
    );
    expect(say(["I", "S", "R", "T"])).toBe(
      "% Profit is measured against the Supply and Installation amounts in columns I, S, R " +
        "and T, all added together.",
    );
    expect(say(["I", "S"])).toBe(
      "% Profit is measured against the Supply amounts in columns I and S, added together. " +
        "Installation is not included.",
    );
    expect(say(["R", "T"])).toBe(
      "% Profit is measured against the Installation amounts in columns R and T, added " +
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
      // The sentence describes the FORMULA, so it never has a subject other than % Profit.
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
