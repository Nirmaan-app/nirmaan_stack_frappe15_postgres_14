import React, { useState } from "react";
import { Link } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { MatchGstToVendorDialog } from "../components/MatchGstToVendorDialog";
import { useGstMismatchList } from "../hooks/useMatchGstToVendor";

const AMOUNT = "whitespace-nowrap text-right tabular-nums";

/**
 * The GST mismatch list (#1538, ADR-0028 Amendment A): every Approved Work Order whose GST flag
 * disagrees with its vendor, both directions, for Admin and Accountants to match one by one.
 * The parent tab shows it only to those roles; the server refuses everyone else.
 */
const GstMismatchList: React.FC = () => {
    const { rows, isLoading, error, mutate } = useGstMismatchList(true);
    // The dialog holds the row's name, never the row (frontend CODING_STANDARDS § Fetching or mutating data).
    const [matching, setMatching] = useState<string | null>(null);

    if (isLoading) {
        return <div className="flex justify-center py-10"><TailSpin height={32} width={32} color="red" /></div>;
    }
    if (error) return <p className="py-6 text-sm text-destructive">{getFrappeError(error)}</p>;

    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                Approved Work Orders whose GST Applicable disagrees with their vendor: GST off although the vendor
                has a GST number, or GST on although it has none. Nothing changes until you match one.
            </p>
            {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Every Approved Work Order's GST matches its vendor.</p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="whitespace-nowrap">Work Order</TableHead>
                                <TableHead>Project</TableHead>
                                <TableHead>Vendor</TableHead>
                                <TableHead className="whitespace-nowrap">GST now</TableHead>
                                <TableHead className={AMOUNT}>Total</TableHead>
                                <TableHead className={AMOUNT}>Amount Paid</TableHead>
                                <TableHead className={AMOUNT}>Amount Due</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.name}>
                                    <TableCell className="whitespace-nowrap">
                                        <Link
                                            to={`/service-requests/${row.name}?tab=${row.is_finalized ? "finalized-sr" : "approved-sr"}`}
                                            className="font-medium text-blue-600 underline-offset-2 hover:underline"
                                        >
                                            {row.name}
                                        </Link>
                                        <div className="text-xs text-muted-foreground">{formatDate(row.creation)}</div>
                                        {row.is_finalized === 1 && <Badge variant="outline" className="mt-1">Finalized</Badge>}
                                    </TableCell>
                                    <TableCell><div className="max-w-[200px] truncate" title={row.project_name || row.project}>{row.project_name || row.project}</div></TableCell>
                                    <TableCell>
                                        <div className="max-w-[220px] truncate" title={row.vendor_name || row.vendor}>{row.vendor_name || row.vendor}</div>
                                        <div className="text-xs text-muted-foreground">{row.vendor_gst?.trim() ? `GSTIN ${row.vendor_gst}` : "No GST number"}</div>
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap">
                                        {row.target_gst === "true" ? "Off → should be On" : "On → should be Off"}
                                        {row.gst_payments > 0 && row.target_gst === "false" && (
                                            <div className="text-xs text-destructive">{row.gst_payments} GST payment(s) block this</div>
                                        )}
                                    </TableCell>
                                    <TableCell className={AMOUNT}>{formatToIndianRupeeOrZero(row.total_amount)}</TableCell>
                                    <TableCell className={AMOUNT}>{formatToIndianRupeeOrZero(row.amount_paid)}</TableCell>
                                    <TableCell className={AMOUNT}>{formatToIndianRupeeOrZero(row.amount_due)}</TableCell>
                                    <TableCell>
                                        <Button size="sm" variant="outline" onClick={() => setMatching(row.name)}>Match GST</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            <MatchGstToVendorDialog workOrder={matching} onClose={() => setMatching(null)} onMatched={mutate} />
        </div>
    );
};

export default GstMismatchList;
