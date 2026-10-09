import { Eye, Pencil, Trash2 } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import type { POLineInput } from "@/utils/mtc";
import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";

import { MTCItemsCell } from "./MTCItemsCell";

interface MTCTableProps {
  mtcs: MaterialTestCertificate[];
  getUserName: (id?: string) => string;
  /** Tags items a revision removed or made non-billable. */
  poItems?: POLineInput[];
  /** Edit / Delete render when true. */
  canChange?: boolean;
  onEdit?: (mtc: MaterialTestCertificate) => void;
  onDelete?: (mtc: MaterialTestCertificate) => void;
  deletingName?: string | null;
  isLoading?: boolean;
  emptyText: string;
}

/**
 * The PO page card's table: S.No · Certificate Date · Uploaded On · Items · Uploaded By · Actions.
 * MTC ids are never shown to users (owner); `mtc.name` is used only as a key.
 */
export const MTCTable = ({
  mtcs,
  getUserName,
  poItems,
  canChange = false,
  onEdit,
  onDelete,
  deletingName,
  isLoading,
  emptyText,
}: MTCTableProps) => (
  <Table>
    <TableHeader className="bg-red-100">
      <TableRow>
        <TableHead className="w-[64px] text-black font-bold">S.No.</TableHead>
        <TableHead className="w-[130px] text-black font-bold">Certificate Date</TableHead>
        <TableHead className="w-[120px] text-black font-bold">Uploaded On</TableHead>
        <TableHead className="text-black font-bold">Items</TableHead>
        <TableHead className="w-[150px] text-black font-bold">Uploaded By</TableHead>
        <TableHead className="w-[130px] text-center text-black font-bold">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {isLoading ? (
        <TableRow>
          <TableCell colSpan={6} className="py-6 text-center" role="status">
            <TailSpin color="red" height={28} width={28} wrapperClass="justify-center" />
          </TableCell>
        </TableRow>
      ) : mtcs.length === 0 ? (
        <TableRow>
          <TableCell colSpan={6} className="py-4 text-center text-gray-500">
            {emptyText}
          </TableCell>
        </TableRow>
      ) : (
        mtcs.map((mtc, index) => (
          <TableRow key={mtc.name}>
            <TableCell className="text-center">{index + 1}</TableCell>
            <TableCell>{mtc.certificate_date ? formatDate(mtc.certificate_date) : "—"}</TableCell>
            <TableCell>{formatDate(mtc.creation)}</TableCell>
            <TableCell>
              <MTCItemsCell items={mtc.items} poItems={poItems} />
            </TableCell>
            <TableCell className="text-sm text-gray-600">{getUserName(mtc.owner)}</TableCell>
            <TableCell className="text-center">
              <div className="flex items-center justify-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-blue-600 hover:text-blue-800"
                  asChild
                  aria-label="View certificate file"
                >
                  <a href={`${SITEURL}${mtc.attachment}`} target="_blank" rel="noreferrer noopener">
                    <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
                    View
                  </a>
                </Button>
                {canChange && onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:text-primary/80"
                    onClick={() => onEdit(mtc)}
                    title="Edit certificate"
                    aria-label="Edit certificate"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                {canChange && onDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600 hover:text-red-800"
                        disabled={deletingName === mtc.name}
                        title="Delete certificate"
                        aria-label="Delete certificate"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this certificate?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The {mtc.items.length} item{mtc.items.length === 1 ? "" : "s"} it covers become
                          free for a new certificate. This can't be undone from the app.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-700 hover:bg-red-800" onClick={() => onDelete(mtc)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))
      )}
    </TableBody>
  </Table>
);
