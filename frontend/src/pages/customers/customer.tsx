import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton";
// import { fetchDoc } from "@/reactQuery/customFunctions";
// import { useQuery } from "@tanstack/react-query";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, FilePenLine } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

const Customer = () => {
  const { customerId } = useParams<{ customerId: string }>();

  return <div>{customerId && <CustomerView customerId={customerId} />}</div>;
};

export const Component = Customer;

const CustomerView = ({ customerId }: { customerId: string }) => {
  const navigate = useNavigate();

  // const { data, isLoading, error } = useQuery({
  //   queryKey: ["doc", "Customers", customerId],
  //   queryFn: () => fetchDoc({doctype: "Customers", name: customerId}),
  //   staleTime: 1000 * 60 * 5,
  // });

  const {data, isLoading, error} = useFrappeGetDoc("Customers", customerId, `Customers ${customerId}`, {
    revalidateIfStale: false
  })

  const customerAddressID = data?.company_address;

  const {data: customerAddress, isLoading: customerAddressLoading, error: customerAddressError} = useFrappeGetDoc("Address", customerAddressID, `${customerAddressID ? `Address ${customerAddressID}`: ""}`, {
    revalidateIfStale: false,
  })

  if (error || customerAddressError) return <h1 className="text-red-700">There is an Error while fetching the account</h1>;

  return (
    <div className="flex-1 space-y-4 p-12 pt-8">
      <div className="flex items-center">
                <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/customers")} />
                {isLoading ? (<Skeleton className="h-10 w-1/3 bg-gray-300" />) :
                <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.company_name}</h2>}
                <FilePenLine onClick={() => navigate('edit')} className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
          </div>
      {(isLoading || customerAddressLoading) ? <OverviewSkeleton /> : (
        <div>
        <Card>
            <CardHeader>
              <CardTitle>
                  {data?.company_name}
              </CardTitle>
            </CardHeader>
            <CardContent>
                <Card className="bg-[#F9FAFB]">
                  <CardHeader>
                    <CardContent className="flex max-lg:flex-col max-lg:gap-10">
                        <div className="space-y-4 lg:w-[50%]">
                          <CardDescription className="space-y-2">
                              <span>Company Id</span>
                              <p className="font-bold text-black">{data?.name}</p>
                          </CardDescription>

                          <CardDescription className="space-y-2">
                              <span>Contact Person</span>
                              <p className="font-bold text-black">{data?.company_contact_person}</p>
                          </CardDescription>

                          <CardDescription className="space-y-2">
                              <span>Contact Number</span>
                              <p className="font-bold text-black">{data?.company_phone}</p>
                          </CardDescription>
                          <CardDescription className="space-y-2">
                              <span>Gmail Address</span>
                              <p className="font-bold text-black">{data?.company_email}</p>
                          </CardDescription>
                          <CardDescription className="space-y-2">
                              <span>GST Number</span>
                              <p className="font-bold text-black">{data?.company_gst}</p>
                          </CardDescription>
                          
                        </div>
                          
                        <div className="space-y-4">
                          <CardDescription className="space-y-2">
                              <span>Address</span>
                              <p className="font-bold text-black">{customerAddress?.address_line1}, {customerAddress?.address_line2}, {customerAddress?.city}, {customerAddress?.state}, {customerAddress?.pincode}</p>
                          </CardDescription>
                          
                          <CardDescription className="space-y-2">
                              <span>City</span>
                              <p className="font-bold text-black">{customerAddress?.city}</p>
                          </CardDescription>
                          
                          <CardDescription className="space-y-2">
                              <span>State</span>
                              <p className="font-bold text-black">{customerAddress?.state}</p>
                          </CardDescription>
                          
                          <CardDescription className="space-y-2">
                              <span>Country</span>
                              <p className="font-bold text-black">{customerAddress?.country}</p>
                          </CardDescription>
                          
                        </div>
                    </CardContent>
                  </CardHeader>
                </Card>
            </CardContent>
                          
        </Card>
    </div>
      )}
    </div>
  );
};
