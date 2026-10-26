// src/pages/outflow-import/useCardImport.ts

import { useCallback, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { CARD_CREATE_METHOD, CARD_CREATE_POLL_MS, CARD_SET_TYPE_METHOD, cardPolling } from "./cardCreate";
import { CARD_IMPORT_METHOD, type CardImport } from "./creditCardImport";
import { describeFrappeError } from "./outflowTableModel";

/** The SWR key a card import is read under; the upload seeds it so the dialog opens on the staged import. */
export const cardImportKey = (batch: string) => `card-import::${batch}`;

/**
 * The card import on screen, as the server reports it, and its two Review actions (#1568): retype a spend
 * and start Create. READ FROM THE SERVER BY BATCH, never held as local state, and polled while the type suggestion (#1569) or the Create
 * job is queued or running, so a reload or a reopen shows exactly where Create stands. Every action's reply
 * is the import as `get_card_import` reports it, and replaces the cached copy.
 */
export const useCardImport = (batch: string | null) => {
    const { data, mutate } = useFrappeGetCall<{ message: CardImport }>(
        CARD_IMPORT_METHOD,
        { batch },
        batch ? cardImportKey(batch) : null,
        { refreshInterval: (latest) => (cardPolling(latest?.message) ? CARD_CREATE_POLL_MS : 0) },
    );
    const { call: setType } = useFrappePostCall<{ message: CardImport }>(CARD_SET_TYPE_METHOD);
    const { call: startCreate } = useFrappePostCall<{ message: CardImport }>(CARD_CREATE_METHOD);
    /** The spend whose type is being saved. */
    const [retyping, setRetyping] = useState<string | null>(null);
    /** The Create request is in flight (the job itself runs on the server; the poll follows it). */
    const [startingCreate, setStartingCreate] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    /** Save `expenseType` on `rows` (default: `line` alone; every spend of its merchant, #1569). */
    const retype = useCallback(
        async (line: string, expenseType: string, rows: string[] = [line]) => {
            if (!batch) return;
            setRetyping(line);
            setActionError(null);
            try {
                const response = await setType({ batch, rows: JSON.stringify(rows), expense_type: expenseType });
                await mutate(response, { revalidate: false });
            } catch (err) {
                setActionError(describeFrappeError(err, "The type was not saved."));
            } finally {
                setRetyping(null);
            }
        },
        [batch, setType, mutate],
    );

    const create = useCallback(async () => {
        if (!batch) return;
        setStartingCreate(true);
        setActionError(null);
        try {
            const response = await startCreate({ batch });
            await mutate(response, { revalidate: false });
        } catch (err) {
            setActionError(describeFrappeError(err, "Create did not start."));
        } finally {
            setStartingCreate(false);
        }
    }, [batch, startCreate, mutate]);

    return {
        cardImport: batch ? data?.message ?? null : null,
        retype,
        retyping,
        create,
        startingCreate,
        actionError,
    };
};
