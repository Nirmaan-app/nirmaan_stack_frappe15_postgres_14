import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
    SheetClose
} from "@/components/ui/sheet"
import { Button } from "../ui/button";
import { ListChecks, MessageCircleMore, Paperclip } from "lucide-react";
import { toast } from "../ui/use-toast";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { TailSpin } from "react-loader-spinner";

interface Category {
    name: string;
}

export default function SentBackQuotationForm({ vendor_id, pr_id, sb_id }) {

    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ["*"],
            filters: [["name", "=", sb_id]],
            limit: 1000
        });
    const [orderData, setOrderData] = useState({
        project: '',
        category: ''
    })
    if (!orderData.project) {
        sent_back_list?.map(item => {
            if (item.name === sb_id) {
                setOrderData(item)
            }
        })
    }
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'lead_time', 'quote', 'item', 'category', 'vendor', 'procurement_task', 'quantity'],
            filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
            limit: 2000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ["*"],
            filters: [["vendor_type", "=", "Material"]],
            limit: 1000
        },
        "Vendors"
    );
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
    const [selectedFile, setSelectedFile] = useState(null);

    useEffect(() => {
      if(quotation_request_list && sent_back_list) {
        const cats = categories.list
        const sbCats = sent_back_list[0]?.category_list.list.map((item) => item.name)
        quotation_request_list.map((item) => {
            const categoryExists = cats.some(category => category.name === item.category );
            if (!categoryExists && (sbCats.includes(item.category))) {
                cats.push({ name: item.category })
            }
        })
        setCategories({
            list: cats
        })

        setDeliveryTime(quotation_request_list[0].lead_time)
      }
    }, [quotation_request_list, sent_back_list]);

    const getItem = (item: string) => {
        const item_name = item_list?.find(value => value.name === item).item_name;
        return item_name
    }
    const getUnit = (item: string) => {
        const item_unit = item_list?.find(value => value.name === item).unit_name;
        return item_unit
    }
    // const getQuantity = (item: string) => {
    //     const procurement_list = procurement_request_list?.find(value => value.name === pr_id).procurement_list;
    //     const quantity = procurement_list?.list.find(value => value.name === item).quantity
    //     return quantity
    // }

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

    // console.log("orderData", orderData)

    // console.log("quotation", quotation_request_list)

    // console.log("quotationData", quotationData)

    const handleDeliveryTimeChange = () => {
      if(orderData && quotation_request_list) {
        const filteredQuotationList = quotation_request_list?.filter((i) => orderData?.item_list?.list?.some((j) => j?.name === i?.item))
      
        const updatedList = filteredQuotationList.map(q => {
          const existingItem = quotationData.list.find(item => item.qr_id === q.name);
  
          // If the item already exists in quotationData, update its lead_time
          if (existingItem) {
              return {
                  ...existingItem
              };
          }
  
          // If the item is not in quotationData, add it with the new lead_time
          return {
              qr_id: q.name,
              price: parseFloat(q.quote),
          };
      });
  
      setQuotationData(prevState => ({
          ...prevState,
          list: updatedList,
      }));
      }
  };

  useEffect(() => {
    handleDeliveryTimeChange()
  }, [deliveryTime])

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

    const { createDoc: createDoc, loading: create_loading, isCompleted: create_submit_complete, error: create_submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: submit_complete, error: submit_error } = useFrappeUpdateDoc()

    const {mutate} = useSWRConfig()

    const handleSubmit = async () => {
        try {
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
              if (prAttachment && prAttachment?.length > 0) {
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

    const vendor_name = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_name;
    const vendor_address = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_address;
    const doc = address_list?.find(item => item.name == vendor_address);
    const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`

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
              <Input type="number"  value={deliveryTime || ""} onChange={(e) => setDeliveryTime(e.target.value !== "" ? Number(e.target.value) : null)} />
            </div>
          </div>
        </CardContent>
      </Card>

{categories.list.map((cat, index) => (
        <Card key={index} className="mb-6">
          <CardHeader className="bg-gray-100 border-b">
            <CardTitle className="text-lg font-medium">Category: {cat.name}</CardTitle>
          </CardHeader>
          <CardContent className="max-sm:p-2">
            {quotation_request_list?.map((q) => (
              (q.category === cat.name && q.vendor === vendor_id && orderData?.item_list?.list.some(item => item.name === q.item)) && (
                <div key={q.item} className="flex max-md:flex-col max-md:gap-2 items-center justify-between py-2 border-b last:border-none">
                  <div className="w-1/4 max-md:w-full font-semibold text-black inline items-baseline">
                  <span>{getItem(q.item)}</span>
                  {getComment(q.item) && (
                    <HoverCard>
                         <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-5 h-5 ml-1 inline-block" /></HoverCardTrigger>
                        <HoverCardContent className="max-w-[300px bg-gray-800 text-white p-2 rounded-md shadow-lg">
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
                    <Input className="w-[24%]" value={q?.quantity} disabled />
                    <Input type="number" placeholder="Enter Price" defaultValue={q.quote} onChange={(e) => handlePriceChange(q.item, Number(e.target.value))} />
                  </div>
                </div>
              )
            ))}
          </CardContent>
        </Card>
      ))}
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