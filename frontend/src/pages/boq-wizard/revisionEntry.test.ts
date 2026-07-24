// Unit tests for the W3 entry un-lock decision (planEntryChange).
//
// What we pin: exactly WHEN a New|Revise change reaches the server. The pre-W3 behaviour
// (store-only, rides the upload POST) must survive untouched while no BOQs doc exists --
// that is the "local" case and it is the regression guard for the whole upload flow.
import { describe, it, expect } from "vitest";
import { planEntryChange } from "./revisionEntry";

describe("planEntryChange -- before a BOQs doc exists", () => {
  it("stays local for New (the mode rides the upload POST, as before W3)", () => {
    expect(
      planEntryChange({ boqDocName: null, mode: "new", sourceBoq: null })
    ).toEqual({ kind: "local" });
  });

  it("stays local for Revise, even with an original already picked", () => {
    expect(
      planEntryChange({ boqDocName: null, mode: "revise", sourceBoq: "BOQ-A" })
    ).toEqual({ kind: "local" });
  });
});

describe("planEntryChange -- once a BOQs doc exists", () => {
  it("waits for the picker when Revise has no original yet (convert requires source_boq)", () => {
    expect(
      planEntryChange({
        boqDocName: "BOQ-NEW",
        mode: "revise",
        sourceBoq: null,
        serverOrigin: "upload",
      })
    ).toEqual({ kind: "await-source" });
  });

  it("converts New -> Revise once the original is picked", () => {
    expect(
      planEntryChange({
        boqDocName: "BOQ-NEW",
        mode: "revise",
        sourceBoq: "BOQ-A",
        serverOrigin: "upload",
        serverSourceBoq: null,
      })
    ).toEqual({ kind: "convert", mode: "revise", sourceBoq: "BOQ-A" });
  });

  it("converts when the user re-points the revision at a different original", () => {
    expect(
      planEntryChange({
        boqDocName: "BOQ-NEW",
        mode: "revise",
        sourceBoq: "BOQ-B",
        serverOrigin: "revision",
        serverSourceBoq: "BOQ-A",
      })
    ).toEqual({ kind: "convert", mode: "revise", sourceBoq: "BOQ-B" });
  });

  it("no-ops when the server already holds exactly this revision entry", () => {
    expect(
      planEntryChange({
        boqDocName: "BOQ-NEW",
        mode: "revise",
        sourceBoq: "BOQ-A",
        serverOrigin: "revision",
        serverSourceBoq: "BOQ-A",
      })
    ).toEqual({ kind: "noop" });
  });

  it("converts Revise -> New (source_boq is dropped server-side)", () => {
    expect(
      planEntryChange({
        boqDocName: "BOQ-NEW",
        mode: "new",
        sourceBoq: null,
        serverOrigin: "revision",
        serverSourceBoq: "BOQ-A",
      })
    ).toEqual({ kind: "convert", mode: "new", sourceBoq: null });
  });

  it("no-ops on New when the doc is known not to be a revision", () => {
    expect(
      planEntryChange({
        boqDocName: "BOQ-NEW",
        mode: "new",
        sourceBoq: null,
        serverOrigin: "upload",
      })
    ).toEqual({ kind: "noop" });
  });

  it("converts on New while the server state is still unknown (never silently skip)", () => {
    // The doc is created but not yet fetched -- a redundant convert is idempotent server-side,
    // a skipped one would leave the radio disagreeing with the doc.
    expect(
      planEntryChange({ boqDocName: "BOQ-NEW", mode: "new", sourceBoq: null })
    ).toEqual({ kind: "convert", mode: "new", sourceBoq: null });
  });
});
