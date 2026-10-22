import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GST_RATE, gstForVendor, gstMatchesVendor, isGstExplicitlyOff, isGstOn, itemsValue, workOrderTotal } from "./workOrderGst";

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
    expect(PY_SOURCE).toMatch(/GST_ON_SPELLINGS = \("true", "1", "yes"\)/);
    expect(PY_SOURCE).toMatch(/\.strip\(\)\.lower\(\) in GST_ON_SPELLINGS/);
  });
});

describe("isGstExplicitlyOff", () => {
  it("is true only for a flag that says off", () => {
    for (const gst of ["false", " False ", "0", "no"]) expect(isGstExplicitlyOff({ gst })).toBe(true);
    for (const gst of ["true", "1", "", null, undefined]) expect(isGstExplicitlyOff({ gst })).toBe(false);
    expect(isGstExplicitlyOff(null)).toBe(false);
  });

  it("uses the same spellings as the server's gst_is_explicitly_off", () => {
    expect(PY_SOURCE).toMatch(/\.strip\(\)\.lower\(\) in \("false", "0", "no"\)/);
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

describe("workOrderTotal", () => {
  it("adds GST_RATE to the items when GST is on, as the server's work_order_total does", () => {
    expect(workOrderTotal(100000, true)).toBe(118000);
    expect(workOrderTotal(100000, false)).toBe(100000);
    expect(PY_SOURCE).toMatch(new RegExp(`GST_RATE = ${GST_RATE}\\b`));
    expect(PY_SOURCE).toMatch(/return sub_total \+ sub_total \* GST_RATE if gst_is_on\(gst_flag\) else sub_total/);
  });
});

describe("itemsValue", () => {
  it("sums quantity x rate, as the server's items_value does", () => {
    expect(itemsValue([{ quantity: 15, rate: 4000 }, { quantity: "2", rate: "250.5" }])).toBe(60501);
    expect(itemsValue(undefined)).toBe(0);
    expect(PY_SOURCE).toMatch(/return sum\(flt\(row.get\("quantity"\)\) \* flt\(row.get\("rate"\)\) for row in rows or \[\]\)/);
  });
});
