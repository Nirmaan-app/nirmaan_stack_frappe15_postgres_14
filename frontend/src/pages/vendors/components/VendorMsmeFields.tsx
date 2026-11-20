import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { AlertTriangle, Eye, Loader2 } from "lucide-react";

import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useFrappeFileUpload, useFrappeGetCall, useFrappePostCall } from "@/lib/frappe";

import { UDYAM_EXAMPLE, isValidUdyam, normalizeUdyam, type MsmeJson } from "../utils/msme";

const API = "nirmaan_stack.api.vendor.msme_autofill";

interface MsmeRead {
  msme_id: string;
  autofill_all_entities_json: MsmeJson;
  validation: {
    is_udyam_certificate: boolean;
    id_read: string;
    id_valid: boolean;
    name_match: boolean | null;
    certificate_name: string;
  };
}

interface VendorRef {
  name: string;
  vendor_name: string;
}

/** The three MSME fields of the vendor forms (both declare them, see `vendorMsmeSchemas`). */
interface MsmeFormValues {
  vendor_name?: string;
  msme_id?: string;
  msme_attachment?: string;
  autofill_all_entities_json?: MsmeJson | null;
}

interface VendorMsmeFieldsProps {
  /** The vendor being edited; absent on New Vendor (the file is attached to it on save). */
  vendorId?: string;
}

/**
 * MSME details on New / Edit Vendor (owner, 2026-11-19): upload the Udyam certificate, Document AI
 * reads it and fills the MSME ID (editable). Once attached, a certificate is only REPLACED, never
 * removed; a new one replaces the MSME ID and the read data too. Optional, but ID and certificate
 * come together: one without the other blocks the save (`refineMsmePair`). Everything else only
 * warns: not a Udyam certificate, no ID read, a different enterprise name, another vendor with the
 * same ID.
 */
export const VendorMsmeFields = ({ vendorId }: VendorMsmeFieldsProps) => {
  const form = useFormContext<MsmeFormValues>();
  const { upload } = useFrappeFileUpload();
  const { call: readCertificate } = useFrappePostCall<{ message: MsmeRead }>(`${API}.extract_msme_fields`);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [lastRead, setLastRead] = useState<MsmeRead | null>(null);

  const attachment = form.watch("msme_attachment");
  const msmeId = normalizeUdyam(form.watch("msme_id"));

  // The form can drop the certificate on its own (New Vendor's Reset): forget the picked file and
  // its read too, or the screen would still show a certificate the vendor is saved without. The
  // file picker is remounted as well: its hidden input keeps the old file, and the browser fires no
  // change when the same file is picked again, so re-picking it after Reset would do nothing.
  const [seenAttachment, setSeenAttachment] = useState(attachment);
  const [pickerKey, setPickerKey] = useState(0);
  if (attachment !== seenAttachment) {
    setSeenAttachment(attachment);
    if (!attachment) {
      setFile(null);
      setLastRead(null);
      setReadError(null);
      setPickerKey((k) => k + 1);
    }
  }

  // Another vendor with this ID: a warning, for a typed ID as much as a read one.
  const { data: duplicates } = useFrappeGetCall<{ message: VendorRef[] }>(
    `${API}.msme_duplicates`,
    { msme_id: msmeId, vendor_id: vendorId },
    isValidUdyam(msmeId) ? `msme-duplicates-${msmeId}-${vendorId ?? "new"}` : null
  );
  const otherVendors = duplicates?.message ?? [];

  const onFileSelect = async (selected: File | null) => {
    setFile(selected);
    setReadError(null);
    setLastRead(null);
    if (!selected) return;
    setReading(true);
    try {
      const uploaded = await upload(selected, {
        isPrivate: true,
        ...(vendorId ? { doctype: "Vendors", docname: vendorId, fieldname: "msme_attachment" } : {}),
      });
      if (!uploaded?.file_url) throw new Error("The file could not be uploaded. Try again.");
      // Uploaded: it is now the CURRENT certificate (link under the picker). Drop the picked-file
      // chip and remount the picker, so there is no ✕ and the same file can be picked again.
      setFile(null);
      setPickerKey((k) => k + 1);
      // A new certificate REPLACES the old one's data (owner, 2026-11-19): the MSME ID and the read
      // data both come from it, so the previous ID goes now and is refilled by the read below; if
      // the read fails, the user types the new ID. After a failed submit, re-check at once.
      const validate = form.formState.isSubmitted;
      form.setValue("msme_attachment", uploaded.file_url, { shouldDirty: true, shouldValidate: validate });
      form.setValue("autofill_all_entities_json", null, { shouldDirty: true });
      form.setValue("msme_id", "", { shouldDirty: true, shouldValidate: validate });

      const res = await readCertificate({
        file_url: uploaded.file_url,
        vendor_name: form.getValues("vendor_name") ?? "",
        vendor_id: vendorId ?? "",
      });
      const read = res.message;
      setLastRead(read);
      form.setValue("autofill_all_entities_json", read.autofill_all_entities_json, { shouldDirty: true });
      if (read.msme_id) form.setValue("msme_id", read.msme_id, { shouldDirty: true, shouldValidate: true });
    } catch (err) {
      setReadError(
        err instanceof Error && err.message
          ? err.message
          : "The certificate could not be read. Type the MSME ID yourself."
      );
    } finally {
      setReading(false);
    }
  };

  // Set by `refineMsmePair` when an MSME ID has no certificate; the ID's own error shows under its field.
  const certificateError = form.formState.errors.msme_attachment?.message;

  const warnings: string[] = [];
  if (lastRead) {
    if (!lastRead.validation.is_udyam_certificate) {
      warnings.push("This file does not look like a Udyam (MSME) registration certificate.");
    }
    if (!lastRead.validation.id_valid) {
      warnings.push(
        lastRead.validation.id_read
          ? `The number read (${lastRead.validation.id_read}) is not a Udyam number. Type the MSME ID yourself.`
          : "No Udyam number could be read. Type the MSME ID yourself."
      );
    }
    if (lastRead.validation.name_match === false) {
      warnings.push(`The certificate is in the name of "${lastRead.validation.certificate_name}".`);
    }
  }
  if (otherVendors.length) {
    warnings.push(`Another vendor already has this MSME ID: ${otherVendors.map((v) => v.vendor_name).join(", ")}.`);
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">MSME Details</p>

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">MSME (Udyam) Certificate</p>
        {/* Same pattern as the PO invoice dialog's edit mode (owner, 2026-11-19): one picker that
            REPLACES the current certificate, the current one linked under it. Never removed. */}
        <CustomAttachment
          key={pickerKey}
          selectedFile={file}
          onFileSelect={(f) => void onFileSelect(f)}
          acceptedTypes={["application/pdf", "image/*"]}
          label={attachment ? "Replace Current Attachment" : "Upload MSME Certificate"}
          className="w-full"
          disabled={reading}
        />
        {attachment && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Current:</span>
            <a
              href={attachment}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-600 hover:underline flex items-center gap-1"
            >
              <Eye className="h-3 w-3" aria-hidden="true" />
              View Certificate
            </a>
          </div>
        )}
        {reading && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading certificate…
          </p>
        )}
        {readError && <p className="text-xs text-red-600">{readError}</p>}
        {certificateError && <p role="alert" className="text-sm font-medium text-destructive">{certificateError}</p>}
      </div>

      <FormField
        control={form.control}
        name="msme_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>MSME ID</FormLabel>
            <FormControl>
              <Input
                placeholder={`e.g. ${UDYAM_EXAMPLE}`}
                {...field}
                value={field.value ?? ""}
                onBlur={() => field.onChange(normalizeUdyam(field.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" /> {w}
        </p>
      ))}
    </div>
  );
};
