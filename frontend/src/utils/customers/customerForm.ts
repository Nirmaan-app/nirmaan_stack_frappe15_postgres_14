import * as z from "zod";
import type { CustomersDocType } from "@/types/doctypes/Customers";
import type { Address } from "@/types/NirmaanStack/Address";

/** The Customer fields Edit Customer shows and saves, typed as the server sends them (an empty one is `null`). */
export type CustomerFields = Pick<
  CustomersDocType,
  "company_name" | "customer_nickname" | "company_email" | "company_phone" | "company_contact_person" | "company_gst"
>;
/** The Address fields Edit Customer shows and saves, typed as the server sends them. */
export type AddressFields = Pick<
  Address,
  "address_title" | "address_line1" | "address_line2" | "city" | "state" | "pincode" | "email_id" | "phone"
>;

const GST_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;

/**
 * Edit Customer's form. Every field holds a string, and "" is an empty field: the optional ones accept it, so a
 * customer saved with no phone or GST can still be saved.
 */
export const CustomerFormSchema = z.object({
  company_name: z
    .string({ required_error: "Company Name is Required" })
    .min(3, { message: "Must be at least 3 characters." }),
  customer_nickname: z
    .string({ required_error: "Customer Nickname is Required" })
    .min(2, { message: "Nickname must be at least 2 characters." })
    .max(30, { message: "Nickname must be at most 30 characters." }),
  company_email: z.string().email().or(z.literal("")),
  company_phone: z.string().refine((v) => v === "" || v.length === 10, { message: "Mobile number must be of 10 digits" }),
  company_contact_person: z.string(),
  company_gst: z.string().refine((v) => v === "" || GST_FORMAT.test(v), {
    message: "Invalid GST format. Example: 22AAAAA0000A1Z5",
  }),
  address_line1: z
    .string({ required_error: "Address Line 1 Required" })
    .min(1, { message: "Address Line 1 Required" }),
  address_line2: z.string(),
  pin_code: z
    .string({ required_error: "Must provide Pincode" })
    .max(6, { message: "Pincode must be of 6 digits" })
    .min(6, { message: "Pincode must be of 6 digits" }),
});

/** Edit Customer's form values: the one type for them, read by the form and by the save. */
export type CustomerFormValues = z.infer<typeof CustomerFormSchema>;

/** The form's values for a saved Customer and its Address, each empty field as "". */
export function customerFormValues(
  customer: Partial<CustomerFields> | undefined,
  address: Partial<AddressFields> | undefined,
): CustomerFormValues {
  return {
    company_name: customer?.company_name ?? "",
    customer_nickname: customer?.customer_nickname ?? "",
    company_email: customer?.company_email ?? "",
    company_phone: customer?.company_phone ?? "",
    company_contact_person: customer?.company_contact_person ?? "",
    company_gst: customer?.company_gst ?? "",
    address_line1: address?.address_line1 ?? "",
    address_line2: address?.address_line2 ?? "",
    pin_code: address?.pincode ?? "",
  };
}

/** Whether the form holds anything other than the saved Customer and Address, field by field. */
export function customerFormChanged(
  values: CustomerFormValues,
  customer: Partial<CustomerFields> | undefined,
  address: Partial<AddressFields> | undefined,
): boolean {
  const saved = customerFormValues(customer, address);
  return CustomerFormSchema.keyof().options.some((key) => values[key] !== saved[key]);
}
