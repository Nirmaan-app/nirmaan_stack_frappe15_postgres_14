import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { DeleteBatchPreview, SnagStatus } from "../types";
import { SNAG_ENDPOINTS } from "../config/snagTable.config";

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
}

export interface UseSnagMutationsResult {
  /** `name` of the row whose status write is in flight, else null. */
  savingStatusFor: string | null;
  isBulkSaving: boolean;
  isAdding: boolean;
  isDeletingBatch: boolean;

  /**
   * ONE row's status, and the remark that rides it (ADR-0018).
   *
   * `remark` HAS THREE STATES AND THEY ARE NOT TWO:
   *   - `undefined` — the key is NOT SENT. The stored text is left exactly as it is.
   *   - `""`        — an explicit CLEAR.
   *   - text        — an OVERWRITE; the imported text is destroyed.
   * Collapsing `undefined` into `""` would wipe the imported remark on every status
   * change made without touching the box.
   */
  updateStatus: (
    snag: string,
    status: SnagStatus,
    remark?: string
  ) => Promise<boolean>;
  /** BULK status change deliberately takes NO remark — see below. */
  bulkUpdateStatus: (snags: string[], status: SnagStatus) => Promise<boolean>;
  addManualSnag: (input: AddManualSnagInput) => Promise<boolean>;
  getBatchDeletePreview: (batch: string) => Promise<DeleteBatchPreview | null>;
  deleteBatch: (batch: string) => Promise<boolean>;
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
  const { call: callDeletePreview } = useFrappePostCall<{
    message: DeleteBatchPreview;
  }>(SNAG_ENDPOINTS.batchDeletePreview);
  const { call: callDeleteBatch } = useFrappePostCall(SNAG_ENDPOINTS.deleteBatch);

  const [savingStatusFor, setSavingStatusFor] = useState<string | null>(null);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

  const updateStatus = useCallback(
    async (snag: string, status: SnagStatus, remark?: string) => {
      setSavingStatusFor(snag);
      try {
        // The key is OMITTED when the caller passed nothing, so the server's
        // "leave it alone" branch is reached. `remark: undefined` would be dropped
        // by JSON.stringify anyway, but building the payload explicitly is what
        // makes the three-state contract visible at the call site.
        await callUpdateStatus(
          remark === undefined ? { snag, status } : { snag, status, remark }
        );
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
    [callUpdateStatus, onChanged]
  );

  // NO `remark` on the bulk path, deliberately (owner decision Q12a): one sentence
  // would overwrite N different remarks, and the imported text is destroyed by an
  // overwrite. Do not "complete" this signature.
  const bulkUpdateStatus = useCallback(
    async (snags: string[], status: SnagStatus) => {
      if (!snags.length) return false;
      setIsBulkSaving(true);
      try {
        await callBulkUpdate({ snags: JSON.stringify(snags), status });
        toast({
          title: "Status updated",
          description: `${snags.length} snag${snags.length === 1 ? "" : "s"} set to ${status}.`,
          variant: "success",
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
    async ({ area, category, description }: AddManualSnagInput) => {
      if (!projectId) return false;
      setIsAdding(true);
      try {
        await callAddManual({
          project: projectId,
          area,
          category,
          description,
        });
        toast({
          title: "Snag added",
          description: "The snag was added and starts at Pending.",
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

  const getBatchDeletePreview = useCallback(
    async (batch: string): Promise<DeleteBatchPreview | null> => {
      try {
        const res = await callDeletePreview({ batch });
        return res?.message ?? null;
      } catch (e: any) {
        toast({
          title: "Could not read the batch",
          description: errText(e, "The delete preview could not be loaded."),
          variant: "destructive",
        });
        return null;
      }
    },
    [callDeletePreview]
  );

  const deleteBatch = useCallback(
    async (batch: string) => {
      setIsDeletingBatch(true);
      try {
        await callDeleteBatch({ batch });
        toast({
          title: "Batch deleted",
          description: "The batch and its snags were removed.",
          variant: "success",
        });
        onChanged?.();
        return true;
      } catch (e: any) {
        toast({
          title: "Could not delete the batch",
          description: errText(e, "Nothing was deleted."),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsDeletingBatch(false);
      }
    },
    [callDeleteBatch, onChanged]
  );

  return {
    savingStatusFor,
    isBulkSaving,
    isAdding,
    isDeletingBatch,
    updateStatus,
    bulkUpdateStatus,
    addManualSnag,
    getBatchDeletePreview,
    deleteBatch,
  };
}
