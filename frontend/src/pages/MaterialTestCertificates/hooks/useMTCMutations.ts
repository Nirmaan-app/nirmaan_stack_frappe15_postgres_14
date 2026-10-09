import { useCallback, useState } from "react";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeFileUpload,
  useFrappePostCall,
} from "frappe-react-sdk";

import type { MTCItem } from "@/types/NirmaanStack/MaterialTestCertificate";

const MTC = "Material Test Certificate";

type LineRef = Pick<MTCItem, "item_id" | "make">;

/**
 * Create / edit / delete a Material Test Certificate. Every rule is enforced server-side by
 * the MTC controller; these only move the data.
 *
 * The file is uploaded attached to the PO (private), exactly like a DC/MIR file.
 */
export const useMTCMutations = (poName: string) => {
  const { upload } = useFrappeFileUpload();
  const { createDoc } = useFrappeCreateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();
  const { call: updateMTC } = useFrappePostCall(
    "nirmaan_stack.api.material_test_certificates.mtc_api.update_mtc"
  );
  const [busy, setBusy] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      const res = await upload(file, {
        doctype: "Procurement Orders",
        docname: poName,
        fieldname: "attachment",
        isPrivate: true,
      });
      if (!res?.file_url) throw new Error("The file could not be uploaded. Try again.");
      return res.file_url as string;
    },
    [upload, poName]
  );

  const toRows = (lines: LineRef[]) =>
    lines.map((l) => ({ item_id: l.item_id, make: l.make ?? "" }));

  const create = useCallback(
    async (file: File, lines: LineRef[], certificateDate: string) => {
      setBusy(true);
      try {
        const fileUrl = await uploadFile(file);
        return await createDoc(MTC, {
          procurement_order: poName,
          attachment: fileUrl,
          certificate_date: certificateDate,
          items: toRows(lines),
        } as any);
      } finally {
        setBusy(false);
      }
    },
    [uploadFile, createDoc, poName]
  );

  /** `file` is null when the file is kept. The replaced file stays in storage (owner ruling). */
  const update = useCallback(
    async (name: string, lines: LineRef[], file: File | null, certificateDate: string) => {
      setBusy(true);
      try {
        const attachment = file ? await uploadFile(file) : undefined;
        return await updateMTC({
          name,
          items: JSON.stringify(toRows(lines)),
          attachment,
          certificate_date: certificateDate,
        });
      } finally {
        setBusy(false);
      }
    },
    [uploadFile, updateMTC]
  );

  const remove = useCallback(
    async (name: string) => {
      setBusy(true);
      try {
        await deleteDoc(MTC, name);
      } finally {
        setBusy(false);
      }
    },
    [deleteDoc]
  );

  return { create, update, remove, busy };
};
