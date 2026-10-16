import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { NAME_REGEX } from "@/constants/vendorFormRegex";
import { findVendorsByPan, vendorNamesLabel } from "./utils/vendorDuplicates";
import { vendorTaxIdSchemas } from "./utils/vendorTaxIds";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEditVendorData, usePincodeData, useExistingVendors } from './data/useVendorQueries';
import { useUpdateVendorDoc } from './data/useVendorMutations';
import { ListChecks, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import * as z from "zod";

// The vendor's bank account is its Payee (spec #1420, ADR-0033): it changes from the vendor page's
// Account Details card (Edit bank details, Use a different payee), never from this form.
const getVendorFormSchema = (service: boolean, existingVendors: Vendors[] | undefined, pincode_data: any) => {
    return z.object({
        vendor_contact_person_name: z
            .string({
              required_error: "Must provide Contact Person Name"
          }).min(3, {
              message: "Must be at least 3 characters.",
          }).regex(NAME_REGEX, {
              message: "Contact Person Name must not contain numbers.",
          }),
        vendor_name: z
            .string({
                required_error: "Must provide Vendor Name"
            })
            .min(3, {
                message: "Must be at least 3 characters.",
            }),
        vendor_nickname: z
            .string()
            .max(30, {
                message: "Must not exceed 30 characters.",
            })
            .optional(),
        address_line_1: z
            .string({
                required_error: "Address Line 1 Required"
            }).min(1, {
                message: "Address Line 1 Required"
            }),
        address_line_2: z.string().optional(),
        // vendor_city: z
        //     .string({
        //         required_error: "Must Provide City"
        //     })
        //     .min(1, {
        //         message: "Must Provide City"
        //     }),
        // vendor_state: z
        //     .string({
        //         required_error: "Must Provide State"
        //     })
        //     .min(1, {
        //         message: "Must Provide State"
        //     }),
        pin: z
            .string({
                required_error: "Must provide pincode"
            })
            .max(6, { message: "Pincode must be of 6 digits" })
            .min(6, { message: "Pincode must be of 6 digits" }).refine((pin) => {
              if (!pin || pin.length !== 6) {
                return true;
              }
              if (pincode_data) {
                return true;
              }
              return false;
            }, {
              message: "Invalid Pincode",
            }),
        vendor_email: z
            .string()
            .email()
            .optional(),
        vendor_mobile: z
            .string({
                required_error: "Must provide contact"
            })
            .max(10, { message: "Mobile number must be of 10 digits" })
            .min(10, { message: "Mobile number must be of 10 digits" }),
        // Optional alternate number. The empty-string branch matters: Frappe
        // stores an unset Data field as "" rather than NULL, so without it a
        // vendor with no alternate number would fail validation on an
        // otherwise-untouched form.
        vendor_alt_mobile: z
            .string()
            .max(10, { message: "Alternate mobile number must be of 10 digits" })
            .min(10, { message: "Alternate mobile number must be of 10 digits" })
            .optional()
            .or(z.literal("")),
        // vendor_gst: z
        //     .string({
        //         required_error: "Vendor GST Required"
        //     })
        //     .min(1, {
        //         message: "Vendor GST Required"
        //     })
        //     .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, {
        //         message: "Invalid GST format. Example: 22AAAAA0000A1Z5"
        //     }),
        // GST required unless Service; PAN required for every vendor.
        ...vendorTaxIdSchemas(existingVendors, service),
        // `coerce` because an <Input type="number"> hands back a string. Without it
        // every submit fails a zod number check on a field the user never touched.
        // ⚠️ Blank must not reach `z.coerce.number()` -- `Number("")` is 0, so an
        // empty box would silently save as "0% TDS". See new-vendor.tsx.
        tds_deduction_percentage: z.preprocess(
            (v) => (typeof v === "string" && v.trim() === "" ? NaN : v),
            z.coerce
                .number({ invalid_type_error: "Enter a TDS percentage." })
                .min(0, { message: "TDS % cannot be negative." })
                .max(100, { message: "TDS % cannot exceed 100." })
        ),
    })
};

type VendorFormValues = z.infer<ReturnType<typeof getVendorFormSchema>>;

interface EditVendorProps {
  toggleEditSheet: () => void;
  /** Called after a save that changed `vendor_name`: the vendor page then asks what happens to the
   * vendor's bank account (#1426). */
  onRenamed?: (rename: { before: string; after: string }) => void;
}

export const EditVendor: React.FC<EditVendorProps> = ({ toggleEditSheet, onRenamed }) => {

  const { vendorId: id } = useParams<{ vendorId: string }>();
  const { data, vendorMutate, vendorAddress, addressMutate } = useEditVendorData(id);
  const { updateDoc, loading } = useUpdateVendorDoc();
  const { toast } = useToast();
  const [vendorChange, setVendorChange] = useState(false)

  const [city, setCity] = useState(vendorAddress?.city || "");
  const [state, setState] = useState(vendorAddress?.state || "");

  const [pincode, setPincode] = useState("");

  const { data: pincode_data } = usePincodeData(pincode);

  const { data: existingVendors } = useExistingVendors(id);

  const VendorFormSchema = getVendorFormSchema(data?.vendor_type === "Service" && !vendorChange, existingVendors, pincode_data);

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(VendorFormSchema),
    // defaultValues: {
    //   vendor_contact_person_name: data?.vendor_contact_person_name,
    //   vendor_name: data?.vendor_name,
    //   address_line_1: vendorAddress?.address_line1,
    //   address_line_2: vendorAddress?.address_line2,
    //   pin: vendorAddress?.pincode,
    //   vendor_email: data?.vendor_email,
    //   vendor_mobile: data?.vendor_mobile,
    //   vendor_gst: data?.vendor_gst,
    // },
    defaultValues: {},
    mode: 'all',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    if (data && vendorAddress) {
      form.reset({
        vendor_contact_person_name: data?.vendor_contact_person_name,
        vendor_name: data?.vendor_name,
        vendor_nickname: data?.vendor_nickname,
        address_line_1: vendorAddress?.address_line1,
        address_line_2: vendorAddress?.address_line2 || undefined,
        pin: vendorAddress?.pincode,
        vendor_email: data?.vendor_email,
        vendor_mobile: data?.vendor_mobile,
        vendor_alt_mobile: data?.vendor_alt_mobile,
        vendor_gst: data?.vendor_gst,
        vendor_pan: data?.vendor_pan,
        // `??` (not `||`) so a vendor deliberately on 0% keeps 0 instead of being
        // silently bumped back to 2 the next time anyone opens this form. The
        // fallback only covers a vendor the backfill patch has not reached.
        tds_deduction_percentage: data?.tds_deduction_percentage ?? 2,
      });

      setPincode(vendorAddress?.pincode);
    }
  }, [data, vendorAddress]);

  const debouncedFetch = useCallback((value: string) => {
    if (value.length >= 6) {
      setPincode(value);
    } else {
      setPincode("");
    }
  }, []);

  useEffect(() => {
    if (pincode.length >= 6 && !pincode_data) {
      setCity("");
      setState("");
    } else {
      setCity(pincode_data?.city || "");
      setState(pincode_data?.state || "");
    }
  }, [pincode_data]);

  const handlePincodeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    debouncedFetch(value);
  }, [debouncedFetch]);

  const onSubmit = async (values: VendorFormValues) => {
    try {
      await updateDoc("Address", `${data?.vendor_address}`, {
        email_id: values.vendor_email,
        phone: values.vendor_mobile,
        address_line1: values.address_line_1,
        // Optional: a cleared box is `undefined`, which the request would drop.
        address_line2: values.address_line_2 || null,
        city: city,
        state: state,
        pincode: values.pin,
      });

      // No `vendor_category` here: the daily job (tasks/vendor_category_sync.py) owns a vendor's
      // categories, derived from its POs and Work Orders.
      await updateDoc("Vendors", id, {
        vendor_type: vendorChange ? "Material & Service" : data?.vendor_type,
        vendor_city: city,
        vendor_contact_person_name: values.vendor_contact_person_name,
        vendor_email: values.vendor_email,
        // `|| null`, not the raw value: a cleared box is `undefined`, which the request
        // would drop — leaving the old number in place instead of clearing it.
        vendor_gst: values.vendor_gst || null,
        vendor_pan: values.vendor_pan || null,
        tds_deduction_percentage: values.tds_deduction_percentage,
        vendor_mobile: values.vendor_mobile,
        // Vendors doc only — deliberately NOT mirrored into the linked Address
        // doc, which carries a single `phone` that belongs to the primary.
        vendor_alt_mobile: values.vendor_alt_mobile,
        vendor_name: values.vendor_name,
        vendor_nickname: values.vendor_nickname,
        vendor_state: state,
      });

      await vendorMutate();
      await addressMutate();

      toast({
        title: "Success!",
        description: `Vendor: ${id} updated successfully!`,
        variant: "success",
      });
      // navigate(`/vendors/${id}`)

      toggleEditSheet();
      if (data?.vendor_name && values.vendor_name !== data.vendor_name) {
        onRenamed?.({ before: data.vendor_name, after: values.vendor_name });
      }
    } catch (error) {
      toast({
        title: "Failed!",
        description: `${error}`,
        variant: "destructive",
      });
      console.log("Error while updating vendor", error);
    }
  };

  // A PAN another vendor already holds is allowed — warn, never block.
  const samePanVendors = findVendorsByPan(existingVendors, form.watch("vendor_pan"));
  const gstRequired = vendorChange || ["Material", "Material & Service"].includes(data?.vendor_type);

  return (
    <div className="flex-1 space-y-4">
            {data?.vendor_type !== "Material & Service" && (
              <>
            <div className="flex flex-col mt-2 px-6 max-md:px-2 space-y-2">
              <label className="block text-sm font-medium text-gray-700">Vendor_Type<sup className="text-sm text-red-600">*</sup></label>
              <div className="flex items-center space-x-2">
                <Label htmlFor="vendorType">Change to <span className="text-primary italic text-lg">Material & Service</span> type?</Label>
                <Switch value={vendorChange} onCheckedChange={(e) => {
                  setVendorChange(e)
                  form.clearErrors(["vendor_gst", "vendor_pan"])
                }} id="vendorType" />
              </div>
            </div>
            <Separator className="my-6 max-md:my-2" />
            </>
            )}
      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.preventDefault(); // Prevents page reload
            return form.handleSubmit(onSubmit)(event); // Calls your form submit logic
          }}
          className="space-y-4 px-6 max-md:px-2"
        >
          <FormField
            control={form.control}
            name="vendor_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Vendor Name<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input id="vendorShopName" placeholder="enter shop name..." {...field}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_nickname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Nickname
                </FormLabel>
                <FormControl>
                  <Input placeholder="Short, memorable name (e.g. Nirmaan, ABC Steel)" {...field}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_contact_person_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Person Name<sup className="text-sm text-red-600">*</sup></FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="vendor_gst"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor GST {gstRequired && <sup className="text-sm text-red-600">*</sup>}</FormLabel>
                <FormControl>
                  <Input placeholder="enter gst..."
                   {...field}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                   />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_pan"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor PAN <sup className="text-sm text-red-600">*</sup></FormLabel>
                <FormControl>
                  <Input placeholder="enter pan..."
                   {...field}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                   />
                </FormControl>                <FormMessage />
              </FormItem>
            )}
          />
          {samePanVendors.length > 0 && (
            <p className="text-xs text-amber-700">
              PAN already used by {vendorNamesLabel(samePanVendors)}. You can still save.
            </p>
          )}
          <FormField
            control={form.control}
            name="tds_deduction_percentage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>TDS Deduction Percentage<sup className="text-sm text-red-600">*</sup></FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    // `any`, NOT a fixed step -- see the matching note in
                    // new-vendor.tsx. `0.01` made the arrows crawl in hundredths.
                    step="any"
                    min={0}
                    max={100}
                    placeholder="2"
                    {...field}
                    // `??` (not `||`) so a deliberate 0% renders as "0".
                    value={field.value ?? ""}
                    // ⚠️ ALWAYS the raw string, never `undefined` -- RHF reads a
                    // field as `get(_formValues, name, get(_defaultValues, name))`
                    // and `get` substitutes the DEFAULT for a stored `undefined`,
                    // so clearing the box snapped it back to 2. See new-vendor.tsx.
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">Applied to this vendor's payments. Defaults to 2%.</p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address_line_1"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Address Line 1<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Building name, floor" {...field}
                       onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address_line_2"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Address Line 2
                </FormLabel>
                <FormControl>
                  <Input placeholder="Street name, area, landmark" {...field}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                     />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormItem>
            <FormLabel>
              City<sup className="text-sm text-red-600">*</sup>
            </FormLabel>
            <FormControl>
              <Input disabled type="text" value={city} />
            </FormControl>
          </FormItem>
          <FormItem>
            <FormLabel>
              State<sup className="text-sm text-red-600">*</sup>
            </FormLabel>
            <FormControl>
              <Input disabled type="text" value={state} />
            </FormControl>
          </FormItem>
          <FormField
            control={form.control}
            name="pin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Pincode<sup className="text-sm text-red-600">*</sup>
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="6 digit PIN"
                    {...field}
                    onChange={(e) => {
                      handlePincodeChange(e);
                      field.onChange(e.target.value === "" ? undefined : e)
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone<sup className="text-sm text-red-600">*</sup></FormLabel>
                <FormControl>
                  <Input type="number" placeholder="Contact No" {...field}
                       onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_alt_mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Alternate Phone</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="Alternate Contact No (optional)" {...field}
                       value={field.value ?? ""}
                       onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.value)}
                    />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vendor_email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="Enter Email ID" {...field}
                  onChange={(e) => field.onChange(e.target.value === "" ? undefined : e)} 
                   />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="secondary"
              className="flex items-center gap-1"
              onClick={toggleEditSheet}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1"
            >
              <ListChecks className="h-4 w-4" />
              {loading ? "Updating..." : "Update"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
