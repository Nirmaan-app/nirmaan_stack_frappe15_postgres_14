import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldShowLongOptionReadout, LONG_OPTION_CHARS } from "./RateHelperPanel";

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
