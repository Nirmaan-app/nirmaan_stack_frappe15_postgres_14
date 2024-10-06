import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import {  useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk"
import {
    SheetClose
} from "@/components/ui/sheet"
import { Button } from "../ui/button";
import { TailSpin } from "react-loader-spinner";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { ListChecks, MessageCircleMore, Paperclip } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { toast } from "../ui/use-toast";

interface Category {
    name: string;
}

export default function QuotationForm({ vendor_id, pr_id }) {

    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time'],
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
            limit: 10000
        });
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ["*"],
            limit: 1000
        },
        "Procurement Requests"
    );
    const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
        {
            fields: ['name', 'address_title', 'address_line1', 'address_line2', 'city', 'state', 'pincode'],
            limit: 1000
        });

    const { data: prAttachment, mutate: prAttachmentMutate } = useFrappeGetDocList("PR Attachments",

        {
            fields: ["*"],
            filters: [["procurement_request", "=", pr_id], ["vendor", "=", vendor_id]],
            limit: 1000
        });

    const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
    const [quotationData, setQuotationData] = useState({
        list: []
    });
    const [deliveryTime, setDeliveryTime] = useState<number | string | null>(null)

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

    useEffect(() => {
        if (quotation_request_list) {
            setDeliveryTime(quotation_request_list[0].lead_time)
        }
    }, [quotation_request_list]);

    const getItem = (item: string) => {
        let item_name;
        if (item_list) {
            item_name = item_list?.find(value => value.name === item)?.item_name;
        }
        return item_name
    }
    const getUnit = (item: string) => {
        let item_unit;
        if (item_list) {
            item_unit = item_list?.find(value => value.name === item)?.unit_name;
        }
        return item_unit
    }
    const getQuantity = (item: string) => {
        const procurement_list = procurement_request_list?.find(value => value.name === pr_id)?.procurement_list;
        const quantity = procurement_list?.list.find(value => value.name === item)?.quantity
        return quantity
    }

    const getComment = (item) => {
        const procurement_list = procurement_request_list?.find(value => value.name === pr_id)?.procurement_list.list
        return procurement_list?.find((i) => i.name === item)?.comment || ""
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
    const { createDoc: createDoc, loading: create_loading, isCompleted: create_submit_complete, error: create_submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

    const vendor_name = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_name;
    const vendor_address = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_address;
    const doc = address_list?.find(item => item.name == vendor_address);
    const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`

    const [selectedFile, setSelectedFile] = useState(null);

    const handleFileChange = (event) => {
        setSelectedFile(event.target.files[0]);
    };

    const { upload: upload, loading: upload_loading, isCompleted: upload_complete, error: upload_error } = useFrappeFileUpload()
    const { call, error: call_error } = useFrappePostCall('frappe.client.set_value')


    useEffect(() => {
        if(prAttachment && prAttachment.length) {
            const fileName = prAttachment[0]?.rfq_pdf?.split("/")[3]
            setSelectedFile(fileName)
        }
    }, [prAttachment])

    const {mutate} = useSWRConfig()
    const handleSubmit = async () => {
        try {
          // Update quotation requests for each item in the list.
          await Promise.all(
            quotationData.list.map(async (item) => {
              try {
                await updateDoc("Quotation Requests", item.qr_id, {
                  lead_time: deliveryTime,
                  quote: item.price,
                });
                mutate(`Quotations Requests,Procurement_task=${pr_id}`)
                toast({
                  title: "Success!",
                  description: `Quote(s) for ${vendor_name} updated successfully`,
                  variant: "success",
                });
              } catch (error) {
                console.error(`Error updating quotation request for ${item.qr_id}:`, error);
                toast({
                  title: "Failed!",
                  description: `There was an error while updating the Quote(s) for ${vendor_name}`,
                  variant: "destructive",
                });
              }
            })
          );
      
          // Handle file upload if a file is selected.
          if (selectedFile) {
            // Check if the selected file is an object (newly uploaded file) or a string (existing file).
            if (typeof selectedFile === "object" || (typeof selectedFile === "string" && selectedFile !== prAttachment[0]?.rfq_pdf.split("/")[3])) {
              let docId;
      
              // If a PR attachment for this vendor already exists, update the document. Otherwise, create a new document.
              if (prAttachment.length > 0) {
                docId = prAttachment[0].name;
              } else {
                const newDoc = await createDoc("PR Attachments", {
                  procurement_request: pr_id,
                  vendor: vendor_id,
                });
                docId = newDoc.name;
                await prAttachmentMutate();
              }
      
              // Upload the file and update the document's file URL.
              const fileArgs = {
                doctype: "PR Attachments",
                docname: docId,
                fieldname: "rfq_pdf",
                isPrivate: true,
              };
      
              const uploadedFile = await upload(selectedFile, fileArgs);
              await call({
                doctype: "PR Attachments",
                name: docId,
                fieldname: "rfq_pdf",
                value: uploadedFile.file_url,
              });
      
              console.log("File upload and document update successful");
              toast({
                title: "Success!",
                description: "File uploaded and updated successfully.",
                variant: "success",
              });
              await prAttachmentMutate();
            }
          }
      
          // Trigger the save button click if everything is completed successfully.
          const btn = document.getElementById("save-button");
          btn?.click();
        } catch (error) {
          console.error("Error during submission:", error);
          toast({
            title: "Submission Failed",
            description: "An error occurred while submitting the form. Please try again.",
            variant: "destructive",
          });
        } finally {
          // Clear the selected file after submission.
          setSelectedFile(null);
        }
      };
      

    // console.log("selectedFile", selectedFile, typeof(selectedFile))
    // console.log("prAttachment", prAttachment)

    return (
        <div className="max-w-screen-lg mx-auto p-4 max-sm:p-1">
      {/* Vendor Info Card */}
      <Card className="mb-6">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="text-xl font-semibold text-black">{vendor_name}</CardTitle>
          <div className="text-gray-500 text-sm">{address}</div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* <div>
              <label className="block text-sm font-medium text-gray-700">Attach File</label>
              <Input type="file" disabled={is_present?.length > 0} onChange={handleFileChange} />
            </div> */}
            <div className="flex flex-col gap-2">
                <div className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-2 mt-4 ${selectedFile && "opacity-50 cursor-not-allowed"}`}
                     onClick={() => document.getElementById("file-upload")?.click()}
                >
                    <Paperclip size="15px" />
                    <span className="p-0 text-sm">Attach</span>
                    <input
                        type="file"
                        id={`file-upload`}
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={selectedFile}
                    />
                </div>
                {(selectedFile) && (
                    <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                        <span className="text-sm">{typeof(selectedFile) === "object" ? selectedFile.name : selectedFile}</span>
                        <button
                            className="ml-1 text-red-500"
                            onClick={() => setSelectedFile(null)}
                        >
                            ✖
                        </button>
                    </div>
                )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Delivery Time (Days)<sup>*</sup></label>
              <Input type="number" value={deliveryTime || ""} onChange={(e) => setDeliveryTime(e.target.value !== "" ? Number(e.target.value) : null)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quotation Items */}
      {categories.list.map((cat, index) => (
        <Card key={index} className="mb-6">
          <CardHeader className="bg-gray-100 border-b">
            <CardTitle className="text-lg font-medium">Category: {cat.name}</CardTitle>
          </CardHeader>
          <CardContent className="max-sm:p-2">
            {quotation_request_list?.map((q) => (
              q.category === cat.name && q.vendor === vendor_id && (
                <div key={q.item} className="flex max-md:flex-col max-md:gap-2 items-center justify-between py-2 border-b last:border-none">
                  <div className="w-1/4 max-md:w-full font-semibold text-black inline items-baseline">
                  <span>{getItem(q.item)}</span>
                  {getComment(q.item) && (
                    <HoverCard>
                         <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-5 h-5 ml-1 inline-block" /></HoverCardTrigger>
                        <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg ml-56">
                            <div className="relative pb-4">
                                <span className="block">{getComment(q.item)}</span>
                                <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
                            </div>
                        </HoverCardContent>
                    </HoverCard>
                  )}
                  </div>
                  <div className="w-[70%] max-md:w-full flex gap-2">
                    <Input value={getUnit(q.item)} disabled />
                    <Input className="w-[24%]" value={getQuantity(q.item)} disabled />
                    <Input type="number" placeholder="Enter Price" defaultValue={q.quote} onChange={(e) => handlePriceChange(q.item, Number(e.target.value))} />
                  </div>
                </div>
              )
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Save Button */}
      <div className="flex justify-end">
        {(upload_loading || create_loading || update_loading) ? (
          <TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" />
        ) : (
          <Button onClick={handleSubmit} disabled={!deliveryTime} className="flex items-center gap-1">
            <ListChecks className="h-4 w-4" />
            Save</Button>
        )}
        <SheetClose><Button id="save-button" className="hidden"></Button></SheetClose>
      </div>
    </div>
    )
}







// ************************************ Made the above code more efficient *********************************************************

// import { useState, useEffect, useMemo } from "react";
// import { Input } from "@/components/ui/input";
// import {
//     useFrappeCreateDoc,
//     useFrappeFileUpload,
//     useFrappeGetDocList,
//     useFrappePostCall,
//     useFrappeUpdateDoc,
// } from "frappe-react-sdk";
// import { SheetClose } from "@/components/ui/sheet";
// import { Button } from "../ui/button";
// import { TailSpin } from "react-loader-spinner";

// interface Category {
//     name: string;
// }

// export default function QuotationForm({ vendor_id, pr_id }) {
//     const { data: quotationRequestList, isLoading: isQuotationLoading } = useFrappeGetDocList("Quotation Requests", {
//         fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time'],
//         filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
//         limit: 1000
//     });
//     const { data: vendorList } = useFrappeGetDocList("Vendors", {
//         fields: ['name', 'vendor_name', 'vendor_address'],
//         limit: 1000
//     });
//     const { data: itemList } = useFrappeGetDocList("Items", {
//         fields: ['name', 'item_name', 'unit_name'],
//         limit: 1000
//     });
//     const { data: procurementRequestList } = useFrappeGetDocList("Procurement Requests", {
//         fields: ['name', 'procurement_list'],
//         limit: 1000
//     });
//     const { data: addressList } = useFrappeGetDocList("Address", {
//         fields: ['name', 'address_line1', 'address_line2', 'city', 'state', 'pincode']
//     });
//     const { data: isPresent, mutate: isPresentMutate } = useFrappeGetDocList("PR Attachments", {
//         filters: [["procurement_request", "=", pr_id], ["vendor", "=", vendor_id]]
//     });

//     const [categories, setCategories] = useState<Category[]>([]);
//     const [quotationData, setQuotationData] = useState<{ qr_id: string, price: number }[]>([]);
//     const [deliveryTime, setDeliveryTime] = useState<number | undefined>();
//     const [selectedFile, setSelectedFile] = useState<File | null>(null);

//     useEffect(() => {
//         if (quotationRequestList) {
//             const newCategories = [...new Set(quotationRequestList.map(q => q.category))];
//             setCategories(newCategories.map(cat => ({ name: cat })));
//         }
//     }, [quotationRequestList]);

//     useEffect(() => {
//         if (quotationRequestList && quotationRequestList.length > 0) {
//             setDeliveryTime(quotationRequestList[0].lead_time);
//         }
//     }, [quotationRequestList]);

//     const getItem = (item: string) => itemList?.find(value => value.name === item)?.item_name;
//     const getUnit = (item: string) => itemList?.find(value => value.name === item)?.unit_name;
//     const getQuantity = (item: string) => {
//         const procurementList = procurementRequestList?.find(value => value.name === pr_id)?.procurement_list;
//         return procurementList?.list.find(value => value.name === item)?.quantity;
//     }

//     const handlePriceChange = (item: string, value: number) => {
//         setQuotationData(prevData => {
//             const index = prevData.findIndex(d => d.qr_id === item);
//             const updatedList = [...prevData];
//             if (index !== -1) {
//                 updatedList[index].price = value;
//             } else {
//                 updatedList.push({ qr_id: item, price: value });
//             }
//             return updatedList;
//         });
//     };
//     const { createDoc, loading: createLoading } = useFrappeCreateDoc();
//     const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
//     const { upload, loading: uploadLoading } = useFrappeFileUpload();
//     const { call } = useFrappePostCall('frappe.client.set_value');
//     const vendor = vendorList?.find(v => v.name === vendor_id);
//     const address = useMemo(() => {
//         if (vendor) {
//             const addressDoc = addressList?.find(a => a.name === vendor.vendor_address);
//             return addressDoc ? `${addressDoc.address_line1}, ${addressDoc.address_line2}, ${addressDoc.city}, ${addressDoc.state}-${addressDoc.pincode}` : '';
//         }
//         return '';
//     }, [vendor, addressList]);
//     const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
//         if (event.target.files) {
//             setSelectedFile(event.target.files[0]);
//         }
//     };
//     console.log("deliveryTime", deliveryTime)
//     console.log("rate", quotationData)
//     const handleSubmit = async () => {
//         // Update quotations
//         await Promise.all(quotationData.map(async item => {
//             try {
//                 await updateDoc('Quotation Requests', item.qr_id, {
//                     lead_time: deliveryTime,
//                     quote: item.price
//                 });
//             } catch (error) {
//                 console.error("Error updating quotation:", error);
//             }
//         }));
//         // Handle file upload if any
//         if (selectedFile) {
//             try {
//                 const doc = await createDoc("PR Attachments", {
//                     procurement_request: pr_id,
//                     vendor: vendor_id
//                 });
//                 const fileArgs = {
//                     doctype: "PR Attachments",
//                     docname: doc.name,
//                     fieldname: "rfq_pdf",
//                     isPrivate: true
//                 };
//                 const uploadResult = await upload(selectedFile, fileArgs);
//                 await call({
//                     doctype: 'PR Attachments',
//                     name: doc.name,
//                     fieldname: 'rfq_pdf',
//                     value: uploadResult.file_url
//                 });
//                 isPresentMutate();
//             } catch (error) {
//                 console.error("Error handling file upload:", error);
//             }
//         }
//         // Trigger save button click
//         document.getElementById("save-button")?.click();
//         setSelectedFile(null);
//     };
//     return (
//         <div>
//             <div className="font-bold text-black text-lg">{vendor?.vendor_name}</div>
//             <div className="text-gray-500 text-sm">{address}</div>
//             <div className="flex justify-between py-4">
//                 <div className="w-[48%]">
//                     <div className="text-gray-500 text-sm">
//                         Attach File {isPresent?.length > 0 && <span className="font-bold">(Already Uploaded)</span>}
//                     </div>
//                     <Input type="file" disabled={isPresent?.length > 0} onChange={handleFileChange} />
//                 </div>
//                 <div className="w-[48%]">
//                     <div className="flex justify-between">
//                         <div className="text-gray-500 text-sm">Delivery Time (Days)</div>
//                         <div className="pt-1 text-gray-500 text-xs">*Required</div>
//                     </div>
//                     <Input type="number" value={deliveryTime} onChange={(e) => setDeliveryTime(Number(e.target.value))} />
//                 </div>
//             </div>
//             <div className="flex text-gray-500 space-x-2 pt-4 pb-2">
//                 <div className="w-1/2 flex-shrink-0">Added Item</div>
//                 <div className="flex-1">UOM</div>
//                 <div className="flex-1">Qty</div>
//                 <div className="flex-1">Rate</div>
//             </div>
//             {categories.map(cat => (
//                 <div key={cat.name}>
//                     <div className="p-2 text-xl font-bold">{cat.name}</div>
//                     {quotationRequestList?.filter(q => q.category === cat.name && q.vendor === vendor_id).map(q => (
//                         <div key={q.name} className="flex space-x-2">
//                             <div className="mt-2 pl-5 w-1/2 text-black flex-shrink-0">{getItem(q.item)}</div>
//                             <div className="flex-1 p-1">
//                                 <Input type="text" disabled={true} placeholder={getUnit(q.item)} />
//                             </div>
//                             <div className="flex-1">
//                                 <Input type="text" disabled={true} placeholder={getQuantity(q.item)} />
//                             </div>
//                             <div className="flex-1">
//                                 <Input type="number" placeholder={q.quote} onChange={(e) => handlePriceChange(q.item, Number(e.target.value))} />
//                             </div>
//                         </div>
//                     ))}
//                 </div>
//             ))}
//             <div className="flex flex-col justify-end items-end bottom-4 right-4 pt-10">
//                 {(uploadLoading || createLoading || updateLoading) ? (
//                     <TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" />
//                 ) : (
//                     <Button onClick={handleSubmit}>Save</Button>
//                 )}
//                 <SheetClose><Button id="save-button" className="invisible" /></SheetClose>
//             </div>
//         </div>
//     );
// }
