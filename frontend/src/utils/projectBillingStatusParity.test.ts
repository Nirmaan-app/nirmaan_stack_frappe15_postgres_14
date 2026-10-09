// Pins the billing tracker's frontend status lists to the backend doctype
// (ADR-0010 F1). Lives outside pages/ because it parses the doctype JSON.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APPROVED_STATUSES,
  BILL_STATUSES,
  BILL_TYPES,
  NA_STATUS,
  PENDING_STATUSES,
} from "@/pages/ProjectBilling/billing.constants";

const DOCTYPE_JSON = resolve(
  __dirname,
  "../../../nirmaan_stack/nirmaan_stack/doctype/project_billing/project_billing.json",
);

function selectOptions(fieldname: string): string[] {
  const json = JSON.parse(readFileSync(DOCTYPE_JSON, "utf8"));
  const field = json.fields.find((f: { fieldname: string }) => f.fieldname === fieldname);
  return field.options.split("\n");
}

describe("status groups mirror the doctype", () => {
  it("lists exactly the doctype's statuses and bill types", () => {
    expect([...BILL_STATUSES]).toEqual(selectOptions("status"));
    expect([...BILL_TYPES]).toEqual(selectOptions("bill_type"));
  });

  it("splits every status into pending, approved or NA, once each", () => {
    const grouped = [...PENDING_STATUSES, ...APPROVED_STATUSES, NA_STATUS];
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(BILL_STATUSES));
  });
});

