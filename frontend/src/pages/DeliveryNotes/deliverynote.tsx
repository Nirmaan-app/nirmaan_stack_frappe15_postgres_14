import { useEffect, useRef, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ArrowLeft, Check, X } from "lucide-react"
import {  useNavigate, useParams } from 'react-router-dom'
import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from 'frappe-react-sdk'
import { useToast } from '@/components/ui/use-toast'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Seal from "../../assets/NIRMAAN-SEAL.jpeg";
import redlogo from "@/assets/red-logo.png"
import { useReactToPrint } from 'react-to-print'

export default function DeliveryNote() {
  const { id } = useParams()
  const poId = id?.replaceAll("&=", "/")
  const { data, isLoading } = useFrappeGetDoc("Procurement Orders", poId, `Procurement Orders ${poId}`)
  const { data: address_list, isLoading: address_list_loading, error: address_list_error } = useFrappeGetDocList("Address",
    {
        fields: ["*"],
        limit: 1000
    },
    "Address"
);

  const [projectAddress, setProjectAddress] = useState()
  const [vendorAddress, setVendorAddress] = useState()
  const [order, setOrder] = useState(null)
  const [isChanged, setIsChanged] = useState(false)
  const [selectionState, setSelectionState] = useState({})
  const { updateDoc } = useFrappeUpdateDoc()
  const [page, setPage] = useState("Summary")
  const [partialItems, setPartialItems] = useState({})

  useEffect(() => {
    if (data) {
        const orderList = JSON.parse(data.order_list)
        const initialState = orderList?.list.reduce((acc, item) => {
            acc[item.item] = null
            return acc
          }, {})
          setSelectionState(initialState)
        const partial = {}
        orderList.list.map((item) => {
        if(item.received && initialState[item.item] === null && item.received !== item.quantity) {
            partial[item.item] = item.received
        }
      })
      setPartialItems(partial)
      setOrder(data)
    }
  }, [data])

//   console.log("partialItems", partialItems)

  useEffect(() => {
    if (order?.project_address) {
        const doc = address_list?.find(item => item.name == order?.project_address);
        const address = `${doc?.address_line1}, ${doc?.address_line2}, ${doc?.city}, ${doc?.state}-${doc?.pincode}`
        setProjectAddress(address)
        const doc2 = address_list?.find(item => item.name == order?.vendor_address);
        const address2 = `${doc2?.address_line1}, ${doc2?.address_line2}, ${doc2?.city}, ${doc2?.state}-${doc2?.pincode}`
        setVendorAddress(address2)
    }

}, [order, address_list]);

  const handleDeliveryStatus = (itemName, status) => {
    setSelectionState(prevState => ({
      ...prevState,
      [itemName]: status
    }))
    setIsChanged(true)
    setOrder(prevOrder => {
      const updatedItems = JSON.parse(prevOrder.order_list).list.map(item => {
        if (item.item === itemName) {
          return {
            ...item,
            received: status === true ? item.quantity : null
          }
        }
        return item
      })
      return { ...prevOrder, order_list: JSON.stringify({ list: updatedItems }) }
    })
  }
//   console.log("selection", selectionState)
//   console.log("order", order)

  const handleActualAmount = (itemName, amount) => {
    setOrder(prevOrder => {
      const updatedItems = JSON.parse(prevOrder.order_list).list.map(item => {
        if (item.item === itemName) {
          return {
            ...item,
            received: amount
          }
        }
        return item
      })
      setIsChanged(true)
      return { ...prevOrder, order_list: JSON.stringify({ list: updatedItems }) }
    })
  }

  const navigate = useNavigate()
  const { toast } = useToast()

  const handleSave = async () => {
    try {
      const allItems = JSON.parse(order.order_list).list
      const allDelivered = allItems.every(item => item.received === item.quantity)
      const status = allDelivered ? "Delivered" : "Partially Delivered"

      await updateDoc("Procurement Orders", poId, {
        order_list: order.order_list,
        status: status
      })

      setIsChanged(false)
      toast({
        title: "Success!",
        description: `Delivery Note for: ${poId.split("/")[1]} updated successfully!`,
        variant: "success"
      })
      setPage("Summary")
    } catch (error) {
      console.log("There was an error in updating the delivery note", error?.message)
      toast({
        title: "Failed!",
        description: `Failed to update Delivery Note: ${poId.split("/")[1]}`,
        variant: "destructive"
      })
    }
  }

    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${(order?.name)?.toUpperCase().replace("PO", "DN")}_${order?.vendor_name}`
    });

  if (isLoading) return <div>...loading</div>

  return (
    <>
{page === "Summary" && (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
    <div className='flex items-center justify-between'>
    <div className="flex items-center mb-4">
      <Button onClick={() => navigate("/delivery-notes")} variant="ghost" className="mr-2 p-2">
        <ArrowLeft className="h-6 w-6 text-red-600" />
        <span className="sr-only">Back</span>
      </Button>
      <h1 className="text-2xl font-bold text-red-600">Order Summary</h1>
    </div>
    <Button onClick={handlePrint} className='w-20'>Print</Button>
    </div>
    
    <Card className="mb-6">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-semibold text-red-600">Order Details</CardTitle>
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
              {order?.status}
            </Badge>
        </div>
      </CardHeader>
      <CardContent>
      <p><strong>Project:</strong> {order?.project_name}</p>
        <p><strong>Address:</strong> {order?.project_address}</p>
        <p><strong>PR:</strong> {order?.procurement_request}</p>
      </CardContent>
    </Card>
    
    <Card>
      <CardHeader className=''>
        <div className='flex items-center justify-between'>
        <CardTitle className="text-xl font-semibold text-red-600">Item List</CardTitle>
        {order?.status !== "Delivered" && <Button onClick={() => setPage("Update")}>Update</Button>}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item Name</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order && JSON.parse(order?.order_list).list.map((item) => (
              <TableRow key={item.name}>
                <TableCell className="font-medium">{item.item}</TableCell>
                <TableCell>{item.quantity} {item.unit}</TableCell>
                <TableCell>
                  {item.received && item.received === item.quantity ? (
                    <Check className="h-5 w-5 text-green-500" />
                  ) : (
                    <div className="flex items-center">
                      <X className="h-5 w-5 text-red-500 mr-2" />
                      <span className="text-sm text-gray-600">
                        ({item.received ? item.received : 0} {item.unit} received)
                      </span>
                    </div>
                  )}
                  <span className="sr-only">
                    {item.received &&  item.received === item.quantity ?  'Received' : `Not Received, ${item.received ? item.received : 0} ${item.unit} received`}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    {/* <div className='flex items-center justify-center pt-2'>
        <Button className='w-20'>Print</Button>
    </div> */}
  </div>
)}

{page === "Update" && (
    <div className="container mx-auto px-4 py-8 max-md:max-w-xl max-w-2xl">
    <div className="flex items-center mb-4">
        <Button onClick={() => setPage("Summary")} variant="ghost" className="mr-2 p-2">
          <ArrowLeft className="h-6 w-6 text-red-600" />
          <span className="sr-only">Back</span>
        </Button>
        <h1 className="text-2xl font-bold text-red-600">Update DN-{poId.split('/')[1]}</h1>
      </div>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-red-600">Order Details</CardTitle>
        </CardHeader>
        <CardContent>
          <p><strong>Project:</strong> {order?.project_name}</p>
          <p><strong>Address:</strong> {order?.project_address}</p>
          <p><strong>PR:</strong> {order?.procurement_request}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-red-600">Item List</CardTitle>
          <CardDescription>Mark Delivered items</CardDescription>
        </CardHeader>
        <CardContent>
          {order && JSON.parse(order.order_list).list.map(item => (
            <div key={item.name} className="mb-4 pb-4 border-b last:border-b-0">
              <h3 className="font-medium">{item.item}</h3>
              <p className="text-sm text-gray-600">{item.quantity} {item.unit}</p>
              <div className="mt-2 space-y-2">
                {partialItems[item.item] ? (
                  <div className="mt-2">
                    <Label htmlFor={`actual-amount-${item.name}`} className="block text-sm font-medium text-gray-700">
                      Update Quantity Received
                    </Label>
                    <div className='flex items-center gap-1'>
                        <span>{partialItems[item.item]}</span>
                        <span>+</span>
                    <Input
                      type="text"
                      id={`actual-amount-${item.name}`}
                    //   value={item.received !== null ? item.received : ''}
                      onChange={(e) => handleActualAmount(item.item, Number(e.target.value) + partialItems[item.item])}
                      placeholder="Enter actual Qty"
                      className="mt-1 border-red-300 focus:border-red-500 focus:ring-red-500 max-w-20"
                    />
                    <span>=</span>
                    <span>{item.received}</span>
                    </div>
                  </div>
                ) :!partialItems[item.item] && item.received === item.quantity && selectionState[item.item] === null ? (
                  <div className="flex items-center">
                    <Check className="text-green-500" />
                    <span className="ml-2">All items received</span>
                  </div>
                ) : (
                  <>
                    <p className='font-semibold pb-2'>All Items Received?</p>
                    <div className='flex gap-4'>
                      <Label className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name={`delivery-${item.name}`}
                          checked={selectionState[item.item] === true}
                          onChange={() => handleDeliveryStatus(item.item, true)}
                          className="border-red-600 text-red-600 focus:ring-red-500"
                        />
                        <span>Yes</span>
                      </Label>
                      <Label className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name={`delivery-${item.name}`}
                          checked={selectionState[item.item] === false}
                          onChange={() => handleDeliveryStatus(item.item, false)}
                          className="border-red-600 text-red-600 focus:ring-red-500"
                        />
                        <span>No</span>
                      </Label>
                    </div>
                    {selectionState[item.item] === false && (
                      <div className="mt-2">
                        <Label htmlFor={`actual-amount-${item.name}`} className="block text-sm font-medium text-gray-700">
                          Actual Quantity received
                        </Label>
                        <Input
                          type="text"
                          id={`actual-amount-${item.name}`}
                          value={item.received !== null ? item.received : ''}
                          onChange={(e) => handleActualAmount(item.item, Number(e.target.value))}
                          placeholder="Enter actual Qty"
                          className="mt-1 border-red-300 focus:border-red-500 focus:ring-red-500 max-w-40"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        className="w-full mt-6 bg-red-600 hover:bg-red-700 focus:ring-red-500"
        disabled={!isChanged}
      >
        Save
      </Button>
    </div>
)} 
<div className='hidden'>
                <div ref={componentRef} className=" w-full p-4">
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
                                                    <div className="pt-2 text-xl text-gray-600 font-semibold">Delivery Note No.</div>
                                                    <div className="text-lg font-semibold text-black">{(order?.name)?.toUpperCase().replace("PO", "DN")}</div>
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
                                                    <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{order?.vendor_name}</div>
                                                    <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{vendorAddress}</div>
                                                    <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {order?.vendor_gst}</div>
                                                </div>
                                                <div>
                                                    <div>
                                                        <h3 className="text-gray-500 text-sm pb-2 text-left">Delivery Location</h3>
                                                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left">{projectAddress}</div>
                                                    </div>
                                                    <div className="pt-2">
                                                        <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{order?.creation?.split(" ")[0]}</i></div>
                                                        <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{order?.project_name}</i></div>
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
                                    </tr>
                                </thead>
                                <tbody className={`bg-white`}>
                                    {order && JSON.parse(order.order_list)?.list?.map((item: any, index: number) => {
                                        return (<tr key={index} className={` page-break-inside-avoid ${index >= 14 ? 'page-break-before' : ''}`}>
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]">{index + 1}.</td>
                                            <td className=" py-2 text-sm whitespace-nowrap text-wrap">{item.item}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.unit}</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap">{item.quantity}</td>
                                        </tr>)
                                    })}
                                   
                                    <tr className="">
                                        <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                                        <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Total Quantity</td>
                                        <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{order && JSON.parse(order.order_list)?.list?.reduce((acc, item) => acc + item.quantity, 0)}</td>
                                    </tr>
                                    <tr className="end-of-page page-break-inside-avoid" >
                                        <td colSpan={6}>
                                            <div className="text-gray-400 text-sm py-2">Note</div>
                                            <div className="text-sm text-gray-900">PlaceHolder</div>
                                        {/* 
                                            <div className="text-gray-400 text-sm py-2">Payment Terms</div>
                                            <div className="text-sm text-gray-900">
                                                {orderData?.advance}% advance {orderData?.advance === "100" ? "" : `and remaining ${100 - orderData?.advance}% on material readiness before delivery of material to site`}
                                            </div> */}
                                            <img src={Seal} className="w-24 h-24" />
                                            <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        </div>
                        </div>
    </>
  )
}