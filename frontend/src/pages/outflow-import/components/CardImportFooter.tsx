// src/pages/outflow-import/components/CardImportFooter.tsx

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { cardPhaseView } from "../cardCreate";
import { CARD_DISCARD_METHOD, canDiscardCard, cardDiscardConfirmation, type CardImport } from "../creditCardImport";
import { ImportDiscardButton } from "./ImportDiscardButton";

interface CardImportFooterProps {
    card: CardImport;
    onCreate: () => void;
    /** Create is being started or a type is being saved: the Create button waits. */
    busy: boolean;
    /** Create is being started: the Create button spins. */
    starting: boolean;
    onDone: () => void;
}

/**
 * The card import's footer (#1568, #1674), read from its phase: Discard (Admin / Accountant Lead, before Create has
 * written anything), Create while lines are left, and Done, the only button once the import is finished.
 */
export const CardImportFooter = ({ card, onCreate, busy, starting, onDone }: CardImportFooterProps) => {
    const { footer } = cardPhaseView(card);
    return (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3">
            {footer.discard && (
                <ImportDiscardButton
                    method={CARD_DISCARD_METHOD}
                    batch={card.batch}
                    offered={(canUndo) => canDiscardCard(card, canUndo)}
                    title="Discard this Credit Card Statement import?"
                    confirmation={cardDiscardConfirmation(card)}
                    onDiscarded={onDone}
                />
            )}
            {footer.create && (
                <Button onClick={onCreate} disabled={busy}>
                    {starting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    {footer.create}
                </Button>
            )}
            <Button variant={footer.done === "primary" ? "default" : "outline"} onClick={onDone}>
                Done
            </Button>
        </div>
    );
};
