import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { AlertTriangle, FileText, Loader2, X } from "lucide-react";

import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Button } from "@/components/ui/button";
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
 * reads it and fills the MSME ID (editable). Optional, but ID and certificate come together: one
 * without the other blocks the save (`refineMsmePair`). Everything else only warns: not a Udyam
 * certificate, no ID read, a different enterprise name, another vendor with the same ID.
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
      // After a failed submit, re-check at once so the "upload the certificate" error clears.
      form.setValue("msme_attachment", uploaded.file_url, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
      form.setValue("autofill_all_entities_json", null, { shouldDirty: true });

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

  const removeCertificate = () => {
    setFile(null);
    setLastRead(null);
    setReadError(null);
    form.setValue("msme_attachment", "", { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    form.setValue("autofill_all_entities_json", null, { shouldDirty: true });
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
        {attachment && !file ? (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <a href={attachment} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              View certificate
            </a>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={removeCertificate}>
              <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Remove
            </Button>
          </div>
        ) : (
          <CustomAttachment
            key={pickerKey}
            selectedFile={file}
            onFileSelect={(f) => void onFileSelect(f)}
            acceptedTypes={["application/pdf", "image/*"]}
            label="Upload MSME Certificate"
            disabled={reading}
          />
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
