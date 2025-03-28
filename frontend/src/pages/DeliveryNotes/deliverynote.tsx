import { Badge } from '@/components/ui/badge';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDoc, useFrappePostCall, useFrappeUpdateDoc } from 'frappe-react-sdk';
import { ArrowDown, ArrowUp, Check, CheckCheck, ListChecks, MessageCircleMore, Paperclip, Pencil, Printer, Undo2 } from "lucide-react";
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
// import { z } from "zod";
import logo from "@/assets/logo-svg.svg";
import { AddressView } from '@/components/address-view';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useToast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { parseNumber } from '@/utils/parseNumber';
import { useReactToPrint } from 'react-to-print';
import Seal from "../../assets/NIRMAAN-SEAL.jpeg";


export default function DeliveryNote() {

  const location = useLocation()
  const { dnId: id } = useParams<{ dnId: string }>();
  const userData = useUserData();
  const deliveryNoteId = id?.replaceAll("&=", "/");
  const poId = deliveryNoteId?.replace("DN", "PO")
  const { data, isLoading, mutate: poMutate } = useFrappeGetDoc("Procurement Orders", poId, `Procurement Orders ${poId}`);
  const [order, setOrder] = useState(null);
  const [modifiedOrder, setModifiedOrder] = useState(null);
  // const [showAlert, setShowAlert] = useState(false);
  const { updateDoc } = useFrappeUpdateDoc();
  const { toast } = useToast();
  const navigate = useNavigate();
  // const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
  //   {
  //     fields: ["*"],
  //     limit: 10000
  //   },
  //   "Address"
  // );

  // const [projectAddress, setProjectAddress] = useState()
  // const [vendorAddress, setVendorAddress] = useState()
  const [show, setShow] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { call } = useFrappePostCall('frappe.client.set_value');
  const { createDoc } = useFrappeCreateDoc()
  const { upload } = useFrappeFileUpload()

  useEffect(() => {
    if (data) {
      const parsedOrder = JSON.parse(data.order_list);
      setOrder(parsedOrder);
      setModifiedOrder(parsedOrder);
    }
  }, [data]);

  // useEffect(() => {
  //   if (data?.project_address) {
  //     const doc = address_list?.find(item => item.name == data?.project_address);
  //     const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
  //     setProjectAddress(address)
  //     const doc2 = address_list?.find(item => item.name == data?.vendor_address);
  //     const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
  //     setVendorAddress(address2)
  //   }

  // }, [data, address_list]);

  // Handle change in received quantity
  const handleReceivedChange = (itemName: string, value: string) => {
    const parsedValue = parseNumber(value);
    setModifiedOrder(prevState => ({
      ...prevState,
      list: prevState.list.map(item =>
        item.item === itemName ? { ...item, received: parsedValue } : item
      )
    }));
  };

  // Handle save
  const handleSave = async () => {
    try {
      const allDelivered = modifiedOrder?.list?.every(item => item.received === item.quantity);

      const noValueItems = modifiedOrder?.list?.filter(item => !item.received || item.received === 0);

      if (noValueItems.length > 0) {
        document.getElementById("alertDialogOpen")?.click()
      } else {
        await updateDoc("Procurement Orders", poId, {
          order_list: JSON.stringify(modifiedOrder),
          status: allDelivered ? "Delivered" : "Partially Delivered",
        });

        if (selectedFile) {
          const doc = await createDoc("Delivery Note Attachments", {
            delivery_note: data?.name,
            project: data?.project,
          });

          const fileArgs = {
            doctype: "Delivery Note Attachments",
            docname: doc.name,
            fieldname: "image",
            isPrivate: true
          };

          const uploadResult = await upload(selectedFile, fileArgs);
          await call({
            doctype: "Delivery Note Attachments",
            name: doc.name,
            fieldname: "image",
            value: uploadResult.file_url
          });
          setSelectedFile(null)
        }

        await poMutate()
        setShow(false)
        toast({
          title: "Success!",
          description: `Delivery Note: ${poId.split('/')[1]} updated successfully`,
          variant: "success",
        });
      }

    } catch (error) {
      console.log("error while updating delivery note", error)
      toast({
        title: "Failed!",
        description: `Error while updating Delivery Note: ${poId.split('/')[1]}`,
        variant: "destructive",
      });
    }
  };

  const handleProceed = async () => {
    try {
      const allDelivered = modifiedOrder.list.every(item => item.received === item.quantity);
      const noValueItems = modifiedOrder.list.filter(item => !item.received || item.received === 0);
      const updatedOrder = {
        ...modifiedOrder,
        list: modifiedOrder.list.map(item =>
          noValueItems.includes(item) ? { ...item, received: 0 } : item
        ),
      };

      await updateDoc("Procurement Orders", poId, {
        order_list: JSON.stringify(updatedOrder),
        status: allDelivered ? "Delivered" : "Partially Delivered",
      });

      if (selectedFile) {
        const doc = await createDoc("Delivery Note Attachments", {
          delivery_note: data?.name,
          project: data?.project,
        });

        const fileArgs = {
          doctype: "Delivery Note Attachments",
          docname: doc.name,
          fieldname: "image",
          isPrivate: true
        };

        const uploadResult = await upload(selectedFile, fileArgs);
        await call({
          doctype: "Delivery Note Attachments",
          name: doc.name,
          fieldname: "image",
          value: uploadResult.file_url
        });
        setSelectedFile(null)
      }
      await poMutate()
      setShow(false)
      toast({
        title: "Success!",
        description: `Delivery Note: ${poId.split('/')[1]} updated successfully`,
        variant: "success",
      });
    } catch (error) {
      console.log("error while updating delivery note", error)
      toast({
        title: "Failed!",
        description: `Error while updating Delivery Note: ${poId.split('/')[1]}`,
        variant: "destructive",
      });
    }
  }

  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `${(data?.name)?.toUpperCase().replace("PO", "DN")}_${data?.vendor_name}`
  });

  const handleFileChange = (event : React.ChangeEvent<HTMLInputElement>) => {
    if(event.target.files && event.target.files.length > 0) {
      setSelectedFile(event.target.files[0]);
    }
  };

  if (isLoading) return <div>...loading</div>;

  return (
    <div className="container mx-auto px-0 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl max-md:text-xl font-bold ml-2">
          DN-{poId.split("/")[1]}
        </h1>
        <Button onClick={handlePrint} className="flex items-center gap-1">
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
              Order Details
            </CardTitle>
            <Badge
              variant={`${data?.status === "Dispatched" ? "orange" : "green"
                }`}
              className=""
            >
              {data?.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* <p>
            <strong>Project:</strong> {data?.project_name}
          </p> */}
          <p className="flex flex-row gap-2">
            <strong>Addr:</strong> <AddressView id={data?.project_address} />
          </p>
          <p className="flex flex-row gap-2">
            <strong>@PR:</strong>
            <span
              className="underline cursor-pointer"
              onClick={() =>
                navigate(location.pathname.includes("delivery-notes")
                ? `/prs&milestones/procurement-requests/${data?.procurement_request}`
                : -1)
              }
            >
              {data?.procurement_request}
            </span>
          </p>
          <p className="flex flex-row gap-2">
            <strong>@PO:</strong>
            <span
              className="underline cursor-pointer"
              onClick={() =>
                navigate(
                  location.pathname.includes("delivery-notes")
                    ? `/prs&milestones/procurement-requests/${data?.procurement_request
                    }/${data?.name.replaceAll("/", "&=")}`
                    : -1
                )
              }
            >
              {data?.name.replaceAll("&=", "/")}
            </span>
          </p>
        </CardContent>
        <CardHeader className="pb-2">
          <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
            Delivery Person Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex flex-row gap-3.5">
            <strong>Name:</strong> 
            {data?.delivery_contact==="" ? (
              <span>Not Provided</span>
              ) : (
              <span>{data?.delivery_contact?.split(":")[0]}</span>
            )}
          </p>
          <p className="flex flex-row gap-2">
            <strong>Mobile:</strong>
            {data?.delivery_contact==="" ? (
              <span>Not Provided</span>
              ) : (
              <span>{data?.delivery_contact?.split(":")[1]}</span>
            )} 
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl max-md:text-lg font-semibold text-red-600">
            Item List
          </CardTitle>
          {[
            "Nirmaan Project Manager Profile",
            "Nirmaan Admin Profile",
            "Nirmaan Project Lead Profile"
          ].includes(userData?.role) &&
            !show &&
            data?.status !== "Delivered" && (
              <Button
                onClick={() => setShow(true)}
                className="flex items-center gap-1"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
          {show && data?.status !== "Delivered" && (
            <div className="flex flex-col gap-2">
              <div
                className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-1 ${selectedFile && "opacity-50 cursor-not-allowed"
                  }`}
                onClick={() =>
                  document.getElementById("file-upload")?.click()
                }
              >
                <Paperclip size="15px" />
                <span className="p-0 text-sm">Attach</span>
                <input
                  type="file"
                  id={`file-upload`}
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={!!selectedFile}
                />
              </div>
              {selectedFile && (
                <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                  <span className="text-sm">
                    {typeof selectedFile === "object"
                      ? selectedFile.name
                      : selectedFile}
                  </span>
                  <button
                    className="ml-1 text-red-500"
                    onClick={() => setSelectedFile(null)}
                  >
                    ✖
                  </button>
                </div>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {show && (
            <div className="pl-2 transition-all duration-500 ease-in-out">
              <i className="text-sm text-gray-600">
                "Please Update the quantity received for delivered items"
              </i>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Item Name</TableHead>
                <TableHead className="font-bold">Unit</TableHead>
                <TableHead className="font-bold">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data &&
                order?.list.map((item) => (
                  <TableRow key={item.name}>
                    <TableCell>
                      <div className="inline items-baseline">
                        <span>{item.item}{item?.makes?.list?.length > 0 && (
  <span className="text-xs italic font-semibold text-gray-500">
    - {item.makes.list.find((i) => i?.enabled === "true")?.make || "no make specified"}
  </span>
)}</span>
                        {item.comment && (
                          <HoverCard>
                            <HoverCardTrigger>
                              <MessageCircleMore className="text-blue-400 w-4 h-4 inline-block ml-1" />
                            </HoverCardTrigger>
                            <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                              <div className="relative pb-4">
                                <span className="block">{item.comment}</span>
                                <span className="text-xs absolute right-0 italic text-gray-200">
                                  -Comment by PL
                                </span>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell>
                      {!show ? (
                        item.received === item.quantity ? (
                          <div className="flex gap-2">
                            <Check className="h-5 w-5 text-green-500" />
                            <span>{item.received}</span>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            {(item.received || 0) > item.quantity ? (
                              <ArrowUp className="text-primary" />
                            ) : (
                              <ArrowDown className="text-primary" />
                            )}
                            <span className="text-sm text-gray-600">
                              {item.received || 0}
                            </span>
                          </div>
                        )
                      ) : item.received !== item.quantity ? (
                        <div>
                          <Input
                            type="number"
                            value={
                              modifiedOrder?.list.find(
                                (mod) => mod.name === item.name
                              ).received || ""
                            }
                            onChange={(e) =>
                              handleReceivedChange(item.item, e.target.value)
                            }
                            placeholder={item?.quantity}
                          />
                          {/* <span className='text-sm font-light text-red-500'>{validateMessage[item.item]}</span> */}
                        </div>
                      ) : (
                        <Check className="h-5 w-5 text-green-500" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {data?.status !== "Delivered" && show && (
            <Button
              onClick={handleSave}
              variant={"default"}
              className="w-full mt-6 flex items-center gap-1"
            >
              <ListChecks className="h-4 w-4" />
              Update
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="hidden">
        <div ref={componentRef} className=" w-full p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-gray-200">
              <thead className="border-b border-black">
                <tr>
                  <th colSpan={8}>
                    <div className="flex justify-between border-gray-600 pb-1">
                      <div className="mt-2 flex justify-between">
                        <div>
                          <img
                            src={logo}
                            alt="Nirmaan"
                            width="180"
                            height="52"
                          />
                          <div className="pt-2 text-lg text-gray-500 font-semibold">
                            Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="pt-2 text-xl text-gray-600 font-semibold">
                          Delivery Note No.
                        </div>
                        <div className="text-lg font-semibold text-black">
                          {data?.name?.toUpperCase().replace("PO", "DN")}
                        </div>
                      </div>
                    </div>
                    <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                          <div className="text-xs text-gray-600 font-normal">
                            {data?.project_gst
                              ? data?.project_gst === "29ABFCS9095N1Z9"
                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                              : "Please set company GST number in order to display the Address!"}
                          </div>
                          <div className="text-xs text-gray-600 font-normal">
                            GST: {data?.project_gst || "N/A"}
                          </div>
                        </div>
                    <div className="flex justify-between">
                      <div>
                        <div className="text-gray-500 text-sm pb-2 text-left">
                          Vendor Address
                        </div>
                        <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">
                          {data?.vendor_name}
                        </div>
                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                          <AddressView id={data?.vendor_address}/>
                        </div>
                        <div className="text-sm font-medium text-gray-900 text-left">
                          GSTIN: {data?.vendor_gst}
                        </div>
                      </div>
                      <div>
                        <div>
                          <h3 className="text-gray-500 text-sm pb-2 text-left">
                            Delivery Location
                          </h3>
                          <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">
                            <AddressView id={data?.project_address}/>
                          </div>
                        </div>
                        <div className="pt-2">
                          <div className="text-sm font-normal text-gray-900 text-left">
                            <span className="text-gray-500 font-normal">
                              Date:
                            </span>
                            &nbsp;&nbsp;&nbsp;
                            <i>{data?.creation?.split(" ")[0]}</i>
                          </div>
                          <div className="text-sm font-normal text-gray-900 text-left">
                            <span className="text-gray-500 font-normal">
                              Project Name:
                            </span>
                            &nbsp;&nbsp;&nbsp;<i>{data?.project_name}</i>
                          </div>
                          <div className="text-sm font-normal text-gray-900 text-left">
                            <span className="text-gray-500 font-normal">
                              Against PO:
                            </span>
                            &nbsp;&nbsp;&nbsp;<i>{data?.name}</i>
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr className="border-t border-black">
                  <th
                    scope="col"
                    className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                  >
                    S. No.
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider pr-48"
                  >
                    Items
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-bold text-gray-800 tracking-wider"
                  >
                    Unit
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider"
                  >
                    Qty
                  </th>
                </tr>
              </thead>
              <tbody className={`bg-white`}>
                {order &&
                  JSON.parse(data.order_list)?.list?.map(
                    (item: any, index: number) => {
                      return (
                        <tr
                          key={index}
                          className={` page-break-inside-avoid ${index >= 14 ? "page-break-before" : ""
                            }`}
                        >
                          <td className="py-2 text-sm whitespace-nowrap w-[7%]">
                            {index + 1}.
                          </td>
                          <td className=" py-2 text-sm whitespace-nowrap text-wrap">
                            {item.item}
                            {item.comment && (
                              <div className="flex gap-1 items-start block p-1">
                                <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                <div className="text-xs text-gray-400">
                                  {item.comment}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.unit}
                          </td>
                          <td className="px-4 py-2 text-sm whitespace-nowrap">
                            {item.received || 0}
                          </td>
                        </tr>
                      );
                    }
                  )}
                <tr className="">
                  <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                  <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                    Total Quantity
                  </td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">
                    {data &&
                      JSON.parse(data.order_list)?.list?.reduce(
                        (acc, item) => acc + item.received || 0,
                        0
                      )}
                  </td>
                </tr>
                <tr className="end-of-page page-break-inside-avoid">
                  <td colSpan={6}>
                    {/* <div className="text-gray-400 text-sm py-2">Note</div>
                                        <div className="text-sm text-gray-900">PlaceHolder</div> */}
                    {/* 
                                             <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                             <div className="text-sm text-gray-900">
                                                 {orderData?.advance}% advance {orderData?.advance === "100" ? "" : `and remaining ${100 - orderData?.advance}% on material readiness before delivery of material to site`}
                                             </div> */}
                    <img src={Seal} className="w-24 h-24" />
                    <div className="text-sm text-gray-900 py-6">
                      For, Stratos Infra Technologies Pvt. Ltd.
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger>
          <Button className="hidden" id="alertDialogOpen">
            open
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              You have provided some items with 0 or no value, they will be
              marked as <span className="underline">'0 items received'</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="flex items-center gap-1">
              <Undo2 className="h-4 w-4" />
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleProceed()}
              className="flex items-center gap-1"
            >
              <CheckCheck className="h-4 w-4" />
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}