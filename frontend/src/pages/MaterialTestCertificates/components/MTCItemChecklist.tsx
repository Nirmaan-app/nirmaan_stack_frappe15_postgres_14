import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MTC_ITEM_TAG_LABEL, type MTCItemTag, type MTCLine } from "@/utils/mtc";

interface MTCItemChecklistProps {
  lines: MTCLine[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Items saved on this MTC that no longer match the PO (Edit only). */
  tags?: Map<string, MTCItemTag>;
}

const checkState = (lines: MTCLine[], selected: Set<string>): boolean | "indeterminate" => {
  const ticked = lines.filter((l) => selected.has(l.key)).length;
  if (ticked === 0) return false;
  return ticked === lines.length ? true : "indeterminate";
};

/**
 * The items an MTC covers: a search box, an "All items" box and ONE plain list -- no category or package
 * grouping (owner, 2026-10-07). Each row is the item name with its make. No quantities.
 */
export const MTCItemChecklist = ({ lines, selected, onChange, tags }: MTCItemChecklistProps) => {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return lines;
    return lines.filter((l) => {
      const text = `${l.item_name ?? ""} ${l.item_id} ${l.make ?? ""} ${l.category ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [lines, query]);

  // Ticking a box acts on the lines it shows; a search narrows that to the matching lines.
  const setMany = (target: MTCLine[], on: boolean) => {
    const next = new Set(selected);
    for (const l of target) {
      if (on) next.add(l.key);
      else next.delete(l.key);
    }
    onChange(next);
  };

  const selectedCount = lines.filter((l) => selected.has(l.key)).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="mtc-item-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items"
            className="h-9 pl-8"
            aria-label="Search items"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {selectedCount} of {lines.length} selected
        </span>
      </div>

      <div className="max-h-[320px] overflow-y-auto rounded-md border">
        {lines.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No billable items left without a certificate.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No item matches your search.</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
              <Checkbox
                checked={checkState(visible, selected)}
                onCheckedChange={(checked) => setMany(visible, !!checked)}
                aria-label={query ? "Select all items shown" : "Select all items"}
              />
              {query ? "All items shown" : "All items"}
            </label>
            {visible.map((line) => {
              const tag = tags?.get(line.key);
              return (
                <label
                  key={line.key}
                  className="flex cursor-pointer items-start gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/30"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(line.key)}
                    onCheckedChange={(checked) => setMany([line], !!checked)}
                    aria-label={`Select ${line.item_name || line.item_id}`}
                  />
                  <span className="min-w-0 flex-1">
                    {line.item_name || line.item_id}
                    {tag && (
                      <span className="ml-2 inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 whitespace-nowrap">
                        {MTC_ITEM_TAG_LABEL[tag]}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{line.make || "—"}</span>
                </label>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
