import { useCallback, useState } from "react";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { SnagStatus, UpdateSnagDetailsPayload } from "../types";
import { SNAG_DOCTYPE, SNAG_ENDPOINTS } from "../config/snagTable.config";
import { SnagPhotoDraft } from "../photo/snagPhotoCapture";

/**
 * Frappe error -> human text. Delegates to the app-wide `getFrappeError`, which already
 * unwraps `_server_messages` / `exception` / `message`. Do NOT reinstate a local copy:
 * a second unwrapper drifts from the shared one and trips ADR-0010 rule F2 (a backend
 * shape is parsed at ONE typed accessor, never inline in a page).
 */
const errText = (e: unknown, fallback: string): string => {
  if (!e) return fallback;
  if (typeof e === "string") return e;
  return getFrappeError(e) || fallback;
};

export interface AddManualSnagInput {
  area: string;
  category: string;
  description: string;
  /**
   * The batch tab the user was on, so the new snag lands in the list they are looking
   * at. `null` on the "Added manually" tab — that snag genuinely belongs to no import.
   */
  batch?: string | null;
}

export interface UseSnagMutationsResult {
  /** `name` of the row whose status write is in flight, else null. */
  savingStatusFor: string | null;
  isBulkSaving: boolean;
  isAdding: boolean;
  isSavingDetails: boolean;
  isRenamingBatch: boolean;

  /**
   * ONE row's status, and the remark that rides it (ADR-0018).
   *
   * `remark` HAS THREE STATES AND THEY ARE NOT TWO:
   *   - `undefined` — the key is NOT SENT. The stored text is left exactly as it is.
   *   - `""`        — an explicit CLEAR.
   *   - text        — an OVERWRITE; the imported text is destroyed.
   * Collapsing `undefined` into `""` would wipe the imported remark on every status
   * change made without touching the box.
   *
   * `photo` (owner 2026-10-08) is a NEW photo picked in the dialog. It is uploaded first,
   * attached to the snag, and then rides the SAME status write — which is how a snag moves to
   * Completed together with the photo that Completed requires.
   */
  updateStatus: (
    snag: string,
    status: SnagStatus,
    remark?: string,
    photo?: SnagPhotoDraft | null
  ) => Promise<boolean>;
  /** BULK status change deliberately takes NO remark — see below. */
  bulkUpdateStatus: (snags: string[], status: SnagStatus) => Promise<boolean>;
  addManualSnag: (input: AddManualSnagInput) => Promise<boolean>;
  /**
   * ONE row's Area / Category / Description — and now its Remark (owner 2026-09-04).
   *
   * STILL CANNOT touch status: it is owned by the status change (ADR-0018), which is
   * what stamps `status_changed_by`. Nor any provenance field — batch / source_row /
   * project answer "where did this come from", which an editable answer would make
   * worthless.
   *
   * ⚠️ THE FOUR FIELDS DO NOT BEHAVE THE SAME WAY, and the difference is the whole
   * point. Area / Category / Description are SENT EVERY TIME (the dialog holds the
   * whole set, so a full overwrite is what the user saw and confirmed). `remark` is
   * THREE-STATE like `updateStatus`'s: `undefined` OMITS the key so the server leaves
   * the stored text alone. Sending it unconditionally would destroy the imported
   * remark on every area typo fix.
   *
   * A blank description is ALLOWED — ADR-0019 dropped the `reqd`, so a client-side
   * required check would refuse what the server accepts.
   *
   * `photo` replaces the stored photo, uploaded first like `updateStatus`'s; `remove_photo`
   * on the payload clears it instead. Never both.
   */
  updateSnagDetails: (
    payload: UpdateSnagDetailsPayload,
    photo?: SnagPhotoDraft | null
  ) => Promise<boolean>;
  /**
   * Rename ONE batch — the label its tab, Import History, the Edit dialog and the PDF all
   * show. Only the label moves: snags link to the batch by its document `name`, so nothing
   * else is rewritten. Resolves `true` once the server accepted the name.
   */
  renameBatch: (batch: string, batchName: string) => Promise<boolean>;
}

/**
 * Every write the Snag List tab performs, in one place.
 *
 * The server is the permission boundary — these calls are made only from
 * controls the permission module already decided to render, and a server refusal
 * surfaces as a destructive toast rather than being swallowed.
 */
export function useSnagMutations(
  projectId: string | undefined,
  onChanged?: () => void
): UseSnagMutationsResult {
  const { call: callUpdateStatus } = useFrappePostCall(SNAG_ENDPOINTS.updateStatus);
  const { call: callBulkUpdate } = useFrappePostCall(SNAG_ENDPOINTS.bulkUpdateStatus);
  const { call: callAddManual } = useFrappePostCall(SNAG_ENDPOINTS.addManualSnag);
  const { call: callUpdateDetails } = useFrappePostCall(
    SNAG_ENDPOINTS.updateSnagDetails
  );
  const { call: callRenameBatch } = useFrappePostCall(SNAG_ENDPOINTS.renameBatch);
  const { upload } = useFrappeFileUpload();

  const [savingStatusFor, setSavingStatusFor] = useState<string | null>(null);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isRenamingBatch, setIsRenamingBatch] = useState(false);

  /**
   * Upload a dialog's photo, ATTACHED TO THE SNAG (the server refuses a photo that is not),
   * and return the fields the write endpoints take. Null when the upload failed — the toast
   * is already shown, and the caller sends nothing.
   */
  const uploadPhoto = useCallback(
    async (snag: string, photo: SnagPhotoDraft) => {
      try {
        const file = await upload(photo.file, {
          isPrivate: true,
          doctype: SNAG_DOCTYPE,
          docname: snag,
          // Names the field, so Frappe's own attach bookkeeping recognises this File.
          fieldname: "attachment",
        });
        const fields: Record<string, string> = { attachment: file.file_url };
        if (photo.location) fields.location = photo.location;
        return fields;
      } catch (e: unknown) {
        toast({
          title: "Photo upload failed",
          description: errText(e, "The photo was not uploaded, so nothing was saved."),
          variant: "destructive",
        });
        return null;
      }
    },
    [upload]
  );

  const updateStatus = useCallback(
    async (snag: string, status: SnagStatus, remark?: string, photo?: SnagPhotoDraft | null) => {
      setSavingStatusFor(snag);
      try {
        const photoFields = photo ? await uploadPhoto(snag, photo) : {};
        if (!photoFields) return false;
        // The key is OMITTED when the caller passed nothing, so the server's
        // "leave it alone" branch is reached. `remark: undefined` would be dropped
        // by JSON.stringify anyway, but building the payload explicitly is what
        // makes the three-state contract visible at the call site.
        await callUpdateStatus({
          ...(remark === undefined ? { snag, status } : { snag, status, remark }),
          ...photoFields,
        });
        onChanged?.();
        return true;
      } catch (e: any) {
        toast({
          title: "Could not update status",
          description: errText(e, "The status change was not saved."),
          variant: "destructive",
        });
        return false;
      } finally {
        setSavingStatusFor(null);
      }
    },
    [callUpdateStatus, onChanged, uploadPhoto]
  );

  // NO `remark` on the bulk path, deliberately (owner decision Q12a): one sentence
  // would overwrite N different remarks, and the imported text is destroyed by an
  // overwrite. Do not "complete" this signature.
  const bulkUpdateStatus = useCallback(
    async (snags: string[], status: SnagStatus) => {
      if (!snags.length) return false;
      setIsBulkSaving(true);
      try {
        const res = await callBulkUpdate({ snags: JSON.stringify(snags), status });
        // A snag with no photo is SKIPPED by a bulk Completed (owner 2026-10-08), not failed.
        const updated: number = res?.message?.updated ?? snags.length;
        const skipped: number = res?.message?.skipped?.length ?? 0;
        const plural = (n: number) => `${n} snag${n === 1 ? "" : "s"}`;
        if (!updated && skipped) {
          // Nothing moved: say so, and keep the dialog and the selection for another try.
          toast({
            title: "No statuses changed",
            description: `${plural(skipped)} skipped — a snag needs a photo to be ${status}.`,
            variant: "destructive",
          });
          return false;
        }
        toast({
          title: skipped ? "Status partly updated" : "Status updated",
          description: skipped
            ? `${plural(updated)} set to ${status}. ${plural(skipped)} skipped — a snag needs a photo to be ${status}.`
            : `${plural(updated)} set to ${status}.`,
          variant: skipped ? "default" : "success",
        });
        onChanged?.();
        return true;
      } catch (e: any) {
        toast({
          title: "Bulk update failed",
          description: errText(e, "No statuses were changed."),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsBulkSaving(false);
      }
    },
    [callBulkUpdate, onChanged]
  );

  const addManualSnag = useCallback(
    async ({ area, category, description, batch }: AddManualSnagInput) => {
      if (!projectId) return false;
      setIsAdding(true);
      try {
        await callAddManual({
          project: projectId,
          area,
          category,
          description,
          // Omitted/blank means "no batch" server-side, which is the manual-tab case.
          batch: batch ?? null,
        });
        toast({
          title: "Snag added",
          description: batch
            ? "The snag was added to this batch and starts at Pending."
            : "The snag was added and starts at Pending.",
          variant: "success",
        });
        onChanged?.();
        return true;
      } catch (e: any) {
        toast({
          title: "Could not add snag",
          description: errText(e, "The snag was not created."),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsAdding(false);
      }
    },
    [callAddManual, onChanged, projectId]
  );

  const updateSnagDetails = useCallback(
    async ({
      snag,
      area,
      category,
      description,
      remark,
      source_serial,
      remove_photo,
    }: UpdateSnagDetailsPayload, photo?: SnagPhotoDraft | null) => {
      setIsSavingDetails(true);
      try {
        const photoFields = photo ? await uploadPhoto(snag, photo) : {};
        if (!photoFields) return false;
        // `remark` and `source_serial` are OMITTED when the caller passed nothing, so the
        // server's "leave it alone" branch is reached for each — the same three-state
        // contract `updateStatus` builds explicitly above, for the same reason.
        const base: Record<string, string | boolean> = { snag, area, category, description };
        if (remark !== undefined) base.remark = remark;
        if (source_serial !== undefined) base.source_serial = source_serial;
        if (remove_photo && !photo) base.remove_photo = true;
        await callUpdateDetails({ ...base, ...photoFields });
        toast({
          title: "Snag updated",
          description: "The snag's details were saved.",
          variant: "success",
        });
        onChanged?.();
        return true;
      } catch (e: any) {
        toast({
          title: "Could not update the snag",
          description: errText(e, "The changes were not saved."),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsSavingDetails(false);
      }
    },
    [callUpdateDetails, onChanged, uploadPhoto]
  );

  const renameBatch = useCallback(
    async (batch: string, batchName: string) => {
      setIsRenamingBatch(true);
      try {
        // The server strips too; trimming here only makes the toast match what is stored.
        const next = batchName.trim();
        await callRenameBatch({ batch, batch_name: next });
        toast({
          title: "Batch renamed",
          description: `The batch is now called “${next}”.`,
          variant: "success",
        });
        // Refetches the batch list, which is what relabels the tab.
        onChanged?.();
        return true;
      } catch (e: any) {
        toast({
          title: "Could not rename the batch",
          description: errText(e, "The name was not changed."),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsRenamingBatch(false);
      }
    },
    [callRenameBatch, onChanged]
  );

  return {
    savingStatusFor,
    isBulkSaving,
    isAdding,
    isSavingDetails,
    isRenamingBatch,
    updateStatus,
    bulkUpdateStatus,
    addManualSnag,
    updateSnagDetails,
    renameBatch,
  };
}
