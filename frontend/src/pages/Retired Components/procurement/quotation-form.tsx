import { Input } from "@/components/ui/input";
import {
  SheetClose
} from "@/components/ui/sheet";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { ListChecks, MessageCircleMore, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import ReactSelect, { components } from 'react-select';
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card";
import { Label } from "../../../components/ui/label";
import { toast } from "../../../components/ui/use-toast";

interface Category {
  name: string;
}

export default function QuotationForm({ vendor_id, pr_id }) {

  const { data: quotation_request_list, isLoading: quotation_request_list_loading, mutate: quotation_request_list_mutate } = useFrappeGetDocList("Quotation Requests",
    {
      fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time', 'quantity', "makes"],
      filters: [["procurement_task", "=", pr_id], ["vendor", "=", vendor_id]],
      orderBy: { field: "creation", order: "desc" },
      limit: 1000
    });

  const { data: vendor_list } = useFrappeGetDocList("Vendors",
    {
      fields: ['name', 'vendor_name', 'vendor_address', 'vendor_type'],
      filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
      limit: 1000
    });
  const { data: item_list } = useFrappeGetDocList("Items",
    {
      fields: ['name', 'item_name', 'unit_name'],
      limit: 100000
    });
  const { data: procurement_request_list, isLoading: procurement_request_list_loading } = useFrappeGetDocList("Procurement Requests",
    {
      fields: ["*"],
      limit: 10000
    },
    "Procurement Requests"
  );
  const { data: address_list } = useFrappeGetDocList("Address",
    {
      fields: ['name', 'address_title', 'address_line1', 'address_line2', 'city', 'state', 'pincode'],
      limit: 100000
    });

  const { data: prAttachment, mutate: prAttachmentMutate, isLoading: prAttachmentLoading } = useFrappeGetDocList("PR Attachments",

    {
      fields: ["*"],
      filters: [["procurement_request", "=", pr_id], ["vendor", "=", vendor_id]],
      limit: 100000
    });

  const [categories, setCategories] = useState<{ list: Category[] }>({ list: [] });
  const [quotationData, setQuotationData] = useState({
    list: []
  });
  const [deliveryTime, setDeliveryTime] = useState<number | string | null>(null)

  const [mandatoryMakesQs, setMandatoryMakesQs] = useState([])

  const [saveEnabled, setSaveEnabled] = useState(false)

  useEffect(() => {
    if (procurement_request_list) {
      const cats = []
      const pr = procurement_request_list?.find(i => i.name === pr_id)
      quotation_request_list?.map((item) => {
        const categoryExists = cats.some(category => category.name === item.category);
        if (!categoryExists) {
          const makes = pr?.category_list?.list?.find(i => i?.name === item?.category)?.makes || [];
          cats.push({ name: item.category, makes: makes })
        }
      })
      setCategories({
        list: cats
      })
    }

    const mandatoryMakes = quotation_request_list?.map(item => (item?.makes?.list?.length > 0 && item?.makes?.list?.every(j => j?.enabled === "false")) && item?.name)?.filter(i => !!i) || []
    setMandatoryMakesQs(mandatoryMakes)

  }, [quotation_request_list, procurement_request_list]);

  useEffect(() => {
    const filteredMandatoryMakes = quotationData?.list?.filter(i => mandatoryMakesQs.includes(i?.qr_id))
    const allMakesChanged = filteredMandatoryMakes?.every(i => {
      if (i?.price !== undefined && i?.makes !== undefined) {
        return true
      } else if (i?.price === undefined && i?.makes !== undefined) {
        return true
      } else if (i?.price !== undefined && i?.makes === undefined) {
        return false
      }
      return false
    })

    setSaveEnabled(allMakesChanged)

  }, [quotationData, mandatoryMakesQs]);

  useEffect(() => {
    if (quotation_request_list && !deliveryTime) {
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
  // const getQuantity = (item: string) => {
  //     const procurement_list = procurement_request_list?.find(value => value.name === pr_id)?.procurement_list;
  //     const quantity = procurement_list?.list.find(value => value.name === item)?.quantity
  //     return quantity
  // }

  const getComment = (item) => {
    const procurement_list = procurement_request_list?.find(value => value.name === pr_id)?.procurement_list.list
    return procurement_list?.find((i) => i.name === item)?.comment || ""
  }

  const handlePriceChange = (new_qrid: string, value: number) => {
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
    setQuotationData({ list: newList });
  };

  const handleMakeChange = (new_qrid, makes, make) => {
    // Create a copy of the existing list
    // const newList = [...makeChanges];
    const newList = [...quotationData.list];

    // Find the index of the existing QR ID in the list
    // const existingIndex = newList.findIndex((q) => q.qr_id === new_qrid);
    const existingIndex = quotationData.list.findIndex(q => q.qr_id === new_qrid);

    if (existingIndex !== -1) {
      // const makeIndex = existingMakes.findIndex((m) => m.make === make);

      // if (makeIndex !== -1) {
      // existingMakes[makeIndex].enabled = "true";
      // } else {
      //   existingMakes.push({ make, enabled: checked ? "true" : "false" });
      // }

      const filteredMakes = makes?.map(m => m?.make === make ? { make, enabled: "true" } : { make: m?.make, enabled: "false" });

      newList[existingIndex] = {
        ...newList[existingIndex],
        makes: filteredMakes,
      };
    } else {
      const updatedMakes = makes?.map((m) =>
        m.make === make ? { make, enabled: "true" } : { make: m?.make, enabled: "false" }
      );

      newList.push({
        qr_id: new_qrid,
        makes: updatedMakes,
      });
    }

    setQuotationData({ list: newList });
  };

  const { createDoc: createDoc, loading: create_loading } = useFrappeCreateDoc()
  const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()

  const vendor_name = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_name;
  const vendor_address = vendor_list?.find(vendor => vendor.name === vendor_id).vendor_address;
  const doc = address_list?.find(item => item.name == vendor_address);
  const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`

  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const { upload: upload, loading: upload_loading } = useFrappeFileUpload()
  const { call } = useFrappePostCall('frappe.client.set_value')


  useEffect(() => {
    if (prAttachment && prAttachment.length) {
      const url = prAttachment[0]?.rfq_pdf || ""
      const match = url.match(/file_name=([^&]+)/);
      const fileName = match ? match[1] : "selectedFile";
      setSelectedFile(fileName)
    }
  }, [prAttachment])

  const { mutate } = useSWRConfig()

  const handleSubmit = async () => {
    try {
      const batchSize = 10; // Number of items per batch
      const promises = [];

      for (let i = 0; i < quotationData.list.length; i += batchSize) {
        const batch = quotationData.list.slice(i, i + batchSize);
        promises.push(
          Promise.all(
            batch.map(async (item) => {
              if (item?.makes !== undefined && item?.price !== undefined) {
                await updateDoc("Quotation Requests", item.qr_id, {
                  lead_time: deliveryTime,
                  quote: !item.price ? null : item.price,
                  makes: { list: item?.makes }
                });
              } else if (item?.makes === undefined && item?.price !== undefined) {
                await updateDoc("Quotation Requests", item.qr_id, {
                  lead_time: deliveryTime,
                  quote: !item.price ? null : item.price,
                });
              } else {
                await updateDoc("Quotation Requests", item.qr_id, {
                  lead_time: deliveryTime,
                  makes: { list: item?.makes },
                });
              }
            })
          )
        );
      }

      // Wait for all the batches to complete.
      await Promise.all(promises);

      // Single success toast after all batches have completed.
      toast({
        title: "Success!",
        description: `All Quote(s) for ${vendor_name} have been updated successfully.`,
        variant: "success",
      });

      await quotation_request_list_mutate()
      // Call mutate only once after all updates.
      await mutate(`Quotations Requests,Procurement_task=${pr_id}`);

      // File upload logic remains unchanged.
      if (selectedFile) {
        if (
          typeof selectedFile === "object" ||
          (typeof selectedFile === "string" &&
            selectedFile !== prAttachment[0]?.rfq_pdf.split("/")[3])
        ) {
          let docId;

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

  if (quotation_request_list_loading || procurement_request_list_loading || prAttachmentLoading) {
    return <div>Loading...</div>
  }

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
                  <span className="text-sm">{typeof (selectedFile) === "object" ? selectedFile.name : selectedFile}</span>
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
            <CardTitle className="text-lg font-medium flex max-md:flex-col max-md:gap-1 md:items-center md:justify-between">
              <span>Category: {cat.name}</span>
              <div>
                {cat?.makes?.length > 0 ? (
                  <Badge className="text-xs">TDS ~    
                  {cat?.makes?.map((i, index, arr) => (
                    <i className="">{i}{index < arr.length - 1 && ", "}</i>
                  ))}</Badge>
                ) : ""}
              </div>
            </CardTitle>
          </CardHeader>
          {/* <CardContent className="max-sm:p-2">
            {quotation_request_list?.map((q) => (
              q.category === cat.name && q.vendor === vendor_id && (
                <div key={q.item} className="flex max-md:flex-col max-md:gap-2 items-center justify-between py-2 border-b last:border-none">
                  <div className="flex items-center max-md:justify-between">
                    <div className="w-1/2 font-semibold text-black inline items-baseline">
                      <span>{getItem(q.item)}</span>
                      {getComment(q.item) && (
                        <HoverCard>
                             <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-5 h-5 ml-1 inline-block" /></HoverCardTrigger>
                            <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                <div className="relative pb-4">
                                    <span className="block">{getComment(q.item)}</span>
                                    <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
                                </div>
                            </HoverCardContent>
                        </HoverCard>
                      )}
                    </div>
                  <div className="mx-1 px-1 text-xs shadow-sm text-gray-500 bg-gray-100 rounded-md py-1 flex items-center ">
                  {q?.makes?.list?.length > 0 ? (
                    <MakesSelection
                      q={q}
                      quotationData={quotationData}
                      handleMakeChange={handleMakeChange}
                    />
                  ) : <span>make(s) not specified!</span>}
                  </div>
                  </div>
                  <div className="w-[50%] max-md:w-full flex gap-2">
                    <Input value={getUnit(q.item)} disabled />
                    <Input className="w-[45%]" value={q?.quantity} disabled />
                    <Input type="number" placeholder="Enter Price" defaultValue={q?.quote} onChange={(e) => handlePriceChange(q.name, Number(e.target.value))} />
                  </div>
                </div>
              )
            ))}
          </CardContent> */}
          <CardContent className="max-sm:p-2 bg-gray-50 rounded-md">
            {quotation_request_list?.map(
              (q) =>
                q.category === cat.name &&
                q.vendor === vendor_id && (
                  <div
                    key={q.item}
                    className="flex flex-col gap-4 p-4 m-2 bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-shadow"
                  >
                    {/* Item and Comment Section */}
                    <div className="flex gap-4 items-start">
                      <div className="text-base font-semibold text-gray-800 flex-1">
                        <span>{getItem(q.item)}</span>
                        {getComment(q.item) && (
                          <HoverCard>
                            <HoverCardTrigger>
                              <MessageCircleMore className="text-blue-400 w-5 h-5 ml-2 inline-block cursor-pointer" />
                            </HoverCardTrigger>
                            <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-3 rounded-md shadow-lg">
                              <div className="relative pb-4">
                                <span className="block">{getComment(q.item)}</span>
                                <span className="text-xs absolute right-0 italic text-gray-400">
                                  - Comment by PL
                                </span>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        )}
                      </div>
                      <div className="text-sm flex-1">
                        {/* {q?.makes?.list?.length > 0 ? ( */}
                        <div className="flex flex-row">
                          <MakesSelection
                            q={q}
                            quotation_request_list_mutate={quotation_request_list_mutate}
                            quotationData={quotationData}
                            handleMakeChange={handleMakeChange}
                          />
                          {q?.makes?.list?.length > 0 ? <sup>*</sup> : null}
                        {/* ) : (
                          <span className="text-gray-500 bg-gray-100 rounded-md px-3 py-1 shadow-sm">Make(s) not specified!</span>
                        )} */}
                        </div>
                      </div>
                    </div>

                    {/* Input Section */}
                    <div className="flex  gap-4">
                      <div className="w-1/4">
                        <Input
                          value={getUnit(q.item)}
                          disabled
                          className="w-full text-gray-700 bg-gray-50 border-gray-300 focus:ring-2 focus:ring-blue-300 rounded-md"
                        />
                      </div>
                      <div className="w-1/4">
                        <Input
                          value={q?.quantity}
                          disabled
                          className="w-full text-gray-700 bg-gray-50 border-gray-300 focus:ring-2 focus:ring-blue-300 rounded-md"
                        />
                      </div>
                      <div className="w-1/2 flex flex-row">
                        <Input
                          type="number"
                          placeholder="Enter Price"
                          defaultValue={q?.quote}
                          onChange={(e) =>
                            handlePriceChange(q.name, Number(e.target.value))
                          }
                          className="w-full text-gray-700 border-gray-300 focus:ring-2 focus:ring-blue-300 rounded-md"
                        />
                        <sup>*</sup>
                      </div>
                    </div>
                  </div>
                )
            )}
          </CardContent>

        </Card>
      ))}

      {/* Save Button */}
      <div className="flex justify-end">
        {(upload_loading || create_loading || update_loading) ? (
          <TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" />
        ) : (
          <Button onClick={handleSubmit} disabled={!deliveryTime || !saveEnabled} className="flex items-center gap-1">
            <ListChecks className="h-4 w-4" />
            Save</Button>
        )}
        <SheetClose><Button id="save-button" className="hidden"></Button></SheetClose>
      </div>
    </div>
  )
}


// const MakesSelection = ({ q, quotationData, handleMakeChange }) => {
//   // Prepare options for React Select
//   const editMakeOptions = q?.makes?.list?.map((i) => ({
//     value: i?.make,
//     label: i?.make,
//   }));

//   // Get the selected make dynamically based on quotationData
//   const selectedMake = quotationData?.list
//     ?.find((j) => j?.qr_id === q?.name)
//     ?.makes?.find((m) => m?.enabled === "true");

//   const selectedMakefromq = q?.makes?.list?.find(m => m?.enabled === "true")

//   // React Select expects the value as an object
//   const selectedMakeValue = selectedMake
//     ? { value: selectedMake?.make, label: selectedMake?.make }
//     : selectedMakefromq ? { value: selectedMakefromq?.make, label: selectedMakefromq?.make } : null;

//   return (
//     <div className="w-full">
//       <ReactSelect
//         className="w-full"
//         placeholder="Select Make..."
//         value={selectedMakeValue}
//         options={editMakeOptions}
//         onChange={(selectedOption) =>
//           handleMakeChange(q?.name, q?.makes?.list, selectedOption?.value, true)
//         }
//       />
//     </div>
//   )
// };







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

const MakesSelection = ({ q, quotationData, handleMakeChange, quotation_request_list_mutate }) => {

  const [showAlert, setShowAlert] = useState(false);

  const [makeOptions, setMakeOptions] = useState([]);

  const [newSelectedMakes, setNewSelectedMakes] = useState([]);
  
  const {updateDoc, loading: updateLoading} = useFrappeUpdateDoc()

  const { data: categoryMakeList, isLoading: categoryMakeListLoading, mutate: categoryMakeListMutate } = useFrappeGetDocList("Category Makelist", {
    fields: ["*"],
    limit: 100000,
  })

  useEffect(() => {
    if (categoryMakeList?.length > 0) {
      const categoryMakes = categoryMakeList?.filter((i) => i?.category === q.category);
      const makeOptionsList = categoryMakes?.map((i) => ({ label: i?.make, value: i?.make })) || [];
      const filteredOptions = makeOptionsList?.filter(i => !q?.makes?.list?.some(j => j?.make === i?.value))
      setMakeOptions(filteredOptions)
    }

  }, [categoryMakeList, q, quotation_request_list_mutate])

  const toggleShowAlert = () => {
    setShowAlert((prevState) => !prevState);
  };

  const editMakeOptions = q?.makes?.list?.map((i) => ({
    value: i?.make,
    label: i?.make,
  }));

  const selectedMake = quotationData?.list
    ?.find((j) => j?.qr_id === q?.name)
    ?.makes?.find((m) => m?.enabled === "true");

  const selectedMakefromq = q?.makes?.list?.find((m) => m?.enabled === "true");

  const selectedMakeValue = selectedMake
    ? { value: selectedMake?.make, label: selectedMake?.make }
    : selectedMakefromq
    ? { value: selectedMakefromq?.make, label: selectedMakefromq?.make }
    : null;

  const handleSumbit = async () => {
    try {
      const reFormattedMakes = newSelectedMakes?.map(i => ({ make: i?.value, enabled: "false" }))

      const combinedMakes = [...q?.makes?.list, ...reFormattedMakes]

      await updateDoc("Quotation Requests", q?.name , {
        makes: {list : combinedMakes}
      })

      await quotation_request_list_mutate()

      setNewSelectedMakes([])

      toast({
        title: "Success!",
        description: `Makes updated successfully!`,
        variant: "success",
      });

      toggleShowAlert()
      
    } catch (error) {
      console.log("error while adding new makes to the item", error)
      toast({
        title: "Failed!",
        description: `Failed to update makes!`,
        variant: "destructive",
      });
    }
  }

  const CustomMenu = (props) => {
    const { MenuList } = components;

    return (
      <MenuList {...props}>
        {props.children}
        <div
          className="p-2 bg-gray-100 hover:bg-gray-200 text-center cursor-pointer"
          onClick={() => toggleShowAlert()}
        >
          <strong>Add New Make</strong>
        </div>
      </MenuList>
    );
  };

  return (
    <>
    <div className="w-full">
      <ReactSelect
        className="w-full"
        placeholder="Select Make..."
        value={selectedMakeValue}
        options={editMakeOptions}
        onChange={(selectedOption) => handleMakeChange(q?.name, q?.makes?.list, selectedOption?.value, true)}
        components={{ MenuList: CustomMenu }}
      />
    </div>

    <Dialog open={showAlert} onOpenChange={toggleShowAlert}>
      <DialogContent className="text-start">
        <DialogHeader>
          <DialogTitle>Add New Makes</DialogTitle>
        </DialogHeader>
        <DialogDescription>
        <div className="flex gap-1 flex-wrap mb-4">
          {editMakeOptions?.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold">Existing Makes for this item:</h2>
              <div className="flex gap-1 flex-wrap">
              {editMakeOptions?.map((i) => (
                <Badge>{i?.value}</Badge>
              ))}
              </div>
            </div>
          )}
        </div>
        <div className="mb-4">
          <Label>
            Select New Make
          </Label>
          {categoryMakeList && (
            <ReactSelect options={makeOptions} value={newSelectedMakes} isMulti onChange={(selectedOptions) => setNewSelectedMakes(selectedOptions)} />
          )}
        </div>
        <div className="flex justify-end gap-2 items-center">
          {updateLoading ? (
            <TailSpin color="red" height={30} width={30} />
          ) : (
            <>
            <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSumbit} disabled={!newSelectedMakes?.length} className="flex items-center gap-1">
            <ListChecks className="h-4 w-4" />
            Confirm
          </Button>
          </>
          )}
        </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
    </>
  );
};
