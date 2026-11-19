import { describe, expect, it } from "vitest";

import { readBoqWorkerOutcome } from "./boqWorkerOutcome";

describe("readBoqWorkerOutcome: what a BoQ upload parse or template clone returned", () => {
  it("a success names the BoQ it made", () => {
    expect(readBoqWorkerOutcome({ status: "success", boq_name: "BOQ-26-00042", parsed_sheets: 3 }))
      .toEqual({ ok: true, boqName: "BOQ-26-00042" });
  });

  it("an error carries its code, even when it names a BoQ shell", () => {
    expect(readBoqWorkerOutcome({ status: "error", error_code: "template_changed", boq_name: "BOQ-26-1" }))
      .toEqual({ ok: false, errorCode: "template_changed" });
  });

  it("NEGATIVE: a success without a BoQ name, or another shape, is an error with no code", () => {
    expect(readBoqWorkerOutcome({ status: "success" })).toEqual({ ok: false, errorCode: null });
    expect(readBoqWorkerOutcome({ status: "error", error_code: 7 })).toEqual({ ok: false, errorCode: null });
    expect(readBoqWorkerOutcome(null)).toEqual({ ok: false, errorCode: null });
  });
});
