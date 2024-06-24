import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import {
    SheetClose
} from "@/components/ui/sheet"
import { Button } from "../ui/button";


interface Category {
    name: string;
}

export default function SentBackQuotationForm({ cat, vendor_id, pr_id, sb_id }) {
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['owner', 'name', 'workflow_state', 'procurement_request', 'category', 'project_name', 'creation', 'item_list'],
            filters: [["name", "=", sb_id]],
            limit: 100
        });
    const [orderData, setOrderData] = useState({
        project_name: '',
        category: ''
    })
    if (!orderData.project_name) {
        sent_back_list?.map(item => {
            if (item.name === sb_id) {
                setOrderData(item)
            }
        })
    }
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'quote', 'project', 'item', 'category', 'vendor', 'procurement_task'],
            filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address'],
            limit: 1000
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name'],
            limit: 1000
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            limit: 100
        });
    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'city', 'state', 'pincode']
        });

    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
    const [quotationData, setQuotationData] = useState({
        list: []
    });
    const [deliveryTime, setDeliveryTime] = useState<number>()
    useEffect(() => {
        const cats = categories.list
        quotation_request_list?.map((item) => {
            const categoryExists = cats.some(category => category.name === item.category);
            if (!categoryExists) {
                cats.push({ name: item.category })
            }
        })
        setCategories({
            list: cats
        })
    }, [quotation_request_list]);

    const getItem = (item: string) => {
        const item_name = item_list?.find(value => value.name === item).item_name;
        return item_name
    }
    const getUnit = (item: string) => {
        const item_unit = item_list?.find(value => value.name === item).unit_name;
        return item_unit
    }
    const getQuantity = (item: string) => {
        const procurement_list = procurement_request_list?.find(value => value.name === pr_id).procurement_list;
        const quantity = procurement_list?.list.find(value => value.name === item).quantity
        return quantity
    }
    const handlePriceChange = (item: string, value: number) => {
        const new_qrid = quotation_request_list?.find(q => q.item === item)?.name;
        const existingIndex = quotationData.list.findIndex(q => q.qr_id === new_qrid);
        const newList = [...quotationData.list];

        if (existingIndex !== -1) {
            newList[existingIndex] = {
                ...newList[existingIndex],
                price: value
            };
        } else {
            newList.push({
                qr_id: new_qrid,
                price: value
            });
        }
        setQuotationData(prevState => ({
            ...prevState,
            list: newList
        }));
    };
    const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()
    const handleSubmit = () => {
        quotationData.list.map((item) => {
            updateDoc('Quotation Requests', item.qr_id, {
                lead_time: deliveryTime,
                quote: item.price
            })
                .then(() => {
                    console.log("item", item)
                }).catch(() => {
                    console.log(submit_error)
                })
        })
    }

    const vendor_name = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_name;
    const vendor_address = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_address;
    const doc = address_list?.find(item => item.name == vendor_address);
    const address = `${doc?.address_title}, ${doc?.address_line1}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
    const delivery_time = quotation_request_list?.find(item => item.vendor === vendor_id)?.lead_time

    return (
        <div>
            <div className="font-bold text-black text-lg">{vendor_name}</div>
            <div className="text-gray-500 text-sm">{address}</div>
            <div className="flex justify-between py-4">
                <div className="w-[48%]">
                    <div className="text-gray-500 text-sm">Attach File</div>
                    <Input />
                </div>
                <div className="w-[48%]">
                    <div className="flex justify-between">
                        <div className="text-gray-500 text-sm">Delivery Time (Days)</div>
                        <div className="pt-1 text-gray-500 text-xs">*Required</div>
                    </div>
                    <Input type="number" placeholder={delivery_time} value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} />
                </div>
            </div>
            <div className="flex text-gray-500 space-x-2 pt-4 pb-2">
                <div className="w-1/2 flex-shrink-0">
                    <div>Item</div>
                </div>
                <div className="flex-1">
                    <div>UOM</div>
                </div>
                <div className="flex-1">
                    <div>Qty</div>
                </div>
                <div className="flex-1">
                    <div>Rate</div>
                </div>
            </div>
            <div>
                <div>{cat}</div>
                {quotation_request_list?.map((q) => {
                    const isSelected = orderData.item_list?.list.some(item => item.name === q.item);
                    if (q.category === cat && q.vendor === vendor_id && isSelected) {
                        return <div className="flex space-x-2">
                            <div className="w-1/2 font-semibold text-black flex-shrink-0">
                                <div>{getItem(q.item)}</div>
                            </div>
                            <div className="flex-1">
                                <Input type="text" disabled={true} placeholder={getUnit(q.item)} />
                            </div>
                            <div className="flex-1">
                                <Input type="text" disabled={true} placeholder={getQuantity(q.item)} />
                            </div>
                            <div className="flex-1">
                                <Input type="number" placeholder={q.quote} onChange={(e) => handlePriceChange(q.item, e.target.value)} />
                            </div>
                        </div>
                    }
                })}
            </div>
            <div className="flex flex-col justify-end items-end bottom-4 right-4 pt-10">
                {deliveryTime ?
                    <SheetClose>
                        <Button onClick={() => handleSubmit()}>
                            Save
                        </Button>
                    </SheetClose>
                    :
                    <Button disabled={true}>
                        Save
                    </Button>}
            </div>
        </div>
    )
}