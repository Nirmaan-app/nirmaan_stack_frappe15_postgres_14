// @vitest-environment jsdom
//
// #1668: the parse confirm dialog stays open while its parse is in flight. While the parse only waits in the queue,
// its button says so; "Parsing..." is for a parse a worker runs.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoQSheetDraft } from "./boqTypes";
import { PARSE_QUEUED_LABEL, PARSING_LABEL } from "./hubParseOperation";
import { ParseRunDialog } from "./ParseRunDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT = { sheet_name: "Tower A Electrical", status: "Config Done" } as unknown as BoQSheetDraft;

describe("ParseRunDialog: the in-flight button", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (inFlightLabel: string | null) =>
    act(() => root.render(
      <ParseRunDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        reviewedDrafts={[DRAFT]}
        parsedDrafts={[]}
        pendingSheetNames={[]}
        skippedSheetNames={[]}
        generalSpecsSheetNames={[]}
        inFlightLabel={inFlightLabel}
      />,
    ));
  const text = () => document.body.textContent ?? "";

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("says the parse waits in the queue while it is queued, not that it is parsing", () => {
    render(PARSE_QUEUED_LABEL);
    expect(text()).toContain("Waiting in the queue...");
    expect(text()).not.toContain("Parsing...");
  });

  it("says Parsing... once a worker runs it", () => {
    render(PARSING_LABEL);
    expect(text()).toContain("Parsing...");
  });

  it("offers the parse when nothing is in flight", () => {
    render(null);
    expect(text()).toContain("Parse 1 sheet");
  });
});
