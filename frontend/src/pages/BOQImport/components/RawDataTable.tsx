import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { SelectedHeaders, FieldMapping } from '../schema';
import { TARGET_FIELDS } from '../constants';

interface RawDataTableProps {
  rows: string[][];
  selectedHeaders: SelectedHeaders;
  detectedHeaderRow: number;
  onCellClick: (rowIndex: number, colIndex: number) => void;
  fieldMapping?: FieldMapping;
  dataStartRow?: number;
  startRowNumber?: number;
}

/** Column letter helper: 0→A, 1→B, ..., 25→Z, 26→AA */
function colLetter(index: number): string {
  let s = '';
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Short label for a target field */
const FIELD_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  TARGET_FIELDS.map(f => [f.value, f.label.length > 6 ? f.label.slice(0, 4) : f.label])
);

export function RawDataTable({
  rows,
  selectedHeaders,
  detectedHeaderRow,
  onCellClick,
  fieldMapping,
  dataStartRow,
  startRowNumber = 1,
}: RawDataTableProps) {
  if (!rows.length) return null;

  const maxCols = Math.max(...rows.map(r => r.length));

  // Reverse field mapping: colIndex → targetField name
  const reverseFieldMap = useMemo(() => {
    if (!fieldMapping) return {};
    const map: Record<number, string> = {};
    for (const [field, colIdx] of Object.entries(fieldMapping)) {
      map[colIdx] = field;
    }
    return map;
  }, [fieldMapping]);

  // Set of column indices that have a selected header cell
  const selectedColumns = useMemo(
    () => new Set(Object.keys(selectedHeaders).map(Number)),
    [selectedHeaders]
  );

  const hasHeaders = Object.keys(selectedHeaders).length > 0;

  return (
    <div
      className="border rounded-lg overflow-auto"
      style={{ overscrollBehavior: 'contain' }}
    >
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b w-12">
              Row
            </th>
            {Array.from({ length: maxCols }, (_, i) => (
              <th
                key={i}
                className={cn(
                  "px-3 py-2 text-left text-xs font-medium border-b min-w-[100px]",
                  selectedColumns.has(i)
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground"
                )}
              >
                {colLetter(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => {
            const isDetectedRow = rowIdx === detectedHeaderRow;
            const isInDataZone = hasHeaders && dataStartRow != null && rowIdx >= dataStartRow;

            return (
              <tr
                key={rowIdx}
                className={cn(
                  'border-b border-border/50 transition-colors',
                  isInDataZone && 'opacity-50',
                )}
              >
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    {startRowNumber + rowIdx}
                    {isDetectedRow && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Detected
                      </Badge>
                    )}
                  </span>
                </td>
                {Array.from({ length: maxCols }, (_, colIdx) => {
                  const cellValue = row[colIdx] || '';
                  const isSelected = selectedHeaders[colIdx] === rowIdx;
                  const mappedField = reverseFieldMap[colIdx];
                  const isMappedCell = isSelected && mappedField != null;

                  return (
                    <td
                      key={colIdx}
                      onClick={() => {
                        if (!isInDataZone) onCellClick(rowIdx, colIdx);
                      }}
                      className={cn(
                        'px-3 py-1.5 text-xs max-w-[200px] truncate transition-colors relative',
                        // Selected cell states
                        isSelected && isMappedCell && 'bg-primary/15 font-semibold text-primary ring-1 ring-primary/30',
                        isSelected && !isMappedCell && 'bg-primary/15 font-semibold text-primary ring-1 ring-primary/30',
                        // Column stripe for non-selected cells in selected columns
                        !isSelected && selectedColumns.has(colIdx) && !isInDataZone && 'bg-primary/[0.03]',
                        // Hover for clickable non-empty cells
                        !isSelected && !isInDataZone && cellValue && 'cursor-pointer hover:bg-primary/10 hover:ring-1 hover:ring-primary/20',
                        // Empty cell styling
                        !cellValue && 'text-muted-foreground/30',
                        // Data zone cells have no cursor
                        isInDataZone && 'cursor-default',
                      )}
                      title={cellValue}
                    >
                      <span className="flex items-center gap-1.5">
                        {cellValue}
                        {isMappedCell && (
                          <Badge className="text-[9px] px-1 py-0 shrink-0 bg-emerald-600">
                            {FIELD_SHORT_LABELS[mappedField] || mappedField}
                          </Badge>
                        )}
                        {isSelected && !isMappedCell && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                            HDR
                          </Badge>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
