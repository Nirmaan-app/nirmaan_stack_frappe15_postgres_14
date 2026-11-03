// DEV2-B6 S2 PANEL ICON (owner 23:02 "thats what i am sayting there are no sprkles to click on"; owner answer 2 "widen").
// On a row with a rate-helper result (a badge entry on any rate cell, or a "Previously priced" match) every rate cell
// shows a 16 px sparkle VISIBLE WITHOUT HOVER ("Open rate suggestions"), beside its badge / tick; a row with no result
// keeps the old faint opener. The JSX is pinned by source (the grid's tests are pure + source pins: no jsdom here).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RATE_HELPER_OPEN_TEXT, rateHelperOpenerKind } from "./PricingGrid";

const badge = { byCol: { F: { count: 2, used: false } } };
const used = { byCol: { F: { count: 1, used: true } } };

describe("rateHelperOpenerKind", () => {
  it("a cell with a badge or a tick: the badge AND the visible sparkle", () => {
    expect(rateHelperOpenerKind(badge, "F", false)).toBe("badge+sparkle");
    expect(rateHelperOpenerKind(used, "F", false)).toBe("badge+sparkle");
  });

  it("another rate cell of a row with a result: the visible sparkle alone", () => {
    expect(rateHelperOpenerKind(badge, "G", false)).toBe("sparkle");
  });

  it("WIDEN: a row with only a previously-priced match (no badge) gets the visible sparkle", () => {
    expect(rateHelperOpenerKind(undefined, "F", true)).toBe("sparkle");
    expect(rateHelperOpenerKind({ byCol: {} }, "G", true)).toBe("sparkle");
  });

  it("a row with no result keeps the faint opener (shown / absent)", () => {
    expect(rateHelperOpenerKind(undefined, "F", false)).toBe("faint");
    expect(rateHelperOpenerKind({ byCol: {} }, "F", false)).toBe("faint");
  });
});

describe("the opening icon in the grid (source)", () => {
  const src = readFileSync(join(__dirname, "PricingGrid.tsx"), "utf-8");
  const at = src.indexOf("{/* DEV2-B6 PANEL ICON");
  const block = src.slice(at, src.indexOf('title="Fill attributes to price this row"', at));

  it("is 16 px, coloured (not the faint 40 %), with the tooltip and screen-reader text", () => {
    expect(RATE_HELPER_OPEN_TEXT).toBe("Open rate suggestions");
    expect(block).toContain('<Sparkles className="h-4 w-4" />');
    expect(block).toContain("title={RATE_HELPER_OPEN_TEXT}");
    expect(block).toContain("aria-label={RATE_HELPER_OPEN_TEXT}");
    expect(block).toContain('data-testid="rate-helper-open"');
    const visible = block.slice(block.indexOf('data-testid="rate-helper-open"') - 600, block.indexOf('data-testid="rate-helper-open"'));
    expect(visible).not.toContain("text-muted-foreground/40");
    expect(visible).not.toMatch(/opacity-0|group-hover|invisible/);   // visible without hover
  });

  it("the row comparator re-renders a row whose match result changes", () => {
    expect(src).toContain("prev.hasMatchResult === next.hasMatchResult");
    expect(src).toContain("hasMatchResult={matchResultRows.has(row.source_row_number)}");
  });

  it("the page passes the rows with matches (owner answer 2: the new prop only)", () => {
    const page = readFileSync(join(__dirname, "SheetPricingPage.tsx"), "utf-8");
    expect(page).toContain("matchResultRows={RATE_HELPER_ENABLED && matchEnabled ? matchResultRows : undefined}");
    expect(page).toMatch(/filter\(\(r\) => \(r\.matches\?\.length \?\? 0\) > 0\)/);
  });
});
