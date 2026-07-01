// Focused render tests for ParentChain (BoQ level-derivation fix, Task F).
//
// ParentChain is a PURE presentational component, so we render it to a static HTML
// string via react-dom/server.renderToStaticMarkup -- this needs NO DOM (works under
// the repo's `environment: "node"` vitest harness), so we deliberately do NOT pull in
// jsdom / @testing-library (consistent with reviewRender.test.ts).
//
// What we pin (the level-derivation contract):
//   (a) a PREAMBLE crumb renders an "L{n}" level chip (reads effective_level);
//   (b) a LINE_ITEM crumb renders NO level chip (effective_level === null);
//   (c) the CURRENT-ROW terminal renders its OWN ClassificationPill (+ a chip iff preamble).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ParentChain } from "./ParentChain";
import type { ReviewRow } from "./boqTypes";

// Narrow ReviewRow fixture: ParentChain reads only row_index, source_row_number,
// effective_parent_index, effective_classification, effective_level, description.
function makeRow(p: {
  row_index: number;
  source_row_number: number;
  effective_parent_index: number | null;
  effective_classification: string | null;
  effective_level: number | null;
  description?: string | null;
}): ReviewRow {
  return {
    description: null,
    ...p,
  } as unknown as ReviewRow;
}

function render(row: ReviewRow, ancestors: ReviewRow[]): string {
  const byIdx = new Map<number, ReviewRow>(
    [...ancestors, row].map((r) => [r.row_index, r]),
  );
  return renderToStaticMarkup(
    <ParentChain row={row} byIdx={byIdx} onNavigate={() => {}} />,
  );
}

// Count rendered level chips: the chip body is exactly `L<digits>` between a `>` and `<`.
function levelChips(html: string): string[] {
  return [...html.matchAll(/>L(\d+)</g)].map((m) => m[1]);
}

describe("ParentChain level chip", () => {
  it("(a) renders an L{n} chip on each PREAMBLE crumb", () => {
    // root preamble (L1) -> nested preamble (L2) -> current line item
    const root = makeRow({
      row_index: 0,
      source_row_number: 5,
      effective_parent_index: null,
      effective_classification: "preamble",
      effective_level: 1,
      description: "CHILLED WATER",
    });
    const valves = makeRow({
      row_index: 1,
      source_row_number: 6,
      effective_parent_index: 0,
      effective_classification: "preamble",
      effective_level: 2,
      description: "VALVES",
    });
    const current = makeRow({
      row_index: 2,
      source_row_number: 7,
      effective_parent_index: 1,
      effective_classification: "line_item",
      effective_level: null,
      description: "Butterfly valve",
    });

    const chips = levelChips(render(current, [root, valves]));
    // Exactly the two preamble crumbs carry a chip -- L1 and L2, in chain order.
    expect(chips).toEqual(["1", "2"]);
  });

  it("(b) renders NO level chip on a LINE_ITEM crumb", () => {
    // a line_item ANCESTOR crumb -> current line item; neither carries effective_level
    const lineParent = makeRow({
      row_index: 0,
      source_row_number: 10,
      effective_parent_index: null,
      effective_classification: "line_item",
      effective_level: null,
      description: "Pump assembly",
    });
    const current = makeRow({
      row_index: 1,
      source_row_number: 11,
      effective_parent_index: 0,
      effective_classification: "line_item",
      effective_level: null,
      description: "Impeller",
    });

    expect(levelChips(render(current, [lineParent]))).toEqual([]);
  });

  it("(c) renders the current row's OWN ClassificationPill on the terminal", () => {
    // preamble ancestor ("Preamble" pill) -> current line item ("Item" pill). The "Item"
    // label can only come from the current-row terminal here, so its presence proves the
    // terminal now renders its own pill.
    const root = makeRow({
      row_index: 0,
      source_row_number: 3,
      effective_parent_index: null,
      effective_classification: "preamble",
      effective_level: 1,
      description: "GENERAL",
    });
    const current = makeRow({
      row_index: 1,
      source_row_number: 4,
      effective_parent_index: 0,
      effective_classification: "line_item",
      effective_level: null,
      description: "Gate valve",
    });

    const html = render(current, [root]);
    expect(html).toContain("(this row)"); // terminal still marked
    expect(html).toContain(">Item<"); // current-row line_item pill (CLS_LABELS.line_item)
    // The current line item carries no chip; only the single preamble ancestor does.
    expect(levelChips(html)).toEqual(["1"]);
  });

  it("renders the current row's level chip when the current row is itself a PREAMBLE", () => {
    const root = makeRow({
      row_index: 0,
      source_row_number: 1,
      effective_parent_index: null,
      effective_classification: "preamble",
      effective_level: 1,
      description: "CHILLED WATER",
    });
    const currentPreamble = makeRow({
      row_index: 1,
      source_row_number: 2,
      effective_parent_index: 0,
      effective_classification: "preamble",
      effective_level: 2,
      description: "VALVES",
    });

    const html = render(currentPreamble, [root]);
    expect(html).toContain("(this row)");
    expect(html).toContain(">Preamble<"); // current-row preamble pill
    expect(levelChips(html)).toEqual(["1", "2"]); // ancestor L1 + current-row L2
  });
});
