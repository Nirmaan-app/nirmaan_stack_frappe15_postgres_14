import { useCallback, useContext, useRef, useState } from "react";
import { FrappeContext, type FrappeConfig } from "frappe-react-sdk";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { CHEQUE_DETAIL_API } from "@/utils/cheques/chequeStatus";

/** The Cheque an Edit dialog is open on: its name, then the Cheque as read on opening, or why it could not be read. */
export interface ChequeEditTarget {
    name: string;
    detail?: ChequeDetail;
    error?: unknown;
}

/**
 * Opens a Cheque's Edit (#1418) with the Cheque read afresh. The edit form copies the Cheque once, so the
 * handler that opens it reads it straight from the server rather than from the detail view's cache, which
 * could still hold the Cheque as it was before the last save. A read that finishes after the dialog was
 * closed or opened on another Cheque is dropped.
 */
export const useChequeEdit = () => {
    const { call } = useContext(FrappeContext) as FrappeConfig;
    const [target, setTarget] = useState<ChequeEditTarget | null>(null);
    const session = useRef(0);

    const openEdit = useCallback(
        async (name: string) => {
            const mine = ++session.current;
            setTarget({ name });
            try {
                const res = await call.get<{ message: ChequeDetail }>(CHEQUE_DETAIL_API, { name });
                if (mine === session.current) setTarget({ name, detail: res.message });
            } catch (error) {
                if (mine === session.current) setTarget({ name, error });
            }
        },
        [call],
    );

    const closeEdit = useCallback(() => {
        session.current += 1;
        setTarget(null);
    }, []);

    return { target, openEdit, closeEdit };
};
