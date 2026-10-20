import { useEffect, useRef } from "react";

/**
 * Call `refetch` each time `key` changes after the first render. A page's "the lists changed" signal
 * (Project Payment & Expense's New Expense submit) refreshes a table's data this way without
 * remounting it, so the table keeps its filters, search and page. Not on mount: the table fetches then.
 */
export const useRefetchOnChange = (key: unknown, refetch: () => void): void => {
    const latest = useRef(refetch);
    latest.current = refetch;
    const seen = useRef(key);
    useEffect(() => {
        if (Object.is(seen.current, key)) return;
        seen.current = key;
        latest.current();
    }, [key]);
};
