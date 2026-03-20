import { useCallback, useMemo } from 'react';
import ReactSelect from 'react-select';
import { Button } from '@/components/ui/button';
import { FormActions } from '@/components/ui/form-field-row';
import { Badge } from '@/components/ui/badge';
import { Info, AlertCircle } from 'lucide-react';
import { getSelectStyles } from '@/config/selectTheme';
import { RawDataTable } from '../components/RawDataTable';
import { cn } from '@/lib/utils';
import { TARGET_FIELDS, MAX_HEADER_SELECTIONS } from '../constants';
import { colLetter } from '../hooks/useExcelParser';
import type { SelectedHeaders, FieldMapping, SelectOption } from '../schema';

interface HeaderMappingStepProps {
  rawRows: string[][];
  allRows: string[][];
  detectedHeaderRow: number;
  selectedHeaders: SelectedHeaders;
  fieldMapping: FieldMapping;
  dataStartRow: number;
  onCellClick: (rowIndex: number, colIndex: number) => void;
  onFieldMappingChange: (mapping: FieldMapping) => void;
  onNext: () => void;
  onBack: () => void;
  sheetNames?: string[];
  selectedSheetIndex?: number;
  onSheetChange?: (index: number) => void;
}

export function HeaderMappingStep({
  rawRows,
  allRows,
  detectedHeaderRow,
  selectedHeaders,
  fieldMapping,
  dataStartRow,
  onCellClick,
  onFieldMappingChange,
  onNext,
  onBack,
  sheetNames,
  selectedSheetIndex,
  onSheetChange,
}: HeaderMappingStepProps) {
  // Build dropdown options from selected header cells
  const columnOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = [];
    for (const [colIdxStr, rowIdx] of Object.entries(selectedHeaders)) {
      const colIdx = Number(colIdxStr);
      const cellValue = allRows[rowIdx]?.[colIdx] || '';
      const label = cellValue
        ? `${colLetter(colIdx)}: ${cellValue}`
        : `${colLetter(colIdx)}: (empty)`;
      opts.push({ label, value: String(colIdx) });
    }
    // Sort by column index
    opts.sort((a, b) => Number(a.value) - Number(b.value));
    return opts;
  }, [selectedHeaders, allRows]);

  // Track which columns are already mapped to a field
  const mappedColIndices = useMemo(
    () => new Set(Object.values(fieldMapping)),
    [fieldMapping]
  );

  const isDescriptionMapped = fieldMapping.description != null;
  const hasAnyHeaders = Object.keys(selectedHeaders).length > 0;
  const selectionCount = Object.keys(selectedHeaders).length;
  const isAtLimit = selectionCount >= MAX_HEADER_SELECTIONS;

  // Get options for a specific target field, disabling already-used columns
  const getOptionsForField = useCallback(
    (targetField: string) => {
      const currentColIdx = fieldMapping[targetField];
      return columnOptions.map(opt => ({
        ...opt,
        isDisabled: Number(opt.value) !== currentColIdx && mappedColIndices.has(Number(opt.value)),
      }));
    },
    [columnOptions, fieldMapping, mappedColIndices]
  );

  const handleFieldChange = useCallback(
    (targetField: string, option: SelectOption | null) => {
      const newMapping = { ...fieldMapping };
      if (option) {
        newMapping[targetField] = Number(option.value);
      } else {
        delete newMapping[targetField];
      }
      onFieldMappingChange(newMapping);
    },
    [fieldMapping, onFieldMappingChange]
  );

  return (
    <div className="space-y-4">
      {/* Info callout */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <Info className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
        <div className="flex-1 text-sm text-blue-700 dark:text-blue-300">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Click individual cells to mark them as column headers</p>
            <Badge
              variant="secondary"
              className={cn(
                "text-xs tabular-nums shrink-0",
                isAtLimit && "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
              )}
            >
              {selectionCount}/{MAX_HEADER_SELECTIONS}
            </Badge>
          </div>
          <p className="text-xs mt-1 text-blue-600 dark:text-blue-400">
            Each selected cell becomes the header for its column. Click again to deselect. Up to {MAX_HEADER_SELECTIONS} cells.
          </p>
        </div>
      </div>

      {/* Sheet selector (multi-sheet workbooks) */}
      {sheetNames && sheetNames.length > 1 && onSheetChange && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            Sheet
          </label>
          <div className="w-64">
            <ReactSelect<SelectOption>
              options={sheetNames.map((name, idx) => ({ label: name, value: String(idx) }))}
              value={{ label: sheetNames[selectedSheetIndex ?? 0], value: String(selectedSheetIndex ?? 0) }}
              onChange={(opt) => opt && onSheetChange(Number(opt.value))}
              styles={getSelectStyles<SelectOption>()}
              classNames={{
                control: () => '!min-h-[32px]',
                valueContainer: () => '!py-0',
              }}
            />
          </div>
        </div>
      )}

      {/* Data table — generous height, internally scrollable */}
      <div className="overflow-hidden rounded-lg" style={{ height: '420px' }}>
        <div className="h-full overflow-auto" style={{ overscrollBehavior: 'contain' }}>
          <RawDataTable
            rows={rawRows}
            selectedHeaders={selectedHeaders}
            detectedHeaderRow={detectedHeaderRow}
            onCellClick={onCellClick}
            fieldMapping={fieldMapping}
            dataStartRow={dataStartRow}
          />
        </div>
      </div>

      {/* Field mapping */}
      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Map Fields</h4>
          <div className="flex flex-wrap gap-1.5">
            {TARGET_FIELDS.map(field => (
              <Badge
                key={field.value}
                variant={fieldMapping[field.value] != null ? 'default' : 'outline'}
                className={fieldMapping[field.value] != null ? '' : 'opacity-50'}
              >
                {field.label}
                {field.required && fieldMapping[field.value] == null && ' *'}
              </Badge>
            ))}
          </div>
        </div>

        {!isDescriptionMapped && hasAnyHeaders && (
          <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <strong>Description</strong> must be mapped to proceed.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {TARGET_FIELDS.map(field => {
            const currentColIdx = fieldMapping[field.value];
            const selectedOption = currentColIdx != null
              ? columnOptions.find(o => Number(o.value) === currentColIdx) || null
              : null;

            return (
              <div
                key={field.value}
                className="flex items-center gap-3 p-2 rounded-md border border-border/50 bg-muted/20"
              >
                <label className="text-sm font-medium w-36 shrink-0 text-right text-muted-foreground">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <div className="flex-1 min-w-0">
                  <ReactSelect<SelectOption>
                    options={getOptionsForField(field.value) as SelectOption[]}
                    value={selectedOption}
                    onChange={(opt) => handleFieldChange(field.value, opt as SelectOption | null)}
                    placeholder="Select column..."
                    isClearable
                    styles={getSelectStyles<SelectOption>()}
                    menuPlacement="auto"
                    isDisabled={!hasAnyHeaders}
                    classNames={{
                      control: () => '!min-h-[32px]',
                      valueContainer: () => '!py-0',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <FormActions align="between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!isDescriptionMapped}>
          Next: Preview & Import
        </Button>
      </FormActions>
    </div>
  );
}
