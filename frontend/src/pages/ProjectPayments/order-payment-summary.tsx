import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, SquarePlus, HandCoins, BookCheck, Truck, CalendarDays, Paperclip } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useReactToPrint } from "react-to-print";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTrigger, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";

const OrderPaymentSummary = () => {
    const { id } = useParams<{ id: string }>();
    const poId = id?.replace(/&=/g, "/");
    const navigate = useNavigate();

    const {createDoc, loading: createLoading} = useFrappeCreateDoc()
    
    const { upload: upload, loading: upload_loading, isCompleted: upload_complete, error: upload_error } = useFrappeFileUpload()

    const { call, error: call_error } = useFrappePostCall('frappe.client.set_value')

    const [vendorAddress, setVendorAddress] = useState<string | null>(null);
    const [projectAddress, setProjectAddress] = useState<string | null>(null);

    const [advance, setAdvance] = useState(0)
    const [materialReadiness, setMaterialReadiness] = useState(0)
    const [afterDelivery, setAfterDelivery] = useState(0)
    const [xDaysAfterDelivery, setXDaysAfterDelivery] = useState(0)
    const [xDays, setXDays] = useState(0)

    const [newPaymentDialog, setNewPaymentDialog] = useState(false);
    
    const toggleNewPaymentDialog = () => {
        setNewPaymentDialog((prevState) => !prevState);
    };

    const [newPayment, setNewPayment] = useState({
            amount: "",
            transaction_date: "",
            utr: ""
    });
    
    const [paymentScreenshot, setPaymentScreenshot] = useState(null);

    const handleFileChange = (event) => {
        setPaymentScreenshot(event.target.files[0]);
    };

    const isPO = poId.split("/")[0] === "PO";

    const endpoint = isPO ? "Procurement Orders" : "Service Requests";

    const { data: documentData, isLoading, error } = useFrappeGetDoc(endpoint, poId);

    const {data : prData} = useFrappeGetDoc("Procurement Requests", documentData?.procurement_request, documentData?.procurement_request ? `Procurement Requests ${documentData?.procurement_request}` : null)

    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
            {
                fields: ["*"],
                limit: 1000
            },
            "Address"
        );

    const {data : vendorData} = useFrappeGetDoc("Vendors", documentData?.vendor, documentData ? `Vendors ${documentData?.vendor}` : null)

    const {data : projectData} = useFrappeGetDoc("Projects", documentData?.project, documentData ? `Projects ${documentData?.project}` : null)

    const {data : projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate} = useFrappeGetDocList("Project Payments", {
            fields: ["*"],
            limit: 10000
     })

    useEffect(() => {
        if (endpoint && documentData && projectData && vendorData) {
            const doc = address_list?.find(item => item.name == projectData?.project_address);
            const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
            setProjectAddress(address)
            const doc2 = address_list?.find(item => item.name == vendorData?.vendor_address);
            const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
            setVendorAddress(address2)
        }
    }, [endpoint, documentData, projectData, vendorData]);

    useEffect(() => {
        if(endpoint === "Procurement Orders" && documentData) {
          const chargesArray = documentData?.advance?.split(", ")
          setAdvance(parseFloat(chargesArray[0] || 0))
          setMaterialReadiness(parseFloat(chargesArray[1] || 0))
          setAfterDelivery(parseFloat(chargesArray[2] || 0))
          setXDaysAfterDelivery(parseFloat(chargesArray[3] || 0))
          setXDays(parseFloat(chargesArray[4] || 0))
        }
      }, [endpoint, documentData])

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

            totalWithGST = total * 1.18;
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

    const AddPayment = async () => {
        try {

            const res = await createDoc("Project Payments", {
                document_type: endpoint,
                document_name: poId,
                project: documentData?.project,
                vendor: documentData?.vendor,
                utr: newPayment?.utr,
                amount: newPayment?.amount,
            })

            const fileArgs = {
                doctype: "Project Payments",
                docname: res?.name,
                fieldname: "payment_attachment",
                isPrivate: true,
              };
      
              const uploadedFile = await upload(paymentScreenshot, fileArgs);

              await call({
                doctype: "Project Payments",
                name: res?.name,
                fieldname: "payment_attachment",
                value: uploadedFile.file_url,
              });

              await projectPaymentsMutate()

              toggleNewPaymentDialog()

              toast({
                title: "Success!",
                description: "Payment added successfully!",
                variant: "success",
              });
            
        } catch (error) {
            console.log("error", error)
            toast({
                title: "Failed!",
                description: "Failed to add Payment!",
                variant: "destructive",
              });
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center flex-wrap gap-2">
                    <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                    <h2 className="text-xl max-sm:text-lg font-bold tracking-tight">Overview:</h2>
                    <span className="text-red-500 text-2xl max-sm:text-lg">{poId}</span>
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
                            {endpoint === "Procurement Orders" ? "PO" : "SR"} Details
                            <Badge>{documentData?.status}</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-4 gap-4 space-y-4 max-sm:grid-cols-2 max-md:grid-cols-3">
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Project:</Label>
                            <span>{projectData?.project_name}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Package:</Label>
                            <span>{endpoint === "Procurement Orders" ? prData?.work_package : "Services"}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Vendor:</Label>
                            <span>{vendorData?.vendor_name}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Date Created:</Label>
                            <span>{formatDate(documentData?.creation)}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Amount Paid:</Label>
                            <span>{projectPayments?.filter((i) => i?.document_name === poId)?.length > 0 ? formatToIndianRupee(projectPayments?.filter((i) => i?.document_name === poId)?.reduce((acc, i) => acc + i?.amount, 0)) : "--"}</span>    
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Vendor GST:</Label>
                            <span>{vendorData?.vendor_gst || "--"}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Total (Excl. GST):</Label>
                            <span>{formatToIndianRupee(totals.total)}</span>
                        </div>
                        {(endpoint === "Procurement Orders" || (endpoint === "Service Requests" && documentData?.gst === "true")) && (
                            <div className="flex flex-col gap-2">
                                <Label className=" text-red-700">Total (Incl. GST):</Label>
                                <span>{formatToIndianRupee(totals.totalWithGST)}</span>
                            </div>
                        ) }
                        </div>
                        {/* <div className="flex-1 py-4">
                            <Label className="pr-1 text-red-700">Vendor Address:</Label>
                            <span>{vendorAddress}</span>
                        </div>
                        <div className="flex-1 py-2">
                            <Label className="text-red-700 pr-1">Project Address:</Label>
                            <span>{projectAddress}</span>
                        </div> */}
                    </CardContent>
                </Card>

                <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-4">

                    {/* Pricing Summary */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                        Transaction Details
                        <AlertDialog open={newPaymentDialog} onOpenChange={toggleNewPaymentDialog}>
                            <AlertDialogTrigger>
                                <SquarePlus className="w-5 h-5 text-red-500 cursor-pointer" />
                            </AlertDialogTrigger>
                            <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                                <AlertDialogHeader className="text-start">
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Project:</Label>
                                    <span className="">{projectData?.project_name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Vendor:</Label>
                                    <span className="">{vendorData?.vendor_name}</span>
                                </div>

                                <div className="flex justify-between pt-4">
                                <div className="flex flex-col">
                                    <Label className="py-4">Amount Paid<sup className=" text-sm text-red-600">*</sup></Label>
                                    {/* <Label className="py-4">Date(of Transaction):</Label> */}
                                    <Label className="py-4">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                </div>
                                <div className="flex flex-col gap-4" >
                                    <Input
                                        type="number"
                                        placeholder="Enter Amount"
                                        value={newPayment.amount}
                                        onChange={(e) => setNewPayment({...newPayment, amount: e.target.value})}
                                     />

                                    {/* <Input
                                        type="date"
                                        value={newPayment.transaction_date}
                                        placeholder="DD/MM/YYYY"
                                        onChange={(e) => setNewPayment({...newPayment, transaction_date: e.target.value})}
                                     /> */}

                                     <Input
                                        type="text"
                                        placeholder="Enter UTR"
                                        value={newPayment.utr}
                                        onChange={(e) => setNewPayment({...newPayment, utr: e.target.value})}
                                     />

                                </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <div className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-2 mt-4 ${paymentScreenshot && "opacity-50 cursor-not-allowed"}`}
                                    onClick={() => document.getElementById("file-upload")?.click()}
                                    >
                                        <Paperclip size="15px" />
                                        <span className="p-0 text-sm">Attach Screenshot</span>
                                        <input
                                            type="file"
                                            id={`file-upload`}
                                            className="hidden"
                                            onChange={handleFileChange}
                                            disabled={paymentScreenshot ? true : false}
                                        />
                                    </div>
                                    {(paymentScreenshot) && (
                                        <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                                            <span className="text-sm">{paymentScreenshot?.name}</span>
                                            <button
                                                className="ml-1 text-red-500"
                                                onClick={() => setPaymentScreenshot(null)}
                                            >
                                                ✖
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-2 items-center pt-4 justify-center">

                                    {createLoading || upload_loading ? <TailSpin color="red" width={40} height={40} /> : (
                                        <>
                                        <AlertDialogCancel className="flex-1" asChild>
                                            <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                        </AlertDialogCancel>
                                        <Button
                                            onClick={AddPayment}
                                            disabled={!paymentScreenshot || !newPayment.amount || !newPayment.utr}
                                            className="flex-1">Add Payment
                                        </Button>
                                        </>
                                    )}
                                </div>
                                
                                </AlertDialogHeader>
                            </AlertDialogContent>
                        </AlertDialog>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-auto">
                        <Table className="w-full">
                            <TableHeader className="bg-gray-300">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>UTR No.</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="w-full">
                                {projectPayments?.filter((i) => i?.document_name === poId)?.length > 0 ? (
                                    projectPayments?.filter((i) => i?.document_name === poId)?.map((payment) => {
                                        return (
                                            <TableRow key={payment?.name}>
                                                <TableCell className="font-semibold">{formatDate(payment?.creation)}</TableCell>
                                                <TableCell className="font-semibold">{formatToIndianRupee(payment?.amount)}</TableCell>
                                                <TableCell className="font-semibold text-blue-500">{payment?.utr}</TableCell>
                                            </TableRow>
                                        )
                                    })
                                ) : (
                                    <div className="flex items-center justify-center w-full py-2">No Payments Found</div>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

            {endpoint === "Procurement Orders" ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600">Payment Terms</CardTitle>  
                    </CardHeader>
                <CardContent>
            <div className="grid grid-cols-5 gap-4">
                {/* Terms */}
                <div className="col-span-3 flex flex-col gap-6">
                    <div className="flex items-center gap-1">
                        <span className="font-semibold">Terms</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <HandCoins className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">Advance:</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <BookCheck className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">Material Readiness:</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Truck className="w-4 h-4 text-muted-foreground" />
                        <Label className="font-light">After Delivery:</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <CalendarDays className="w-4 h-4 text-muted-foreground" /> 
                        <Label className="font-light">After {xDays || "--"} days of delivery:</Label>
                    </div>
                </div>

                {/* Percentages */}
                <div className="col-span-1 flex flex-col gap-6">
                    <div className="flex items-center gap-1">
                        <span className="font-semibold">%</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{advance}%</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{materialReadiness}%</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{afterDelivery}%</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{xDaysAfterDelivery}%</Label>
                    </div>
                </div>

                {/* Amounts  */}
                <div className="col-span-1 flex flex-col gap-6">
                    <div className="flex items-center gap-1">
                        <span className="font-semibold">Amount</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{formatToIndianRupee(totals?.totalWithGST * (advance / 100))}</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{formatToIndianRupee(totals?.totalWithGST * (materialReadiness / 100))}</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{formatToIndianRupee(totals?.totalWithGST * (afterDelivery / 100))}</Label>
                    </div>
                    <div className="flex items-center gap-1">
                        <Label className="font-light">{formatToIndianRupee(totals?.totalWithGST * (xDaysAfterDelivery / 100))}</Label>
                    </div>
                </div>
            </div>
                </CardContent>
            </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600">SR Options</CardTitle>   
                    </CardHeader>
                    <CardContent>
                    <div className="flex flex-col gap-2 items-start mt-4">
                        <Label className="font-bold">Notes</Label>
                        <ul className="list-[number]">
                            {documentData?.notes && JSON.parse(documentData?.notes)?.list?.map((note) => (
                                <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
                            ))}
                        </ul>
                    </div>

                    <Separator className="my-4" />

                    <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-2 items-start mt-4">
                            <Label className="font-bold">GST?</Label>
                            <span>{documentData?.gst === "true" ? "Yes" : "No"}</span>
                        </div>
                    </div>
                  </CardContent>
                </Card>
            )}

                </div>

                {/* Order Details */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{isPO ? "Item Name" : "Service Description"}</TableHead>
                                    <TableHead>Unit</TableHead>
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
                                            <TableCell>{item?.unit}</TableCell>
                                            <TableCell>{item?.quantity}</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quote)}</TableCell>
                                            <TableCell>{item?.tax}%</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quantity * item?.quote)}</TableCell>
                                        </TableRow>
                                    ))
                                    : JSON.parse(documentData.service_order_list).list.map((item, index) => (
                                        <TableRow key={index}>
                                            <td className="w-[65%] text-left py-1">
                                                <p className="font-semibold">{item?.category}</p>
                                                <span className="whitespace-pre-wrap">{item?.description}</span>
                                            </td>
                                            <TableCell>{item?.uom}</TableCell>
                                            <TableCell>{item?.quantity}</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.rate)}</TableCell>
                                            <TableCell>{formatToIndianRupee((item?.quantity * item?.rate) * (documentData?.gst === "true" ? 1.18 : 1))}</TableCell>
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