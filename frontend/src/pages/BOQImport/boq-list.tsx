import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Plus, FileSpreadsheet, Search } from 'lucide-react';
import { BOQImportDialog } from './boq-import-dialog';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';

interface BOQDoc {
  name: string;
  project: string;
  work_package: string;
  zone: string;
  status: string;
  total_items: number;
  total_amount: number;
  creation: string;
}

const statusStyles: Record<string, string> = {
  Imported: 'bg-emerald-100 text-emerald-700',
  Draft: 'bg-gray-100 text-gray-700',
  Error: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

export function BOQList() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);

  const { data: boqData, isLoading, mutate } = useFrappeGetDocList<BOQDoc>('BOQ', {
    fields: ['name', 'project', 'work_package', 'zone', 'status', 'total_items', 'total_amount', 'creation'],
    orderBy: { field: 'creation', order: 'desc' },
    limit: 100,
  });

  const filteredData = useMemo(() => {
    if (!boqData) return [];
    if (!searchTerm.trim()) return boqData;

    const lower = searchTerm.toLowerCase();
    return boqData.filter(
      (row) =>
        row.project?.toLowerCase().includes(lower) ||
        row.work_package?.toLowerCase().includes(lower) ||
        row.zone?.toLowerCase().includes(lower)
    );
  }, [boqData, searchTerm]);

  if (isLoading) return <LoadingFallback />;

  return (
    <div className="flex-1 space-y-5">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 md:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Bill of Quantities</h1>
            <p className="text-sm text-gray-500">Manage and import BOQ documents for your projects</p>
          </div>
          <Button onClick={() => setShowImportDialog(true)} className="whitespace-nowrap">
            <Plus className="h-4 w-4 mr-2" />
            Add BOQ
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 md:px-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="Search by project, work package, or zone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-10 border-gray-300 focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 md:px-6">
        {!boqData?.length ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <FileSpreadsheet className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No BOQ documents yet</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm">
              Import your first Bill of Quantities to get started.
            </p>
            <Button onClick={() => setShowImportDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Import your first BOQ
            </Button>
          </div>
        ) : filteredData.length === 0 ? (
          /* No search results */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No results found</h3>
            <p className="text-sm text-gray-500">Try adjusting your search term</p>
          </div>
        ) : (
          /* Table */
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Project
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Work Package
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Zone
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Items
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredData.map((row) => (
                      <tr
                        key={row.name}
                        onClick={() => navigate(`/boq/${row.name}`)}
                        className="cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                          {row.project}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {row.work_package}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {row.zone || '\u2014'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums whitespace-nowrap">
                          {row.total_items ?? 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums whitespace-nowrap">
                          {formatToRoundedIndianRupee(row.total_amount)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {formatDate(row.creation)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Import Dialog */}
      <BOQImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onSuccess={() => {
          setShowImportDialog(false);
          mutate();
        }}
      />
    </div>
  );
}

export default BOQList;
