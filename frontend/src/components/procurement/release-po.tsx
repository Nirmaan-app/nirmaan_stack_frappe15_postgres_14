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
            fields: ['name', 'project_name', 'project_address', 'vendor_name', 'vendor_address', 'vendor_gst', 'order_list', 'creation', 'advance', 'loading_charges', 'freight_charges', 'category'],
            limit: 100
        });

    const {data: category_list, isLoading: category_list_loading, error: category_list_error, mutate: category_list_mutate} = useFrappeGetDocList("Category", 
        {
        fields: ['work_package', 'name', 'tax']
        })
    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'address_line2', 'city', 'state', 'pincode']
        });

    const [orderData, setOrderData] = useState(null);
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

    }, [orderData, address_list]);

    const [isPrinting, setIsPrinting] = useState(false);
    const componentRef = useRef<HTMLDivElement>(null);

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


    // console.log("procurement_order_list", procurement_order_list)
    // console.log("category_list", category_list)


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

    // console.log("orderData", orderData)

    const getTotal = () => {
        let total: number = 0;
        let totalGst = 0;
        // const orderDataa = procurement_order_list?.find(item => item.name === order_id)?.order_list;
        orderData?.order_list?.list?.map((item) => {
            const price = item.quote;
            const gst = (price) * (item.quantity) * (item.tax / 100)

            totalGst += gst
            total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
        })

        total += loadingCharges + freightCharges
        totalGst += ((orderData?.loading_charges) * 0.18) + ((orderData?.freight_charges) * 0.18)

        return {total, totalGst : totalGst , totalAmt : total + totalGst};
    }

    // console.log("total", getTotal().total)
    // console.log("gst", getTotal().totalGst)




    // const afterDelivery = totalAmount * (1 - advance / 100);

    // let count = 1;
    // console.log(advance)

    const styles = {
        container: {
            maxWidth: '800px',
            margin: 'auto',
            padding: '20px',
            color: '#333',
        },
        header: {
            color: '#333',
        },
        list: {
            paddingLeft: '20px',
        },
        listItem: {
            marginBottom: '10px',
        }
    };


    if (procurement_order_list_loading || address_list_loading) return <div>Loading</div>
    if (procurement_order_list_error || address_list_error) return procurement_order_list_error ? procurement_order_list_error.message : address_list_error.message

    return (
        <>
            <div className="flex justify-between">
                <div className="mt-10 pl-24">
                    <div className="flex py-4">
                        <ArrowLeft className="mt-1 cursor-pointer" onClick={() => navigate("/release-po")} />
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

                <div className="w-[50%] p-4 m-4 border rounded-lg h-screen overflow-y-scroll">
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
                                        {/* <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">SGST</th>
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">CGST</th> */}
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>
                                        <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className={`bg-white`}>
                                    {orderData?.order_list?.list.map((item : any, index : number) => {
                                        return ( <tr key={index} className={`${(!loadingCharges && !freightCharges && index === orderData?.order_list?.list.length - 1) && "border-b border-black"} page-break-inside-avoid ${index >= 14 ? 'page-break-before' : ''}`}>
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                                            <td className=" py-2 text-sm whitespace-nowrap text-wrap">{item.item}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quote}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.tax}%</td>
                                            {/* <td className="px-4 py-2 text-sm whitespace-nowrap">{((item.quote) * (item.quantity) * (item.tax / 200)).toFixed(2)}({item.tax /2}%)</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{((item.quote) * (item.quantity) * (item.tax / 200)).toFixed(2)}({item.tax /2}%)</td> */}
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{((item.quote) * (item.quantity)).toFixed(2)}</td>
                                        </tr> )
                                    })}
                                    {/* {[...Array(14)].map((_, index) => (
                                        orderData?.order_list?.list.map((item) => (
                                             <tr className="">
                                                <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index+1}.</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.item}</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                                <td className="px-6 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quote}</td>
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
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{orderData?.loading_charges}</td>
                                            {/* <td className="px-4 py-2 text-sm whitespace-nowrap">{((orderData?.loading_charges) * 0.09).toFixed(2)}(9%)</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{((orderData?.loading_charges) * 0.09).toFixed(2)}(9%)</td> */}
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{(orderData?.loading_charges * 1).toFixed(2)}</td>
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
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{orderData?.freight_charges}</td>
                                            {/* <td className="px-4 py-2 text-sm whitespace-nowrap">{((orderData?.freight_charges) * 0.09).toFixed(2)}(9%)</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{((orderData?.freight_charges) * 0.09).toFixed(2)}(9%)</td> */}
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{(orderData?.freight_charges * 1).toFixed(2)}</td>
                                        </tr>
                                        :
                                        <></>
                                    }
                                    {/* <tr> 
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        
                                        <td className="space-y-4 py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                                            <div>Sub Total:</div>
                                            <div>CGST(9%):</div>
                                            <div>SGST(9%):</div>
                                            <div className="h-2"></div>
                                            
                                        </td>
                                        <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                                            <div className="ml-4">{getTotal().total}</div>
                                            <div className="ml-4">{(getTotal().total * 0.09).toFixed(2)}</div>
                                            <div className="ml-4">{(getTotal().total * 0.09).toFixed(2)}</div>
                                            <div className="h-2"></div>
                                        </td>
                                    </tr> */}
                                    <tr className="">
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                                            <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                            {/* <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{((getTotal().totalGst)/2).toFixed(2)}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{((getTotal().totalGst)/2).toFixed(2)}</td> */}
                                            {/* <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{(getTotal().totalGst).toFixed(2)}</td>  */}
                                            <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{getTotal().total.toFixed(2)}</td>
                                        </tr>
                                    <tr className="border-none">
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        {/* <td></td> */}
                                        <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                                            <div>Total Tax(GST):</div>
                                            <div>Round Off:</div>
                                            <div>Total:</div>
                                        </td>

                                        <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                                            <div className="ml-4">{(getTotal().totalGst).toFixed(2)}</div>
                                           <div className="ml-4">- {((getTotal().totalAmt).toFixed(2) - (Math.floor(getTotal().totalAmt)).toFixed(2)).toFixed(2)}</div>
                                           <div className="ml-4">{(Math.floor(getTotal().totalAmt)).toFixed(2)}</div>
                                        </td>

                                    </tr>
                                    {/*
                                    <tr className="border-none">
                                        <td colSpan={6}>
                                            <div className="text-gray-400 text-sm py-2">Note</div>
                                            <div className="text-sm text-gray-900">Above Sheet to be used of Jindal or Tata</div>

                                            <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                            <div className="text-sm text-gray-900">{orderData?.advance}% advance {orderData?.advance === "100" ? "" : `and remaining ${100 - orderData?.advance}% on material readiness before delivery of material to site`}</div>

                                            <img src={Seal} className="w-24 h-24" />
                                            <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                                        </td>
                                    </tr> */}
                                    <tr className="end-of-page page-break-inside-avoid" >
                                       <td colSpan={6}>
                                         <div className="text-gray-400 text-sm py-2">Note</div>
                                         <div className="text-sm text-gray-900">Above Sheet to be used of Jindal or Tata</div>
                     
                                         <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                         <div className="text-sm text-gray-900">
                                           {orderData?.advance}% advance {orderData?.advance === "100" ? "" : `and remaining ${100 - orderData?.advance}% on material readiness before delivery of material to site`}
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
                                                    <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
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
                                                <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Flipspace’s prior written consent.</li>
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
            {/* <button onClick={handlePrint} className="m-8 p-2 bg-blue-500 text-white">Print</button> */}
        </>
    )
}