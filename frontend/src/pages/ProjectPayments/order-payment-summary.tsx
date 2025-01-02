import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useReactToPrint } from "react-to-print";

const OrderPaymentSummary = () => {
    const { id } = useParams<{ id: string }>();
    const poId = id?.replace(/&=/g, "/");
    const navigate = useNavigate();

    const [data, setData] = useState(null);
    const [vendorAddress, setVendorAddress] = useState<string | null>(null);
    const [projectAddress, setProjectAddress] = useState<string | null>(null);

    const isPO = poId.split("/")[0] === "PO";
    const endpoint = isPO ? "Procurement Orders" : "Service Requests";

    const { data: documentData, isLoading, error } = useFrappeGetDoc(endpoint, poId);

    useEffect(() => {
        if (documentData) {
            const vendorAddr = `${documentData.vendor_address?.address_line1}, ${documentData.vendor_address?.address_line2}, ${documentData.vendor_address?.city}, ${documentData.vendor_address?.state}-${documentData.vendor_address?.pincode}`;
            setVendorAddress(vendorAddr);

            if (isPO) {
                const projAddr = `${documentData.project_address?.address_line1}, ${documentData.project_address?.address_line2}, ${documentData.project_address?.city}, ${documentData.project_address?.state}-${documentData.project_address?.pincode}`;
                setProjectAddress(projAddr);
            } else {
                const projAddr = `${documentData.project_data?.address_line1}, ${documentData.project_data?.address_line2}, ${documentData.project_data?.city}, ${documentData.project_data?.state}-${documentData.project_data?.pincode}`;
                setProjectAddress(projAddr);
            }
        }
    }, [documentData]);

    const calculateTotals = () => {
        let total = 0;
        let totalWithGST = 0;

        if (isPO) {
            JSON.parse(documentData.order_list).list.forEach((item) => {
                const price = parseFloat(item?.quote) || 0;
                const quantity = parseFloat(item?.quantity) || 1;
                const tax = parseFloat(item?.tax) || 0;
                const amount = price * quantity;
                const gstAmount = (amount * tax) / 100;

                total += amount;
                totalWithGST += amount + gstAmount;
            });
        } else {
            JSON.parse(documentData.service_order_list).list.forEach((item) => {
                const price = parseFloat(item?.rate) || 0;
                const quantity = parseFloat(item?.quantity) || 1;
                total += price * quantity;
            });
        }

        return {
            total,
            totalWithGST,
        };
    };

    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${endpoint}_${id}`,
    });

    if (isLoading) return <h1>Loading...</h1>;
    if (error) return <h1>Error loading {endpoint} data.</h1>;

    const totals = calculateTotals();

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                    <h2 className="text-xl font-bold tracking-tight">Overview: {endpoint}</h2>
                    <span className="text-red-500 text-2xl">{id}</span>
                </div>
                <Button onClick={handlePrint} className="flex items-center gap-1">
                    <Printer className="h-4 w-4" />
                    Print
                </Button>
            </div>

            <div ref={componentRef} className="space-y-4">
                {/* Details Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                            {endpoint} Details
                            <Badge>{documentData?.status}</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                        <div className="flex items-center gap-2">
                            <Label className="font-light text-red-700">Project:</Label>
                            <span>{documentData?.project_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Label className="font-light text-red-700">Vendor:</Label>
                            <span>{documentData?.vendor_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Label className="font-light text-red-700">Date Created:</Label>
                            <span>{formatDate(documentData?.creation)}</span>
                        </div>
                        <div className="flex-1">
                            <Label className="font-light text-red-700">Vendor Address:</Label>
                            <span>{vendorAddress}</span>
                        </div>
                        <div className="flex-1">
                            <Label className="font-light text-red-700">Project Address:</Label>
                            <span>{projectAddress}</span>
                        </div>
                    </CardContent>
                </Card>

                {/* Pricing Summary */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600">Pricing Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex justify-between">
                            <span>Total (Excl. GST):</span>
                            <span className="font-semibold">{formatToIndianRupee(totals.total)}</span>
                        </div>
                        {isPO && (
                            <div className="flex justify-between">
                                <span>Total (Incl. GST):</span>
                                <span className="font-semibold">{formatToIndianRupee(totals.totalWithGST)}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Order Details */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Quantity</TableHead>
                                    <TableHead>Rate</TableHead>
                                    {isPO && <TableHead>GST</TableHead>}
                                    <TableHead>Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isPO
                                    ? JSON.parse(documentData.order_list).list.map((item, index) => (
                                        <TableRow key={index}>
                                            <TableCell>{item?.item}</TableCell>
                                            <TableCell>{item?.quantity}</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quote)}</TableCell>
                                            <TableCell>{item?.tax}%</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quantity * item?.quote)}</TableCell>
                                        </TableRow>
                                    ))
                                    : JSON.parse(documentData.service_order_list).list.map((item, index) => (
                                        <TableRow key={index}>
                                            <TableCell>{item?.description}</TableCell>
                                            <TableCell>{item?.quantity}</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.rate)}</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quantity * item?.rate)}</TableCell>
                                        </TableRow>
                                    ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default OrderPaymentSummary;