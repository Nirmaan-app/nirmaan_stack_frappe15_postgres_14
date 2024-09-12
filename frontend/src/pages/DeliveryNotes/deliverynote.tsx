import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useFrappeGetDoc } from "frappe-react-sdk"
import { ArrowLeft } from "lucide-react"
import { Link, useParams } from "react-router-dom"

const DeliveryNote = () => {

    const {id} = useParams()

    const poId = id?.replaceAll("&=", "/")

   const {data} = useFrappeGetDoc("Procurement Orders", poId, `Procurement Orders ${poId}`)

    console.log("data", data)

    return (
        <div className="flex-1 md:space-y-4 p-4 md:p-6 pt-6">
            <div className="flex mb-4">
                        <Link to="/delivery-notes"><ArrowLeft className="" /></Link>
                        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.name}</h2>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Item List</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-4">
                <CardDescription className="flex text-lg font-semibold justify-between items-center">
                            <h1>Item Id</h1>
                            <p>Qty</p>
                            <p>Status</p>
                    </CardDescription>
                    { data && JSON.parse(data?.order_list)?.list?.map((item) => (
                        <CardDescription className="flex justify-between items-center">
                            <h1>{item.name}</h1>
                            <p>{item.quantity}({item.unit})</p>
                            <p>status ph</p>
                        </CardDescription>
                    ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

export default DeliveryNote