import { describe, expect, it } from "vitest";

import {
  UPLOAD_COPY,
  canApply,
  cellText,
  changeSummary,
  formatPct,
  headlineCounts,
  planIsNoOp,
  splitChanges,
  TWIN_COPY,
  rowsWithTwin,
  twinFingerprints,
  twinNumbers,
  undecidedTwinRows,
  type UploadChange,
  type UploadCounts,
  type UploadPlan,
  type UploadTwin,
} from "./rateMasterUpload";

// SLICE 6. `fileToBase64` is deliberately NOT covered here: it wraps FileReader, and this project
// runs vitest with environment "node" and no DOM on purpose (see frontend/CLAUDE.md). Everything
// that DECIDES what a user is shown before they confirm a write is pure, and is covered.
//
// Plain-English coverage summary (test -> changed behaviour):
//   * splitChanges is the ONLY grouping rule, and it reads the server's `major` flag rather than
//     re-deriving the 10% threshold client-side -- two definitions of "major" would be free to
//     disagree about the same row.
//   * headlineCounts emits the owner's four chips in order, and shows `other changes` ONLY when
//     it is non-zero: a row that moved in some way other than a rate is none of the four, and
//     folding it into one of them would mislabel it.
//   * canApply refuses on ANY error -- the apply is all-or-nothing, so a partly-good file is not
//     partly appliable.
//   * formatPct signs both directions and stays silent where a percentage does not exist.
//   * the copy names the safety property (absent items untouched) and the rollback (a snapshot),
//     because those are the two facts that make confirming safe.

const change = (over: Partial<UploadChange> = {}): UploadChange => ({
  row: 1,
  kind: "update",
  item_uid: "rmi-000000000001",
  name: "ITEM-1",
  label: "cable / 1C 6.0",
  major: false,
  fields: [{ space: "rate", column: "list_price", old: "100.0", new: "104.0", pct: 4 }],
  ...over,
});

const counts = (over: Partial<UploadCounts> = {}): UploadCounts => ({
  rates_changed: 0,
  items_added: 0,
  unchanged: 0,
  other_changed: 0,
  errors: 0,
  ...over,
});

const plan = (over: Partial<UploadPlan> = {}): UploadPlan => ({
  discipline: "Electrical",
  mode: "category",
  encoding: "utf-8",
  row_count: 3,
  columns: { attributes: [], rates: [], fixed: [] },
  counts: counts(),
  errors: [],
  changes: [],
  digest: "abc",
  ...over,
});

describe("splitChanges", () => {
  it("expands what the server marked major and collapses the rest", () => {
    const big = change({ row: 1, major: true });
    const small = change({ row: 2, major: false });
    const added = change({ row: 3, kind: "add", item_uid: null, major: true });

    const { expanded, collapsed } = splitChanges([big, small, added]);
    expect(expanded.map((c) => c.row)).toEqual([1, 3]);
    expect(collapsed.map((c) => c.row)).toEqual([2]);
  });

  it("grouping and colour read the SAME server flags -- red-but-collapsed is impossible", () => {
    // F-21. The dialog used to colour a percentage from its own `Math.abs(f.pct) >= 10`, reading
    // the ROUNDED pct while the server classified from the raw one. At the boundary they
    // disagreed: an exactly -10% move computed -9.999999999999993 (not major -> COLLAPSED) but
    // arrived rounded to -10.0 (>= 10 -> RED). The row shouted and hid at the same time.
    //
    // ⚠️ The colour itself lives in JSX and is STRUCTURALLY untestable here -- vitest runs with
    // environment "node" and there is no DOM, by deliberate choice (frontend/CLAUDE.md). What IS
    // testable, and is the thing that makes the contradiction impossible, is the DATA CONTRACT:
    // the change-level flag that drives grouping must be exactly "any rate field flagged", so a
    // collapsed change cannot contain a field the dialog would paint red. The rendered half is
    // covered by the browser cert.
    const boundary = { space: "rate" as const, column: "list_price", old: "491.0",
                       new: "441.90000000000003", pct: -10, major: true };
    const small = { space: "rate" as const, column: "install_base", old: "100.0",
                    new: "98.0", pct: -2, major: false };
    const big = change({ row: 1, major: true, fields: [boundary, small] });
    const quiet = change({ row: 2, major: false, fields: [small] });

    const { expanded, collapsed } = splitChanges([big, quiet]);
    expect(expanded.map((c) => c.row)).toEqual([1]);
    expect(collapsed.map((c) => c.row)).toEqual([2]);

    for (const c of [big, quiet]) {
      expect(c.major).toBe(c.fields.some((f) => f.space === "rate" && f.major === true));
    }
    // the collapsed group carries NOTHING the dialog would paint red
    for (const c of collapsed) {
      expect(c.fields.some((f) => f.major === true)).toBe(false);
    }
  });

  it("keeps every change in exactly one of the two groups -- collapsed is not hidden", () => {
    const all = [change({ row: 1, major: true }), change({ row: 2 }), change({ row: 3 })];
    const { expanded, collapsed } = splitChanges(all);
    expect(expanded.length + collapsed.length).toBe(all.length);
  });

  it("handles an empty list without inventing groups", () => {
    expect(splitChanges([])).toEqual({ expanded: [], collapsed: [] });
  });
});

describe("headlineCounts", () => {
  it("emits the owner's four chips, in order", () => {
    const chips = headlineCounts(counts({ rates_changed: 4, items_added: 1, unchanged: 30 }));
    expect(chips.map((c) => c.key)).toEqual([
      "rates_changed",
      "items_added",
      "unchanged",
      "errors",
    ]);
    expect(chips.map((c) => c.label)).toEqual([
      "rates changed",
      "items added",
      "rows unchanged",
      "errors",
    ]);
  });

  it("adds `other changes` ONLY when a row moved in some way other than a rate", () => {
    expect(headlineCounts(counts()).map((c) => c.key)).not.toContain("other_changed");
    const withOther = headlineCounts(counts({ other_changed: 2 }));
    expect(withOther.map((c) => c.key)).toContain("other_changed");
    // ...and it sits with the other change counts, ahead of the unchanged/error tail
    expect(withOther.findIndex((c) => c.key === "other_changed"))
      .toBeLessThan(withOther.findIndex((c) => c.key === "unchanged"));
  });

  it("marks errors as an error tone so a non-zero one cannot read as ordinary", () => {
    const chips = headlineCounts(counts({ errors: 1 }));
    expect(chips.find((c) => c.key === "errors")?.tone).toBe("error");
  });
});

describe("canApply / planIsNoOp", () => {
  it("refuses on ANY error, even beside good changes -- the apply is all-or-nothing", () => {
    const withErrors = plan({
      changes: [change({ major: true })],
      errors: [{ row: 4, column: "", message: "'x' is not a number." }],
    });
    expect(canApply(withErrors)).toBe(false);
  });

  it("allows a clean plan that actually changes something", () => {
    expect(canApply(plan({ changes: [change()] }))).toBe(true);
  });

  it("refuses a clean plan with nothing to do, and reports it as a no-op", () => {
    const nothing = plan({ counts: counts({ unchanged: 3 }) });
    expect(canApply(nothing)).toBe(false);
    expect(planIsNoOp(nothing)).toBe(true);
  });

  it("refuses when there is no plan at all", () => {
    expect(canApply(null)).toBe(false);
  });

  it("a plan carrying errors is NOT a no-op -- there is something to fix", () => {
    expect(planIsNoOp(plan({ errors: [{ row: 1, column: "", message: "bad" }] }))).toBe(false);
  });
});

describe("formatPct", () => {
  it("signs a rise and a fall -- both directions matter", () => {
    expect(formatPct(10)).toBe("+10%");
    expect(formatPct(-10)).toBe("-10%");
  });

  it("rounds to one place rather than printing float noise", () => {
    expect(formatPct(12.3456)).toBe("+12.3%");
  });

  it("says nothing where a percentage does not exist (a rate appearing, or from zero)", () => {
    expect(formatPct(null)).toBe("");
    expect(formatPct(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatPct(Number.NaN)).toBe("");
  });
});

describe("cellText / changeSummary", () => {
  it("renders an empty cell as an em-dash so 'cleared' never looks like a rendering bug", () => {
    expect(cellText("")).toBe("—");
    expect(cellText("0")).toBe("0");
  });

  it("summarises an update by its columns and an add by what it is", () => {
    expect(changeSummary(change())).toBe("list_price");
    expect(changeSummary(change({ kind: "add", item_uid: null }))).toBe("new item");
  });

  it("truncates a long column list rather than filling the row", () => {
    const many = change({
      fields: ["a", "b", "c", "d", "e"].map((column) => ({
        space: "rate" as const, column, old: "1", new: "2", pct: 1,
      })),
    });
    expect(changeSummary(many)).toBe("a, b, c +2 more");
  });
});

describe("UPLOAD_COPY", () => {
  it("names the safety property -- absent items are left untouched", () => {
    expect(UPLOAD_COPY.absentHint.toLowerCase()).toContain("untouched");
  });

  it("names the rollback, because that is what makes confirming safe", () => {
    expect(UPLOAD_COPY.snapshotNote.toLowerCase()).toContain("snapshot");
    expect(UPLOAD_COPY.snapshotNote.toLowerCase()).toContain("rolled back");
  });

  it("states the expansion rule in BOTH directions, not just 'increases'", () => {
    expect(UPLOAD_COPY.expandedHint).toContain("10%");
    expect(UPLOAD_COPY.expandedHint).toContain("either direction");
  });

  it("says the errors case is all-or-nothing rather than merely 'some rows failed'", () => {
    expect(UPLOAD_COPY.errorsTitle(2)).toContain("nothing will be applied");
    expect(UPLOAD_COPY.errorsHint).toContain("all-or-nothing");
  });

  it("pluralises the collapsed label and the error title honestly", () => {
    expect(UPLOAD_COPY.collapsedLabel(1)).toBe("1 smaller change");
    expect(UPLOAD_COPY.collapsedLabel(4)).toBe("4 smaller changes");
    expect(UPLOAD_COPY.errorsTitle(1)).toContain("1 problem —");
  });

  it("warns about a non-UTF-8 read by NAMING the encoding the server actually used", () => {
    expect(UPLOAD_COPY.encodingWarn("cp1252")).toContain("cp1252");
  });
});

// ── SLICE 1e -- Excel by default, CSV second; the upload accepts both; no system columns ──────────
import {
  DEFAULT_RATE_FILE_FORMAT,
  FORMAT_COPY,
  RATE_FILE_FORMATS,
  UPLOAD_ACCEPT,
  rateFileFallbackName,
  showEncodingWarning,
} from "./rateMasterUpload";

describe("SLICE 1e -- the rate-file format (owner X-a)", () => {
  it("Excel is the default and the first choice; CSV is the second, and there is no third", () => {
    expect(DEFAULT_RATE_FILE_FORMAT).toBe("xlsx");
    expect(RATE_FILE_FORMATS.map((f) => f.id)).toEqual(["xlsx", "csv"]);
    expect(RATE_FILE_FORMATS[0].label).toBe("Excel");
    expect(RATE_FILE_FORMATS[1].label).toBe("CSV");
  });
  it("the file picker admits BOTH formats by extension and by media type", () => {
    const parts = UPLOAD_ACCEPT.split(",");
    expect(parts).toContain(".xlsx");
    expect(parts).toContain(".csv");
    expect(parts).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(parts).toContain("text/csv");
  });
  it("the upload hint names both formats and the format hint explains why Excel is the default", () => {
    expect(UPLOAD_COPY.hint).toMatch(/Excel/);
    expect(UPLOAD_COPY.hint).toMatch(/CSV/);
    expect(FORMAT_COPY.hint).toMatch(/1:6/);
  });
  it("the fallback file name follows the format and the mode", () => {
    expect(rateFileFallbackName("hvac_adp", "xlsx")).toBe("rate_master_hvac_adp.xlsx");
    expect(rateFileFallbackName(null, "csv")).toBe("rate_master_all.csv");
  });
});

describe("showEncodingWarning -- the cp1252 warning is about a CSV decode, never a workbook", () => {
  it("fires for a cp1252 csv, stays silent for a utf-8 csv and for ANY xlsx (NEGATIVE)", () => {
    expect(showEncodingWarning({ format: "csv", encoding: "cp1252" })).toBe(true);
    expect(showEncodingWarning({ format: "csv", encoding: "utf-8" })).toBe(false);
    expect(showEncodingWarning({ format: "xlsx", encoding: "xlsx" })).toBe(false);
    // a pre-1e server reply carries no `format`: the old rule stands unchanged
    expect(showEncodingWarning({ encoding: "cp1252" } as { encoding: string; format?: "xlsx" | "csv" })).toBe(true);
    expect(showEncodingWarning({ encoding: "utf-8" } as { encoding: string; format?: "xlsx" | "csv" })).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 1f -- SAME-MEANING DUPLICATES (owner Y-a..Y-f). Plain-English coverage:
//   * the warning is the approved sentence, with BOTH wordings and the existing item's uid; the edit
//     case adds the line naming the edited item, which stays as it is;
//   * canApply is FALSE while any duplicate warning is unanswered (the server refuses too; this keeps
//     the button honest) and TRUE once every one is confirmed or declined; a plan with no warning is
//     unchanged (NEGATIVE: the pre-1f rule still holds for it);
//   * twinFingerprints sends a fingerprint for a CONFIRMED row only -- never for a decline, never for a
//     row without a warning;
//   * the `same as existing` chip appears ONLY when the count is non-zero (like `other changes`), so an
//     ordinary upload keeps its four numbers;
//   * twinNumbers renders the numbers in a stable order with the em-dash for a blank.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const twin = (over: Partial<UploadTwin> = {}): UploadTwin => ({
  case: "new",
  item_uid: "rmi-31fd9a7020d8",
  name: "BRMI-26-1",
  existing_wording: "Round Diffuser Without GI Damper / 300 MM DIA",
  row_wording: "Round Diffuser Without GI Dampers / 300 MM DIA",
  existing_rates: { cost_install: "250.0", cost_supply: "720.0" },
  row_rates: { cost_install: "150.0", cost_supply: "800.0" },
  compared: ["family", "damper", "dia_mm"],
  fingerprint: "fp-existing",
  decision: null,
  ...over,
});

describe("SLICE 1f -- the duplicate warning", () => {
  it("is the approved sentence with BOTH wordings and the existing item's uid", () => {
    const t = twin();
    const text = TWIN_COPY.warning(t.existing_wording, t.item_uid, t.row_wording);
    expect(text).toBe(
      "This means the same as an existing item: Round Diffuser Without GI Damper / 300 MM DIA (rmi-31fd9a7020d8). " +
      "Your row says: Round Diffuser Without GI Dampers / 300 MM DIA. " +
      "If you confirm, the existing item's rates and markups are updated to these; its wording stays as it is.",
    );
    // an existing item WITHOUT a uid (added by hand): no empty bracket
    expect(TWIN_COPY.warning("A / B", "", "C / D")).toBe(
      "This means the same as an existing item: A / B. Your row says: C / D. " +
      "If you confirm, the existing item's rates and markups are updated to these; its wording stays as it is.",
    );
    // the edit case (Y-e) names the edited item and says it stays exactly as it is
    expect(TWIN_COPY.editNote("rmi-aaaaaaaaaaaa")).toContain("rmi-aaaaaaaaaaaa");
    expect(TWIN_COPY.editNote("rmi-aaaaaaaaaaaa")).toMatch(/exactly as it is/);
    expect(TWIN_COPY.decided("confirm")).toMatch(/existing item/);
    expect(TWIN_COPY.decided("decline")).toMatch(/nothing changes/);
  });
  it("renders both sets of numbers in a stable order, em-dash for a blank", () => {
    expect(twinNumbers({ cost_supply: "720.0", cost_install: "250.0" })).toBe("cost_install = 250.0, cost_supply = 720.0");
    expect(twinNumbers({ b: "", a: "1" })).toBe("a = 1, b = \u2014");
    expect(twinNumbers({})).toBe("");
  });
  it("names the warning rows and the UNANSWERED ones; canApply waits for every answer", () => {
    const p = plan({
      changes: [
        change({ row: 1, kind: "add", item_uid: null, major: true, twin: twin() }),
        change({ row: 2, major: false }),
        change({ row: 3, kind: "add", item_uid: null, major: true, twin: twin({ fingerprint: "fp3" }) }),
      ],
    });
    expect(rowsWithTwin(p)).toEqual([1, 3]);
    expect(rowsWithTwin(null)).toEqual([]);
    expect(undecidedTwinRows(p, {})).toEqual([1, 3]);
    expect(undecidedTwinRows(p, { 1: "confirm" })).toEqual([3]);
    expect(undecidedTwinRows(p, { 1: "confirm", 3: "decline" })).toEqual([]);
    expect(canApply(p)).toBe(false);                                 // unanswered -> no apply
    expect(canApply(p, { 1: "confirm" })).toBe(false);               // one still unanswered
    expect(canApply(p, { 1: "confirm", 3: "decline" })).toBe(true);  // every warning answered
    expect(canApply(p, { 1: "decline", 3: "decline" })).toBe(true);  // declining all is an answer too
    // NEGATIVE: a plan with NO warning keeps the pre-1f rule -- appliable without any decision map
    const q = plan({ changes: [change({ row: 1 })] });
    expect(canApply(q)).toBe(true);
    expect(canApply(plan({ changes: [change({ row: 1 })], errors: [{ row: 1, column: "", message: "x" }] }))).toBe(false);
  });
  it("sends a fingerprint for a CONFIRMED warning row only", () => {
    const p = plan({
      changes: [
        change({ row: 1, kind: "add", item_uid: null, twin: twin({ fingerprint: "fp1" }) }),
        change({ row: 2 }),
        change({ row: 3, kind: "add", item_uid: null, twin: twin({ fingerprint: "fp3" }) }),
      ],
    });
    expect(twinFingerprints(p, { 1: "confirm", 2: "confirm", 3: "decline" })).toEqual({ 1: "fp1" });
    expect(twinFingerprints(p, {})).toEqual({});
    expect(twinFingerprints(null, { 1: "confirm" })).toEqual({});
  });
  it("the chip appears ONLY when the count is non-zero, after the four, before unchanged", () => {
    const keys = (c: UploadCounts) => headlineCounts(c).map((x) => x.key);
    expect(keys(counts())).toEqual(["rates_changed", "items_added", "unchanged", "errors"]);
    expect(keys(counts({ twins: 0 }))).toEqual(["rates_changed", "items_added", "unchanged", "errors"]);
    expect(keys(counts({ twins: 2 }))).toEqual(["rates_changed", "items_added", "twins", "unchanged", "errors"]);
    const chip = headlineCounts(counts({ twins: 2 })).find((x) => x.key === "twins")!;
    expect(chip.label).toBe(TWIN_COPY.chip);
    expect(chip.value).toBe(2);
    expect(chip.tone).toBe("warn");
  });
  it("the shown-in-full hint names the duplicate rows (the server promotes them to major)", () => {
    expect(UPLOAD_COPY.expandedHint).toMatch(/same as an existing item/);
    expect(UPLOAD_COPY.expandedHint).toContain("ask about or flags");   // the 1d half stays
  });
});
