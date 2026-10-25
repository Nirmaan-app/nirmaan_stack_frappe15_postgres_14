// src/pages/outflow-import/components/PorterDiscardButton.tsx

import { PORTER_DISCARD_METHOD, canDiscardPorter, discardConfirmation } from "../porterDiscard";
import type { PorterStatus } from "../porterImport";
import { ImportDiscardButton } from "./ImportDiscardButton";

/**
 * Discard a Porter import Create has not written to (#1447): its batch, lines, Porter Invoices and PDFs.
 * Admin and Accountant Lead only; renders nothing for anyone else, or once Create has written anything.
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
        offered={(canUndo) => canDiscardPorter(status, canUndo)}
        title="Discard this Porter import?"
        confirmation={discardConfirmation(status)}
        onDiscarded={onDiscarded}
    />
);
