import type { AddressFields, CustomerFields, CustomerFormValues } from "./customerForm";

/** One `updateDoc` call: the document and the fields to write to it, typed by its DocType. */
export type DocUpdate =
  | { doctype: "Customers"; name: string; fields: CustomerFields }
  | { doctype: "Address"; name: string; fields: AddressFields };

/** The server's empty is null, the form's is "": the two are the same value. */
const same = (saved: string | null | undefined, form: string) => (saved ?? "") === form;
/** A form value as the server stores it: an empty field is null. */
const stored = (form: string) => (form === "" ? null : form);

type SaveInput = Parameters<typeof customerSaveUpdates>[0];

/**
 * Plans the save (every ID checked, nothing sent when one is missing), then sends each update in order through
 * `send`, waiting for each before the next.
 */
export async function sendCustomerSave(input: SaveInput, send: (update: DocUpdate) => Promise<void>): Promise<void> {
  for (const update of customerSaveUpdates(input)) {
    await send(update);
  }
}

/**
 * The updates Edit Customer sends, Customer first, for the fields the form changed.
 *
 * Throws before returning anything when an update needs an ID that is missing, so the page checks every ID before
 * its first `updateDoc` and never saves the Customer without its Address.
 */
export function customerSaveUpdates({
  customerId,
  addressId,
  customer,
  address,
  values,
  city,
  state,
}: {
  customerId?: string;
  addressId?: string;
  customer?: Partial<CustomerFields>;
  address?: Partial<AddressFields>;
  values: CustomerFormValues;
  city: string;
  state: string;
}): DocUpdate[] {
  const updates: DocUpdate[] = [];

  const customerChanged =
    !same(customer?.company_name, values.company_name) ||
    !same(customer?.customer_nickname, values.customer_nickname) ||
    !same(customer?.company_email, values.company_email) ||
    !same(customer?.company_phone, values.company_phone) ||
    !same(customer?.company_contact_person, values.company_contact_person) ||
    !same(customer?.company_gst, values.company_gst);
  if (customerChanged) {
    if (!customerId) throw new Error("No customer is open, so its details could not be saved");
    updates.push({
      doctype: "Customers",
      name: customerId,
      fields: {
        company_name: values.company_name,
        customer_nickname: values.customer_nickname,
        company_email: stored(values.company_email),
        company_phone: stored(values.company_phone),
        company_contact_person: stored(values.company_contact_person),
        company_gst: stored(values.company_gst),
      },
    });
  }

  const addressChanged =
    !same(address?.address_line1, values.address_line1) ||
    !same(address?.address_line2, values.address_line2) ||
    !same(address?.city, city) ||
    !same(address?.state, state) ||
    !same(address?.pincode, values.pin_code);
  if (addressChanged) {
    if (!addressId) throw new Error("This customer has no company address, so the address could not be saved");
    updates.push({
      doctype: "Address",
      name: addressId,
      fields: {
        address_title: values.company_name,
        address_line1: values.address_line1,
        address_line2: stored(values.address_line2),
        city,
        state,
        pincode: values.pin_code,
        email_id: stored(values.company_email),
        phone: stored(values.company_phone),
      },
    });
  }

  return updates;
}
