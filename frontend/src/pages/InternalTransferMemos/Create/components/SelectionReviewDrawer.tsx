import { useMemo } from "react";
import { AlertTriangle, Inbox, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ItemSelection, SelectionState } from "../types";

interface SelectionReviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
}

interface FlatPick {
  source: string;
  source_project_name: string;
  subKey: string;
  entry: ItemSelection;
}

const isInvalidEntry = (e: ItemSelection): boolean =>
  !(e.qty > 0) || e.qty > e.available_quantity;

export function SelectionReviewDrawer({
  open,
  onOpenChange,
  selection,
  onSelectionChange,
}: SelectionReviewDrawerProps) {
  // Group selections by source project. Source order = first time the project
  // was added to selection (Map preserves insertion order).
  const grouped = useMemo<Array<{ source: string; source_project_name: string; picks: FlatPick[] }>>(() => {
    const map = new Map<string, { source: string; source_project_name: string; picks: FlatPick[] }>();
    for (const [source, byKey] of Object.entries(selection)) {
      for (const [subKey, entry] of Object.entries(byKey)) {
        const projectName = entry.source_project_name || source;
        let bucket = map.get(source);
        if (!bucket) {
          bucket = { source, source_project_name: projectName, picks: [] };
          map.set(source, bucket);
        }
        bucket.picks.push({ source, source_project_name: projectName, subKey, entry });
      }
    }
    return Array.from(map.values());
  }, [selection]);

  const totalPicks = useMemo(
    () => grouped.reduce((sum, g) => sum + g.picks.length, 0),
    [grouped]
  );
  const sourceCount = grouped.length;

  const updateQty = (source: string, subKey: string, qty: number) => {
    const cur = selection[source]?.[subKey];
    if (!cur) return;
    onSelectionChange({
      ...selection,
      [source]: {
        ...selection[source],
        [subKey]: { ...cur, qty },
      },
    });
  };

  const removePick = (source: string, subKey: string) => {
    if (!selection[source]) return;
    const { [subKey]: _, ...rest } = selection[source];
    const next: SelectionState = { ...selection };
    if (Object.keys(rest).length === 0) {
      delete next[source];
    } else {
      next[source] = rest;
    }
    onSelectionChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">Review selections</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {totalPicks === 0
              ? "Pick items from the catalogue to see them here."
              : `${totalPicks} item${totalPicks !== 1 ? "s" : ""} across ${sourceCount} source project${sourceCount !== 1 ? "s" : ""}`}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {totalPicks === 0 ? (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground gap-2 py-12">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">No items selected yet</p>
              <p className="text-xs">
                Pick items from the catalogue to see them here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <section key={group.source} className="space-y-2">
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <h3 className="text-sm font-semibold text-blue-600">
                      {group.source_project_name}
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {group.picks.length} item{group.picks.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <ul className="space-y-2">
                    {group.picks.map(({ subKey, entry }) => {
                      const invalid = isInvalidEntry(entry);
                      return (
                        <li
                          key={subKey}
                          className={cn(
                            "rounded-md border p-3 transition-colors",
                            invalid && "border-destructive/60 bg-destructive/5"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p
                                className="text-sm font-medium truncate"
                                title={entry.item_name}
                              >
                                {entry.item_name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Make: {entry.make ?? "—"} · {entry.unit}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => removePick(group.source, subKey)}
                              aria-label={`Remove ${entry.item_name}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-xs tabular-nums whitespace-nowrap">
                              <span className="text-muted-foreground">Available:</span>
                              <span className="font-semibold text-foreground">
                                {entry.available_quantity.toLocaleString("en-IN")}
                              </span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              {invalid && (
                                <AlertTriangle
                                  className="h-3.5 w-3.5 text-destructive"
                                  aria-label="Quantity invalid"
                                />
                              )}
                              <span className="text-xs text-blue-600">Qty</span>
                              <Input
                                type="number"
                                min={0}
                                max={entry.available_quantity}
                                step="any"
                                value={Number.isFinite(entry.qty) ? entry.qty : ""}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === "") {
                                    updateQty(group.source, subKey, 0);
                                    return;
                                  }
                                  const n = Number(raw);
                                  updateQty(
                                    group.source,
                                    subKey,
                                    Number.isFinite(n) ? n : 0
                                  );
                                }}
                                className={cn(
                                  "h-7 w-20 text-xs tabular-nums",
                                  invalid &&
                                    "border-destructive focus-visible:ring-destructive"
                                )}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
