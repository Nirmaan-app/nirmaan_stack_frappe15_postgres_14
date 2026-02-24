import React, { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormEntry } from "../hooks/useRemainingItemsForm";
import { DeclarationDialog } from "./DeclarationDialog";

interface RemainingItemsFormProps {
  projectName: string;
  projectCity: string;
  entries: FormEntry[];
  onQuantityChange: (index: number, value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  validationErrors: Map<string, string>;
  isEditing: boolean;
  onCancel?: () => void;
  filledCount: number;
  totalCount: number;
}

export const RemainingItemsForm: React.FC<RemainingItemsFormProps> = ({
  projectName,
  projectCity,
  entries,
  onQuantityChange,
  onSubmit,
  isSubmitting,
  validationErrors,
  isEditing,
  onCancel,
  filledCount,
  totalCount,
}) => {
  // Group entries by category for section headers
  const categories = Array.from(new Set(entries.map((e) => e.category)));

  const allFilled = filledCount === totalCount;
  const [declarationOpen, setDeclarationOpen] = useState(false);

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
              <TableHead className="text-center min-w-[60px] text-sm">Unit</TableHead>
              <TableHead className="text-right min-w-[130px] text-sm">Remaining</TableHead>
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
                      colSpan={3}
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
                        <TableCell className="py-1.5 px-3 text-sm text-center">
                          {entry.unit || "N/A"}
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
                              step="any"
                            />
                            {error ? (
                              <span className="text-red-500 text-xs">{error}</span>
                            ) : null}
                          </div>
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

      <div className="flex justify-end gap-2">
        {isEditing && onCancel ? (
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        ) : null}
        <Button onClick={() => setDeclarationOpen(true)} disabled={isSubmitting || !allFilled}>
          {`Submit Report (${filledCount}/${totalCount})`}
        </Button>
      </div>

      <DeclarationDialog
        open={declarationOpen}
        onOpenChange={setDeclarationOpen}
        entries={entries}
        onConfirm={onSubmit}
        isSubmitting={isSubmitting}
        projectCity={projectCity}
      />
    </div>
  );
};
