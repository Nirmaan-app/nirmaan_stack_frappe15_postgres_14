import { describe, expect, it } from "vitest";
import { customerSaveUpdates } from "./customerSaveUpdates";

const CUSTOMER = {
  company_name: "Acme Builders",
  customer_nickname: "Acme",
  company_email: "office@acme.example",
  company_phone: "9000000001",
  company_contact_person: "Test Person",
  company_gst: "22AAAAA0000A1Z5",
};
const ADDRESS = {
  address_line1: "1 Test Road",
  address_line2: "Block B",
  city: "Testville",
  state: "Teststate",
  pincode: "560001",
};
const VALUES = { ...CUSTOMER, address_line1: "2 New Road", address_line2: "Block B", pin_code: "560001" };

const save = (over: Partial<Parameters<typeof customerSaveUpdates>[0]>) =>
  customerSaveUpdates({
    customerId: "CUST-0001",
    addressId: "ADDR-0001",
    customer: CUSTOMER,
    address: ADDRESS,
    values: { ...VALUES, company_name: "Acme Builders Pvt" },
    city: "Testville",
    state: "Teststate",
    ...over,
  });

describe("customerSaveUpdates", () => {
  it("plans the Customer update, then the Address update", () => {
    const updates = save({});
    expect(updates.map((u) => [u.doctype, u.name])).toEqual([
      ["Customers", "CUST-0001"],
      ["Address", "ADDR-0001"],
    ]);
    expect(updates[0].fields).toMatchObject({ company_name: "Acme Builders Pvt" });
    expect(updates[1].fields).toMatchObject({ address_line1: "2 New Road", address_title: "Acme Builders Pvt" });
  });

  it("refuses the whole save, Customer included, when the address ID is missing", () => {
    expect(() => save({ addressId: undefined })).toThrow(/no company address/);
  });

  it("refuses the whole save when the customer ID is missing", () => {
    expect(() => save({ customerId: undefined })).toThrow(/No customer is open/);
  });

  it("plans nothing for a form that changed nothing", () => {
    expect(save({ values: { ...CUSTOMER, address_line1: "1 Test Road", address_line2: "Block B", pin_code: "560001" } }))
      .toEqual([]);
  });
});
