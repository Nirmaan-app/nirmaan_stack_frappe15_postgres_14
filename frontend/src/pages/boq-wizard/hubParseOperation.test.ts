import { describe, expect, it } from "vitest";

import { checkChipOf, hubParseOf, parseOutcomeOf } from "./hubParseOperation";

const OP = "aaaaaaaa-0000-4000-8000-000000000001";
const CHECK_OP = "bbbbbbbb-0000-4000-8000-000000000002";

describe("hubParseOf: what the hub shows for the parse it follows", () => {
  it("tells waiting in the queue apart from parsing", () => {
    expect(hubParseOf({ phase: "starting", opId: OP }, false)).toEqual({ inFlight: true, label: "Waiting in the queue..." });
    expect(hubParseOf({ phase: "queued", opId: OP }, true)).toEqual({ inFlight: true, label: "Waiting in the queue..." });
    expect(hubParseOf({ phase: "running", opId: OP, progress: null }, true)).toEqual({ inFlight: true, label: "Parsing..." });
  });

  it("ends the wait when the parse failed or was lost, even while the BoQ still says a parse runs", () => {
    expect(hubParseOf({ phase: "failed", opId: OP, error: "The parser could not process this workbook." }, true))
      .toEqual({ inFlight: false, label: null });
    expect(hubParseOf({ phase: "lost", opId: OP, error: "The server stopped while running this operation." }, true))
      .toEqual({ inFlight: false, label: null });
    expect(hubParseOf({ phase: "finished", opId: OP, result: {} }, true)).toEqual({ inFlight: false, label: null });
  });

  it("shows a parse it does not follow (another tab or user) from the BoQ's own flag", () => {
    expect(hubParseOf({ phase: "idle" }, true)).toEqual({ inFlight: true, label: "Parsing..." });
    expect(hubParseOf({ phase: "idle" }, false)).toEqual({ inFlight: false, label: null });
  });
});

describe("parseOutcomeOf: the finished parse's result", () => {
  it("reads the sheets, the carry and the check each parsed sheet started", () => {
    const carry = { "Made-up Sheet": { copied: 2, needs_review: 1, total: 3 } };
    expect(parseOutcomeOf({
      status: "success", boq_name: "BOQ-X", parsed_sheets: ["Made-up Sheet"], not_parsed_sheets: ["Cover"],
      failed_sheets: [], revision_carry: carry, checks: { "Made-up Sheet": CHECK_OP },
    })).toEqual({
      kind: "parsed", parsed: ["Made-up Sheet"], notParsed: ["Cover"], failed: [], carry,
      checks: { "Made-up Sheet": CHECK_OP },
    });
  });

  it("says when no sheet was eligible, an advisory and not a failure", () => {
    expect(parseOutcomeOf({ status: "nothing_to_parse", boq_name: "BOQ-X" })).toEqual({ kind: "nothing_to_parse" });
  });

  it("reads nothing from a result that is not a parse's", () => {
    expect(parseOutcomeOf(null)).toBeNull();
    expect(parseOutcomeOf({ status: "success", parsed_sheets: "not a list" })).toEqual({
      kind: "parsed", parsed: [], notParsed: [], failed: [], carry: undefined, checks: {},
    });
  });
});

describe("checkChipOf: a sheet card's check chip from the check's own operation", () => {
  it("says the check waits in the queue until a worker runs it", () => {
    expect(checkChipOf({ phase: "starting", opId: CHECK_OP })).toBe("Waiting to check rows…");
    expect(checkChipOf({ phase: "queued", opId: CHECK_OP })).toBe("Waiting to check rows…");
    expect(checkChipOf({ phase: "running", opId: CHECK_OP, progress: null })).toBe("Checking rows…");
  });

  it("has nothing to say once the check ended or when none is followed", () => {
    expect(checkChipOf({ phase: "finished", opId: CHECK_OP, result: {} })).toBeNull();
    expect(checkChipOf({ phase: "failed", opId: CHECK_OP, error: "x" })).toBeNull();
    expect(checkChipOf({ phase: "idle" })).toBeNull();
    expect(checkChipOf(undefined)).toBeNull();
  });
});
