// import { useState, useEffect } from "react"
// import { Input } from "@/components/ui/input"
// import { FileArgs, useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk"
// import {
//     SheetClose
// } from "@/components/ui/sheet"
// import { Button } from "../ui/button";
// import { TailSpin } from "react-loader-spinner";


// interface Category {
//     name: string;
// }

// export default function QuotationForm({ vendor_id, pr_id }) {

//     const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
//         {
//             fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time'],
//             filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
//             limit: 1000
//         });
//     const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
//         {
//             fields: ['name', 'vendor_name', 'vendor_address'],
//             limit: 1000
//         });
//     const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
//         {
//             fields: ['name', 'item_name', 'unit_name'],
//             limit: 1000
//         });
//     const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
//         {
//             fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
//             limit: 1000
//         });
//     const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
//         {
//             fields: ['name', 'address_title', 'address_line1', 'city', 'state', 'pincode']
//         });
//     const { data: is_present,mutate: is_present_mutate } = useFrappeGetDocList("PR Attachments",
//         {
//             filters: [["procurement_request", "=", pr_id], ["vendor", "=", vendor_id]]
//         });

//     const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
//     const [quotationData, setQuotationData] = useState({
//         list: []
//     });
//     const [deliveryTime, setDeliveryTime] = useState<number>()
//     useEffect(() => {
//         const cats = categories.list
//         quotation_request_list?.map((item) => {
//             const categoryExists = cats.some(category => category.name === item.category);
//             if (!categoryExists) {
//                 cats.push({ name: item.category })
//             }
//         })
//         setCategories({
//             list: cats
//         })
//     }, [quotation_request_list]);

//     useEffect(() => {
//         if (quotation_request_list) {
//             setDeliveryTime(quotation_request_list[0].lead_time)
//         }
//     }, [quotation_request_list]);

//     const getItem = (item: string) => {
//         const item_name = item_list?.find(value => value.name === item).item_name;
//         return item_name
//     }
//     const getUnit = (item: string) => {
//         const item_unit = item_list?.find(value => value.name === item).unit_name;
//         return item_unit
//     }
//     const getQuantity = (item: string) => {
//         const procurement_list = procurement_request_list?.find(value => value.name === pr_id)?.procurement_list;
//         const quantity = procurement_list?.list.find(value => value.name === item)?.quantity
//         return quantity
//     }
//     const handlePriceChange = (item: string, value: number) => {
//         const new_qrid = quotation_request_list?.find(q => q.item === item)?.name;
//         const existingIndex = quotationData.list.findIndex(q => q.qr_id === new_qrid);
//         const newList = [...quotationData.list];

//         if (existingIndex !== -1) {
//             newList[existingIndex] = {
//                 ...newList[existingIndex],
//                 price: value
//             };
//         } else {
//             newList.push({
//                 qr_id: new_qrid,
//                 price: value
//             });
//         }
//         setQuotationData(prevState => ({
//             ...prevState,
//             list: newList
//         }));
//     };
//     const { createDoc: createDoc, loading: create_loading, isCompleted: create_submit_complete, error: create_submit_error } = useFrappeCreateDoc()
//     const { updateDoc: updateDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

//     const vendor_name = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_name;
//     const vendor_address = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_address;
//     const doc = address_list?.find(item => item.name == vendor_address);
//     const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`

//     const [selectedFile, setSelectedFile] = useState(null);
//     const handleFileChange = (event) => {
//         setSelectedFile(event.target.files[0]);
//         console.log(event.target.files[0])
//         };
//     const { upload: upload, loading: upload_loading, isCompleted: upload_complete, error: upload_error } = useFrappeFileUpload()
//     const { call, error: call_error } = useFrappePostCall('frappe.client.set_value')


//     const handleSubmit = () => {
//         quotationData.list.map((item) => {
//             updateDoc('Quotation Requests', item.qr_id, {
//                 lead_time: deliveryTime,
//                 quote: item.price
//             })
//                 .then(() => {
//                     console.log("item", item)
//                 }).catch(() => {
//                     console.log(submit_error)
//                 })
//         })

//         if(selectedFile){
//         createDoc("PR Attachments",{
//             procurement_request: pr_id,
//             vendor: vendor_id
//         })
//         .then((doc)=>{
//             is_present_mutate()
//             const fileArgs = {
//                 doctype: "PR Attachments",
//                 docname: doc.name,
//                 fieldname : "rfq_pdf",
//                 isPrivate: true
//               };
    
//             upload(selectedFile, fileArgs)
//                 .then((d) => {
//                     console.log("done",d)
//                     is_present_mutate()
//                         call({
//                             doctype: 'PR Attachments',
//                             name: doc.name,
//                             fieldname: 'rfq_pdf',
//                             value: d.file_url
//                         }).then(() => {
//                             console.log("done")
//                             const btn = document.getElementById("save-button")
//                             btn?.click()
//                             setSelectedFile(null)
//                         }).catch(() => {
//                             console.log("error",call_error)
//                         })

//                 }).catch(() => {
//                     console.log(upload_error)
//                 })
//             is_present_mutate()

//         })}
//         else{
//             const btn = document.getElementById("save-button")
//             btn?.click()
//         }
//     }

//     return (
//         <div>
//             <div className="font-bold text-black text-lg">{vendor_name}</div>
//             <div className="text-gray-500 text-sm">{address}</div>
//             <div className="flex justify-between py-4">
//                 <div className="w-[48%]">
//                     <div className="text-gray-500 text-sm">Attach File {is_present?.length>0 && <span className="font-bold">(Already Uploaded)</span>}</div>
//                     <Input type="file" disabled={is_present?.length>0 ? true : false} onChange={handleFileChange} />
//                 </div>
//                 <div className="w-[48%]">
//                     <div className="flex justify-between">
//                         <div className="text-gray-500 text-sm">Delivery Time (Days)</div>
//                         <div className="pt-1 text-gray-500 text-xs">*Required</div>
//                     </div>
//                     <Input type="number" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} />
//                 </div>
//             </div>
//             <div className="flex text-gray-500 space-x-2 pt-4 pb-2">
//                 <div className="w-1/2 flex-shrink-0">
//                     <div>Added Item</div>
//                 </div>
//                 <div className="flex-1">
//                     <div>UOM</div>
//                 </div>
//                 <div className="flex-1">
//                     <div>Qty</div>
//                 </div>
//                 <div className="flex-1">
//                     <div>Rate</div>
//                 </div>
//             </div>
//             {categories.list.map((cat) => {
//                 return <div>
//                     <div className="p-2 text-xl font-bold">{cat.name}</div>
//                     {quotation_request_list?.map((q) => {
//                         if (q.category === cat.name && q.vendor === vendor_id) {
//                             return <div className="flex space-x-2">
//                                 <div className="mt-2 pl-5 w-1/2 text-black flex-shrink-0">
//                                     <div>{getItem(q.item)}</div>
//                                 </div>
//                                 <div className="flex-1 p-1">
//                                     <Input type="text" disabled={true} placeholder={getUnit(q.item)} />
//                                 </div>
//                                 <div className="flex-1">
//                                     <Input type="text" disabled={true} placeholder={getQuantity(q.item)} />
//                                 </div>
//                                 <div className="flex-1">
//                                     <Input type="number" placeholder={q.quote} onChange={(e) => handlePriceChange(q.item, e.target.value)} />
//                                 </div>
//                             </div>
//                         }
//                     })}
//                 </div>
//             })}
//             <div className="flex flex-col justify-end items-end bottom-4 right-4 pt-10">
//                 {(upload_loading || create_loading || loading) ?
//                     <TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />
//                     :
//                     <Button onClick={handleSubmit}>
//                         Save
//                     </Button>}
//                 <SheetClose><Button id="save-button" className="invisible"></Button></SheetClose>
//             </div>
//         </div>
//     )
// }







// ************************************ Made the above code more efficient *********************************************************

import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
    useFrappeCreateDoc,
    useFrappeFileUpload,
    useFrappeGetDocList,
    useFrappePostCall,
    useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { SheetClose } from "@/components/ui/sheet";
import { Button } from "../ui/button";
import { TailSpin } from "react-loader-spinner";

interface Category {
    name: string;
}

export default function QuotationForm({ vendor_id, pr_id }) {
    const { data: quotationRequestList, isLoading: isQuotationLoading } = useFrappeGetDocList("Quotation Requests", {
        fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time'],
        filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
        limit: 1000
    });
    const { data: vendorList } = useFrappeGetDocList("Vendors", {
        fields: ['name', 'vendor_name', 'vendor_address'],
        limit: 1000
    });
    const { data: itemList } = useFrappeGetDocList("Items", {
        fields: ['name', 'item_name', 'unit_name'],
        limit: 1000
    });
    const { data: procurementRequestList } = useFrappeGetDocList("Procurement Requests", {
        fields: ['name', 'procurement_list'],
        limit: 1000
    });
    const { data: addressList } = useFrappeGetDocList("Address", {
        fields: ['name', 'address_line1', 'address_line2', 'city', 'state', 'pincode']
    });
    const { data: isPresent, mutate: isPresentMutate } = useFrappeGetDocList("PR Attachments", {
        filters: [["procurement_request", "=", pr_id], ["vendor", "=", vendor_id]]
    });

    const [categories, setCategories] = useState<Category[]>([]);
    const [quotationData, setQuotationData] = useState<{ qr_id: string, price: number }[]>([]);
    const [deliveryTime, setDeliveryTime] = useState<number | undefined>();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    useEffect(() => {
        if (quotationRequestList) {
            const newCategories = [...new Set(quotationRequestList.map(q => q.category))];
            setCategories(newCategories.map(cat => ({ name: cat })));
        }
    }, [quotationRequestList]);

    useEffect(() => {
        if (quotationRequestList && quotationRequestList.length > 0) {
            setDeliveryTime(quotationRequestList[0].lead_time);
        }
    }, [quotationRequestList]);

    const getItem = (item: string) => itemList?.find(value => value.name === item)?.item_name;
    const getUnit = (item: string) => itemList?.find(value => value.name === item)?.unit_name;
    const getQuantity = (item: string) => {
        const procurementList = procurementRequestList?.find(value => value.name === pr_id)?.procurement_list;
        return procurementList?.list.find(value => value.name === item)?.quantity;
    }

    const handlePriceChange = (item: string, value: number) => {
        setQuotationData(prevData => {
            const index = prevData.findIndex(d => d.qr_id === item);
            const updatedList = [...prevData];
            if (index !== -1) {
                updatedList[index].price = value;
            } else {
                updatedList.push({ qr_id: item, price: value });
            }
            return updatedList;
        });
    };

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call } = useFrappePostCall('frappe.client.set_value');

    const vendor = vendorList?.find(v => v.name === vendor_id);
    const address = useMemo(() => {
        if (vendor) {
            const addressDoc = addressList?.find(a => a.name === vendor.vendor_address);
            return addressDoc ? `${addressDoc.address_line1}, ${addressDoc.address_line2}, ${addressDoc.city}, ${addressDoc.state}-${addressDoc.pincode}` : '';
        }
        return '';
    }, [vendor, addressList]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            setSelectedFile(event.target.files[0]);
        }
    };

    const handleSubmit = async () => {
        // Update quotations
        await Promise.all(quotationData.map(async item => {
            try {
                await updateDoc('Quotation Requests', item.qr_id, {
                    lead_time: deliveryTime,
                    quote: item.price
                });
            } catch (error) {
                console.error("Error updating quotation:", error);
            }
        }));

        // Handle file upload if any
        if (selectedFile) {
            try {
                const doc = await createDoc("PR Attachments", {
                    procurement_request: pr_id,
                    vendor: vendor_id
                });
                const fileArgs = {
                    doctype: "PR Attachments",
                    docname: doc.name,
                    fieldname: "rfq_pdf",
                    isPrivate: true
                };
                const uploadResult = await upload(selectedFile, fileArgs);
                await call({
                    doctype: 'PR Attachments',
                    name: doc.name,
                    fieldname: 'rfq_pdf',
                    value: uploadResult.file_url
                });
                isPresentMutate();
            } catch (error) {
                console.error("Error handling file upload:", error);
            }
        }

        // Trigger save button click
        document.getElementById("save-button")?.click();
        setSelectedFile(null);
    };

    return (
        <div>
            <div className="font-bold text-black text-lg">{vendor?.vendor_name}</div>
            <div className="text-gray-500 text-sm">{address}</div>
            <div className="flex justify-between py-4">
                <div className="w-[48%]">
                    <div className="text-gray-500 text-sm">
                        Attach File {isPresent?.length > 0 && <span className="font-bold">(Already Uploaded)</span>}
                    </div>
                    <Input type="file" disabled={isPresent?.length > 0} onChange={handleFileChange} />
                </div>
                <div className="w-[48%]">
                    <div className="flex justify-between">
                        <div className="text-gray-500 text-sm">Delivery Time (Days)</div>
                        <div className="pt-1 text-gray-500 text-xs">*Required</div>
                    </div>
                    <Input type="number" value={deliveryTime} onChange={(e) => setDeliveryTime(Number(e.target.value))} />
                </div>
            </div>
            <div className="flex text-gray-500 space-x-2 pt-4 pb-2">
                <div className="w-1/2 flex-shrink-0">Added Item</div>
                <div className="flex-1">UOM</div>
                <div className="flex-1">Qty</div>
                <div className="flex-1">Rate</div>
            </div>
            {categories.map(cat => (
                <div key={cat.name}>
                    <div className="p-2 text-xl font-bold">{cat.name}</div>
                    {quotationRequestList?.filter(q => q.category === cat.name && q.vendor === vendor_id).map(q => (
                        <div key={q.name} className="flex space-x-2">
                            <div className="mt-2 pl-5 w-1/2 text-black flex-shrink-0">{getItem(q.item)}</div>
                            <div className="flex-1 p-1">
                                <Input type="text" disabled={true} placeholder={getUnit(q.item)} />
                            </div>
                            <div className="flex-1">
                                <Input type="text" disabled={true} placeholder={getQuantity(q.item)} />
                            </div>
                            <div className="flex-1">
                                <Input type="number" placeholder={q.quote} onChange={(e) => handlePriceChange(q.item, Number(e.target.value))} />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
            <div className="flex flex-col justify-end items-end bottom-4 right-4 pt-10">
                {(uploadLoading || createLoading || updateLoading) ? (
                    <TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" />
                ) : (
                    <Button onClick={handleSubmit}>Save</Button>
                )}
                <SheetClose><Button id="save-button" className="invisible" /></SheetClose>
            </div>
        </div>
    );
}
