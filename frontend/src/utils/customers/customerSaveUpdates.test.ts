import { describe, expect, it } from "vitest";
import { customerSaveUpdates, sendCustomerSave, type DocUpdate } from "./customerSaveUpdates";

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

const INPUT: Parameters<typeof customerSaveUpdates>[0] = {
  customerId: "CUST-0001",
  addressId: "ADDR-0001",
  customer: CUSTOMER,
  address: ADDRESS,
  values: { ...VALUES, company_name: "Acme Builders Pvt" },
  city: "Testville",
  state: "Teststate",
};
const save = (over: Partial<typeof INPUT>) => customerSaveUpdates({ ...INPUT, ...over });

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

describe("customerSaveUpdates with empty fields", () => {
  // Frappe sends null for an empty field; the form holds "" for it (#1703).
  const EMPTY_CUSTOMER = { ...CUSTOMER, company_phone: null, company_gst: null, company_email: null };
  const EMPTY_ADDRESS = { ...ADDRESS, address_line2: null };
  const unchanged = { ...VALUES, address_line1: "1 Test Road", company_phone: "", company_gst: "", company_email: "",
    address_line2: "" };

  it("plans nothing when an empty phone, GST, email or address line 2 is still empty", () => {
    expect(save({ customer: EMPTY_CUSTOMER, address: EMPTY_ADDRESS, values: unchanged })).toEqual([]);
  });

  it("writes an empty field as null, never as an empty string", () => {
    const [customer, address] = save({
      customer: EMPTY_CUSTOMER, address: EMPTY_ADDRESS, values: { ...unchanged, company_name: "Acme Builders Pvt" },
    });
    expect(customer.fields).toMatchObject({ company_phone: null, company_gst: null, company_email: null });
    expect(address).toBeUndefined();
  });
});

describe("sendCustomerSave", () => {
  const sender = () => {
    const sent: DocUpdate[] = [];
    return { sent, send: async (u: DocUpdate) => { sent.push(u); } };
  };

  it("sends no update at all when the address ID is missing", async () => {
    const { sent, send } = sender();
    await expect(sendCustomerSave({ ...INPUT, addressId: undefined }, send)).rejects.toThrow(/no company address/);
    expect(sent).toEqual([]);
  });

  it("sends the Customer, then the Address, one after the other", async () => {
    const { sent, send } = sender();
    await sendCustomerSave(INPUT, send);
    expect(sent.map((u) => u.doctype)).toEqual(["Customers", "Address"]);
  });
});
