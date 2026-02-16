import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Plus, FileSpreadsheet } from 'lucide-react';
import { BOQImportDialog } from './boq-import-dialog';

interface BOQListItem {
  name: string;
  work_package: string;
  zone: string;
  status: string;
  total_items: number;
  total_amount: number;
  creation: string;
}

interface ProjectBOQTabProps {
  projectId: string;
  projectName?: string;
  boqList?: { name: string }[];  // Basic list from parent to check empty state
  onRefresh: () => void;
}

export function ProjectBOQTab({ projectId, boqList, onRefresh }: ProjectBOQTabProps) {
  const navigate = useNavigate();
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Fetch full BOQ data for this project (more fields than parent's basic fetch)
  const { data: boqData, mutate } = useFrappeGetDocList<BOQListItem>('BOQ', {
    fields: ['name', 'work_package', 'zone', 'status', 'total_items', 'total_amount', 'creation'],
    filters: [['project', '=', projectId]],
    orderBy: { field: 'creation', order: 'desc' },
    limit: 100,
  });

  const handleImportSuccess = () => {
    setShowImportDialog(false);
    mutate();
    onRefresh();
  };

  const statusStyles: Record<string, string> = {
    Imported: 'bg-emerald-100 text-emerald-700',
    Draft: 'bg-gray-100 text-gray-700',
    Error: 'bg-red-100 text-red-700',
  };

  // Empty state
  if (!boqList?.length && !boqData?.length) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <FileSpreadsheet className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No BOQ documents</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            Import a Bill of Quantities spreadsheet for this project.
          </p>
          <Button onClick={() => setShowImportDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Import BOQ
          </Button>
        </div>
        <BOQImportDialog
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onSuccess={handleImportSuccess}
          preSelectedProject={projectId}
        />
      </>
    );
  }

  // List state
  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-medium">BOQ Documents</h3>
          <Button onClick={() => setShowImportDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Import BOQ
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Package</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Zone</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {boqData?.map((row) => (
                    <tr
                      key={row.name}
                      onClick={() => navigate(`/boq/${row.name}`)}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.work_package}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.zone || '\u2014'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums whitespace-nowrap">{row.total_items ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums whitespace-nowrap">{formatToRoundedIndianRupee(row.total_amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[row.status] || 'bg-gray-100 text-gray-700'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(row.creation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <BOQImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onSuccess={handleImportSuccess}
        preSelectedProject={projectId}
      />
    </>
  );
}
