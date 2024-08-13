import { Button } from "@/components/ui/button"
import { Vendors } from "@/types/NirmaanStack/Vendors"
import { useFrappeGetDoc } from "frappe-react-sdk"
import { ArrowLeft } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"



const Vendor = () => {

    const { vendorId } = useParams<{ vendorId: string }>()

    return (
        <div>
            {vendorId && <VendorView vendorId={vendorId} />}
        </div>
    )
}

export const Component = Vendor

const VendorView = ({ vendorId }: { vendorId: string }) => {

    const navigate = useNavigate();

    const { data, error, isLoading } = useFrappeGetDoc<Vendors>(
        'Vendors',
        `${vendorId}`
    );


    if (isLoading) return <h1>Loading..</h1>
    if (error) return <h1 className="text-red-700">{error.message}</h1>
    return (
        <div className="flex-1 space-y-4 p-8 pt-4">
            {data &&
                <>
                    <div className="flex items-center justify-between space-y-2">
                        <div className="flex">
                            <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/vendors")} />
                            <h2 className="pl-1 text-2xl font-bold tracking-tight">{data.vendor_name}</h2>
                        </div>
                        <div className="flex space-x-2">
                            {/* <Button onClick={handlePrint}>
                            Report
                        </Button>
                        <Button onClick={handlePrint2}>
                            Schedule
                        </Button>*/}
                            <Button asChild>
                                <Link to={`/vendors/${vendorId}/edit`}> Edit Vendor</Link>
                            </Button>
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">

                    </div>
                </>
            }
        </div>
    )
}