import React from "react";

import { cn } from "@/lib/utils";

/** The two views of a "Delivery Challans & MIRs" card. */
export type DCMIRView = "dc" | "item";

const VIEWS: ReadonlyArray<readonly [DCMIRView, string]> = [
  ["dc", "DC-wise"],
  ["item", "Item-wise"],
];

interface DCMIRViewSwitchProps {
  view: DCMIRView;
  onChange: (view: DCMIRView) => void;
}

/**
 * DC-wise | Item-wise switch, on its own row under a "Delivery Challans & MIRs" card
 * header. Shared by the PO page (`DocumentAttachments`) and the ITM page
 * (`ITMAttachmentSection`); both open on DC-wise. Full width on mobile.
 */
export const DCMIRViewSwitch: React.FC<DCMIRViewSwitchProps> = ({ view, onChange }) => (
  <div className="border-b border-gray-200 px-4 py-2">
    <div
      className="flex w-full items-center gap-1 rounded-lg bg-muted p-1 sm:inline-flex sm:w-auto"
      role="group"
      aria-label="Delivery Challans & MIRs view"
    >
      {VIEWS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex-1 rounded-md px-3.5 py-1.5 text-sm font-medium transition-all sm:flex-none",
            view === value ? "bg-red-600 text-white shadow-sm" : "text-foreground hover:text-black"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
);
