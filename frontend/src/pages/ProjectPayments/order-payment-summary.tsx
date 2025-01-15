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
import { debounce } from "lodash";
import logo from "@/assets/logo-svg.svg"
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet"; 

const OrderPaymentSummary = () => {
    const { id } = useParams<{ id: string }>();
    const poId = id?.replace(/&=/g, "/");
    const navigate = useNavigate();

    const [poPdfSheet, setPoPdfSheet] = useState(false); // State for PO PDF Sheet
    const [srPdfSheet, setSrPdfSheet] = useState(false); // State for SR PDF Sheet

    const {createDoc, loading: createLoading} = useFrappeCreateDoc()

    const [warning, setWarning] = useState("");
    
    const { upload: upload, loading: upload_loading, isCompleted: upload_complete, error: upload_error } = useFrappeFileUpload()

    const { call, error: call_error } = useFrappePostCall('frappe.client.set_value')

    const [vendorAddress, setVendorAddress] = useState<string | null>(null);
    const [projectAddress, setProjectAddress] = useState<string | null>(null);

    const [advance, setAdvance] = useState(0)
    const [materialReadiness, setMaterialReadiness] = useState(0)
    const [afterDelivery, setAfterDelivery] = useState(0)
    const [xDaysAfterDelivery, setXDaysAfterDelivery] = useState(0)
    const [xDays, setXDays] = useState(0)
    const [loadingCharges, setLoadingCharges] = useState(0)
    const [freightCharges, setFreightCharges] = useState(0)

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
          setLoadingCharges(parseFloat(documentData?.loading_charges || 0))
          setFreightCharges(parseFloat(documentData?.freight_charges || 0))
        }
      }, [endpoint, documentData])

    const calculateTotals = () => {
        let total = 0;
        let totalWithGST = 0;

        if (isPO) {
            JSON.parse(documentData?.order_list).list.forEach((item) => {
                const price = parseFloat(item?.quote || 0);
                const quantity = parseFloat(item?.quantity || 1);
                const tax = parseFloat(item?.tax || 0);
                const amount = price * quantity;
                const gstAmount = amount * (tax / 100);

                total += amount;
                totalWithGST += amount + gstAmount;
            });
            total += loadingCharges + freightCharges;
            totalWithGST += loadingCharges * 0.18 + freightCharges * 0.18;
        } else {
            JSON.parse(documentData?.service_order_list).list.forEach((item) => {
                const price = parseFloat(item?.rate || 0);
                const quantity = parseFloat(item?.quantity || 1);
                total += price * quantity;
            });

            totalWithGST = total * 1.18;
        }

        return {
            total,
            totalWithGST,
        };
    };

    const getTotalAmtPaid = (id) => {

        if(projectPayments) {
            const payments = projectPayments?.filter((i) => i?.document_name === id);

            return payments?.reduce((acc, i) => acc + parseFloat(i?.amount), 0);
        }

        return 0;
    }

    const componentRef = useRef<HTMLDivElement>(null);

    const togglePoPdfSheet = () => setPoPdfSheet((prev) => !prev);
  const toggleSrPdfSheet = () => setSrPdfSheet((prev) => !prev);

  const handlePrint = () => {
    if (isPO) {
      togglePoPdfSheet(); // Open PO PDF Sheet
    } else {
      toggleSrPdfSheet(); // Open SR PDF Sheet
    }
  };

  const handleReactToPrint = useReactToPrint({
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

              setNewPayment({
                amount: "",
                transaction_date: "",
                utr: ""
            })

            setPaymentScreenshot(null)
            
        } catch (error) {
            console.log("error", error)
            toast({
                title: "Failed!",
                description: "Failed to add Payment!",
                variant: "destructive",
              });
        }
    }

    const siteUrl = `${window.location.protocol}//${window.location.host}`;

    const validateAmount = debounce((amount) => {
    
        if (!documentData) {
          setWarning(""); // Clear warning if no order is found
          return;
        }
    
        const { total, totalWithGST } = totals
    
        const compareAmount =
          isPO
            ? totalWithGST // Always compare with totalWithTax for Purchase Orders
            : documentData?.gst === "true" // Check GST field for Service Orders
            ? totalWithGST
            : total;
    
        if (parseFloat(amount) > compareAmount) {
          setWarning(
            `Entered amount exceeds the total amount ${
                isPO ? "including" : documentData?.gst === "true" ? "including" : "excluding"
            } GST: ${formatToIndianRupee(compareAmount)}`
          );
        } else {
          setWarning(""); // Clear warning if within the limit
        }
      }, 300);
    
      // Handle input change
      const handleAmountChange = (e) => {
        const amount = e.target.value;
        setNewPayment({ ...newPayment, amount });
        validateAmount(amount);
      };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center flex-wrap gap-2">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                    <h2 className="text-xl max-sm:text-lg font-bold tracking-tight">Overview</h2>
                    {/* <span className="text-red-500 text-2xl max-sm:text-lg">{poId}</span> */}
                </div>
                <Button onClick={handlePrint} className="flex items-center gap-1">
                    <Printer className="h-4 w-4" />
                    Print
                </Button>
            </div>

            <div className="space-y-4">
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
                        )}
                        <div className="flex flex-col gap-2">
                            <Label className=" text-red-700">Amount Paid:</Label>
                            <span>{getTotalAmtPaid(poId) ? formatToIndianRupee(getTotalAmtPaid(poId)) : "--"}</span>    
                        </div>
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
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Amt excl. Tax:</Label>
                                    <span className="">{formatToIndianRupee(totals.total)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                                    <span className="">{formatToIndianRupee(totals.totalWithGST)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Amt Paid Till Now:</Label>
                                    <span className="">{getTotalAmtPaid(poId) ? formatToIndianRupee(getTotalAmtPaid(poId)) : "--"}</span>
                                </div>

                                <div className="flex flex-col gap-4 pt-4">
                                                            <div className="flex gap-4 w-full">
                                                                <Label className="w-[40%]">Amount Paid<sup className=" text-sm text-red-600">*</sup></Label>
                                                                <div className="w-full">
                                                                <Input
                                                                    type="number"
                                                                    placeholder="Enter Amount"
                                                                    value={newPayment.amount}
                                                                    onChange={(e) => handleAmountChange(e)}
                                                                />
                                                                    {warning && <p className="text-red-600 mt-1 text-xs">{warning}</p>}
                                                                </div> 
                                                            </div>
                                                            <div className="flex gap-4 w-full">
                                                                <Label className="w-[40%]">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                                                <Input
                                                                    type="text"
                                                                    placeholder="Enter UTR"
                                                                    value={newPayment.utr}
                                                                    onChange={(e) => setNewPayment({ ...newPayment, utr: e.target.value })}
                                                                />
                                                            </div>

                                                        </div>

                                {/* <div className="flex justify-between pt-4">
                                <div className="flex flex-col">
                                    <Label className="py-4">Amount Paid<sup className=" text-sm text-red-600">*</sup></Label>
                                    <Label className="py-4">Date(of Transaction):</Label>
                                    <Label className="py-4">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                </div>
                                <div className="flex flex-col gap-4" >
                                    <Input
                                        type="number"
                                        placeholder="Enter Amount"
                                        value={newPayment.amount}
                                        onChange={(e) => setNewPayment({...newPayment, amount: e.target.value})}
                                     />

                                    <Input
                                        type="date"
                                        value={newPayment.transaction_date}
                                        placeholder="DD/MM/YYYY"
                                        onChange={(e) => setNewPayment({...newPayment, transaction_date: e.target.value})}
                                     />

                                     <Input
                                        type="text"
                                        placeholder="Enter UTR"
                                        value={newPayment.utr}
                                        onChange={(e) => setNewPayment({...newPayment, utr: e.target.value})}
                                     />

                                </div>
                                </div> */}

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
                                                <TableCell className="font-semibold text-blue-500 underline">
                                                {import.meta.env.MODE === "development" ? (
                                                    <a href={`http://localhost:8000${payment?.payment_attachment}`} target="_blank" rel="noreferrer">
                                                        {payment?.utr}
                                                    </a>
                                                ) : (
                                                    <a href={`${siteUrl}${payment?.payment_attachment}`} target="_blank" rel="noreferrer">
                                                        {payment?.utr}
                                                    </a>
                                                )}
                                                </TableCell>
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
                    <div className="flex items-center gap-1">
                      <Label className="font-light">Loading Charges</Label>
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="font-light">Freight Charges</Label>
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
                    <div className="flex items-center gap-1">
                      <Label className="font-light">{formatToIndianRupee(loadingCharges * 1.18)}</Label>
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="font-light">{formatToIndianRupee(freightCharges * 1.18)}</Label>
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
                                    ? JSON.parse(documentData?.order_list).list.map((item, index) => (
                                        <TableRow key={index}>
                                            <TableCell>{item?.item}</TableCell>
                                            <TableCell>{item?.unit}</TableCell>
                                            <TableCell>{item?.quantity}</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quote)}</TableCell>
                                            <TableCell>{item?.tax}%</TableCell>
                                            <TableCell>{formatToIndianRupee(item?.quantity * item?.quote)}</TableCell>
                                        </TableRow>
                                    ))
                                    : JSON.parse(documentData?.service_order_list).list.map((item, index) => (
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
        
        {/* PO Pdf  */}

      {isPO && <Sheet open={poPdfSheet} onOpenChange={togglePoPdfSheet}>
      <SheetContent className="overflow-y-auto min-w-[700px]">
        <Button onClick={handleReactToPrint} className="flex items-center gap-1">
          <Printer className="h-4 w-4" />
          Print
        </Button>
        <div
          className={`w-full border mt-6`}
        >
          <div ref={componentRef} className="w-full p-2">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-gray-200">
                <thead className="border-b border-black">
                  <tr>
                    <th colSpan={8}>
                      <div className="flex justify-between border-gray-600 pb-1">
                        <div className="mt-2 flex justify-between">
                          <div>
                            {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                            <img
                              src={logo}
                              alt="Nirmaan"
                              width="180"
                              height="52"
                            />
                            <div className="pt-2 text-lg text-gray-600 font-semibold">
                              Nirmaan(Stratos Infra Technologies Pvt.
                              Ltd.)
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="pt-2 text-xl text-gray-600 font-semibold">
                            Purchase Order No.
                          </div>
                          <div className="text-lg font-light italic text-black">
                            {documentData?.name?.toUpperCase()}
                          </div>
                        </div>
                      </div>

                      <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                        <div className="text-xs text-gray-600 font-normal">
                          1st Floor, 234, 9th Main, 16th Cross, Sector
                          6, HSR Layout, Bengaluru - 560102, Karnataka
                        </div>
                        <div className="text-xs text-gray-600 font-normal">
                          GST: 29ABFCS9095N1Z9
                        </div>
                      </div>

                      <div className="flex justify-between">
                        <div>
                          <div className="text-gray-600 text-sm pb-2 text-left">
                            Vendor Address
                          </div>
                          <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
                            {documentData?.vendor_name}
                          </div>
                          <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                            {vendorAddress?.address_line1}, {vendorAddress?.address_line2}, {vendorAddress?.city}, {vendorAddress?.state}-{vendorAddress?.pincode}
                          </div>
                          <div className="text-sm font-medium text-gray-900 text-left">
                            GSTIN: {documentData?.vendor_gst}
                          </div>
                        </div>
                        <div>
                          <div>
                            <h3 className="text-gray-600 text-sm pb-2 text-left">
                              Delivery Location
                            </h3>
                            <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                              {projectAddress?.address_line1}, {projectAddress?.address_line2}, {projectAddress?.city}, {projectAddress?.state}-{projectAddress?.pincode}
                            </div>
                          </div>
                          <div className="pt-2">
                            <div className="text-sm font-normal text-gray-900 text-left">
                              <span className="text-gray-600 font-normal">
                                Date:
                              </span>
                              &nbsp;&nbsp;&nbsp;
                              <i>{documentData?.creation?.split(" ")[0]}</i>
                            </div>
                            <div className="text-sm font-normal text-gray-900 text-left">
                              <span className="text-gray-600 font-normal">
                                Project Name:
                              </span>
                              &nbsp;&nbsp;&nbsp;
                              <i>{documentData?.project_name}</i>
                            </div>
                          </div>
                        </div>
                      </div>
                    </th>
                  </tr>
                  <tr className="border-t border-black">
                    <th
                      scope="col"
                      className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      S. No.
                    </th>
                    <th
                      scope="col"
                      className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48"
                    >
                      Items
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Unit
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Qty
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Rate
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Tax
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className={`bg-white`}>
                  {/* {orderData?.order_list?.list.map((item: any, index: number) => {
                                                  return (<tr key={index} className={`${(!loadingCharges && !freightCharges && index === orderData?.order_list?.list.length - 1) && "border-b border-black"} page-break-inside-avoid ${index === 15 ? 'page-break-before' : ''}`}>
                                                      <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                                                      <td className=" py-2 text-sm whitespace-nowrap text-wrap">{item.item}</td>
                                                      <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                      <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                      <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.quote)}</td>
                                                      <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                                      <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(((item.quote) * (item.quantity)))}</td>
                                                  </tr>)
                                              })} */}

                  {[
                    ...new Map(
                        JSON.parse(documentData?.order_list).list?.map((item) => [
                        item.item,
                        {
                          ...item,
                          quantity: JSON.parse(documentData?.order_list).list
                            ?.filter(
                              ({ item: itemName }) =>
                                itemName === item.item
                            )
                            ?.reduce(
                              (total, curr) => total + curr.quantity,
                              0
                            ),
                        },
                      ])
                    )?.values(),
                  ]?.map((item, index) => {
                    const length = [
                      ...new Map(
                        JSON.parse(documentData?.order_list).list?.map((item) => [
                          item.item,
                          {
                            ...item,
                            quantity: JSON.parse(documentData?.order_list).list
                              ?.filter(
                                ({ item: itemName }) =>
                                  itemName === item.item
                              )
                              ?.reduce(
                                (total, curr) => total + curr.quantity,
                                0
                              ),
                          },
                        ])
                      ).values(),
                    ].length;
                    return (
                      <tr
                        key={index}
                        className={`${!loadingCharges &&
                          !freightCharges &&
                          index === length - 1 &&
                          "border-b border-black"
                          } page-break-inside-avoid ${index === 15 ? "page-break-before" : ""
                          }`}
                      >
                        <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                          {index + 1}.
                        </td>
                        <td className="py-2 text-sm whitespace-nowrap text-wrap">
                          {item.item}
                          {item?.makes?.list?.length > 0 && (
<p className="text-xs italic font-semibold text-gray-500">
  - {item.makes.list.find((i) => i?.enabled === "true")?.make || "no make specified"}
</p>
)}{item.comment && includeComments && (
                            <div className="flex gap-1 items-start block p-1">
                              <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                              <div className="text-xs text-gray-400">
                                {item.comment}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {item.unit}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(item.quote)}
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {item.tax}%
                        </td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          {formatToIndianRupee(item.quote * item.quantity)}
                        </td>
                      </tr>
                    )
                  })}
                  {/* {[...Array(19)].map((_, index) => (
                                      orderData?.list.map((item) => (
                                           <tr className="">
                                              <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index+1}.</td>
                                              <td className="px-6 py-2 text-sm whitespace-nowrap text-wrap">sijdoodsjfo sfjdofjdsofjdsofj sdifjsojfosdjfjs </td>
                                              <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                              <td className="px-6 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                              <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                              <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                              <td className="px-4 py-2 text-sm whitespace-nowrap">{(item.quote) * (item.quantity)}</td>
                                          </tr>
                                      )
                                  )))} */}
                  {loadingCharges ? (
                    <tr
                      className={`${!freightCharges && "border-b border-black"
                        }`}
                    >
                      <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                        -
                      </td>
                      <td className=" py-2 text-sm whitespace-nowrap">
                        LOADING CHARGES
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        NOS
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        1
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(loadingCharges)}
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        18%
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(loadingCharges)}
                      </td>
                    </tr>
                  ) : (
                    <></>
                  )}
                  {freightCharges ? (
                    <tr className={`border-b border-black`}>
                      <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                        -
                      </td>
                      <td className=" py-2 text-sm whitespace-nowrap">
                        FREIGHT CHARGES
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        NOS
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        1
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(freightCharges)}
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        18%
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatToIndianRupee(freightCharges)}
                      </td>
                    </tr>
                  ) : (
                    <></>
                  )}
                  <tr className="">
                    <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                    <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                      Sub-Total
                    </td>
                    <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                      {formatToIndianRupee(totals.total)}
                    </td>
                  </tr>
                  <tr className="border-none">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                      <div>Total Tax(GST):</div>
                      <div>Round Off:</div>
                      <div>Total:</div>
                    </td>

                    <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                      <div className="ml-4">
                        {formatToIndianRupee(
                          totals.totalWithGST
                        )}
                      </div>
                      <div className="ml-4">
                        -{" "}
                        {formatToIndianRupee(
                          (
                            totals.totalWithGST -
                            Math.floor(totals.totalWithGST)
                          )
                        )}
                      </div>
                      <div className="ml-4">
                        {formatToIndianRupee(
                          Math.floor(totals.totalWithGST)
                        )}
                      </div>
                    </td>
                  </tr>
                  <tr className="end-of-page page-break-inside-avoid">
                    <td colSpan={6}>
                      {documentData?.notes !== "" && (
                        <>
                          <div className="text-gray-600 font-bold text-sm py-2">
                            Note
                          </div>
                          <div className="text-sm text-gray-900">
                            {documentData?.notes}
                          </div>
                        </>
                      )}
                      {advance ||
                        materialReadiness ||
                        afterDelivery ||
                        xDaysAfterDelivery ? (
                        <>
                          <div className="text-gray-600 font-bold text-sm py-2">
                            Payment Terms
                          </div>
                          <div className="text-sm text-gray-900">
                            {(() => {
                              // Check if any of the variables is 100
                              if (advance === 100) {
                                return `${advance}% advance`;
                              } else if (materialReadiness === 100) {
                                return `${materialReadiness}% on material readiness`;
                              } else if (afterDelivery === 100) {
                                return `${afterDelivery}% after delivery to the site`;
                              } else if (xDaysAfterDelivery === 100) {
                                return `${xDaysAfterDelivery}% after ${xDays} days of delivering the material(s)`;
                              }

                              // If none of the variables is 100, render non-zero values
                              const parts = [];
                              if (advance > 0) {
                                parts.push(`${advance}% advance`);
                              }
                              if (materialReadiness > 0) {
                                parts.push(
                                  `${materialReadiness}% on material readiness`
                                );
                              }
                              if (afterDelivery > 0) {
                                parts.push(
                                  `${afterDelivery}% after delivery to the site`
                                );
                              }
                              if (xDaysAfterDelivery > 0) {
                                parts.push(
                                  `${xDaysAfterDelivery}% after ${xDays} days of delivering the material(s)`
                                );
                              }

                              // Join the parts with commas and return
                              return parts.join(", ");
                            })()}
                          </div>
                        </>
                      ) : (
                        ""
                      )}

                      <img src={Seal} className="w-24 h-24" />
                      <div className="text-sm text-gray-900 py-6">
                        For, Stratos Infra Technologies Pvt. Ltd.
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              style={{ display: "block", pageBreakBefore: "always" }}
            ></div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-gray-200">
                <thead className="border-b border-black">
                  <tr>
                    <th colSpan={6}>
                      <div className="flex justify-between border-gray-600 pb-1">
                        <div className="mt-2 flex justify-between">
                          <div>
                            {/* <img className="w-44" src={redlogo} alt="Nirmaan" /> */}
                            <img
                              src={logo}
                              alt="Nirmaan"
                              width="180"
                              height="52"
                            />
                            <div className="pt-2 text-lg text-gray-600 font-semibold">
                              Nirmaan(Stratos Infra Technologies Pvt.
                              Ltd.)
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="pt-2 text-xl text-gray-600 font-semibold">
                            Purchase Order No. :
                          </div>
                          <div className="text-lg font-light italic text-black">
                            {documentData?.name?.toUpperCase()}
                          </div>
                        </div>
                      </div>

                      <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                        <div className="flex justify-between">
                          <div className="text-xs text-gray-600 font-normal">
                            1st Floor, 234, 9th Main, 16th Cross, Sector
                            6, HSR Layout, Bengaluru - 560102, Karnataka
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: 29ABFCS9095N1Z9
                          </div>
                        </div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <div className="max-w-4xl mx-auto p-6 text-gray-800">
                    <h1 className="text-xl font-bold mb-4">
                      Terms and Conditions
                    </h1>
                    <h2 className="text-lg font-semibold mt-6">
                      1. Invoicing:
                    </h2>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        All invoices shall be submitted in original and
                        shall be tax invoices showing the breakup of tax
                        structure/value payable at the prevailing rate and
                        a clear description of goods.
                      </li>
                      <li className="pl-2">
                        All invoices submitted shall have Delivery
                        Challan/E-waybill for supply items.
                      </li>
                      <li className="pl-2">
                        All Invoices shall have the tax registration
                        numbers mentioned thereon. The invoices shall be
                        raised in the name of “Stratos Infra Technologies
                        Pvt Ltd, Bangalore”.
                      </li>
                      <li className="pl-2">
                        Payments shall be only entertained after receipt
                        of the correct invoice.
                      </li>
                      <li className="pl-2">
                        In case of advance request, Advance payment shall
                        be paid after the submission of an advance receipt
                        (as suggested under GST law).
                      </li>
                    </ol>

                    <h2 className="text-lg font-semibold mt-6">
                      2. Payment:
                    </h2>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        Payment shall be done through RTGS/NEFT.
                      </li>
                      <li className="pl-2">
                        A retention amount shall be deducted as per PO
                        payment terms and:
                      </li>
                      <ol className="list-decimal pl-6 space-y-1 text-sm">
                        <li className="pl-2">
                          In case the vendor is not completing the task
                          assigned by Nirmaan a suitable amount, as
                          decided by Nirmaan, shall be deducted from the
                          retention amount.
                        </li>
                        <li className="pl-2">
                          The adjusted amount shall be paid on completion
                          of the defect liability period.
                        </li>
                        <li className="pl-2">
                          Vendors are expected to pay GST as per the
                          prevailing rules. In case the vendor is not
                          making GST payments to the tax authority,
                          Nirmaan shall deduct the appropriated amount
                          from the invoice payment of the vendor.
                        </li>
                        <li className="pl-2">
                          Nirmaan shall deduct the following amounts from
                          the final bills:
                        </li>
                        <ol className="list-decimal pl-6 space-y-1 text-sm">
                          <li className="pl-2">
                            Amount pertaining to unfinished supply.
                          </li>
                          <li className="pl-2">
                            Amount pertaining to Liquidated damages and
                            other fines, as mentioned in the documents.
                          </li>
                          <li className="pl-2">
                            Any agreed amount between the vendor and
                            Nirmaan.
                          </li>
                        </ol>
                      </ol>
                    </ol>

                    <h2 className="text-lg font-semibold mt-6">
                      3. Technical Specifications of the Work:
                    </h2>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        All goods delivered shall conform to the technical
                        specifications mentioned in the vendor’s quote
                        referred to in this PO or as detailed in Annexure
                        1 to this PO.
                      </li>
                      <li className="pl-2">
                        Supply of goods or services shall be strictly as
                        per Annexure - 1 or the Vendor’s quote/PI in case
                        of the absence of Annexure - I.
                      </li>
                      <li className="pl-2">
                        Any change in line items or quantities shall be
                        duly approved by Nirmaan with rate approval prior
                        to supply. Any goods supplied by the agency
                        without obtaining due approvals shall be subject
                        to the acceptance or rejection from Nirmaan.
                      </li>
                      <li className="pl-2">
                        Any damaged/faulty material supplied needs to be
                        replaced with a new item free of cost, without
                        extending the completion dates.
                      </li>
                      <li className="pl-2">
                        Material supplied in excess and not required by
                        the project shall be taken back by the vendor at
                        no cost to Nirmaan.
                      </li>
                    </ol>
                    <br />
                    <br />
                    <br />
                    <br />
                    <br />

                    <h1 className="text-xl font-bold mb-4">
                      General Terms & Conditions for Purchase Order
                    </h1>
                    <ol className="list-decimal pl-6 space-y-2 text-sm">
                      <li className="pl-2">
                        <div className="font-semibold">
                          Liquidity Damages:
                        </div>{" "}
                        Liquidity damages shall be applied at 2.5% of the
                        order value for every day of delay.
                      </li>
                      <li className="pl-2">
                        <div className="font-semibold">
                          Termination/Cancellation:
                        </div>{" "}
                        If Nirmaan reasonably determines that it can no
                        longer continue business with the vendor in
                        accordance with applicable legal, regulatory, or
                        professional obligations, Nirmaan shall have the
                        right to terminate/cancel this PO immediately.
                      </li>
                      <li className="pl-2">
                        <div className="font-semibold">
                          Other General Conditions:
                        </div>
                      </li>
                      <ol className="list-decimal pl-6 space-y-1 text-sm">
                        <li className="pl-2">
                          Insurance: All required insurance including, but
                          not limited to, Contractors’ All Risk (CAR)
                          Policy, FLEXA cover, and Workmen’s Compensation
                          (WC) policy are in the vendor’s scope. Nirmaan
                          in any case shall not be made liable for
                          providing these insurance. All required
                          insurances are required prior to the
                          commencement of the work at the site.
                        </li>
                        <li className="pl-2">
                          Safety: The safety and security of all men
                          deployed and materials placed by the Vendor or
                          its agents for the project shall be at the risk
                          and responsibility of the Vendor. Vendor shall
                          ensure compliance with all safety norms at the
                          site. Nirmaan shall have no obligation or
                          responsibility on any safety, security &
                          compensation related matters for the resources &
                          material deployed by the Vendor or its agent.
                        </li>
                        <li className="pl-2">
                          Notice: Any notice or other communication
                          required or authorized under this PO shall be in
                          writing and given to the party for whom it is
                          intended at the address given in this PO or such
                          other address as shall have been notified to the
                          other party for that purpose, through registered
                          post, courier, facsimile or electronic mail.
                        </li>
                        <li className="pl-2">
                          Force Majeure: Neither party shall be liable for
                          any delay or failure to perform if such delay or
                          failure arises from an act of God or of the
                          public enemy, an act of civil disobedience,
                          epidemic, war, insurrection, labor action, or
                          governmental action.
                        </li>
                        <li className="pl-2">
                          Name use: Vendor shall not use, or permit the
                          use of, the name, trade name, service marks,
                          trademarks, or logo of Nirmaan in any form of
                          publicity, press release, advertisement, or
                          otherwise without Nirmaan's prior written
                          consent.
                        </li>
                        <li className="pl-2">
                          Arbitration: Any dispute arising out of or in
                          connection with the order shall be settled by
                          Arbitration in accordance with the Arbitration
                          and Conciliation Act,1996 (As amended in 2015).
                          The arbitration proceedings shall be conducted
                          in English in Bangalore by the sole arbitrator
                          appointed by the Purchaser.
                        </li>
                        <li className="pl-2">
                          The law governing: All disputes shall be
                          governed as per the laws of India and subject to
                          the exclusive jurisdiction of the court in
                          Karnataka.
                        </li>
                      </ol>
                    </ol>
                  </div>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
}

    {/* SR PDF Sheet */}


    {!isPO && <Sheet open={srPdfSheet} onOpenChange={toggleSrPdfSheet}>
    <SheetContent className="overflow-y-auto min-w-[700px]">
        <Button onClick={handleReactToPrint} className="flex items-center gap-1">
            <Printer className="h-4 w-4" />
            Print
        </Button>
        <div className={`w-full border mt-6`}>
            <div ref={componentRef} className="w-full p-2">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-gray-200">
                        <thead className="border-b border-black">
                            <tr>
                                <th colSpan={8}>
                                    <div className="flex justify-between border-gray-600 pb-1">
                                        <div className="mt-2 flex justify-between">
                                            <div>
                                                <img src={logo} alt="Nirmaan" width="180" height="52" />
                                                <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No.</div>
                                            <div className="text-lg font-semibold text-black">{(documentData?.name)?.toUpperCase()}</div>
                                        </div>
                                    </div>

                                    <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                                        <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                        <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                    </div>

                                    <div className="flex justify-between">
                                        <div>
                                            <div className="text-gray-500 text-sm pb-2 text-left">Vendor Address</div>
                                            <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{vendorData?.vendor_name}</div>
                                            <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{vendorAddress}</div>
                                            <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {vendorData?.vendor_gst || "N/A"}</div>
                                        </div>
                                        <div>
                                            <div>
                                                <h3 className="text-gray-500 text-sm pb-2 text-left">Service Location</h3>
                                                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{projectAddress}</div>
                                            </div>
                                            <div className="pt-2">
                                                <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{documentData?.modified?.split(" ")[0]}</i></div>
                                                <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{documentData?.project}</i></div>
                                            </div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                            <tr className="border-t border-black">
                                <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">No.</th>
                                {/* <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">Services</th> */}
                                <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Service Description</th>
                                <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
                                <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                {(!isPO && documentData?.gst === "true") && <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>}
                                <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                            </tr>
                        </thead>
                        <tbody className={`bg-white`}>
                            {(documentData && !isPO) && JSON.parse(documentData?.service_order_list)?.list?.map((item, index) => (
                                <tr key={item.id} className={`${index === (documentData && JSON.parse(documentData?.service_order_list))?.list?.length - 1 && "border-b border-black"} page-break-inside-avoid`}>
                                    <td className="py-2 text-sm whitespace-nowrap flex items-start">{index + 1}.</td>
                                    {/* <td className="py-2 text-sm whitespace-nowrap text-wrap">{item?.category}</td> */}
                                    <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[95%]">
                                        <p className="font-semibold">{item?.category}</p>
                                        <span className="whitespace-pre-wrap">{item?.description}</span>
                                    </td>
                                    <td className="px-2 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
                                    <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
                                    <td className=" py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate)}</td>
                                    {(!isPO && documentData?.gst === "true") && <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>}
                                    <td className="px-2 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate * item.quantity)}</td>
                                </tr>
                            ))}
                            {/* {[...Array(20)].map((_, index) => (
               orderData && JSON.parse(orderData?.service_order_list)?.list?.map((item) => (
                   <tr key={item.id} className={`${index === 19 && "border-b border-black"} page-break-inside-avoid`}>
                       <td className="py-2 text-sm whitespace-nowrap w-[5%]">{index + 2}.</td>
                       <td className="py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.category}</td>
                       <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[65%]">{item?.description}</td>
                       <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
                       <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
                       <td className="px-4 py-2 text-sm whitespace-nowrap w-[5%]">{formatToIndianRupee(item.rate)}</td>
                       <td className="px-4 py-2 text-sm whitespace-nowrap w-[5%]">18%</td>
                       <td className="px-4 py-2 text-sm whitespace-nowrap w-[5%]">{formatToIndianRupee(item.rate * item.quantity)}</td>
                   </tr>
               ))
                   ))} */}
                            <tr className="">
                                <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                                <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                                <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                {/* <td className="px-4 py-2 text-sm whitespace-nowrap"></td> */}
                                {(!isPO && documentData?.gst === "true") && <td className="px-4 py-2 text-sm whitespace-nowrap"></td>}
                                <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                                <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(totals.total)}</td>
                            </tr>
                            <tr className="border-none">
                                <td></td>
                                <td></td>
                                <td></td>
                                {/* <td></td> */}
                                {(!isPO && documentData?.gst === "true") && <td></td>}
                                <td></td>
                                <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                                    {(!isPO && documentData?.gst === "true") && <div>Total Tax(GST):</div>}
                                    <div>Round Off:</div>
                                    <div>Total:</div>
                                </td>

                                <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                                    {(!isPO && documentData?.gst === "true") && <div className="ml-4">{formatToIndianRupee(totals.total * 1.18 - totals.total)}</div>}
                                    <div className="ml-4">- {formatToIndianRupee((totals.total * ((!isPO && documentData?.gst === "true") ? 1.18 : 1)) - Math.floor(totals.total * ((!isPO && documentData?.gst === "true") ? 1.18 : 1)))}</div>
                                    <div className="ml-4">{formatToIndianRupee(Math.floor(totals.total * ((!isPO && documentData?.gst === "true") ? 1.18 : 1)))}</div>
                                </td>

                            </tr>

                            <tr className="end-of-page page-break-inside-avoid" >
                                <td colSpan={6}>

                                {(() => {
  try {
    const notes = documentData?.notes ? JSON.parse(documentData.notes) : null;

    // Check if notes is a valid object and has a non-empty `list`
    if (notes?.list?.length > 0) {
      return (
        <div className="mb-2">
          <div className="text-gray-400 text-sm py-2">Notes</div>
          <ul className="list-[number]">
            {notes.list.map((note: { id: string; note: string }) => (
              <li key={note.id} className="text-sm text-gray-900 ml-4">
                {note.note}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return null; // No notes to display
  } catch (error) {
    console.error("Failed to parse notes:", error);
    return null; // Fallback in case of invalid JSON
  }
})()}

                                    {/* <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                   <div className="text-sm text-gray-900">
                                       {advance}% advance {advance === 100 ? "" : `and remaining ${100 - advance}% on material readiness before delivery of material to site`}
                                   </div> */}

                                    <img src={Seal} className="w-24 h-24" />
                                    <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div style={{ display: 'block', pageBreakBefore: 'always', }}></div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-gray-200">
                        <thead className="border-b border-black">
                            <tr>
                                <th colSpan={6}>
                                    <div className="flex justify-between border-gray-600 pb-1">
                                        <div className="mt-2 flex justify-between">
                                            <div>
                                                <img src={logo} alt="Nirmaan" width="180" height="52" />
                                                <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No. :</div>
                                            <div className="text-lg font-semibold text-black">{(documentData?.name)?.toUpperCase()}</div>
                                        </div>
                                    </div>

                                    <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                                        <div className="flex justify-between">
                                            <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                            <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                        </div>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <div className="max-w-4xl mx-auto p-6 text-gray-800">
                                <h1 className="text-xl font-bold mb-4">Terms and Conditions</h1>
                                <h2 className="text-lg font-semibold mt-6">1. Invoicing:</h2>
                                <ol className="list-decimal pl-6 space-y-2 text-sm">
                                    <li className="pl-2">All invoices shall be submitted in original and shall be tax invoices showing the breakup of tax structure/value payable at the prevailing rate and a clear description of goods.</li>
                                    <li className="pl-2">All invoices submitted shall have Delivery Challan/E-waybill for supply items.</li>
                                    <li className="pl-2">All Invoices shall have the tax registration numbers mentioned thereon. The invoices shall be raised in the name of “Stratos Infra Technologies Pvt Ltd, Bangalore”.</li>
                                    <li className="pl-2">Payments shall be only entertained after receipt of the correct invoice.</li>
                                    <li className="pl-2">In case of advance request, Advance payment shall be paid after the submission of an advance receipt (as suggested under GST law).</li>
                                </ol>

                                <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
                                <ol className="list-decimal pl-6 space-y-2 text-sm">
                                    <li className="pl-2">Payment shall be done through RTGS/NEFT.</li>
                                    <li className="pl-2">A retention amount shall be deducted as per PO payment terms and:</li>
                                    <ol className="list-decimal pl-6 space-y-1 text-sm">
                                        <li className="pl-2">In case the vendor is not completing the task assigned by Nirmaan a suitable amount, as decided by Nirmaan, shall be deducted from the retention amount.</li>
                                        <li className="pl-2">The adjusted amount shall be paid on completion of the defect liability period.</li>
                                        <li className="pl-2">Vendors are expected to pay GST as per the prevailing rules. In case the vendor is not making GST payments to the tax authority, Nirmaan shall deduct the appropriated amount from the invoice payment of the vendor.</li>
                                        <li className="pl-2">Nirmaan shall deduct the following amounts from the final bills:</li>
                                        <ol className="list-decimal pl-6 space-y-1 text-sm">
                                            <li className="pl-2">Amount pertaining to unfinished supply.</li>
                                            <li className="pl-2">Amount pertaining to Liquidated damages and other fines, as mentioned in the documents.</li>
                                            <li className="pl-2">Any agreed amount between the vendor and Nirmaan.</li>
                                        </ol>
                                    </ol>
                                </ol>

                                <h2 className="text-lg font-semibold mt-6">3. Technical Specifications of the Work:</h2>
                                <ol className="list-decimal pl-6 space-y-2 text-sm">
                                    <li className="pl-2">All goods delivered shall conform to the technical specifications mentioned in the vendor’s quote referred to in this PO or as detailed in Annexure 1 to this PO.</li>
                                    <li className="pl-2">Supply of goods or services shall be strictly as per Annexure - 1 or the Vendor’s quote/PI in case of the absence of Annexure - I.</li>
                                    <li className="pl-2">Any change in line items or quantities shall be duly approved by Nirmaan with rate approval prior to supply. Any goods supplied by the agency without obtaining due approvals shall be subject to the acceptance or rejection from Nirmaan.</li>
                                    <li className="pl-2">Any damaged/faulty material supplied needs to be replaced with a new item free of cost, without extending the completion dates.</li>
                                    <li className="pl-2">Material supplied in excess and not required by the project shall be taken back by the vendor at no cost to Nirmaan.</li>
                                </ol>
                                <br />
                                <br />
                                <br />
                                <br />
                                <br />

                                <h1 className="text-xl font-bold mb-4">General Terms & Conditions for Purchase Order</h1>
                                <ol className="list-decimal pl-6 space-y-2 text-sm">
                                    <li className="pl-2"><div className="font-semibold">Liquidity Damages:</div> Liquidity damages shall be applied at 2.5% of the order value for every day of delay.</li>
                                    <li className="pl-2"><div className="font-semibold">Termination/Cancellation:</div> If Nirmaan reasonably determines that it can no longer continue business with the vendor in accordance with applicable legal, regulatory, or professional obligations, Nirmaan shall have the right to terminate/cancel this PO immediately.</li>
                                    <li className="pl-2"><div className="font-semibold">Other General Conditions:</div></li>
                                    <ol className="list-decimal pl-6 space-y-1 text-sm">
                                        <li className="pl-2">Insurance: All required insurance including, but not limited to, Contractors’ All Risk (CAR) Policy, FLEXA cover, and Workmen’s Compensation (WC) policy are in the vendor’s scope. Nirmaan in any case shall not be made liable for providing these insurance. All required insurances are required prior to the commencement of the work at the site.</li>
                                        <li className="pl-2">Safety: The safety and security of all men deployed and materials placed by the Vendor or its agents for the project shall be at the risk and responsibility of the Vendor. Vendor shall ensure compliance with all safety norms at the site. Nirmaan shall have no obligation or responsibility on any safety, security & compensation related matters for the resources & material deployed by the Vendor or its agent.</li>
                                        <li className="pl-2">Notice: Any notice or other communication required or authorized under this PO shall be in writing and given to the party for whom it is intended at the address given in this PO or such other address as shall have been notified to the other party for that purpose, through registered post, courier, facsimile or electronic mail.</li>
                                        <li className="pl-2">Force Majeure: Neither party shall be liable for any delay or failure to perform if such delay or failure arises from an act of God or of the public enemy, an act of civil disobedience, epidemic, war, insurrection, labor action, or governmental action.</li>
                                        <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Nirmaan's prior written consent.</li>
                                        <li className="pl-2">Arbitration: Any dispute arising out of or in connection with the order shall be settled by Arbitration in accordance with the Arbitration and Conciliation Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted in English in Bangalore by the sole arbitrator appointed by the Purchaser.</li>
                                        <li className="pl-2">The law governing: All disputes shall be governed as per the laws of India and subject to the exclusive jurisdiction of the court in Karnataka.</li>
                                    </ol>
                                </ol>
                            </div>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

    </SheetContent>
</Sheet>}
</div>

    );
};

export default OrderPaymentSummary;