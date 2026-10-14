/**
 * The Payee page's Linked Vendors tab (#1423, mockup screen 2): the vendors whose PO and Work Order
 * payments go to this account.
 */

import { Link } from "react-router-dom";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { PayeePageVendor } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";

const statusChip = (status?: string | null) =>
    status === "On-Hold" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-green-300 bg-green-50 text-green-700";

export function PayeeLinkedVendorsTab({ vendors }: { vendors: PayeePageVendor[] }) {
    return (
        <div className="flex flex-col gap-2.5">
            <p className="text-sm text-zinc-600">A PO or Work Order payment to any of these vendors goes to this account.</p>
            <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[720px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Vendor ID</TableHead>
                            <TableHead>Vendor name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>City</TableHead>
                            <TableHead>Linked since</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {vendors.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                                    No vendor is paid into this account.
                                </TableCell>
                            </TableRow>
                        )}
                        {vendors.map((v) => (
                            <TableRow key={v.name}>
                                <TableCell className="font-medium">
                                    <Link to={`/vendors/${encodeURIComponent(v.name)}`} className="text-blue-600 hover:underline">
                                        {v.name}
                                    </Link>
                                </TableCell>
                                <TableCell className="font-medium">{v.vendor_name}</TableCell>
                                <TableCell>{v.vendor_type || "--"}</TableCell>
                                <TableCell>{v.vendor_city || "--"}</TableCell>
                                <TableCell className="whitespace-nowrap">{v.linked_since ? formatDate(v.linked_since) : "--"}</TableCell>
                                <TableCell>
                                    {v.vendor_status && (
                                        <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", statusChip(v.vendor_status))}>
                                            {v.vendor_status}
                                        </span>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
