import { useCallback, useState } from "react";

import type { DCMIRView } from "../components/DCMIRViewSwitch";

/**
 * View state of a "Delivery Challans & MIRs" card with a DC-wise | Item-wise switch
 * (PO page and ITM page). Opens on DC-wise (owner, 2026-11-26).
 *
 * - `setView` is the switch's handler; it clears any focused document.
 * - `openDoc` is the Item-wise DC/MIR-number click: it switches to DC-wise and focuses
 *   that document, which `DeliveryChallanTable` opens, highlights and scrolls to.
 */
export function useDCMIRView() {
  const [view, setViewState] = useState<DCMIRView>("dc");
  const [focusedDocName, setFocusedDocName] = useState<string | null>(null);

  const setView = useCallback((next: DCMIRView) => {
    setFocusedDocName(null);
    setViewState(next);
  }, []);

  const openDoc = useCallback((docName: string) => {
    setFocusedDocName(docName);
    setViewState("dc");
  }, []);

  return { view, setView, focusedDocName, openDoc };
}
