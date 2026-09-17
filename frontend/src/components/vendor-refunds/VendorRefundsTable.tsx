import { TruncatedText } from "@/components/common/TruncatedText";
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { RefundAttachmentLink } from "./RefundAttachmentLink";
import type { VendorRefundRow } from "./useVendorRefunds";

/**
 * The refunds against ONE PO or WO, with a total -- the "Vendor Refunds" dialog's table. (The vendor
 * page's tab uses the shared server data table instead: `pages/vendors/components/VendorRefundsTab`.)
 */
export const VendorRefundsTable = ({ refunds }: { refunds: VendorRefundRow[] }) => {
    const total = refunds.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return (
        <Table>
            <TableHeader className="bg-red-100">
                <TableRow>
                    <TableHead className="text-black font-bold">Date</TableHead>
                    <TableHead className="text-black font-bold">Refund</TableHead>
                    <TableHead className="text-black font-bold">UTR / Ref</TableHead>
                    <TableHead className="text-black font-bold">Description</TableHead>
                    <TableHead className="text-black font-bold text-right">Amount</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {refunds.map((row) => (
                    <TableRow key={row.name}>
                        <TableCell className="whitespace-nowrap">
                            {row.payment_date ? formatDate(row.payment_date) : "--"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{row.name}</TableCell>
                        <TableCell className="max-w-[200px]">
                            <RefundAttachmentLink refund={row} />
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                            <TruncatedText text={row.description} fallback="--" />
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                            {formatToIndianRupee(row.amount)}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
            <TableFooter>
                <TableRow>
                    <TableCell colSpan={4} className="font-semibold">
                        Total ({refunds.length})
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                        {formatToIndianRupee(total)}
                    </TableCell>
                </TableRow>
            </TableFooter>
        </Table>
    );
};
