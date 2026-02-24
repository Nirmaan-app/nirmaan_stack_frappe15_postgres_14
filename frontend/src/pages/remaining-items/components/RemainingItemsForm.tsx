import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormEntry } from "../hooks/useRemainingItemsForm";

interface RemainingItemsFormProps {
  projectName: string;
  entries: FormEntry[];
  onQuantityChange: (index: number, value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  validationErrors: Map<string, string>;
  isEditing: boolean;
}

export const RemainingItemsForm: React.FC<RemainingItemsFormProps> = ({
  projectName,
  entries,
  onQuantityChange,
  onSubmit,
  isSubmitting,
  validationErrors,
  isEditing,
}) => {
  // Group entries by category for section headers
  const categories = Array.from(new Set(entries.map((e) => e.category)));

  const getStatusLabel = (entry: FormEntry) => {
    if (entry.remaining_quantity === null || entry.remaining_quantity === undefined) {
      return <span className="text-muted-foreground text-xs">Blank</span>;
    }
    if (entry.remaining_quantity === 0) {
      return <span className="text-red-600 text-xs font-medium">All Consumed</span>;
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  return (
    <div className="space-y-3">
      {isEditing ? (
        <div className="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
          Editing today's report for {projectName}
        </div>
      ) : null}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="min-w-[200px] text-sm">Item Name</TableHead>
              <TableHead className="min-w-[120px] text-sm">Category</TableHead>
              <TableHead className="text-center min-w-[60px] text-sm">Unit</TableHead>
              <TableHead className="text-right min-w-[100px] text-sm">DN Qty</TableHead>
              <TableHead className="text-right min-w-[130px] text-sm">Remaining</TableHead>
              <TableHead className="text-center min-w-[80px] text-sm">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => {
              const categoryEntries = entries
                .map((entry, idx) => ({ entry, idx }))
                .filter(({ entry }) => entry.category === category);

              return (
                <React.Fragment key={category}>
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-1.5 px-3 bg-muted/30 border-b"
                    >
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {category}
                      </span>
                    </TableCell>
                  </TableRow>
                  {categoryEntries.map(({ entry, idx }) => {
                    const error = validationErrors.get(`${idx}`);
                    return (
                      <TableRow key={`${entry.category}_${entry.item_id}`}>
                        <TableCell className="py-1.5 px-3 text-sm font-medium">
                          {entry.item_name || "N/A"}
                        </TableCell>
                        <TableCell className="py-1.5 px-3 text-sm text-muted-foreground">
                          {entry.category}
                        </TableCell>
                        <TableCell className="py-1.5 px-3 text-sm text-center">
                          {entry.unit || "N/A"}
                        </TableCell>
                        <TableCell className="py-1.5 px-3 text-sm text-right font-mono tabular-nums">
                          {entry.dn_quantity.toFixed(2)}
                        </TableCell>
                        <TableCell className="py-1.5 px-3 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <Input
                              type="number"
                              className={`h-8 w-24 text-right font-mono ${error ? "border-red-500" : ""}`}
                              value={entry.remaining_quantity !== null && entry.remaining_quantity !== undefined ? entry.remaining_quantity : ""}
                              onChange={(e) => onQuantityChange(idx, e.target.value)}
                              placeholder="—"
                              min={0}
                              max={entry.dn_quantity}
                              step="any"
                            />
                            {error ? (
                              <span className="text-red-500 text-xs">{error}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="py-1.5 px-3 text-center">
                          {getStatusLabel(entry)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : "Submit Report"}
        </Button>
      </div>
    </div>
  );
};
