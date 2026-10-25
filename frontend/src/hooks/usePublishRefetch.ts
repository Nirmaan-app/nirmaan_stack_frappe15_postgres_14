import { useEffect, type MutableRefObject } from "react";

/** A page's handle on the open tab's refetch. The page calls `ref.current?.()` from the handler of
 *  the action that changed the lists. */
export type RefetchRef = MutableRefObject<(() => void) | null>;

/**
 * Publish a table's `refetch` to the page through `ref`, so the page's own handler (Project Payment &
 * Expense's New Expense submit) refreshes the rows without remounting the table, which keeps its
 * filters, search and page. Registration only: the refresh runs in that handler, never here. On
 * unmount the ref is cleared, unless another table has taken it since.
 */
export const usePublishRefetch = (ref: RefetchRef | undefined, refetch: () => void): void => {
    useEffect(() => {
        if (!ref) return;
        ref.current = refetch;
        return () => {
            if (ref.current === refetch) ref.current = null;
        };
    }, [ref, refetch]);
};
