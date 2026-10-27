// src/pages/outflow-import/components/PorterDiscardButton.tsx

import { PORTER_DISCARD_METHOD, canDiscardPorter, discardConfirmation } from "../porterDiscard";
import type { PorterStatus } from "../porterImport";
import { ImportDiscardButton } from "./ImportDiscardButton";

/**
 * Discard a whole Porter import Create has not written to (#1447): its batch, lines, Porter Invoices and
 * PDFs. Any module user, Accountant included (#1557); renders nothing once Create has written anything.
 * The asking and posting is the shared `ImportDiscardButton`.
 */
export const PorterDiscardButton = ({
    status,
    onDiscarded,
}: {
    status: PorterStatus;
    onDiscarded: () => void | Promise<void>;
}) => (
    <ImportDiscardButton
        method={PORTER_DISCARD_METHOD}
        batch={status.batch}
        offered={() => canDiscardPorter(status)}
        title="Discard this Porter import?"
        confirmation={discardConfirmation(status)}
        onDiscarded={onDiscarded}
    />
);
