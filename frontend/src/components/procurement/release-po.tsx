import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useState, useEffect, useRef } from "react"
import React from 'react';
import { useNavigate, useParams } from "react-router-dom";
import { useReactToPrint } from 'react-to-print';
import redlogo from "@/assets/red-logo.png"
// import { Form, InputNumber } from 'antd';
import { Button } from "../ui/button";
import { ArrowLeft, X } from "lucide-react";
import { MainLayout } from "../layout/main-layout";
import Seal from "../../assets/NIRMAAN-SEAL.jpeg";
import { Controller, useForm } from "react-hook-form";
import { Input } from '@/components/ui/input';
import { Label } from "../ui/label";

export const ReleasePO = () => {
    const { id } = useParams<{ id: string }>()
    const orderId = id?.replaceAll("&=", "/")

    const navigate = useNavigate()

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ['name', 'project_name', 'project_address', 'vendor_name', 'vendor_address', 'vendor_gst', 'order_list', 'creation', 'advance', 'loading_charges', 'freight_charges'],
            limit: 100
        });
    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'address_line2', 'city', 'state', 'pincode']
        });

    const [orderData, setOrderData] = useState({
        name: ''
    });
    const [projectAddress, setProjectAddress] = useState()
    const [vendorAddress, setVendorAddress] = useState()

    // useEffect(() => {
    //     const curOrder = procurement_order_list?.find(item => item.name === orderId);
    //     setOrderData(curOrder)
    // }, [procurement_order_list]);

    useEffect(() => {
        if (orderData?.project_address) {
            const doc = address_list?.find(item => item.name == orderData?.project_address);
            const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
            setProjectAddress(address)
            const doc2 = address_list?.find(item => item.name == orderData?.vendor_address);
            const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
            setVendorAddress(address2)
        }

    }, [orderData]);


    const [isPrinting, setIsPrinting] = useState(false);
    const componentRef = React.useRef();

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${orderData?.name}_${orderData?.vendor_name}`
    });

    const togglePrintMode = () => {
        setIsPrinting(prevState => !prevState);
        if (!isPrinting) {
            handlePrint();
        }
    };

    const [advance, setAdvance] = useState(0)
    const [loadingCharges, setLoadingCharges] = useState(0)
    const [freightCharges, setFreightcCharges] = useState(0)
    const [totalAmount, setTotalAmount] = useState(100); // Example total amount

    // const handleAdvanceChange = (value) => {
    //     setAdvance(value);

    //     if (parseInt(value) > 100 || parseInt(value) < 0) {
    //         alert("Invalid: Advance % should be between 0 and 100");
    //     }
    // };

    // const handleLoadingChargesChange = (value) => {
    //     setLoadingCharges(value);
    //     console.log(value, loadingCharges)
    //     if (parseInt(value) < 0) {
    //         alert("Amount cannot be negative");
    //     }
    // }

    // const handleFreightChargesChange = (value) => {
    //     setFreightcCharges(value);
    //     console.log(value, freightCharges)
    //     if (parseInt(value) < 0) {
    //         alert("Amount cannot be negative");
    //     }
    // }
    // const [form] = Form.useForm();

    const { control, handleSubmit, setValue, reset, formState: { errors } } = useForm({
        defaultValues: {
            advance: 0,
            loadingCharges: 0,
            freightCharges: 0,
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
                    // afterDelivery: calculateAfterDelivery(curOrder) // Assuming you have a function to calculate this
                });
                setLoadingCharges(parseInt(curOrder.loading_charges || 0))
                setFreightcCharges(parseInt(curOrder.freight_charges || 0))
            }
            // setOrderData(curOrder);
            // setAdvance(parseInt(curOrder?.advance || 0));
            // setLoadingCharges(parseInt(curOrder?.loading_charges || 0));
            // setFreightcCharges(parseInt(curOrder?.freight_charges || 0));
            // form.setFieldsValue({
            //     advance: parseInt(curOrder?.advance || 0),
            //     loadingCharges: parseInt(curOrder?.loading_charges || 0),
            //     freightCharges: parseInt(curOrder?.freight_charges || 0),
            // });
        }
    }, [procurement_order_list, orderId, reset]);



    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()



    // handleSubmit
    const onSubmit = (data: any) => {

        const updateData = {
            advance: data.advance,
            loading_charges: !loadingCharges ? 0 : data.loadingCharges,
            freight_charges: !freightCharges ? 0 : data.freightCharges,
        };

        updateDoc('Procurement Orders', orderData?.name, updateData)
            .then((doc) => {
                // setOrderData(prev => ({
                //     ...prev,
                //     advance: doc.advance

                // }))
                mutate()
                console.log("orderData?.name", orderData?.name)
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })
    };

    const getTotal = (order_id: string) => {
        let total: number = 0;
        const orderData = procurement_order_list?.find(item => item.name === order_id)?.order_list;
        orderData?.list.map((item) => {
            const price = item.quote;
            total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
        })
        return total + loadingCharges + freightCharges;
    }

    // const afterDelivery = totalAmount * (1 - advance / 100);

    let count = 1;
    console.log(advance)




    if (procurement_order_list_loading || address_list_loading) return <div>Loading</div>
    if (procurement_order_list_error || address_list_error) return procurement_order_list_error ? procurement_order_list_error.message : address_list_error.message

    return (
        <>
            <MainLayout>
                <div className="flex">
                    <div className="w-[30%] mx-auto mt-10">
                        <div className="flex py-4">
                            <ArrowLeft className="mt-1" onClick={() => navigate("/release-po")} />
                            <div className="font-semibold text-xl pl-2"><span className="text-red-700 text-2xl">Selected PO:</span> {(orderData?.name)?.toUpperCase()}</div>
                        </div>


                        {/* <Form form={form} layout="vertical" initialValues={{ advance, afterDelivery: totalAmount * (1 - advance / 100), loadingCharges, freightCharges }}>
                            <div className="flex-col p-4">
                                {!loadingCharges ? <Button variant='outline' onClick={() => setLoadingCharges(1)}>Add Loading/Unloading Charges</Button>
                                    :
                                    <div className="flex-1">
                                        <Form.Item
                                            name="loadingCharges"
                                            label="Loading Charges"
                                        >
                                            <Input
                                                onChange={handleLoadingChargesChange}
                                                value={loadingCharges}
                                                className="w-full"
                                            />
                                        </Form.Item>
                                        <Button className="mb-2" onClick={() => setLoadingCharges(0)}>Cancel</Button>
                                    </div>}
                                {
                                    !freightCharges ? <Button variant='outline' onClick={() => setFreightcCharges(1)}>Add Freight Charges</Button>
                                        :
                                        <div className="flex-1">
                                            <Form.Item
                                                name="freightCharges"
                                                label="Freight Charges"
                                            >
                                                <Input
                                                    onChange={() => handleFreightChargesChange}
                                                    value={freightCharges}
                                                    className="w-full"
                                                />

                                            </Form.Item>
                                            <Button className="mb-2" onClick={() => setFreightcCharges(0)}>Cancel</Button>
                                        </div>
                                }


                                <Form.Item
                                    name="advance"
                                    label="Advance (%)"
                                    rules={[{ required: true, message: 'Please input the advance percentage!' }]}
                                >
                                    <InputNumber
                                        // type="number"
                                        onChange={() => handleAdvanceChange}
                                        value={advance}
                                        className="w-full"

                                    />
                                </Form.Item>
                                <Form.Item label="After Delivery Amount">
                                    <Input
                                        value={afterDelivery.toFixed(2)}
                                        disabled
                                        className="w-full"
                                    />
                                </Form.Item>
                                <Form.Item>
                                    {update_loading ? <div>loading...</div> : (<Button className="mr-2" disabled={advance > 100 || advance < 0} onClick={handleSubmit}>
                                        Save
                                    </Button>)}
                                    <Button onClick={handlePrint}>
                                        Print
                                    </Button>
                                    {update_submit_complete &&
                                        <div>
                                            <div className="font-semibold text-green-500">Advance Value Saved Successfully</div>
                                        </div>
                                    }
                                </Form.Item>
                            </div>
                        </Form> */}
                        <form onSubmit={handleSubmit(onSubmit)} className="p-4">
                            <div className="flex-col">
                                {!loadingCharges ? <Button variant='outline' onClick={() => setLoadingCharges(1)}>Add Loading/Unloading Charges</Button>
                                    :
                                    <div className="flex-1">
                                        <Label>Loading Charges</Label>
                                        <div className="flex">
                                            <Controller
                                                control={control}
                                                name="loadingCharges"
                                                render={({ field }) => <Input {...field} className="w-full" />}
                                            />
                                            <Button className="mb-2 ml-2" onClick={() => setLoadingCharges(0)}><X /></Button>
                                        </div>
                                    </div>
                                }
                                {!freightCharges ? <Button variant='outline' className="mt-2" onClick={() => setFreightcCharges(1)}>Add Freight Charges</Button>
                                    :
                                    <div className="flex-1">
                                        <Label>Freight Charges</Label>
                                        <div className="flex">
                                            <Controller
                                                control={control}
                                                name="freightCharges"
                                                render={({ field }) => <Input {...field} className="w-full" />}
                                            />
                                            <Button className="mb-2 ml-2" onClick={() => setFreightcCharges(0)}><X /></Button>
                                        </div>
                                    </div>

                                }
                                <div className="flex-1 mt-2">
                                    <Label>Advance (in %)</Label>
                                    <Controller
                                        control={control}
                                        name="advance"
                                        render={({ field }) => <Input {...field} className="w-full" />}
                                    />
                                </div>
                                <div className="mt-2">
                                    {update_loading ? <div>loading...</div> : (<Button className="mr-2" disabled={advance > 100 || advance < 0} onClick={handleSubmit}>
                                        Save
                                    </Button>)}
                                    <Button onClick={handlePrint}>
                                        Print
                                    </Button>
                                    {update_submit_complete &&
                                        <div>
                                            <div className="font-semibold text-green-500">PO Update Successfull</div>
                                        </div>
                                    }
                                </div>

                            </div>
                        </form>
                    </div>

                    <div className="w-[50%] p-4 m-4 border rounded-lg">
                        <div ref={componentRef} className="w-full p-4">
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
                                                        <div className="text-lg text-black">{(orderData?.name)?.toUpperCase()}</div>
                                                    </div>
                                                </div>

                                                <div className=" border-b-2 border-gray-600 pb-1 mb-1">
                                                    <div className="flex justify-between">
                                                        <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
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
                                                            <div className="text-sm font-medium text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;{orderData?.creation?.split(" ")[0]}</div>
                                                            <div className="text-sm font-medium text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;{orderData?.project_name}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </th>
                                        </tr>
                                        <tr>
                                            <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider w-[7%]">S. No.</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48">Items</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                            <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Quantity</th>
                                            <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                            <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">

                                        {orderData?.order_list?.list.map((item) => {
                                            return <tr className="">
                                                <td className="py-2 text-sm whitespace-nowrap w-[7%]">{count++}.</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.item}</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{(item.quote) * (item.quantity)}</td>
                                            </tr>
                                        })}
                                        {loadingCharges ?
                                            <tr className="">
                                                <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">LOADING CHARGES</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">NOS</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">1</td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{orderData?.loading_charges}</td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{orderData?.loading_charges}</td>
                                            </tr>
                                            :
                                            <></>
                                        }
                                        {freightCharges ?
                                            <tr className="">
                                                <td className="py-2 text-sm whitespace-nowrap w-[7%]">-</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">FREIGHT CHARGES</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">NOS</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">1</td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{orderData?.freight_charges}</td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{orderData?.freight_charges}</td>
                                            </tr>
                                            :
                                            <></>
                                        }
                                        <tr>
                                            <td></td>
                                            <td></td>
                                            <td></td>
                                            <td className="space-y-4 py-4 text-sm font-semibold">
                                                <div>Sub Total:</div>
                                                <div>CGST(9%):</div>
                                                <div>SGST(9%):</div>
                                                <div>Total:</div>
                                            </td>
                                            <td></td>
                                            <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                                                <div>{getTotal(orderData?.name)}</div>
                                                <div>{(getTotal(orderData?.name) * 0.09).toFixed(2)}</div>
                                                <div>{(getTotal(orderData?.name) * 0.09).toFixed(2)}</div>
                                                <div>{(getTotal(orderData?.name) * 1.18).toFixed(2)}</div>
                                            </td>
                                        </tr>
                                        <tr className="border-none">
                                            <td colSpan={6}>
                                                <div className="text-gray-400 text-sm py-2">Note</div>
                                                <div className="text-sm text-gray-900">Above Sheet to be used of Jindal or Tata</div>

                                                <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                                <div className="text-sm text-gray-900">{orderData?.advance}% advance {orderData?.advance === "100" ? "" : `and remaining ${100 - orderData?.advance}% on material readiness before delivery of material to site`}</div>

                                                <img src={Seal} className="w-24 h-24" />
                                                <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div >
            </MainLayout >
            {/* <button onClick={handlePrint} className="m-8 p-2 bg-blue-500 text-white">Print</button> */}
        </>
    )
}