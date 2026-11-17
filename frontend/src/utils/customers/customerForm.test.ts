import { describe, expect, it } from "vitest";
import { CustomerFormSchema, customerFormValues } from "./customerForm";

const CUSTOMER = {
  company_name: "Acme Builders",
  customer_nickname: "Acme",
  company_email: null,
  company_phone: null,
  company_contact_person: null,
  company_gst: null,
};
const ADDRESS = { address_line1: "1 Test Road", address_line2: null, city: "Testville", state: "Teststate", pincode: "560001" };

describe("customerFormValues", () => {
  it("holds each empty field as an empty string", () => {
    expect(customerFormValues(CUSTOMER, ADDRESS)).toEqual({
      company_name: "Acme Builders",
      customer_nickname: "Acme",
      company_email: "",
      company_phone: "",
      company_contact_person: "",
      company_gst: "",
      address_line1: "1 Test Road",
      address_line2: "",
      pin_code: "560001",
    });
  });
});

describe("CustomerFormSchema", () => {
  const values = customerFormValues(CUSTOMER, ADDRESS);
  const errors = (over: Partial<typeof values>) => {
    const parsed = CustomerFormSchema.safeParse({ ...values, ...over });
    return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it("accepts a customer saved with no phone, GST or email", () => {
    expect(errors({})).toEqual([]);
  });

  it("still refuses a phone that is not 10 digits and a malformed GST", () => {
    expect(errors({ company_phone: "900000001", company_gst: "22AAAAA0000" })).toEqual([
      "company_phone: Mobile number must be of 10 digits",
      "company_gst: Invalid GST format. Example: 22AAAAA0000A1Z5",
    ]);
  });

  it("accepts a 10-digit phone and a well-formed GST", () => {
    expect(errors({ company_phone: "9000000001", company_gst: "22AAAAA0000A1Z5" })).toEqual([]);
  });
});
