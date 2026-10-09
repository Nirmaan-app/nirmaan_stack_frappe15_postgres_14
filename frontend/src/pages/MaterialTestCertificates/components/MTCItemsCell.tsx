import { useState } from "react";

import type { MTCItem } from "@/types/NirmaanStack/MaterialTestCertificate";
import { MTC_ITEM_TAG_LABEL, mtcItemTag, type POLineInput } from "@/utils/mtc";

interface MTCItemsCellProps {
  items: MTCItem[];
  /** PO page only: tags items a revision removed or made non-billable. */
  poItems?: POLineInput[];
  /**
   * `text` (PO page card): "name · make, name · make +N more".
   * `list` (MTC list page): one item per line, "• name · make".
   */
  variant?: "text" | "list";
}

/** The items an MTC covers. Shows the first few, then "+N more" which expands the list in place. */
export const MTCItemsCell = ({ items, poItems, variant = "text" }: MTCItemsCellProps) => {
  const [expanded, setExpanded] = useState(false);
  const shown = variant === "list" ? 3 : 2;
  const visible = expanded ? items : items.slice(0, shown);
  const hidden = items.length - shown;

  const toggle = hidden > 0 && (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="text-xs text-blue-600 hover:underline"
      aria-expanded={expanded}
    >
      {expanded ? "show less" : `+${hidden} more`}
    </button>
  );

  if (variant === "list") {
    return (
      <div className="space-y-0.5">
        <ul className="space-y-0.5 text-sm">
          {visible.map((item, idx) => (
            <li key={`${item.item_id}-${item.make}-${idx}`} className="flex gap-1.5">
              <span className="text-muted-foreground" aria-hidden="true">•</span>
              <span>
                {item.item_name || item.item_id}
                {item.make && <span className="text-muted-foreground"> · {item.make}</span>}
              </span>
            </li>
          ))}
        </ul>
        {toggle}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      {visible.map((item, idx) => {
        const tag = poItems ? mtcItemTag(item, poItems) : null;
        return (
          <span key={`${item.item_id}-${item.make}-${idx}`} className="inline-flex items-center gap-1">
            <span>
              {item.item_name || item.item_id}
              {item.make && <span className="text-muted-foreground"> · {item.make}</span>}
              {idx < visible.length - 1 && ","}
            </span>
            {tag && (
              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 whitespace-nowrap">
                {MTC_ITEM_TAG_LABEL[tag]}
              </span>
            )}
          </span>
        );
      })}
      {toggle}
    </div>
  );
};
