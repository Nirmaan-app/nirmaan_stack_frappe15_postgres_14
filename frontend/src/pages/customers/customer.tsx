import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton";
// import { fetchDoc } from "@/reactQuery/customFunctions";
// import { useQuery } from "@tanstack/react-query";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, FilePenLine, MapPin } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import EditCustomer from "./edit-customer";

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

  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const toggleEditSheet = () => {
    setEditSheetOpen((prevState) => !prevState);
  };

  const { data, isLoading, error } = useFrappeGetDoc(
    "Customers",
    customerId,
    `Customers ${customerId}`,
    {
      revalidateIfStale: false,
    }
  );

  const { data: associatedProjects } = useFrappeGetDocList("Projects", {
    fields: ["*"],
    filters: [["customer", "=", customerId]],
    limit: 1000,
  });

  // console.log("asociated Projects", associatedProjects)

  const customerAddressID = data?.company_address;

  const {
    data: customerAddress,
    isLoading: customerAddressLoading,
    error: customerAddressError,
  } = useFrappeGetDoc(
    "Address",
    customerAddressID,
    `${customerAddressID ? `Address ${customerAddressID}` : ""}`,
    {
      revalidateIfStale: false,
    }
  );

  if (error || customerAddressError)
    return (
      <h1 className="text-red-700">
        There is an Error while fetching the account
      </h1>
    );

  return (
    <div className="flex-1 md:space-y-4">
      <div className="flex items-center gap-1 max-md:mb-2">
        {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate("/customers")} /> */}
        {isLoading ? (
          <Skeleton className="h-10 w-1/3 bg-gray-300" />
        ) : (
          <h2 className="text-xl md:text-3xl font-bold tracking-tight ml-2">
            {data?.company_name}
          </h2>
        )}
        <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
          <SheetTrigger>
            <FilePenLine className="text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
          </SheetTrigger>
          <SheetContent className="overflow-auto">
            <EditCustomer toggleEditSheet={toggleEditSheet} />
          </SheetContent>
        </Sheet>
      </div>
      {isLoading || customerAddressLoading ? (
        <OverviewSkeleton />
      ) : (
        <div>
          <Card>
            <CardContent className="flex max-lg:flex-col max-lg:gap-10 mt-6">
              {/* <Card className="bg-[#F9FAFB]">
                  <CardHeader>
                    <CardContent className="flex max-lg:flex-col max-lg:gap-10"> */}
              <div className="space-y-4 lg:w-[50%]">
                <CardDescription className="space-y-2">
                  <span>Company Id</span>
                  <p className="font-bold text-black">{data?.name}</p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>Contact Person</span>
                  <p className="font-bold text-black">
                    {!data.company_contact_person
                      ? "N.A."
                      : data.company_contact_person}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>Contact Number</span>
                  <p className="font-bold text-black">
                    {!data.company_phone ? "N.A." : data.company_phone}
                  </p>
                </CardDescription>
                <CardDescription className="space-y-2">
                  <span>Email Address</span>
                  <p className="font-bold text-black">
                    {!data.company_email ? "N.A." : data.company_email}
                  </p>
                </CardDescription>
                <CardDescription className="space-y-2">
                  <span>GST Number</span>
                  <p className="font-bold text-black">{data?.company_gst}</p>
                </CardDescription>
              </div>

              <div className="space-y-4">
                <CardDescription className="space-y-2">
                  <span>Address</span>
                  <p className="font-bold text-black">
                    {customerAddress?.address_line1},{" "}
                    {customerAddress?.address_line2}, {customerAddress?.city},{" "}
                    {customerAddress?.state}, {customerAddress?.pincode}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>City</span>
                  <p className="font-bold text-black">
                    {customerAddress?.city}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>State</span>
                  <p className="font-bold text-black">
                    {customerAddress?.state}
                  </p>
                </CardDescription>

                <CardDescription className="space-y-2">
                  <span>Country</span>
                  <p className="font-bold text-black">
                    {customerAddress?.country}
                  </p>
                </CardDescription>
              </div>
              {/* </CardContent>
                  </CardHeader>
                </Card> */}
            </CardContent>
          </Card>
          <div className="mt-4">
            <h2 className="text-2xl max-md:text-xl font-semibold font-bold pb-2 ml-2">
              Associated Projects
            </h2>
            {associatedProjects?.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {associatedProjects?.map((project) => (
                  <Link key={project.name} to={`/projects/${project?.name}`}>
                    <Card className="flex flex-col">
                      <CardHeader>
                        <CardTitle className="flex justify-between items-start">
                          <span className="text-lg">
                            {project?.project_name}
                          </span>
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {project?.name}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-grow">
                        <div className="flex items-center gap-2 mb-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {project?.project_city}, {project?.project_state}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-center bg-gray-50 py-2">Not Available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};