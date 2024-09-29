import React, { useState } from 'react';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UploadOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Button , Layout } from 'antd';
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import {  useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom";
import { useReactToPrint } from 'react-to-print';
import redlogo from "@/assets/red-logo.png"
// import { Button } from "../ui/button";
import { ArrowLeft, X } from "lucide-react";
import Seal from "../../assets/NIRMAAN-SEAL.jpeg";
import { Controller, useForm } from "react-hook-form";
import { Input } from '@/components/ui/input';
import { Label } from "../ui/label";
import TextArea from "antd/es/input/TextArea";
import { useToast } from "../ui/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { AlertDialogAction } from "@radix-ui/react-alert-dialog";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import formatToIndianRupee from '@/utils/FormatPrice';

const { Header, Sider, Content } = Layout;

export const ReleasePONew: React.FC = () => {

  const [collapsed, setCollapsed] = useState(true);
  // const {
  //   token: { colorBgContainer, borderRadiusLG },
  // } = theme.useToken();

  const { id } = useParams<{ id: string }>()
    const orderId = id?.replaceAll("&=", "/")

    const navigate = useNavigate()

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ["*"],
            limit: 1000
        },
        "Procurement Orders"
    );

    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ["*"],
            limit: 1000
        },
        "Address"
    );

    const [orderData, setOrderData] = useState(null);
    const [projectAddress, setProjectAddress] = useState()
    const [vendorAddress, setVendorAddress] = useState()

    useEffect(() => {
        if (orderData?.project_address) {
            const doc = address_list?.find(item => item.name == orderData?.project_address);
            const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
            setProjectAddress(address)
            const doc2 = address_list?.find(item => item.name == orderData?.vendor_address);
            const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
            setVendorAddress(address2)
        }

    }, [orderData, address_list]);

    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${orderData?.name}_${orderData?.vendor_name}`
    });

    const [advance, setAdvance] = useState(0)
    const [loadingCharges, setLoadingCharges] = useState(0)
    const [freightCharges, setFreightCharges] = useState(0)
    const [notes, setNotes] = useState("")

    const { control, handleSubmit, reset } = useForm({
        defaultValues: {
            advance: 0,
            loadingCharges: 0,
            freightCharges: 0,
            notes: ""
            // afterDelivery: 0  // Initial values need to be set based on your state or props
        }
    });

    useEffect(() => {
        if (procurement_order_list && orderId) {
            const curOrder = procurement_order_list.find(item => item.name === orderId);
            if (curOrder) {
                setOrderData(curOrder);
                reset({
                    advance: parseInt(curOrder.advance || 0),
                    loadingCharges: parseInt(curOrder.loading_charges || 0),
                    freightCharges: parseInt(curOrder.freight_charges || 0),
                    notes: curOrder.notes || ""
                    // afterDelivery: calculateAfterDelivery(curOrder) // Assuming you have a function to calculate this
                });
                setAdvance(parseInt(curOrder.advance || 0))
                setLoadingCharges(parseInt(curOrder.loading_charges || 0))
                setFreightCharges(parseInt(curOrder.freight_charges || 0))
                setNotes(curOrder.notes || "")
            }
        }
    }, [procurement_order_list, orderId, reset]);

    const { updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()
    const { createDoc, loading: create_loading } = useFrappeCreateDoc()

    const { toast } = useToast()

    // console.log("values", control._formValues)

    const onSubmit = (data: any) => {
        const updateData = {
            advance: data.advance !== "" ? parseInt(data.advance) : 0,
            loading_charges: data.loadingCharges !== "" ? parseInt(data.loadingCharges) : 0,
            freight_charges: data.freightCharges !== "" ? parseInt(data.freightCharges) : 0,
            notes: data.notes || ""
        };

        updateDoc('Procurement Orders', orderData?.name, updateData)
            .then((doc) => {
                mutate()
                console.log("orderData?.name", orderData?.name)
                toast({
                    title: "Success!",
                    description: `${doc.name} updated successfully!`,
                    variant: "success"
                })
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
                toast({
                    title: "Failed!",
                    description: `Failed to update ${orderData?.name}`,
                    variant: "destructive"
                })
            })
    };

    const getTotal = () => {
        let total: number = 0;
        let totalGst = 0;
        orderData?.order_list?.list?.map((item) => {
            const price = item.quote;
            const gst = (price) * (item.quantity) * (item.tax / 100)

            totalGst += gst
            total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
        })

        total += loadingCharges + freightCharges
        totalGst += ((loadingCharges) * 0.18) + ((freightCharges) * 0.18)

        return { total, totalGst: totalGst, totalAmt: total + totalGst };
    }

    const handleCancelPo = async () => {

        const categories = []

        const itemList = []

        orderData?.order_list?.list.map((item) => {
            categories.push({ name: item.category })
            itemList.push({ ...item, status: "Pending" })
        })

        try {
            await updateDoc("Procurement Orders", orderId, {
                status: "Cancelled"
            })

            const newSentBack = await createDoc("Sent Back Category", {
                type: "Cancelled",
                procurement_request: orderData?.procurement_request,
                project: orderData?.project,
                category_list: { list: categories },
                item_list: { list: itemList },
                comments: ""
            })
            console.log("newSentBack", newSentBack)
            toast({
                title: "Success!",
                description: `Cancelled Po & New Sent Back: ${newSentBack.name} created successfully!`,
                variant: "success"
            })
            navigate("/release-po")
        } catch (error) {
            console.log("Error while cancelling po", error)
            toast({
                title: "Failed!",
                description: `PO: ${orderId} Cancellation Failed!`,
                variant: "destructive"
            })
        }
    }

    if (procurement_order_list_loading || address_list_loading) return <div>Loading</div>
    if (procurement_order_list_error || address_list_error) return procurement_order_list_error ? procurement_order_list_error.message : address_list_error.message


  return (
    <div className='flex-1 md:space-y-4 p-4'>
                        <div className="flex py-4">
                            <ArrowLeft className="mt-1 cursor-pointer" onClick={() => navigate("/release-po")} />
                            <div className="font-semibold text-xl pl-2"><span className="text-red-700 text-2xl">Selected PO:</span> {(orderData?.name)?.toUpperCase()}</div>
                        </div>
    <Layout>
      <Sider theme='light' collapsedWidth={0} width={500}  trigger={null} collapsible collapsed={collapsed}>
                    <form onSubmit={handleSubmit(onSubmit)} className="px-4 pb-4">
                        <div className="flex-col">
                            <h3 className="font-semibold text-lg mt-4">Additional Charges</h3>
                            <div className="flex-1 mt-2">
                                <Label>Loading Charges</Label>
                                <Controller
                                    control={control}
                                    name="loadingCharges"
                                    render={({ field }) => (
                                        <Input {...field} className="w-full" onChange={(e) => {
                                            const value = e.target.value
                                            field.onChange(e);
                                            setLoadingCharges(value !== "" ? parseInt(value) : 0);
                                        }} />
                                    )}
                                />
                            </div>
                            <div className="flex-1 mt-2">
                                <Label>Freight Charges</Label>
                                <Controller
                                    control={control}
                                    name="freightCharges"
                                    render={({ field }) => (
                                        <Input {...field} className="w-full" onChange={(e) => {
                                            const value = e.target.value
                                            field.onChange(e);
                                            setFreightCharges(value !== "" ? parseInt(value) : 0);
                                        }} />
                                    )}
                                />
                            </div>
                            <h3 className="font-semibold text-lg mt-4">Terms and Other Description</h3>
                            <div className="flex-1 mt-2">
                                <Label>Advance (in %)</Label>
                                <Controller
                                    control={control}
                                    name="advance"
                                    render={({ field }) => (
                                        <Input type="number" {...field} onChange={(e) => {
                                            const value = e.target.value
                                            field.onChange(e);
                                            setAdvance(value !== "" ? parseInt(value) : 0);
                                        }} className="w-full" />
                                    )}
                                />
                            </div>
                            <div className="flex-1 mt-2">
                                <Label>Add Notes</Label>
                                <Controller
                                    control={control}
                                    name="notes"
                                    render={({ field }) => (
                                        <TextArea {...field} onChange={(e) => {
                                            const value = e.target.value;
                                            field.onChange(value);
                                            setNotes(value);
                                        }} className="w-full" />
                                    )}
                                />
                            </div>
                            <div className="mt-2 text-center">
                                <button className="h-9 px-8 py-2 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90" disabled={advance > 100 || advance < 0} >
                                    {update_loading ? "Saving..." : "Save"}
                                </button>
                            </div>
                        </div>
                    </form>
      </Sider>
      <Layout className='bg-white'>
        <div className="flex">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
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
              <div className='absolute right-0 -top-[8%]'>
                        <button className='h-9 px-6 py-1 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90' disabled={advance > 100 || advance < 0} onClick={() => {
                            onSubmit(control._formValues)
                            handlePrint()
                            }}>
                            Print
                        </button>
              </div>
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
                                                        <img className="w-44" src={redlogo} alt="Nirmaan" />
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
                                                    <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{orderData?.vendor_name}</div>
                                                    <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{vendorAddress}</div>
                                                    <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {orderData?.vendor_gst}</div>
                                                </div>
                                                <div>
                                                    <div>
                                                        <h3 className="text-gray-500 text-sm pb-2 text-left">Delivery Location</h3>
                                                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{projectAddress}</div>
                                                    </div>
                                                    <div className="pt-2">
                                                        <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.creation?.split(" ")[0]}</i></div>
                                                        <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.project_name}</i></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </th>
                                    </tr>
                                    <tr className="border-t border-black">
                                        <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">S. No.</th>
                                        <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48">Items</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className={`bg-white`}>
                                    {orderData?.order_list?.list.map((item: any, index: number) => {
                                        return (<tr key={index} className={`${(!loadingCharges && !freightCharges && index === orderData?.order_list?.list.length - 1) && "border-b border-black"} page-break-inside-avoid ${index === 15 ? 'page-break-before' : ''}`}>
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                                            <td className=" py-2 text-sm whitespace-nowrap text-wrap">{item.item}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.quote)}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(((item.quote) * (item.quantity)).toFixed(2))}</td>
                                        </tr>)
                                    })}
                                    {/* {[...Array(19)].map((_, index) => (
                                        orderData?.order_list?.list.map((item) => (
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
                                    {loadingCharges ?
                                        <tr className={`${!freightCharges && "border-b border-black"}`}>
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                                            <td className=" py-2 text-sm whitespace-nowrap">LOADING CHARGES</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">NOS</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">1</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(loadingCharges)}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(loadingCharges.toFixed(2))}</td>
                                        </tr>
                                        :
                                        <></>
                                    }
                                    {freightCharges ?
                                        <tr className={`border-b border-black`}>
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                                            <td className=" py-2 text-sm whitespace-nowrap">FREIGHT CHARGES</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">NOS</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">1</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(freightCharges)}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(freightCharges.toFixed(2))}</td>
                                        </tr>
                                        :
                                        <></>
                                    }
                                    <tr className="">
                                        <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                                        <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal().total.toFixed(2))}</td>
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
                                            <div className="ml-4">{formatToIndianRupee((getTotal().totalGst).toFixed(2))}</div>
                                            <div className="ml-4">- {formatToIndianRupee(((getTotal().totalAmt).toFixed(2) - (Math.floor(getTotal().totalAmt)).toFixed(2)).toFixed(2))}</div>
                                            <div className="ml-4">{formatToIndianRupee((Math.floor(getTotal().totalAmt)).toFixed(2))}</div>
                                        </td>

                                    </tr>
                                    <tr className="end-of-page page-break-inside-avoid" >
                                        <td colSpan={6}>
                                            {notes !== "" && (
                                                <>
                                                    <div className="text-gray-400 text-sm py-2">Note</div>
                                                    <div className="text-sm text-gray-900">{notes}</div>
                                                </>
                                            )}
                                            <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                            <div className="text-sm text-gray-900">
                                                {advance}% advance {advance === 100 ? "" : `and remaining ${100 - advance}% on material readiness before delivery of material to site`}
                                            </div>

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
                                                        <img className="w-44" src={redlogo} alt="Nirmaan" />
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

                     <Card className="border-primary">
                        <CardHeader>
                            <CardTitle>Cancel PO</CardTitle>
                            <CardContent>
                                <CardDescription className="flex justify-between items-center">
                                    <p className="w-[70%]">on clicking the cancel button will create a "Sent Back Request"</p>
                                    {orderData?.status === "Generated" ? (
                                        <button
                                            onClick={() => document.getElementById("alertTrigger")?.click()}
                                            className="border-primary h-9 px-4 py-2 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground"
                                        >
                                            Cancel PO
                                        </button>
                                    ) : (
                                        <HoverCard>
                                            <HoverCardTrigger>
                                                <button disabled className="border-primary cursor-not-allowed h-9 px-4 py-2 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground">Cancel PO</button>
                                            </HoverCardTrigger>
                                            <HoverCardContent className="w-80">
                                                <div>
                                                    <span className="text-primary underline">Cancellation</span> not allowed for this PO as its delivery note has already been updated!
                                                </div>
                                            </HoverCardContent>
                                        </HoverCard>
                                    )}
                                    <AlertDialog>
                                        <AlertDialogTrigger>
                                            <button className="hidden" id="alertTrigger">trigger</button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                    <h1 className="justify-center">Are you sure!</h1>
                                                </AlertDialogTitle>

                                                <AlertDialogDescription className="space-x-2 text-center">
                                                    Cancelling this PO will create a new cancelled Sent Back. Continue?
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={handleCancelPo}>
                                                        <button className='h-9 px-4 py-2 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90'>Confirm</button>
                                                    </AlertDialogAction>
                                                </AlertDialogDescription>

                                            </AlertDialogHeader>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </CardDescription>

                            </CardContent>
                        </CardHeader>
                    </Card>
        </Content>
        </div>
      </Layout>
    </Layout>
    </div>
  );
};
