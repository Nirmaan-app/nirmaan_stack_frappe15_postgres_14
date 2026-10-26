// src/pages/outflow-import/hooks/usePorterPlacement.ts

import { useCallback, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { describeFrappeError } from "../outflowTableModel";
import { PORTER_PLACE_METHOD, PORTER_REVIEW_METHOD, type PorterReview } from "../porterReview";

/**
 * A Porter import's orders as Review reads them, and the one way a screen places some of them on a project
 * (or Not a project: ""). Choose projects, Confirm & create and Create's result each place orders; all three
 * share this fetch under one SWR key, so a choice made on one screen is already on the next.
 *
 * `place` saves, puts the server's answer in the cache, then calls `onPlaced` (the dialog re-reads the
 * import's status: the bar and Create's gate). `saving` is the key the caller passed while a save runs.
 */
export const usePorterPlacement = (batch: string, onPlaced?: () => void) => {
    const { data, error, mutate } = useFrappeGetCall<{ message: PorterReview }>(
        PORTER_REVIEW_METHOD,
        { batch },
        `porter-review::${batch}`,
    );
    const { call } = useFrappePostCall<{ message: PorterReview }>(PORTER_PLACE_METHOD);
    const [saving, setSaving] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const place = useCallback(
        async (key: string, rows: string[], project: string): Promise<boolean> => {
            setSaving(key);
            setSaveError(null);
            try {
                const response = await call({ batch, rows, project });
                await mutate(response, { revalidate: false });
                onPlaced?.();
                return true;
            } catch (err) {
                setSaveError(describeFrappeError(err, "The change was not saved."));
                return false;
            } finally {
                setSaving(null);
            }
        },
        [batch, call, mutate, onPlaced],
    );

    return { review: data?.message, error, place, saving, saveError };
};
