import { CHEQUE_ACCOUNTS_PROFILES } from "@/constants/roles";
import { CHEQUE_STATUS, CHEQUE_TYPE, type ChequeStatus } from "@/types/NirmaanStack/Cheques";

import { canEditCheque } from "./chequeEdit";

/**
 * The buttons a Cheque Tracker row shows (spec #1477, #1483), by the viewer's role and the Cheque's type and
 * status. Pure, so vitest covers it (F4). The server is the enforcement; this only decides what is offered.
 *
 * - View: always.
 * - Edit: as `canEditCheque` allows (the dialog then opens only what the status permits).
 * - Clear (Admin, Accountant, Accountant Lead): an Issued Payment cheque. A Pending one is cleared only by the
 *   bank import; a Security Deposit is never cashed.
 * - Cancel (the same roles): a Pending or Issued Payment cheque, or an Issued Security Deposit. A Cleared or
 *   Cancelled cheque has no undo by hand.
 *
 * Old-type cheques (#1478) follow the same rule: they are hand-cleared or hand-cancelled only.
 */

export type ChequeRowAction = "view" | "edit" | "clear" | "cancel";

/** The fields of a row the rule reads. */
export interface ChequeActionRow {
    status: ChequeStatus;
    cheque_type: string;
    owner: string;
}

/** Who is looking: the Role Profile and the user id (`useUserData`). */
export interface ChequeViewer {
    role: string;
    user: string;
}

const isPayment = (row: ChequeActionRow) => row.cheque_type !== CHEQUE_TYPE.SECURITY_DEPOSIT;

const canClear = (row: ChequeActionRow) => isPayment(row) && row.status === CHEQUE_STATUS.ISSUED;

const canCancel = (row: ChequeActionRow) =>
    row.status === CHEQUE_STATUS.ISSUED || (isPayment(row) && row.status === CHEQUE_STATUS.PENDING);

/** The row's buttons, in display order. */
export const chequeRowActions = (row: ChequeActionRow, viewer: ChequeViewer): ChequeRowAction[] => {
    const actions: ChequeRowAction[] = ["view"];
    if (canEditCheque(row, viewer.role, viewer.user)) actions.push("edit");
    if (CHEQUE_ACCOUNTS_PROFILES.includes(viewer.role)) {
        if (canClear(row)) actions.push("clear");
        if (canCancel(row)) actions.push("cancel");
    }
    return actions;
};
