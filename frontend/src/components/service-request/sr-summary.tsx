import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests";
import { useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { useNavigate, useParams } from "react-router-dom"
import { NewPRSkeleton } from "../ui/skeleton";
import { useEffect, useRef, useState } from "react";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { useUserData } from "@/hooks/useUserData";
import { ArrowLeft, ListChecks, Printer, Settings2, Trash2, Undo2, UserSearch } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { toast } from "../ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { NirmaanComments as NirmaanCommentsType } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { Timeline } from "antd";
import { Badge } from "../ui/badge";
import { SelectServiceVendorPage } from "./select-service-vendor";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useReactToPrint } from "react-to-print";
import redlogo from "@/assets/red-logo.png"
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import logo from "@/assets/logo-svg.svg"

const SrSummary = () => {

    const { srId: id } = useParams<{ srId: any }>();

    const [project, setProject] = useState<string | undefined>()

    const { data: sr_data, isLoading: sr_loading, error: sr_error } = useFrappeGetDoc<ServiceRequestsType>("Service Requests", id, id ? `Service Requests ${id}` : null);

    const { data: usersList, isLoading: userLoading, error: userError } = useFrappeGetDocList<NirmaanUsersType>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
    })

    const { data: universalComments, isLoading: universalCommentsLoading, error: universalCommentsError } = useFrappeGetDocList<NirmaanCommentsType>("Nirmaan Comments", {
        fields: ["*"],
        limit: 1000,
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    })

    const { data: service_vendor, isLoading: service_vendor_loading, error: service_vendor_error, mutate: service_vendor_mutate } = useFrappeGetDoc("Vendors", sr_data?.vendor, sr_data?.vendor ? `Vendors ${sr_data?.vendor}` : null)

    const { data: projectData, isLoading: project_loading, error: project_error, mutate: project_mutate } = useFrappeGetDoc("Projects", sr_data?.project, sr_data?.project ? `Projects ${sr_data?.project}` : null)

    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ["*"],
            limit: 10000
        },
        "Address"
    );

    useEffect(() => {
        if (sr_data) {
            setProject(sr_data?.project)
        }
    }, [sr_data])

    return (
        <>  {(sr_loading || project_loading || userLoading || universalCommentsLoading || service_vendor_loading || address_list_loading) ? <NewPRSkeleton /> :
            <SrSummaryPage sr_data={sr_data} project_data={projectData} universalComments={universalComments} usersList={usersList} service_vendor={service_vendor} address_list={address_list} />}
            {(sr_error || project_error || userError || universalCommentsError || service_vendor_error || address_list_error) && <h1>Error</h1>}
        </>
    )
};

interface SrSummaryPageProps {
    sr_data: ServiceRequestsType | undefined
    project_data: ProjectsType | undefined
    usersList: NirmaanUsersType[] | undefined
    universalComments: NirmaanCommentsType[] | undefined
    service_vendor?: any
    address_list?: any
}

export const SrSummaryPage = ({ sr_data, project_data, usersList, universalComments, service_vendor, address_list }: SrSummaryPageProps) => {
    const navigate = useNavigate();
    const sr_no = sr_data?.name.split("-").slice(-1)
    const userData = useUserData()
    const [page, setPage] = useState("Summary")
    const [vendorAddress, setVendorAddress] = useState()
    const [projectAddress, setProjectAddress] = useState()

    const { mutate } = useSWRConfig()
    const { deleteDoc } = useFrappeDeleteDoc()
    const [gstEnabled, setGstEnabled] = useState(true)

    const getFullName = (id: string) => {
        return usersList?.find((user) => user.name === id)?.full_name
    }

    useEffect(() => {
        if (sr_data?.project && project_data && service_vendor) {
            const doc = address_list?.find(item => item.name == project_data?.project_address);
            const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
            setProjectAddress(address)
            const doc2 = address_list?.find(item => item.name == service_vendor?.vendor_address);
            const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
            setVendorAddress(address2)
            // setPhoneNumber(doc2?.phone || "")
            // setEmail(doc2?.email_id || "")
        }
        if (sr_data) {
            if (sr_data?.gst === "true") {
                setGstEnabled(true)
            } else {
                setGstEnabled(false)
            }
        }
        // if (orderData?.vendor) {
        //     setVendor(orderData?.vendor)
        // }
        // if (vendor_data) {
        //     setVendorGST(vendor_data?.vendor_gst)
        // }

    }, [sr_data, address_list, project_data, service_vendor]);

    const itemsTimelineList = universalComments?.map((cmt: any) => ({
        label: (
            <span className="max-sm:text-wrap text-xs m-0 p-0">{formatDate(cmt.creation.split(" ")[0])} {cmt.creation.split(" ")[1].substring(0, 5)}</span>
        ), children: (
            <Card>
                <CardHeader className="p-2">
                    <CardTitle>
                        {cmt.comment_by === "Administrator" ? (
                            <span className="text-sm">Administrator</span>
                        ) : (
                            <span className="text-sm">{getFullName(cmt.comment_by)}</span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                    {cmt.content}
                </CardContent>
            </Card>
        ), color:
            cmt.subject ? (cmt.subject === "creating pr" ? "green" : cmt.subject === "rejecting pr" ? "red" : "blue") : 'gray'
    }))


    const handleDeleteSr = async () => {
        try {
            await deleteDoc("Service Requests", sr_data?.name)
            await mutate("Service Requests,orderBy(creation-desc)")
            toast({
                title: "Success!",
                description: `SR: ${sr_data?.name} deleted successfully!`,
                variant: "success"
            })
            navigate("/service-requests")
        } catch (error) {
            console.log("error while deleting SR", error)
            toast({
                title: "Failed!",
                description: `SR: ${sr_data?.name} deletion Failed!`,
                variant: "destructive"
            })
        }
    }

    const componentRef = useRef<HTMLDivElement>(null);

    // const handlePDFPrint = (enable) => {
    //     setGstEnabled(enable)
    //     setTimeout(() => handlePrint(), 1000)
    // }

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${sr_data?.name}_${sr_data?.vendor}`
    });

    // console.log('gstEnabled', gstEnabled)

    const getTotal = () => {
        let total: number = 0;
        if (sr_data) {
            const serviceOrder = JSON.parse(sr_data?.service_order_list);
            serviceOrder?.list?.map((item) => {
                const price = item.quantity * item.rate;
                total += price ? parseFloat(price) : 0
            })
        }
        return total;
    }

    // console.log("sr_data", sr_data)

    return (
        <div className="flex-1 space-y-4">
            {
                page === "Summary" && (
                    <>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 flex-wrap">
                                {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                                <h2 className="text-xl max-md:text-lg font-bold tracking-tight text-pageheader">Summary</h2>
                                {/* <span className="text-red-500 text-2xl max-md:text-xl">SR-{sr_no}</span> */}
                            </div>
                            <div className="flex gap-4 items-center">
                                {sr_data?.status === "Approved" &&
                                    <div>
                                        <Button className='flex items-center gap-2' onClick={handlePrint}>
                                            <Printer className='h-4 w-4' />
                                            Print
                                        </Button>
                                    </div>
                                    // <div className="flex max-sm:flex-col gap-2 items-center">
                                    //     <Button className='flex items-center gap-2' onClick={() => handlePDFPrint(true)}>
                                    //         <Printer className='h-4 w-4' />
                                    //         Print inc. Tax
                                    //     </Button>
                                    //     <Button className='flex items-center gap-2' onClick={() => handlePDFPrint(false)}>
                                    //         <Printer className='h-4 w-4' />
                                    //         Print exc. Tax
                                    //     </Button>
                                    // </div>
                                }
                                {
                                    sr_data?.status === "Rejected" && (
                                        <Button onClick={() => navigate("resolve-sr")} className="flex items-center gap-1">
                                            <Settings2 className="h-4 w-4" />
                                            Resolve</Button>
                                    )
                                }
                                {
                                    ["Created", "Rejected", userData?.role === "Nirmaan Procurement Executive Profile" ? "Vendor Selected" : ""].includes(sr_data?.status) && (
                                        <AlertDialog>
                                            <AlertDialogTrigger>
                                                <Button className="flex items-center gap-1">
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle className="text-center">
                                                        Are you sure, you want to delete this SR?
                                                    </AlertDialogTitle>
                                                </AlertDialogHeader>
                                                <AlertDialogDescription className="">
                                                    This action will delete this service request from the system. Are you sure you want to continue?
                                                    <div className="flex gap-2 items-center justify-center">
                                                        <AlertDialogCancel className="flex items-center gap-1">
                                                            <Undo2 className="h-4 w-4" />
                                                            Cancel
                                                        </AlertDialogCancel>
                                                        <AlertDialogAction className="flex items-center gap-1" onClick={handleDeleteSr}>
                                                            <ListChecks className="h-4 w-4" />
                                                            Confirm
                                                        </AlertDialogAction>
                                                    </div>
                                                </AlertDialogDescription>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )
                                }
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                                        SR Details
                                        {/* <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(pr_data?.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(pr_data?.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(pr_data?.workflow_state) && checkPoToPr(pr_data?.name)) ? "green" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && !checkPoToPr(pr_data.name)) ? "orange" : pr_data.workflow_state === "Rejected" ? "red" : "yellow"}`}>
                                            {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(pr_data?.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(pr_data?.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(pr_data?.workflow_state) && checkPoToPr(pr_data?.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(pr_data.workflow_state) && !checkPoToPr(pr_data.name)) ? "In Progress" : pr_data.workflow_state === "Pending" ? "Approval Pending" : pr_data.workflow_state}
                                        </Badge> */}
                                        <Badge>{sr_data?.status}</Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-wrap gap-4">
                                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                        <div className="space-y-1">
                                            <Label className="text-slim text-red-300">Project:</Label>
                                            <p className="font-semibold">{project_data?.project_name}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-slim text-red-300">Package:</Label>
                                            <p className="font-semibold">Services</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-slim text-red-300">Date Created:</Label>
                                            <p className="font-semibold">{new Date(sr_data?.creation).toDateString()}</p>
                                        </div>
                                    </div>
                                    {sr_data?.status === "Approved" && (
                                        <>
                                            <div className="space-y-1">
                                                <Label className="text-slim text-red-300">Vendor Name:</Label>
                                                <p className="font-semibold">{service_vendor?.vendor_name}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-slim text-red-300">Vendor Address:</Label>
                                                <p className="font-semibold">{vendorAddress}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-slim text-red-300">GST Information:</Label>
                                                <p className="font-semibold">GST {sr_data?.gst === "true" ? "Enabled" : "Disabled"}</p>
                                            </div>
                                        </>
                                    )}

                                    <div className="space-y-1 flex flex-col items-start justify-start">
                                        <Label className="text-slim text-red-300 mb-4 block">Comments:</Label>
                                        <Timeline
                                            className="w-full"
                                            mode={'left'}
                                            items={itemsTimelineList}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                                </CardHeader>

                                <div className="overflow-x-auto">
                                    <div className="min-w-full inline-block align-middle">
                                        {JSON.parse(sr_data?.service_category_list).list.map((cat: any) => {
                                            return <div className="p-5">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-red-100">
                                                            <TableHead className="w-[60%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span></TableHead>
                                                            <TableHead className="w-[10%]">Unit</TableHead>
                                                            <TableHead className="w-[10%]">Quantity</TableHead>
                                                            {sr_data?.status !== "Created" && (
                                                                <TableHead className="w-[20%]">Amount</TableHead>
                                                            )}

                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {sr_data && JSON.parse(sr_data?.service_order_list).list.map((item: any) => {
                                                            if (item.category === cat.name) {
                                                                return (
                                                                    <TableRow key={item.id}>
                                                                        <TableCell className="whitespace-pre-wrap">{item.description}</TableCell>
                                                                        <TableCell>
                                                                            {item.uom}
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            {item.quantity}
                                                                        </TableCell>
                                                                        {sr_data?.status !== "Created" && (
                                                                            <TableCell>{formatToIndianRupee(item.quantity * item.rate)}</TableCell>
                                                                        )}

                                                                    </TableRow>
                                                                )
                                                            }
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        })}
                                    </div>
                                </div>
                            </Card>
                            {/* {userData.role !== "Nirmaan Project Manager Profile" && <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600">Associated POs:</CardTitle>
                                    <div className="overflow-x-auto">
                                        <div className="min-w-full inline-block align-middle">
                                        </div>
                                        {po_data?.length === 0 ? <p>No POs generated as of now</p>
                                            :
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="bg-red-100">
                                                        <TableHead className="w-[40%]">PO Number</TableHead>
                                                        <TableHead className="w-[30%]">Date Created</TableHead>
                                                        <TableHead className="w-[30%]">Status</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {po_data?.map((po) => {
                                                        return (
                                                            <TableRow key={po.name}>
                                                                <TableCell>
                                                                    <Link to={po?.name.replaceAll("/", "&=")} className="text-blue-500 underline">{po?.name}</Link>
                                                                </TableCell>
                                                                <TableCell>{formatDate(po.creation)}</TableCell>
                                                                <TableCell><Badge variant="outline">{po.status}</Badge></TableCell>
                                                            </TableRow>
                                                        )
                                                    })}
                                                </TableBody>
                                            </Table>}
                                    </div>
                                </CardHeader>
                            </Card>} */}

                            <div className={`w-full border rounded-lg h-screen overflow-y-scroll hidden`}>
                                <div ref={componentRef} className="w-full p-4">
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
                                                                <div className="text-lg font-semibold text-black">{(sr_data?.name)?.toUpperCase()}</div>
                                                            </div>
                                                        </div>

                                                        <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                                                            <div className="flex justify-between">
                                                                <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                                                <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                                            </div>
                                                        </div>

                                                        <div className="flex justify-between">
                                                            <div>
                                                                <div className="text-gray-500 text-sm pb-2 text-left">Vendor Address</div>
                                                                <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{service_vendor?.vendor_name}</div>
                                                                <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{vendorAddress}</div>
                                                                <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {service_vendor?.vendor_gst || "N/A"}</div>
                                                            </div>
                                                            <div>
                                                                <div>
                                                                    <h3 className="text-gray-500 text-sm pb-2 text-left">Service Location</h3>
                                                                    <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{projectAddress}</div>
                                                                </div>
                                                                <div className="pt-2">
                                                                    <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{sr_data?.modified?.split(" ")[0]}</i></div>
                                                                    <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{sr_data?.project}</i></div>
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
                                                    <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                                    <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                                    {gstEnabled && <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>}
                                                    <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody className={`bg-white`}>
                                                {sr_data && JSON.parse(sr_data?.service_order_list)?.list?.map((item, index) => (
                                                    <tr key={item.id} className={`${index === (sr_data && JSON.parse(sr_data?.service_order_list))?.list?.length - 1 && "border-b border-black"} page-break-inside-avoid`}>
                                                        <td className="py-2 text-sm whitespace-nowrap flex items-start">{index + 1}.</td>
                                                        {/* <td className="py-2 text-sm whitespace-nowrap text-wrap">{item?.category}</td> */}
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[95%]">
                                                            <p className="font-semibold">{item?.category}</p>
                                                            <span className="whitespace-pre-wrap">{item?.description}</span>
                                                        </td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
                                                        <td className="py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate)}</td>
                                                        {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>}
                                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate * item.quantity)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="">
                                                    <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                                                    <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                                                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                                    <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                                    {/* <td className="px-4 py-2 text-sm whitespace-nowrap"></td> */}
                                                    {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap"></td>}
                                                    <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                                                    <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal())}</td>
                                                </tr>
                                                <tr className="border-none">
                                                    <td></td>
                                                    <td></td>
                                                    <td></td>
                                                    {/* <td></td> */}
                                                    {gstEnabled && <td></td>}
                                                    <td></td>
                                                    <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                                                        {gstEnabled && <div>Total Tax(GST):</div>}
                                                        <div>Round Off:</div>
                                                        <div>Total:</div>
                                                    </td>

                                                    <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                                                        {gstEnabled && <div className="ml-4">{formatToIndianRupee(getTotal() * 1.18 - getTotal())}</div>}
                                                        <div className="ml-4">- {formatToIndianRupee((getTotal() * (gstEnabled ? 1.18 : 1)) - Math.floor(getTotal() * (gstEnabled ? 1.18 : 1)))}</div>
                                                        <div className="ml-4">{formatToIndianRupee(Math.floor(getTotal() * (gstEnabled ? 1.18 : 1)))}</div>
                                                    </td>

                                                </tr>

                                                <tr className="end-of-page page-break-inside-avoid" >
                                                    <td colSpan={6}>
                                                        {sr_data?.notes && JSON.parse(sr_data?.notes)?.list?.length > 0 && (
                                                            <div className="mb-2">
                                                                <div className="text-gray-400 text-sm py-2">Notes</div>
                                                                <ul className="list-[number]">
                                                                    {JSON.parse(sr_data?.notes)?.list?.map((note) => (
                                                                        <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {/* <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                                        <div className="text-sm text-gray-900">
                                                            {parseFloat(sr_data?.advance || 0)}% advance {parseFloat(sr_data?.advance || 0) === 100 ? "" : `and remaining ${100 - parseFloat(sr_data?.advance || 0)}% on material readiness before delivery of material to site`}
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
                                                                <div className="text-lg font-semibold text-black">{(sr_data?.name)?.toUpperCase()}</div>
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
                        </div>

                        {
                            sr_data?.status === "Created" &&
                            <div className="text-right">
                                <Button onClick={() => navigate(`/choose-service-vendor/${sr_data?.name}`)} className="items-center gap-2"><UserSearch className="h-4 w-4" />Select Service Vendor</Button>
                            </div>
                        }
                    </>
                )
            }
            {/* {page === "Resolve" && (
                <SelectServiceVendorPage resolve={true} sr_data={sr_data} universalComments={universalComments?.filter((com) => com?.subject === "rejecting sr")} setPage={setPage} />
            )} */}
        </div >
    )
}

export const Component = SrSummary