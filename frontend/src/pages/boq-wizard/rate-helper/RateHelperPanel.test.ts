import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldShowLongOptionReadout, LONG_OPTION_CHARS, otherMode } from "./RateHelperPanel";

// ══════════════════════════════════════════════════════════════════════════════════════════
// THE LONG-OPTION WRAPPED READ-OUT (owner ruling 2026-09-04, option C)
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// A native <select> does NOT wrap its option text, so a long catalogue description is truncated to
// one line and a pricer cannot read what they picked. The fix adds a READ-ONLY wrapped paragraph
// BENEATH the control -- the select itself is untouched, because its blank-versus-fallback
// behaviour is owner-locked and that rule once cost 12 live rows.
//
// ⚠️ WHAT THESE TESTS CAN AND CANNOT REACH. This repo has NO DOM test environment by deliberate
// choice (frontend/CLAUDE.md), so the rendered paragraph itself is not assertable here -- only a
// live browser can see it, and it was certified there. What IS assertable, and what actually
// carries the risk, is the PREDICATE that gates it and the promise that the gate names no category.
// ══════════════════════════════════════════════════════════════════════════════════════════

const SHORT = "6A/16A 3-Pin Socket";                                   // 19 chars, switch_socket_item
const OTHER_CATEGORY_LONGEST = "Industrial Socket with Socket Outlet Interlocked"; // 48, the true max
const LMS_SHORTEST = "DB BOX for mounting dimming , swithcing module";   // 46, the shortest LMS item
const LMS_TYPICAL =
  "Supply, Installation, Testing & Commissioning of Power Supply Unit for supply PDUs to Antenna " +
  "devices Similar to Lutron QSPS-DH -1 -75";                          // 134
const LMS_LONGEST =
  "Supply of QS cable for power and data simialr to Lutron QS-CBL-LSZH Cable Adheres to CE " +
  "standards for Low Smoke Generation (EN 60332-1-2), Halogen Gas Emission (EN 61034-2), and Flame " +
  "Retardation (EN 60754-1&2). Five Conductors: Common 0.75 mm2 (18 AWG) Power 0.75 mm2 (18 AWG) " +
  "MUX Data 0.25 mm2 (22 AWG) Data 0.25 mm2 (22 AWG) Drain Wire 0.2 mm2 (24 AWG)";  // ~430

describe("long-option read-out: the threshold is a MEASUREMENT, and the margin is the point", () => {
  it("the threshold sits clearly above every other category and clearly below LMS's median", () => {
    // Live Electrical catalogue, measured 2026-09-04:
    //   lms_item descriptions      46 .. 434, median 215
    //   every OTHER kind's longest  48 (industrial_socket), then 42, 42, 38, 26
    // 80 is in the gap. It cannot fire on today's other categories, and a future long-option
    // category inherits the read-out with no code change.
    expect(LONG_OPTION_CHARS).toBeGreaterThan(48);
    expect(LONG_OPTION_CHARS).toBeLessThan(215);
    expect(OTHER_CATEGORY_LONGEST.length).toBe(48);
  });

  it("a LONG option gets the read-out", () => {
    expect(shouldShowLongOptionReadout(LMS_TYPICAL, true)).toBe(true);
    expect(shouldShowLongOptionReadout(LMS_LONGEST, true)).toBe(true);
  });

  it("⚠️ NEGATIVE: a SHORT option gets nothing -- no other category's panel changes", () => {
    expect(shouldShowLongOptionReadout(SHORT, true)).toBe(false);
    // the longest string ANY other kind can produce still does not trip it
    expect(shouldShowLongOptionReadout(OTHER_CATEGORY_LONGEST, true)).toBe(false);
    // and even the SHORTEST LMS description stays out -- it fits on one line already
    expect(shouldShowLongOptionReadout(LMS_SHORTEST, true)).toBe(false);
  });

  it("⚠️ NEGATIVE: nothing selected renders nothing -- never a stale or placeholder string", () => {
    for (const empty of ["", null, undefined]) {
      expect(shouldShowLongOptionReadout(empty as string | null | undefined, true)).toBe(false);
    }
  });

  it("⚠️ NEGATIVE: a free-text field never gets it -- only a <select> truncates", () => {
    // `hasOptions` false means the field renders as an Input, which wraps nothing but is not
    // truncated to one line either. The read-out exists to undo a SELECT's truncation.
    expect(shouldShowLongOptionReadout(LMS_LONGEST, false)).toBe(false);
  });

  it("the boundary is exact and exclusive", () => {
    expect(shouldShowLongOptionReadout("x".repeat(LONG_OPTION_CHARS), true)).toBe(false);
    expect(shouldShowLongOptionReadout("x".repeat(LONG_OPTION_CHARS + 1), true)).toBe(true);
  });
});

describe("long-option read-out: the source promises", () => {
  const src = readFileSync(
    join(__dirname, "RateHelperPanel.tsx"),
    "utf8",
  );

  it("⚠️ NEGATIVE: the gate names NO category, kind or attribute id (test_lrd_05)", () => {
    // If any of these ever appears inside the predicate, the read-out becomes an LMS special case
    // and the next long-description category silently does not get it.
    const fn = src.slice(
      src.indexOf("export function shouldShowLongOptionReadout"),
      src.indexOf("export function shouldShowLongOptionReadout") + 700,
    );
    for (const forbidden of [
      "lighting_mgmt_system", "lms_item", "lms", "description", "brand",
      "category", "kind", "item_kinds",
    ]) {
      expect(fn.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("⚠️ NEGATIVE: the read-out is READ-ONLY -- it is a <p>, never an input or a control", () => {
    const block = src.slice(
      src.indexOf("shouldShowLongOptionReadout(shown"),
      src.indexOf("shouldShowLongOptionReadout(shown") + 600,
    );
    expect(block).toContain("<p");
    for (const control of ["<select", "<input", "<button", "<textarea", "onChange", "onClick"]) {
      expect(block).not.toContain(control);
    }
  });

  it("⚠️ NEGATIVE: the read-out reads the SAME value the select shows, so they cannot disagree", () => {
    // It is passed `shown` -- the identical expression bound to the select's `value` prop.
    expect(src).toContain("shouldShowLongOptionReadout(shown, !!a.options)");
    expect(src).toContain("value={shown}");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// SLICE 11 (owner addition, 2026-09-25) -- THE UNIT THE RATE IS QUOTED IN, on every priced
// item and on the row total.
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ WHAT THIS CAN AND CANNOT REACH, again. There is no DOM test environment here, so the
// rendered "per Sqft" itself is certified in the browser, not asserted. What IS assertable is
// the SEAM that carries it -- and the one thing that actually carries risk: `FiguresRow` is
// THE ONE renderer of the three figures and the NON-item-list surface mounts it too, which is
// what Electrical renders. If the label were a property of the component rather than an
// opt-in per call site, Electrical's panel would change. The owner's instruction was to STOP
// rather than widen it, so these tests pin that it did not.
describe("slice 11 / the unit label is opt-in per call site, which is what keeps Electrical unchanged", () => {
  const src = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");

  it("FiguresRow takes an OPTIONAL unit and renders it beside the number", () => {
    const start = src.indexOf("function FiguresRow");
    const fn = src.slice(start, src.indexOf("interface RateHelperPanelProps"));
    expect(fn).toContain("unit?: string | null");
    expect(fn).toContain("per {label}");
    // a blank or whitespace-only unit renders nothing -- never "per " with nothing after it
    expect(fn).toContain('unit.trim() !== ""');
  });

  it("both ITEM-LIST surfaces pass the row's own unit: each priced item, and the row total", () => {
    expect(src).toContain("<FiguresRow figures={b.figures} unit={view.unit} />");
    expect(src).toContain("<FiguresRow figures={rowTotals(view)} copy={false} muted unit={view.unit} />");
  });

  it("⚠️ NEGATIVE: the NON-item-list surface passes NO unit, so Electrical's figures are unchanged", () => {
    expect(src).toContain("<FiguresRow figures={g.figures} />");
    // exactly three mounts in the file, and exactly one of them is unit-less
    const mounts = src.match(/<FiguresRow /g) ?? [];
    expect(mounts.length).toBe(3);
    const unitless = src.match(/<FiguresRow (?![^>]*unit=)[^>]*\/>/g) ?? [];
    expect(unitless.length).toBe(1);
    expect(unitless[0]).toContain("g.figures");
  });

  it("⚠️ NEGATIVE: the label is the ROW's own unit text, never a class name the pricing invented", () => {
    // `view.unit` is the BoQ's own spelling; the class names live in the config and must not appear here
    for (const forbidden of ['"area"', '"length"', '"count"', "sq.m", "sqft"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * CERT-FOUND DEFECT (2026-10-04) -- "Other..." COULD NOT BE TYPED INTO
 *
 * Reported from the live screen: pick "Other..." for Thickness, type a size, nothing lands. The
 * cause was ONE binding. `ItemFieldView.value` is the RESOLVED size -- the ladder result, or blank
 * where nothing fits (rule X3: the field shows the size that will be PRICED) -- and the typed box
 * was bound to it. So every keystroke was rewritten to the rung it resolved to, or erased:
 *
 *   type "3"  -> 3 ladders up to 13   -> the box is rewritten to "13"
 *   type "32" -> 32 composes, no rung -> the box is BLANKED, and the note reported a stray "2"
 *
 * The box's render CONDITION keyed on the same resolved value, so a typed 16 resolved to the stocked
 * 19, `options.includes("19")` went true, and the box VANISHED mid-entry while the select jumped to a
 * size nobody chose.
 *
 * TWO DIFFERENT QUESTIONS WERE SHARING ONE FIELD: "what will be priced" and "what did you enter".
 * `typedValue` is the second, and `otherMode` keys on it. The resolution is not lost -- it shows in
 * the select beside the box and in the note beneath, which is what C-R4 asks for.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("CERT-FOUND -- a size can be TYPED into Other...", () => {
  const F = (over: Partial<{ allowOther: boolean; value: string; typedValue: string; options: string[] }>) => ({
    allowOther: true, value: "", typedValue: "", options: ["13", "19", "25"], ...over,
  });

  it("THE DEFECT: a typed size that RESOLVES keeps the box open and keeps what was typed", () => {
    expect(otherMode(F({ typedValue: "16", value: "19" }))).toBe(true);
  });

  it("THE DEFECT: a typed size that resolves to NOTHING also keeps the box open", () => {
    expect(otherMode(F({ typedValue: "32", value: "" }))).toBe(true);
  });

  it("a STOCKED size, typed or picked, is NOT other-mode -- the plain dropdown is untouched", () => {
    expect(otherMode(F({ typedValue: "19", value: "19" }))).toBe(false);
    expect(otherMode(F({ typedValue: "", value: "19" }))).toBe(false);
  });

  it("picking Other... (which CLEARS the field) opens the box", () => {
    expect(otherMode(F({ typedValue: "", value: "" }))).toBe(true);
  });

  it("a field without allowOther is NEVER other-mode, whatever it holds", () => {
    expect(otherMode(F({ allowOther: false, typedValue: "32", value: "" }))).toBe(false);
    expect(otherMode(F({ allowOther: false, typedValue: "", value: "" }))).toBe(false);
  });

  it("VACUITY: the OLD rule really did close the box on the case that broke", () => {
    const old = (x: { allowOther: boolean; value: string; options: string[] }) =>
      x.allowOther && (x.value === "" || !x.options.includes(x.value));
    // a typed 16 resolving to the stocked 19: OLD says closed (the defect), NEW says open
    expect(old({ allowOther: true, value: "19", options: ["13", "19", "25"] })).toBe(false);
    expect(otherMode(F({ typedValue: "16", value: "19" }))).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * OWNER RULING 2026-10-04 -- THE PANEL SAYS WHICH RATE IT IS SHOWING
 *
 * "the calculator panel should clearly mention whether the final rates are BoQ or BCS rate. it
 * should be BoQ rates."
 *
 * The screen gave a real reason to guess wrong: the working above each figure ends with
 * "ROUNDUP(BCS supply, 0)" and "BCS cost x (1 + markup)", so the last words before the number are
 * "BCS cost". The number is the BoQ rate -- what the CLIENT is charged.
 *
 * The label is written at the two CALL SITES, never inside `FiguresRow`, which is what keeps the
 * non-item-list (Electrical) surface byte-identical -- the same opt-in rule the `unit` label
 * follows. Both headings read ONE constant so they cannot drift.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("the panel names the rate it shows -- BoQ, not BCS", () => {
  const src = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");

  it("there is ONE label constant, and it says BoQ", () => {
    expect(src).toContain('const BOQ_RATE_LABEL = "BoQ rates";');
    expect((src.match(/const BOQ_RATE_LABEL/g) ?? []).length).toBe(1);
  });

  it("BOTH figure surfaces carry it -- the row total and each priced item", () => {
    expect(src).toContain("Row total per 1 {view.unit} &middot; {BOQ_RATE_LABEL}");
    // the per-item label sits immediately above that block's FiguresRow
    const i = src.indexOf("{BOQ_RATE_LABEL}");
    const j = src.indexOf("<FiguresRow figures={b.figures}");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("⚠️ it is NOT a property of FiguresRow -- that would change Electrical's panel", () => {
    // the same boundary the sibling unit-label test uses, so both read the identical span
    const start = src.indexOf("function FiguresRow");
    const fn = src.slice(start, src.indexOf("interface RateHelperPanelProps"));
    expect(fn).toContain("function FiguresRow");
    expect(fn).not.toContain("BOQ_RATE_LABEL");
    // ⚠️ NOT a bare /BoQ/ match: FiguresRow's own doc comment says "as the BoQ writes it" about the
    // UNIT, which is correct and unrelated. What must be absent is the rate LABEL it would render.
    expect(fn).not.toContain("BoQ rates");
  });

  it("NEGATIVE: the panel never labels these figures as a BCS rate", () => {
    // BCS appears in the WORKING the pricer emits, never as a heading over the final figures
    expect(src).not.toMatch(/BCS rates?"/);
    expect(src).not.toContain('const BCS_RATE_LABEL');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12c-S -- "Other..." IS A THING THE PRICER DID (owner S5 on F15), AND EVERY NOTE IS A
// BLUE INFO BOX (owner S7, "option A")
// ══════════════════════════════════════════════════════════════════════════════════════════
describe("SLICE 12c-S -- Other... mode and the note box", () => {
  const src = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");
  const f = (o: Partial<{ allowOther: boolean; value: string; typedValue: string; options: string[]; otherMode: boolean }>) =>
    ({ allowOther: true, value: "", typedValue: "", options: ["13", "19"], ...o });

  it("F15: the helper's own verdict is the authority when it is present", () => {
    expect(otherMode(f({ otherMode: true }))).toBe(true);
    expect(otherMode(f({ otherMode: false, value: "", typedValue: "" }))).toBe(false);
    // ⚠️ THE WHOLE POINT: a FRESH field (nothing typed, nothing resolved) is NOT in Other mode.
    // Derived from emptiness alone -- as the legacy branch below still does -- it was, and every
    // new item opened already claiming a choice the pricer had not made.
  });

  it("F15 NEGATIVE: a field that cannot type is never in Other mode, whatever the flag says", () => {
    expect(otherMode(f({ allowOther: false, otherMode: true }))).toBe(false);
  });

  it("the legacy derivation is UNCHANGED for a caller that passes no verdict", () => {
    // every pre-slice caller hands this predicate a bare value / typedValue pair; those must behave
    // exactly as they did, which is what keeps this an addition rather than a rewrite
    expect(otherMode(f({ typedValue: "30" }))).toBe(true);        // typed, unstocked
    expect(otherMode(f({ typedValue: "13" }))).toBe(false);       // typed, stocked
    expect(otherMode(f({ value: "" }))).toBe(true);               // the old emptiness rule
    expect(otherMode(f({ value: "13" }))).toBe(false);
  });

  /**
   * S7 ("option A"): one blue info box, with an info icon, for every note -- panel AND calculator,
   * both disciplines. Amber stays for a ruled DEFAULT and red for a refusal; those were explicitly
   * left alone.
   */
  it("S7: notes render in an accent info box, and the amber default line is untouched", () => {
    // the item-list field box and the Electrical attribute box are the SAME treatment
    expect(src.match(/bg-accent\/40/g)?.length).toBe(2);
    expect(src).toContain("<Info className=");
    // the ruled default keeps amber -- the one tone this panel reserves for "we filled this in"
    expect(src).toMatch(/\{f\.rule && <p className="pl-1 text-\[10px\] leading-tight text-amber-700/);
  });

  /**
   * F4: both the note and the "How is this matched?" help were gated on the field NOT holding a
   * stocked value, so they existed only while the row was broken and vanished the moment it priced.
   * The gate is gone; this pins that it stays gone, because its return would be invisible in a
   * repo with no DOM test environment.
   */
  it("F4: the guidance is no longer gated on the field being unresolved", () => {
    expect(src).not.toContain('f.typedNote && (f.value === "" || !(f.options ?? []).includes(f.value))');
    expect(src).not.toContain('&& (f.value === "" || !(f.options ?? []).includes(f.value)) && (');
    // and it still renders at all
    expect(src).toContain("{f.typedNote && <p");
    expect(src).toContain("How is this matched?");
  });

  it("S7: choosing Other... is RECORDED through the edit op, not inferred from the field clearing", () => {
    expect(src).toContain('op: "set_other"');
    // a real pick closes the box in the SAME op, because two dispatches from one handler would
    // both start from the rendered state and the second would discard the first
    expect(src).toContain('onEdit({ op: "set_attr", index: i, id: f.id, value: e.target.value });');
  });
});
