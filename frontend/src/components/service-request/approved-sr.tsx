import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { ArrowLeft, ArrowLeftToLine, CheckIcon, CirclePlus, Edit, NotebookPen, Printer, Save, Trash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import redlogo from "@/assets/red-logo.png"
import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import formatToIndianRupee from "@/utils/FormatPrice";
// import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { Button, Layout } from 'antd';
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique IDs
import { toast } from "../ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Button as ShadButton } from "../ui/button"
import { Separator } from "../ui/separator";
import { RadioGroup, RadioGroupItem } from "../ui/radiogroup";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import logo from "@/assets/logo-svg.svg"

const { Sider, Content } = Layout;

export const ApprovedSR = () => {

    const { srId : id } = useParams()

    const navigate = useNavigate()

    const { data: service_request, isLoading: service_request_loading, error: service_request_error, mutate: service_request_mutate } = useFrappeGetDoc("Service Requests", id, id ? `Service Requests ${id}` : null)

    const [orderData, setOrderData] = useState(null)
    const [vendorAddress, setVendorAddress] = useState()
    const [projectAddress, setProjectAddress] = useState()
    const [notes, setNotes] = useState([])
    const [curNote, setCurNote] = useState(null)
    const [collapsed, setCollapsed] = useState(true);
    const [gstEnabled, setGstEnabled] = useState(null)
    const [advance, setAdvance]= useState(0)
    const [customAdvance, setCustomAdvance] = useState(false);

    const { data: service_vendor, isLoading: service_vendor_loading, error: service_vendor_error, mutate: service_vendor_mutate } = useFrappeGetDoc("Vendors", orderData?.vendor, orderData?.vendor ? `Vendors ${orderData?.vendor}` : null)

    const { data: project, isLoading: project_loading, error: project_error, mutate: project_mutate } = useFrappeGetDoc("Projects", orderData?.project, orderData?.project ? `Projects ${orderData?.project}` : null)

    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ["*"],
            limit: 1000
        },
        "Address"
    );

    useEffect(() => {
        if (service_request) {
            console.log("running")
            setOrderData(service_request)
            const notes = service_request?.notes && JSON.parse(service_request?.notes)?.list
            setNotes(notes || [])
            const gst = service_request?.gst
            if(gst === "true") {
                setGstEnabled(true)
            } else {
                setGstEnabled(false)
            }
            setAdvance(parseFloat(service_request?.advance) || 0)
        }
    }, [service_request])


    useEffect(() => {
        if (orderData?.project && project && service_vendor) {
            const doc = address_list?.find(item => item.name == project?.project_address);
            const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
            setProjectAddress(address)
            const doc2 = address_list?.find(item => item.name == service_vendor?.vendor_address);
            const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
            setVendorAddress(address2)
            // setPhoneNumber(doc2?.phone || "")
            // setEmail(doc2?.email_id || "")
        }
        // if (orderData?.vendor) {
        //     setVendor(orderData?.vendor)
        // }
        // if (vendor_data) {
        //     setVendorGST(vendor_data?.vendor_gst)
        // }

    }, [orderData, address_list, project, service_vendor]);

    const { updateDoc, loading: update_loading } = useFrappeUpdateDoc()
    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${orderData?.name}_${orderData?.vendor}`
    });

    const getTotal = () => {
        let total: number = 0;
        if (orderData) {
            const serviceOrder = JSON.parse(orderData?.service_order_list);
            serviceOrder?.list?.map((item) => {
                const price = item.quantity * item.rate;
                total += price ? parseFloat(price) : 0
            })
        }
        return total;
    }

    const [editingIndex, setEditingIndex] = useState(null);

    const handleAddNote = () => {
        if (editingIndex !== null) {
            const updatedNotes = notes.map(note =>
                note.id === editingIndex ? { ...note, note: curNote } : note
            );
            setNotes(updatedNotes);
            setEditingIndex(null);
        } else {
            const newNote = { id: uuidv4(), note: curNote }
            setNotes([...notes, newNote])
        }
        setCurNote(null);
    };

    const handleEditNote = (id) => {
        setCurNote(notes?.find((i) => i?.id === id)?.note);
        setEditingIndex(id);
    };

    const handleDeleteNote = (id) => {
        setNotes(notes.filter((note) => note?.id !== id));
    };

    const handleNotesSave = async () => {
        let updatedData = {}

        if(notes?.length) {
            updatedData = {...updatedData, notes: { list: notes }}
        }
        if(service_request?.gst !== gstEnabled?.toString()) {
            updatedData = {...updatedData, gst : gstEnabled?.toString()}
        }

        // if(parseFloat(service_request?.advance || 0) !== advance) {
        //     updatedData = {...updatedData, advance: advance}
        // }

        try {
            const data = await updateDoc("Service Requests", orderData?.name, updatedData)

            // console.log("updatedData", data)

            await service_request_mutate()

            toast({
                title: "Success!",
                description: `Saved notes successfully!`,
                variant: "success"
            })
        } catch (error) {
            console.log("error while adding notes to the database", error)
            toast({
                title: "Failed!",
                description: `Saving notes Failed!`,
                variant: "destructive"
            })
        }
    }

    // console.log("notes", notes)

    // console.log("orderData", orderData)

    // console.log("advance", advance, customAdvance)

    // console.log("gstEnabled", gstEnabled)

    return (
        <div className='flex-1 space-y-4'>
            <div className="flex justify-between items-center">
<<<<<<< HEAD
<<<<<<< HEAD
                <div className=" flex items-center gap-1 ml-8">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                    <div className="font-semibold text-xl md:text-2xl text-pageheader">SR PDF</div>
=======
                <div className="py-4 flex items-center gap-1">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                    <div className="font-semibold text-xl md:text-2xl">{(orderData?.name)?.toUpperCase()}</div>
>>>>>>> f5a5ff9 (fix: removed left arrows for the following components.)
=======
                <div className=" flex items-center gap-1 ml-8">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                    <div className="font-semibold text-xl md:text-2xl text-pageheader">SR PDF</div>
>>>>>>> ec27647 (fix: fixed several routes & navigations and removed/updated page headings)
                </div>
                <ShadButton className='flex items-center gap-2' onClick={handlePrint}>
                    <Printer className='h-4 w-4' />
                    Print
                </ShadButton>
            </div>
            <Layout>
                <Sider theme='light' collapsedWidth={0} width={400} trigger={null} collapsible collapsed={collapsed}>
                    {gstEnabled !== null && (
                        <div className="flex flex-col gap-2 py-6 border-b border-gray-200">
                        <p className="font-semibold">Enable/Disable Tax Calculation</p>
                        <Switch id="hello" defaultChecked={gstEnabled} onCheckedChange={(e) => setGstEnabled(e)}  /> 
                    </div>
                    )}
                    {/* <div className="flex-1 py-6 border-b border-gray-200">
                                <Label className="font-semibold">Advance (in %)</Label>
                                            <RadioGroup
                                                onValueChange={(value) => {
                                                    setAdvance(value !== "Other" ? parseFloat(value) : 0);
                                                    setCustomAdvance(value === "Other");
                                                }}
                                                className="flex flex-col space-y-2 mt-2"
                                            >
                                                <div className="flex gap-4 items-center">
                                                    <RadioGroupItem value="25" id="advance-25" />
                                                    <Label htmlFor="advance-25" className="font-medium text-gray-700">25%</Label>

                                                    <RadioGroupItem value="50" id="advance-50" />
                                                    <Label htmlFor="advance-50" className="font-medium text-gray-700">50%</Label>

                                                    <RadioGroupItem value="75" id="advance-75" />
                                                    <Label htmlFor="advance-75" className="font-medium text-gray-700">75%</Label>

                                                    <RadioGroupItem value="100" id="advance-100" />
                                                    <Label htmlFor="advance-100" className="font-medium text-gray-700">100%</Label>

                                                    <RadioGroupItem value="Other" id="advance-other" />
                                                    <Label htmlFor="advance-other" className="font-medium text-gray-700">Other</Label>
                                                </div>

                                                {customAdvance && (
                                                    <div className="mt-4">
                                                        <Label htmlFor="custom-advance">Enter Custom Advance %</Label>
                                                        <Input
                                                            id="custom-advance"
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            placeholder="Enter percentage"
                                                            className="mt-2 border border-gray-300 rounded-lg p-2"
                                                            value={advance}
                                                            onChange={(e) => {
                                                                const value = e.target.value
                                                                if (value === "") {
                                                                    setAdvance(0);
                                                                } else if (parseFloat(value) < 0) {
                                                                    setAdvance(0);
                                                                } else if (parseFloat(value) > 100) {
                                                                    setAdvance(100);
                                                                } else {
                                                                    setAdvance(parseFloat(value));
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                </RadioGroup>
                    </div>             */}
                    <div className="flex flex-col pt-4 gap-2">
                        <h3 className="text-sm font-semibold">Create Note Points</h3>
                        <div className="flex max-md:flex-col gap-4 md:items-center">
                            <Input
                                type="text"
                                placeholder="type notes here..."
                                value={curNote || ""}
                                className="w-[90%]"
                                onChange={(e) => setCurNote(e.target.value)}
                            />
                            <Button onClick={handleAddNote}
                                className="w-20"
                                disabled={!curNote}>
                                {editingIndex === null ? <div className="flex gap-1 items-center"><CirclePlus className="w-4 h-4" /><span>Add</span></div> : <div className="flex gap-1 items-center"><Edit className="w-4 h-4" /><span>Update</span></div>}
                            </Button>
                        </div>
                    </div>

                    {notes?.length > 0 && (
                        <div className="flex flex-col gap-2 pt-4">
                            <h3 className="text-sm font-semibold">Notes Preview</h3>
                            <ul className="list-[number] space-y-2">
                                {notes.map((note) => (
                                    <li key={note?.id} className="ml-4">
                                        <div className="flex items-center gap-2">
                                            <p>{note?.note}</p>
                                            <div className="flex gap-2 items-center">
                                                {editingIndex === note?.id ? (
                                                    <CheckIcon
                                                        className="w-4 h-4 cursor-pointer text-green-500"
                                                        onClick={handleAddNote}
                                                    />
                                                ) : (
                                                    <Pencil2Icon
                                                        className="w-4 h-4 cursor-pointer"
                                                        onClick={() => handleEditNote(note?.id)}
                                                    />
                                                )}
                                                <span>|</span>
                                                <Trash
                                                    className="w-4 h-4 text-primary cursor-pointer"
                                                    onClick={() => handleDeleteNote(note?.id)}
                                                />
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                        <Button disabled={update_loading || (!notes?.length && !(service_request?.notes && JSON.parse(service_request?.notes)?.list?.length > 0) && service_request?.gst === gstEnabled?.toString() && parseFloat(service_request?.advance || 0) === advance) } onClick={handleNotesSave} className="w-full mt-4 items-center flex gap-2">{update_loading ? <TailSpin width={20} height={20} color="red" /> : <div className="flex items-center gap-1"><Save className="w-4 h-4" /> <span>Save</span></div>}</Button>
                    {/* <Separator className="my-6" /> */}
                </Sider>
                <Layout className='bg-white'>
                    <div className="flex">
                        <Button
                            type="text"
                            icon={collapsed ? <NotebookPen className='hover:text-primary/40' /> : <ArrowLeftToLine className='hover:text-primary/40' />}
                            onClick={() => setCollapsed(!collapsed)}
                            style={{
                                fontSize: '16px',
                                width: 64,
                                height: 64,
                                backgroundColor: "white"
                            }}
                        />
                        <Content
                            className={`${collapsed ? "md:mx-10 lg:mx-32" : ""} my-4 mx-2 flex flex-col gap-4 relative`}
                        >
                            <div className={`w-full border rounded-lg h-screen overflow-y-scroll`}>
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
                                                                <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
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
                                                                    <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.modified?.split(" ")[0]}</i></div>
                                                                    <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.project}</i></div>
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
                                                    {gstEnabled && <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>}
                                                    <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody className={`bg-white`}>
                                                {orderData && JSON.parse(orderData?.service_order_list)?.list?.map((item, index) => (
                                                    <tr key={item.id} className={`${index === (orderData && JSON.parse(orderData?.service_order_list))?.list?.length - 1 && "border-b border-black"} page-break-inside-avoid`}>
                                                        <td className="py-2 text-sm whitespace-nowrap flex items-start">{index + 1}.</td>
                                                        {/* <td className="py-2 text-sm whitespace-nowrap text-wrap">{item?.category}</td> */}
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[95%]">
                                                            <p className="font-semibold">{item?.category}</p>
                                                            {item?.description}
                                                        </td>
                                                        <td className="px-2 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
                                                        <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
                                                        <td className=" py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate)}</td>
                                                        {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>}
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
                                                        {gstEnabled && <div className="ml-4">{formatToIndianRupee(getTotal() * 1.18 - getTotal())}</div> }
                                                        <div className="ml-4">- {formatToIndianRupee((getTotal() * (gstEnabled ? 1.18 : 1)).toFixed(2) - Math.floor(getTotal() * (gstEnabled ? 1.18 : 1)))}</div>
                                                        <div className="ml-4">{formatToIndianRupee(Math.floor(getTotal() * (gstEnabled ? 1.18 : 1)))}</div>
                                                    </td>

                                                </tr>

                                                <tr className="end-of-page page-break-inside-avoid" >
                                                    <td colSpan={6}>

                                                        {notes?.length > 0 && (
                                                            <div className="mb-2">
                                                                <div className="text-gray-400 text-sm py-2">Notes</div>
                                                                <ul className="list-[number]">
                                                                    {notes?.map((note) => (
                                                                        <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

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
                                                                <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
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
                        </Content>
                    </div>
                </Layout>
            </Layout>
        </div>
    );
};