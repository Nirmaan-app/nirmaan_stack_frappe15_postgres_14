import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { SnagStatus, UpdateSnagDetailsPayload } from "../types";
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
  isSavingDetails: boolean;

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
   */
  updateSnagDetails: (payload: UpdateSnagDetailsPayload) => Promise<boolean>;
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

  const [savingStatusFor, setSavingStatusFor] = useState<string | null>(null);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);

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

  const updateSnagDetails = useCallback(
    async ({ snag, area, category, description, remark }: UpdateSnagDetailsPayload) => {
      setIsSavingDetails(true);
      try {
        // `remark` is OMITTED when the caller passed nothing, so the server's "leave
        // it alone" branch is reached — the same three-state contract `updateStatus`
        // builds explicitly above, for the same reason.
        const base = { snag, area, category, description };
        await callUpdateDetails(
          remark === undefined ? base : { ...base, remark }
        );
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
    [callUpdateDetails, onChanged]
  );

  return {
    savingStatusFor,
    isBulkSaving,
    isAdding,
    isSavingDetails,
    updateStatus,
    bulkUpdateStatus,
    addManualSnag,
    updateSnagDetails,
  };
}
