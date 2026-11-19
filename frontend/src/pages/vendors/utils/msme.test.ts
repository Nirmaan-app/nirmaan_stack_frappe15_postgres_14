import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  MSME_NEEDS_CERTIFICATE,
  MSME_NEEDS_ID,
  isValidUdyam,
  msmeValuesToSave,
  normalizeUdyam,
  readMsmeJson,
  refineMsmePair,
  vendorMsmeSchemas,
} from "./msme";

describe("normalizeUdyam / isValidUdyam (the server's services/vendor_msme.py)", () => {
  it.each<[string, string, boolean]>([
    ["UDYAM-UP-28-0012345", "UDYAM-UP-28-0012345", true],
    ["udyam-up-28-0012345", "UDYAM-UP-28-0012345", true],
    [" UDYAM - UP - 28 - 0012345 ", "UDYAM-UP-28-0012345", true],
    ["UDYAM–UP–28–0012345", "UDYAM-UP-28-0012345", true],
    ["UDYAM-UP-28-012345", "UDYAM-UP-28-012345", false],
    ["UDYAM-U1-28-0012345", "UDYAM-U1-28-0012345", false],
    ["UAM-UP-28-0012345", "UAM-UP-28-0012345", false],
    ["", "", false],
  ])("%j -> %j (valid %s)", (raw, normalized, valid) => {
    expect(normalizeUdyam(raw)).toBe(normalized);
    expect(isValidUdyam(normalizeUdyam(raw))).toBe(valid);
  });
});

describe("readMsmeJson", () => {
  it("reads the stored object or its JSON text, keeping only known string fields", () => {
    const stored = { udyam_registration_number: "UDYAM-UP-28-0012345", enterprise_type: "Micro", junk: 1 };
    expect(readMsmeJson(stored)).toEqual({ udyam_registration_number: "UDYAM-UP-28-0012345", enterprise_type: "Micro" });
    expect(readMsmeJson('{"enterprise_name": "S V Metals"}')).toEqual({ enterprise_name: "S V Metals" });
  });

  it("is null for nothing or unreadable text", () => {
    expect(readMsmeJson(null)).toBeNull();
    expect(readMsmeJson(undefined)).toBeNull();
    expect(readMsmeJson("not json")).toBeNull();
    expect(readMsmeJson("[1, 2]")).toBeNull();
  });
});

describe("vendorMsmeSchemas", () => {
  const schema = z.object(vendorMsmeSchemas);

  it("accepts no MSME details at all, and normalises a typed ID", () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ msme_id: "udyam-up-28-0012345" }).msme_id).toBe("UDYAM-UP-28-0012345");
    expect(schema.parse({ msme_id: "" }).msme_id).toBe("");
  });

  it("refuses an ID that is not a Udyam number", () => {
    expect(schema.safeParse({ msme_id: "UDYAM-UP-28-123" }).success).toBe(false);
  });
});

describe("refineMsmePair (both or neither; the server's Vendors._validate_msme)", () => {
  const schema = z.object(vendorMsmeSchemas).superRefine(refineMsmePair);
  const issues = (values: object) => {
    const r = schema.safeParse(values);
    return r.success ? [] : r.error.issues.map((i) => [i.path.join("."), i.message]);
  };

  it("accepts neither, or both", () => {
    expect(issues({})).toEqual([]);
    expect(issues({ msme_id: "", msme_attachment: "" })).toEqual([]);
    expect(issues({ msme_id: "udyam-up-28-0012345", msme_attachment: "/private/files/u.pdf" })).toEqual([]);
  });

  it("asks for the certificate when only the ID is given", () => {
    expect(issues({ msme_id: "UDYAM-UP-28-0012345" })).toEqual([["msme_attachment", MSME_NEEDS_CERTIFICATE]]);
    expect(issues({ msme_id: "UDYAM-UP-28-0012345", msme_attachment: "" })).toEqual([["msme_attachment", MSME_NEEDS_CERTIFICATE]]);
  });

  it("asks for the ID when only the certificate is given", () => {
    expect(issues({ msme_attachment: "/private/files/u.pdf" })).toEqual([["msme_id", MSME_NEEDS_ID]]);
    expect(issues({ msme_id: "  ", msme_attachment: "/private/files/u.pdf" })).toEqual([["msme_id", MSME_NEEDS_ID]]);
  });
});

describe("msmeValuesToSave", () => {
  it("clears blanks, drops the read data when the certificate is gone, and sends it as JSON text", () => {
    expect(msmeValuesToSave({ msme_id: "", msme_attachment: "", autofill_all_entities_json: { enterprise_type: "Micro" } })).toEqual({
      msme_id: null,
      msme_attachment: null,
      autofill_all_entities_json: null,
    });
    const json = { enterprise_type: "Small" };
    expect(msmeValuesToSave({ msme_id: "UDYAM-UP-28-0012345", msme_attachment: "/x.pdf", autofill_all_entities_json: json })).toEqual({
      msme_id: "UDYAM-UP-28-0012345",
      msme_attachment: "/x.pdf",
      autofill_all_entities_json: '{"enterprise_type":"Small"}',
    });
    // What is sent reads back as the same object.
    expect(readMsmeJson(msmeValuesToSave({ msme_id: "x", msme_attachment: "/x.pdf", autofill_all_entities_json: json }).autofill_all_entities_json)).toEqual(json);
  });
});
