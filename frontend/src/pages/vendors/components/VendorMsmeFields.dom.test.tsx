// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { MSME_NEEDS_CERTIFICATE, MSME_NEEDS_ID, refineMsmePair, vendorMsmeSchemas } from "../utils/msme";
import { VendorMsmeFields } from "./VendorMsmeFields";

const upload = vi.fn();
const readCertificate = vi.fn();

vi.mock("@/lib/frappe", () => ({
  useFrappeFileUpload: () => ({ upload }),
  useFrappePostCall: () => ({ call: readCertificate }),
  useFrappeGetCall: () => ({ data: undefined }),
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

interface Values {
  vendor_name: string;
  msme_id: string;
  msme_attachment: string;
  autofill_all_entities_json: null;
}

const EMPTY: Values = { vendor_name: "", msme_id: "", msme_attachment: "", autofill_all_entities_json: null };

let container: HTMLDivElement;
let root: Root;
let form: UseFormReturn<Values>;

// The vendor forms' MSME rules, as New / Edit Vendor wire them.
const schema = z.object(vendorMsmeSchemas).superRefine(refineMsmePair);

const Harness = ({ defaults, vendorId }: { defaults: Values; vendorId?: string }) => {
  form = useForm<Values>({ defaultValues: defaults, resolver: zodResolver(schema) });
  return (
    <FormProvider {...form}>
      <VendorMsmeFields vendorId={vendorId} />
    </FormProvider>
  );
};

// What `extract_msme_fields` returns for a readable certificate.
const goodRead = (id: string) => ({
  message: {
    msme_id: id,
    autofill_all_entities_json: { udyam_registration_number: id },
    validation: { is_udyam_certificate: true, id_read: id, id_valid: true, name_match: null, certificate_name: "" },
  },
});

const fileInput = () => container.querySelector<HTMLInputElement>('input[type="file"]');

const pickFile = async (file: File) => {
  const input = fileInput();
  if (!input) throw new Error("no file input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

beforeEach(() => {
  upload.mockReset();
  readCertificate.mockReset();
  // jsdom has no object URLs; the file picker previews the picked file with one.
  Reflect.set(URL, "createObjectURL", () => "blob:preview");
  Reflect.set(URL, "revokeObjectURL", () => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VendorMsmeFields", () => {
  it("forgets the picked certificate when the form is reset (New Vendor's Reset)", async () => {
    upload.mockResolvedValue({ file_url: "/private/files/udyam.pdf" });
    readCertificate.mockRejectedValue(new Error("Gemini API key is not configured"));
    act(() => root.render(<Harness defaults={EMPTY} />));

    await pickFile(new File(["%PDF"], "udyam.pdf", { type: "application/pdf" }));
    expect(form.getValues("msme_attachment")).toBe("/private/files/udyam.pdf");
    expect(container.textContent).toContain("View Certificate");
    expect(container.textContent).toContain("Gemini API key is not configured");

    const pickerBefore = fileInput();
    act(() => form.reset(EMPTY));

    // The screen must match the form: no certificate shown, no stale read error, upload usable again.
    expect(container.textContent).not.toContain("View Certificate");
    expect(container.textContent).toContain("Upload MSME Certificate");
    expect(container.textContent).not.toContain("Gemini API key is not configured");
    expect(fileInput()?.disabled).toBe(false);
    // A fresh picker, so picking the SAME file again is a change the browser reports (found in the
    // browser walk: the old input kept the file and a re-pick did nothing).
    expect(fileInput()).not.toBe(pickerBefore);
    await pickFile(new File(["%PDF"], "udyam.pdf", { type: "application/pdf" }));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(form.getValues("msme_attachment")).toBe("/private/files/udyam.pdf");
  });

  it("an MSME ID without a certificate blocks the save, with the message under the certificate", async () => {
    upload.mockResolvedValue({ file_url: "/private/files/udyam.pdf" });
    readCertificate.mockResolvedValue(goodRead("UDYAM-KR-03-0098765"));
    act(() => root.render(<Harness defaults={{ ...EMPTY, msme_id: "UDYAM-KR-03-0098765" }} />));
    const onValid = vi.fn();

    await act(async () => form.handleSubmit(onValid)());
    expect(onValid).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(MSME_NEEDS_CERTIFICATE);

    // Uploading the certificate clears the message at once, and the save goes through.
    await pickFile(new File(["%PDF"], "udyam.pdf", { type: "application/pdf" }));
    expect(container.textContent).not.toContain(MSME_NEEDS_CERTIFICATE);
    await act(async () => form.handleSubmit(onValid)());
    expect(onValid).toHaveBeenCalledTimes(1);
  });

  it("a certificate without an MSME ID blocks the save, with the message under the ID", async () => {
    act(() => root.render(<Harness defaults={{ ...EMPTY, msme_attachment: "/private/files/saved.pdf" }} />));
    const onValid = vi.fn();

    await act(async () => form.handleSubmit(onValid)());
    expect(onValid).not.toHaveBeenCalled();
    expect(container.textContent).toContain(MSME_NEEDS_ID);
  });

  it("shows a saved certificate as 'Replace Current Attachment' + 'Current: View Certificate', no Remove (Edit Vendor)", () => {
    act(() =>
      root.render(<Harness defaults={{ ...EMPTY, msme_id: "UDYAM-KR-03-0098765", msme_attachment: "/private/files/saved.pdf" }} />)
    );
    expect(container.textContent).toContain("Replace Current Attachment");
    expect(container.textContent).toContain("Current:");
    const link = container.querySelector("a");
    expect(link?.textContent?.trim()).toBe("View Certificate");
    expect(link?.getAttribute("href")).toBe("/private/files/saved.pdf");
    expect(fileInput()?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Remove");
  });

  it("after an upload the new certificate is the current one: no file chip, no ✕", async () => {
    upload.mockResolvedValue({ file_url: "/private/files/udyam.pdf" });
    readCertificate.mockResolvedValue(goodRead("UDYAM-KR-03-0098765"));
    act(() => root.render(<Harness defaults={EMPTY} />));

    await pickFile(new File(["%PDF"], "udyam.pdf", { type: "application/pdf" }));
    expect(container.textContent).toContain("Replace Current Attachment");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/private/files/udyam.pdf");
    expect(container.textContent).not.toContain("udyam.pdf");
    expect(container.querySelector('button[aria-label="Remove file"]')).toBeNull();
  });

  it("Replace swaps the certificate, the MSME ID and the read data for the new certificate's", async () => {
    const saved = { ...EMPTY, msme_id: "UDYAM-KR-03-0098765", msme_attachment: "/private/files/old.pdf" };
    upload.mockResolvedValue({ file_url: "/private/files/new.pdf" });
    readCertificate.mockResolvedValue(goodRead("UDYAM-KR-03-0097422"));
    act(() => root.render(<Harness defaults={saved} />));

    await pickFile(new File(["%PDF"], "new.pdf", { type: "application/pdf" })); // the Replace picker
    expect(form.getValues("msme_attachment")).toBe("/private/files/new.pdf");
    expect(form.getValues("msme_id")).toBe("UDYAM-KR-03-0097422");
    expect(form.getValues("autofill_all_entities_json")).toEqual({ udyam_registration_number: "UDYAM-KR-03-0097422" });
  });

  it("Replace with an unreadable certificate drops the old MSME ID: it belonged to the old one", async () => {
    const saved = { ...EMPTY, msme_id: "UDYAM-KR-03-0098765", msme_attachment: "/private/files/old.pdf" };
    upload.mockResolvedValue({ file_url: "/private/files/new.pdf" });
    readCertificate.mockRejectedValue(new Error("The certificate could not be read. Type the MSME ID yourself."));
    act(() => root.render(<Harness defaults={saved} />));

    await pickFile(new File(["%PDF"], "new.pdf", { type: "application/pdf" }));
    expect(form.getValues("msme_attachment")).toBe("/private/files/new.pdf");
    expect(form.getValues("msme_id")).toBe("");
    expect(form.getValues("autofill_all_entities_json")).toBeNull();
    expect(container.textContent).toContain("Type the MSME ID yourself");
  });

  it("Edit Vendor uploads the certificate unattached: only Update ties it to the vendor, so Cancel leaves none", async () => {
    const saved = { ...EMPTY, msme_id: "UDYAM-KR-03-0098765", msme_attachment: "/private/files/old.pdf" };
    upload.mockResolvedValue({ file_url: "/private/files/new.pdf" });
    readCertificate.mockResolvedValue(goodRead("UDYAM-KR-03-0097422"));
    act(() => root.render(<Harness defaults={saved} vendorId="VEN-Material-0001" />));

    await pickFile(new File(["%PDF"], "new.pdf", { type: "application/pdf" }));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toEqual({ isPrivate: true });
    // The read still knows the vendor: the duplicate-ID check leaves the vendor itself out.
    expect(readCertificate).toHaveBeenCalledWith(expect.objectContaining({ vendor_id: "VEN-Material-0001" }));
  });

  it("a failed upload on Replace keeps the old certificate and ID", async () => {
    const saved = { ...EMPTY, msme_id: "UDYAM-KR-03-0098765", msme_attachment: "/private/files/old.pdf" };
    upload.mockRejectedValue(new Error("Network error"));
    act(() => root.render(<Harness defaults={saved} />));

    await pickFile(new File(["%PDF"], "new.pdf", { type: "application/pdf" }));
    expect(form.getValues("msme_attachment")).toBe("/private/files/old.pdf");
    expect(form.getValues("msme_id")).toBe("UDYAM-KR-03-0098765");
  });
});
