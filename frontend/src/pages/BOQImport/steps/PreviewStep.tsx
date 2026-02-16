import { useMemo, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { Button } from '@/components/ui/button';
import { FormActions } from '@/components/ui/form-field-row';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatNumber } from '../constants';
import type { BOQPreviewRow, BOQImportResult, BOQUploadFormValues, FieldMapping } from '../schema';
import { useToast } from '@/components/ui/use-toast';

interface PreviewStepProps {
  fieldMapping: FieldMapping;
  dataStartRow: number;
  previewRows: string[][];
  totalRows: number;
  formValues: BOQUploadFormValues;
  fileUrl: string;
  selectedSheetIndex: number;
  onBack: () => void;
  onReset: () => void;
  onSuccess?: () => void;
}

export function PreviewStep({
  fieldMapping,
  dataStartRow,
  previewRows,
  totalRows,
  formValues,
  fileUrl,
  selectedSheetIndex,
  onBack,
  onReset,
  onSuccess,
}: PreviewStepProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [importResult, setImportResult] = useState<BOQImportResult | null>(null);

  const { call: importBOQ, loading: isImporting } = useFrappePostCall(
    'nirmaan_stack.api.boq_import.import_boq_data'
  );

  // fieldMapping is already in the correct format: targetField → colIndex
  const colIndexMap = fieldMapping;

  // Transform preview rows into typed BOQ rows
  const mappedRows: BOQPreviewRow[] = useMemo(() => {
    const toFloat = (val: string) => {
      const n = parseFloat(val);
      return isNaN(n) ? 0 : n;
    };

    return previewRows
      .map((row, idx) => {
        const description = colIndexMap.description != null ? row[colIndexMap.description] || '' : '';
        const unit = colIndexMap.unit != null ? row[colIndexMap.unit] || '' : '';
        const quantity = colIndexMap.quantity != null ? toFloat(row[colIndexMap.quantity]) : 0;
        const supply_rate = colIndexMap.supply_rate != null ? toFloat(row[colIndexMap.supply_rate]) : 0;
        const installation_rate = colIndexMap.installation_rate != null ? toFloat(row[colIndexMap.installation_rate]) : 0;
        const total_rate = supply_rate + installation_rate;
        const amount = quantity * total_rate;

        let hasWarning: BOQPreviewRow['hasWarning'] | undefined;
        if (!description.trim()) hasWarning = 'empty_description';
        else if (supply_rate === 0 && installation_rate === 0) hasWarning = 'zero_rates';

        return {
          rowIndex: idx + 1,
          description,
          unit,
          quantity,
          supply_rate,
          installation_rate,
          total_rate,
          amount,
          hasWarning,
        };
      })
      .filter(r => r.description.trim());
  }, [previewRows, colIndexMap]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalAmount = mappedRows.reduce((sum, r) => sum + r.amount, 0);
    const warningCount = mappedRows.filter(r => r.hasWarning).length;
    return { totalItems: mappedRows.length, totalAmount, warningCount };
  }, [mappedRows]);

  const handleImport = async () => {
    try {
      const result = await importBOQ({
        file_url: fileUrl,
        field_column_map: JSON.stringify(fieldMapping),
        data_start_row: dataStartRow,
        sheet_index: selectedSheetIndex,
        project: formValues.project,
        work_package: formValues.work_package,
        zone: formValues.zone || '',
      });

      const data = result?.message || result;
      setImportResult({
        status: 'success',
        boq_name: data.boq_name,
        items_count: data.items_count,
        total_amount: data.total_amount,
      });

      toast({
        title: 'BOQ Imported Successfully',
        description: `${data.items_count} items imported`,
      });

      if (onSuccess) {
        onSuccess();
        return;
      }
    } catch (error: any) {
      setImportResult({
        status: 'error',
        message: error?.message || 'Import failed',
      });
      toast({
        title: 'Import Failed',
        description: error?.message || 'An error occurred during import',
        variant: 'destructive',
      });
    }
  };

  // ─── Success State ───────────────────────────────────────────
  if (importResult?.status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6">
        <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">BOQ Imported Successfully</h3>
          <p className="text-sm text-muted-foreground">
            {importResult.items_count} items totalling{' '}
            {formatCurrency(importResult.total_amount || 0)}
          </p>
          <p className="text-xs text-muted-foreground font-mono">{importResult.boq_name}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onReset}>
            Import Another
          </Button>
          <Button onClick={() => navigate('/projects')}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  // ─── Preview Table ───────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4">
        <Card className="flex-1 min-w-[140px] shadow-sm">
          <CardContent className="p-3 flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Total Items</p>
              <p className="text-lg font-semibold tabular-nums">{totalRows}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[140px] shadow-sm">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-5 w-5 flex items-center justify-center text-primary font-bold text-sm">
              ₹
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Amount</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(summary.totalAmount)}
              </p>
            </div>
          </CardContent>
        </Card>
        {summary.warningCount > 0 && (
          <Card className="flex-1 min-w-[140px] shadow-sm border-amber-200">
            <CardContent className="p-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-xs text-muted-foreground">Warnings</p>
                <p className="text-lg font-semibold tabular-nums">{summary.warningCount}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Preview showing first N rows */}
      <p className="text-xs text-muted-foreground">
        Showing preview of {mappedRows.length} rows (of {totalRows} total)
      </p>

      <div
        className="border rounded-lg overflow-auto max-h-[400px]"
        style={{ overscrollBehavior: 'contain' }}
      >
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b w-12">
                #
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b min-w-[200px]">
                Description
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b w-16">
                Unit
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground border-b w-20">
                Qty
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground border-b w-24">
                Supply Rate
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground border-b w-24">
                Install Rate
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground border-b w-24">
                Total Rate
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground border-b w-28">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {mappedRows.map(row => (
              <tr
                key={row.rowIndex}
                className={cn(
                  'border-b border-border/50',
                  row.hasWarning === 'empty_description' && 'bg-amber-50 dark:bg-amber-950/20',
                  row.hasWarning === 'zero_rates' && 'bg-muted/30'
                )}
              >
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                  {row.rowIndex}
                </td>
                <td className="px-3 py-1.5 text-xs max-w-[300px]">
                  <span className="line-clamp-2">{row.description}</span>
                </td>
                <td className="px-3 py-1.5 text-xs">{row.unit}</td>
                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                  {formatNumber(row.quantity)}
                </td>
                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                  {formatNumber(row.supply_rate)}
                </td>
                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                  {formatNumber(row.installation_rate)}
                </td>
                <td className="px-3 py-1.5 text-xs text-right tabular-nums font-medium">
                  {formatNumber(row.total_rate)}
                </td>
                <td className="px-3 py-1.5 text-xs text-right tabular-nums font-medium">
                  {formatCurrency(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FormActions align="between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleImport} disabled={isImporting || mappedRows.length === 0}>
          {isImporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            `Import ${totalRows} Items`
          )}
        </Button>
      </FormActions>
    </div>
  );
}
