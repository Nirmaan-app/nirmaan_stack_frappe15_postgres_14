import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Minimal antd-`Table` replacement rendered on shadcn `Table`.
 *
 * Covers exactly the API surface the migrated screens use:
 *   columns: { title, dataIndex, key, render(value, record, index), width, align }[]
 *   dataSource, rowKey, pagination (accepted + ignored — all call sites pass false),
 *   expandable: { expandedRowRender(record, index), rowExpandable? }
 *
 * A parent row with `expandable` gets a chevron that toggles a full-width detail row
 * (which itself is usually another <SimpleTable>). Client-side expand state, no lib.
 */
export type Column<T = any> = {
  title?: React.ReactNode;
  dataIndex?: string;
  key?: string | number;
  width?: string | number;
  align?: "left" | "center" | "right";
  render?: (value: any, record: T, index: number) => React.ReactNode;
};

export type ColumnsType<T = any> = Column<T>[];

/** No-op stand-in for antd's <ConfigProvider> — its theme is irrelevant once tables render
 *  on shadcn. Lets a call site keep its <ConfigProvider> wrapper and migrate by import-swap. */
export const PassThrough = ({ children }: { children?: React.ReactNode; [key: string]: any }) => <>{children}</>;

interface SimpleTableProps<T = any> {
  columns: Column<T>[];
  dataSource?: T[];
  rowKey?: string | ((record: T, index: number) => string);
  expandable?: {
    expandedRowRender: (record: T, index: number) => React.ReactNode;
    rowExpandable?: (record: T) => boolean;
    // Accept-and-ignore antd's controlled-expand props (expandedRowKeys, onExpandedRowsChange…)
    // so call sites can migrate by import-swap alone; the shim owns expand state internally.
    [key: string]: any;
  };
  pagination?: any;
  className?: string;
  size?: "small" | "middle" | "large";
}

const resolveKey = (rowKey: SimpleTableProps["rowKey"], record: any, i: number): string => {
  if (typeof rowKey === "function") return String(rowKey(record, i));
  if (rowKey) return String(record?.[rowKey]);
  return String(record?.key ?? i);
};

export function SimpleTable<T = any>({ columns, dataSource = [], rowKey, expandable, className }: SimpleTableProps<T>) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const colCount = columns.length + (expandable ? 1 : 0);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {expandable && <TableHead className="w-8" />}
            {columns.map((c, ci) => (
              <TableHead key={c.key ?? ci} style={{ width: c.width, textAlign: c.align }}>
                {c.title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {dataSource.map((record, ri) => {
            const k = resolveKey(rowKey, record, ri);
            const canExpand = !!expandable && (expandable.rowExpandable ? expandable.rowExpandable(record) : true);
            const isOpen = expanded.has(k);
            return (
              <React.Fragment key={k}>
                <TableRow>
                  {expandable && (
                    <TableCell className="w-8 align-top">
                      {canExpand && (
                        <button
                          type="button"
                          onClick={() => toggle(k)}
                          aria-label={isOpen ? "Collapse row" : "Expand row"}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                        </button>
                      )}
                    </TableCell>
                  )}
                  {columns.map((c, ci) => {
                    const val = c.dataIndex ? (record as any)?.[c.dataIndex] : undefined;
                    return (
                      <TableCell key={c.key ?? ci} style={{ textAlign: c.align }}>
                        {c.render ? c.render(val, record, ri) : (val as React.ReactNode)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {expandable && isOpen && canExpand && (
                  <TableRow>
                    <TableCell colSpan={colCount} className="bg-muted/30 p-2">
                      {expandable.expandedRowRender(record, ri)}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
