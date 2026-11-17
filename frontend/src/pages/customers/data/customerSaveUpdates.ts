import type { CustomersDocType } from "@/types/doctypes/Customers";
import type { Address } from "@/types/NirmaanStack/Address";

type CustomerFields = Pick<
  CustomersDocType,
  "company_name" | "customer_nickname" | "company_email" | "company_phone" | "company_contact_person" | "company_gst"
>;
type AddressFields = Pick<Address, "address_line1" | "address_line2" | "city" | "state" | "pincode">;

export interface CustomerSaveValues {
  company_name: string;
  customer_nickname: string;
  company_email?: string;
  company_phone?: string;
  company_contact_person?: string;
  company_gst?: string;
  address_line1: string;
  address_line2?: string;
  pin_code: string;
}

export interface DocUpdate {
  doctype: "Customers" | "Address";
  name: string;
  fields: Record<string, string | undefined>;
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
  values: CustomerSaveValues;
  city: string;
  state: string;
}): DocUpdate[] {
  const updates: DocUpdate[] = [];

  const customerChanged =
    customer?.company_name !== values.company_name ||
    customer?.customer_nickname !== values.customer_nickname ||
    customer?.company_email !== values.company_email ||
    customer?.company_phone !== values.company_phone ||
    customer?.company_contact_person !== values.company_contact_person ||
    customer?.company_gst !== values.company_gst;
  if (customerChanged) {
    if (!customerId) throw new Error("No customer is open, so its details could not be saved");
    updates.push({
      doctype: "Customers",
      name: customerId,
      fields: {
        company_name: values.company_name,
        customer_nickname: values.customer_nickname,
        company_email: values.company_email,
        company_phone: values.company_phone,
        company_contact_person: values.company_contact_person,
        company_gst: values.company_gst,
      },
    });
  }

  const addressChanged =
    address?.address_line1 !== values.address_line1 ||
    address?.address_line2 !== values.address_line2 ||
    address?.city !== city ||
    address?.state !== state ||
    address?.pincode !== values.pin_code;
  if (addressChanged) {
    if (!addressId) throw new Error("This customer has no company address, so the address could not be saved");
    updates.push({
      doctype: "Address",
      name: addressId,
      fields: {
        address_title: values.company_name,
        address_line1: values.address_line1,
        address_line2: values.address_line2,
        city,
        state,
        pincode: values.pin_code,
        email_id: values.company_email,
        phone: values.company_phone,
      },
    });
  }

  return updates;
}
