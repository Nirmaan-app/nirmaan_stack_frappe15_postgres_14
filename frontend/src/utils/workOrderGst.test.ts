import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { gstForVendor, gstMatchesVendor, isGstOn } from "./workOrderGst";

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

describe("gstForVendor", () => {
  it("is on exactly when the vendor has a GST number", () => {
    expect(gstForVendor("29AADCU7527Q1ZG")).toBe(true);
    for (const vendorGst of ["", "   ", null, undefined]) expect(gstForVendor(vendorGst)).toBe(false);
  });

  it("uses the same rule as the server's gst_flag_for_vendor", () => {
    expect(PY_SOURCE).toMatch(/return GST_ON if str\(vendor_gst or ""\)\.strip\(\) else GST_OFF/);
  });
});

describe("gstMatchesVendor", () => {
  it("matches when the flag agrees with the vendor's GST number", () => {
    expect(gstMatchesVendor({ gst: "true" }, "29AADCU7527Q1ZG")).toBe(true);
    expect(gstMatchesVendor({ gst: "false" }, "")).toBe(true);
  });

  it("disagrees in both directions", () => {
    expect(gstMatchesVendor({ gst: "false" }, "29AADCU7527Q1ZG")).toBe(false);
    expect(gstMatchesVendor({ gst: "true" }, "  ")).toBe(false);
  });
});
