import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
// import { fetchDoc } from "@/reactQuery/customFunctions";
// import { useQuery } from "@tanstack/react-query";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

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

  const companyAddress = data?.company_address;

  const {data: addressData} = useFrappeGetDoc("Address", companyAddress, `${companyAddress ? `Address ${companyAddress}`: ""}`, {
    revalidateIfStale: false,
  })

  if (isLoading) return <h1>Loading...</h1>;
  if (error) return <h1 className="text-red-700">{error.message}</h1>;

  // const customer = data?.data;
  // const address = addressData?.data;

  return (
    <div className="p-8">
      {data && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <ArrowLeft
                className="cursor-pointer"
                onClick={() => navigate("/customers")}
              />
              <h2 className="pl-4 text-3xl font-bold tracking-tight">
                {data.company_name}
              </h2>
            </div>
            <Button asChild>
              <Link to={`/customers/${customerId}/edit`}>Edit Customer</Link>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Company Details</CardTitle>
              <CardDescription>
                Here you can find all the details about the company.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2 md:border-r-2 border-gray-200">
                  <p>
                    <span className="font-semibold">Contact Person:</span>{" "}
                    {data.company_contact_person}
                  </p>
                  <p>
                    <span className="font-semibold">Phone:</span> {data.company_phone}
                  </p>
                  <p>
                    <span className="font-semibold">Email:</span> {data.company_email}
                  </p>
                  <p>
                    <span className="font-semibold">GST:</span> {data.company_gst}
                  </p>
                </div>
                {addressData && (
                  <div className="flex flex-col gap-2">
                    <p>
                      <span className="font-semibold">Address Line 1:</span>{" "}
                      {addressData.address_line1}
                    </p>
                    <p>
                      <span className="font-semibold">Address Line 2:</span>{" "}
                      {addressData.address_line2}
                    </p>
                    <p>
                      <span className="font-semibold">City:</span> {addressData.city}
                    </p>
                    <p>
                      <span className="font-semibold">State:</span> {addressData.state}
                    </p>
                    <p>
                      <span className="font-semibold">Pincode:</span> {addressData.pincode}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
