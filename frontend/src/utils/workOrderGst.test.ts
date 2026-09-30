import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isGstOn } from "./workOrderGst";

const PY_SOURCE = readFileSync(
  resolve(__dirname, "../../../nirmaan_stack/services/work_order_gst.py"),
  "utf-8"
);

describe("isGstOn", () => {
  it("reads every stored spelling of on as on", () => {
    for (const gst of ["true", "True", " TRUE ", "1", "yes"]) expect(isGstOn({ gst })).toBe(true);
  });

  it("reads everything else, blank included, as off", () => {
    for (const gst of ["false", "", null, undefined, "0", "no"]) expect(isGstOn({ gst })).toBe(false);
    expect(isGstOn(null)).toBe(false);
    expect(isGstOn(undefined)).toBe(false);
  });

  it("uses the same spellings as the server's gst_is_on", () => {
    expect(PY_SOURCE).toMatch(/\.strip\(\)\.lower\(\) in \("true", "1", "yes"\)/);
  });
});
