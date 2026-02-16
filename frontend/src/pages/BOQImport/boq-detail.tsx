import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { ArrowLeft, FileSpreadsheet, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { formatCurrency, formatNumber } from './constants';

// ─── Status Badge ────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  Imported: 'bg-green-100 text-green-800',
  Draft: 'bg-gray-100 text-gray-700',
  Error: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────
export function BOQDetail() {
  const { boqId } = useParams<{ boqId: string }>();
  const navigate = useNavigate();

  const { data: boqDoc, isLoading } = useFrappeGetDoc('BOQ', boqId);

  const items: any[] = boqDoc?.items ?? [];

  const totals = useMemo(() => {
    let qty = 0;
    let amt = 0;
    for (const item of items) {
      qty += Number(item.quantity) || 0;
      amt += Number(item.amount) || 0;
    }
    return { qty, amt };
  }, [items]);

  // ─── Loading / Not Found ─────────────────────────────────
  if (isLoading) return <LoadingFallback />;

  if (!boqDoc) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">BOQ not found</p>
        <Button variant="ghost" onClick={() => navigate('/boq')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to BOQ List
        </Button>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-6 p-4 md:p-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => navigate('/boq')}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to BOQ List
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">BOQ: {boqDoc.name}</h1>
          <p className="text-xs font-mono text-muted-foreground">{boqDoc.name}</p>
        </div>
        <StatusBadge status={boqDoc.status} />
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">Project</span>
          <p className="font-medium">{boqDoc.project}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Work Package</span>
          <p className="font-medium">{boqDoc.work_package}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Zone</span>
          <p className="font-medium">{boqDoc.zone || '\u2014'}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Source File</span>
          {boqDoc.source_file ? (
            <p>
              <a
                href={boqDoc.source_file}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 hover:underline truncate block"
              >
                Download
              </a>
            </p>
          ) : (
            <p className="font-medium">{'\u2014'}</p>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Imported</span>
          <p className="font-medium">{formatDate(boqDoc.creation)}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-2xl font-semibold">{boqDoc.total_items ?? items.length}</p>
              <p className="text-xs text-muted-foreground">Total Items</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <IndianRupee className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-2xl font-semibold">{formatToRoundedIndianRupee(boqDoc.total_amount)}</p>
              <p className="text-xs text-muted-foreground">Total Amount</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Items table */}
      <div>
        <h2 className="text-base font-semibold mb-3">Items</h2>
        <div
          className="rounded-md border max-h-[500px] overflow-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-right w-12">#</th>
                <th className="px-3 py-2 text-left min-w-[200px]">Description</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-right">Quantity</th>
                <th className="px-3 py-2 text-right">Supply Rate</th>
                <th className="px-3 py-2 text-right">Install Rate</th>
                <th className="px-3 py-2 text-right">Total Rate</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.name ?? idx} className="border-b last:border-b-0 hover:bg-muted/40">
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{idx + 1}</td>
                  <td className="px-3 py-2 text-left min-w-[200px] line-clamp-2">{item.description}</td>
                  <td className="px-3 py-2 text-left">{item.unit || '\u2014'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.quantity ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.supply_rate ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(item.installation_rate ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatNumber(item.total_rate ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(item.amount ?? 0)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot className="border-t bg-muted/40 font-medium">
                <tr>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-left">Total</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.qty)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.amt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

export default BOQDetail;
