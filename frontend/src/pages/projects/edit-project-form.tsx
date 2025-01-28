import { zodResolver } from "@hookform/resolvers/zod";
import {
  useFrappeDocTypeEventListener,
  useFrappeGetDocList,
  useFrappeGetDoc,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { ButtonLoading } from "../../components/ui/button-loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import ProjectTypeForm from "../../components/project-type-form";
import { Separator } from "../../components/ui/separator";
import { useNavigate, useParams } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CalendarIcon,
  CirclePlus,
  GitCommitVertical,
  ListChecks,
  MessageCircleWarning,
} from "lucide-react";
import { Calendar } from "../../components/ui/calendar";
import { format } from "date-fns";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import NewCustomer from "../customers/add-new-customer";
import { formatToLocalDateTimeString } from "@/utils/FormatDate";
import { toast } from "@/components/ui/use-toast";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import ReactSelect from "react-select";

// 1.a Create Form Schema accordingly
const projectFormSchema = z.object({
  project_name: z
    .string({
      required_error: "Must Provide Project Name",
    })
    .min(6, {
      message: "Must Provide Project Name",
    }),
  customer: z.string({
    required_error: "Please select associated customer",
  }),
  project_type: z.string().optional(),
  address_line_1: z
    .string({
      required_error: "Address Line 1 Required",
    })
    .min(1, {
      message: "Address Line 1 Required",
    }),
  address_line_2: z
    .string({
      required_error: "Address Line 2 Required",
    })
    .min(1, {
      message: "Address Line 2 Required",
    }),
  pin: z
    .string({
      required_error: "Must provide pincode",
    })
    .max(6, { message: "Pincode must be of 6 digits" })
    .min(6, { message: "Pincode must be of 6 digits" })
    .or(z.number()),
  email: z.string().email().optional().or(z.literal("")),
  phone: z
    .string()
    .max(10, { message: "Mobile number must be of 10 digits" })
    .min(10, { message: "Mobile number must be of 10 digits" })
    .optional()
    .or(z.literal("")),
  project_start_date: z.date({
    required_error: "A start date is required.",
  }),
  project_end_date: z.date({
    required_error: "An end date is required.",
  }),
  project_work_packages: z
    .object({
      work_packages: z.array(
        z.object({
          work_package_name: z.string(),
          category_list: z
            .object({
              list: z.array(
                z.object({
                  name: z.string(),
                  makes: z.array(z.object({
                    label: z.string(),
                    value: z.string()
                  }))
                })
              )
            })
        })
      )
    }),
  project_scopes: z.object({
    scopes: z.array(
      z.object({
        scope_of_work_name: z.string(),
        work_package: z.string(),
      })
    ),
  }),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

interface SelectOption {
  label: string;
  value: string;
}
// interface wpType {
//     work_package_name: string;
// }
// interface sowType {
//     scope_of_work_name: string;
//     work_package: string;
// }

export const EditProjectForm = ({ toggleEditSheet }) => {
  const { projectId } = useParams<{ projectId: string }>();

  const { data, mutate: projectMutate } = useFrappeGetDoc<ProjectsType>(
    "Projects",
    `${projectId}`
  );

  // console.log("projectData", data)

  const {
    data: work_package_list,
    isLoading: wp_list_loading,
    error: wp_list_error,
  } = useFrappeGetDocList("Work Packages", {
    fields: ["work_package_name"],
    limit: 1000,
  });

  const {
    data: company,
    isLoading: company_isLoading,
    error: company_error,
    mutate: company_mutate,
  } = useFrappeGetDocList("Customers", {
    fields: ["name", "company_name"],
    limit: 1000,
  });

  const {
    data: project_types,
    isLoading: project_types_isLoading,
    error: project_types_error,
    mutate: project_types_mutate,
  } = useFrappeGetDocList("Project Types", {
    fields: ["name", "project_type_name"],
    limit: 1000,
  });

  const {
    data: project_address,
    isLoading: project_address_isLoading,
    error: project_address_error,
    mutate: project_address_mutate,
  } = useFrappeGetDoc("Address", data?.project_address);

  // const { data: user, isLoading: user_isLoading, error: user_error } = useFrappeGetDocList('Nirmaan Users', {
  //     fields: ["*"],
  //     limit: 1000
  // });

  useFrappeDocTypeEventListener("Project Types", async (d) => {
    await project_types_mutate();
  });

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    mode: "onChange",
    defaultValues: {
      project_name: data?.project_name || "",
      customer: data?.customer || "",
      project_type: data?.project_type || "",
      address_line_1: project_address?.address_line1 || "",
      address_line_2: project_address?.address_line2 || "",
      pin: project_address?.pincode || "",
      email: project_address?.email_id || "",
      phone: project_address?.phone || "",
      project_start_date: data?.project_start_date
        ? new Date(data?.project_start_date)
        : new Date(),
      project_end_date: data?.project_end_date
        ? new Date(data?.project_end_date)
        : new Date(),
      project_work_packages: data?.project_work_packages
        ? JSON.parse(data?.project_work_packages)
        : {
          work_packages: [],
        },
      project_scopes: data?.project_scopes
        ? JSON.parse(data?.project_scopes)
        : {
          scopes: [],
        },
    },
  });

  // console.log("formValues", form.getValues())

  useEffect(() => {
    if (data && project_address) {
      const reformattedWorkPackages = JSON.parse(data?.project_work_packages || "{}")?.work_packages?.map((workPackage) => {
        const updatedCategoriesList = workPackage.category_list.list.map((category) => ({
          name: category.name,
          makes: category.makes.map((make) => ({ label: make, value: make })), // Extract only the labels
        }));

        return {
          ...workPackage,
          category_list: {
            list: updatedCategoriesList,
          },
        };
      });

      form.reset({
        project_name: data?.project_name || "",
        customer: data?.customer || "",
        project_type: data?.project_type || "",
        address_line_1: project_address?.address_line1 || "",
        address_line_2: project_address?.address_line2 || "",
        pin: project_address?.pincode || "",
        email: project_address?.email_id || "",
        phone: project_address?.phone || "",
        project_start_date: data?.project_start_date
          ? new Date(data?.project_start_date)
          : new Date(),
        project_end_date: data?.project_end_date
          ? new Date(data?.project_end_date)
          : new Date(),
        project_work_packages: {
          work_packages: reformattedWorkPackages || [],
        },
        project_scopes: data?.project_scopes
          ? JSON.parse(data?.project_scopes)
          : {
            scopes: [],
          },
      });

      setPincode(project_address.pincode);
    }
  }, [data, project_address, company, project_types]);

  const {
    updateDoc: updateDoc,
    loading: loading,
    isCompleted: submit_complete,
    error: submit_error,
  } = useFrappeUpdateDoc();

  const [city, setCity] = useState(project_address?.city || "");
  const [state, setState] = useState(project_address?.state || "");
  const [pincode, setPincode] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverOpen2, setPopoverOpen2] = useState(false);
  const [duration, setDuration] = useState(0);

  const startDate = form.watch("project_start_date");
  const endDate = form.watch("project_end_date");

  useEffect(() => {
    if (startDate && endDate) {
      const durationInDays = Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)
      );
      setDuration(durationInDays);
    }
  }, [startDate, endDate]);

  const {
    data: pincode_data,
    isLoading: pincode_loading,
    error: pincode_error,
  } = useFrappeGetDoc("Pincodes", pincode, `Pincodes ${pincode}`);

  const debouncedFetch = useCallback((value: string) => {
    if (value.length >= 6) {
      setPincode(value);
    } else {
      setPincode("");
    }
  }, []);

  useEffect(() => {
    if (pincode.length >= 6 && !pincode_data) {
      setCity("Not Found");
      setState("Not Found");
    } else {
      setCity(pincode_data?.city || "");
      setState(pincode_data?.state || "");
    }
  }, [pincode_data]);

  const handlePincodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    debouncedFetch(value);
  };

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof projectFormSchema>) {
    try {
      if (city === "Not Found" || state === "Not Found") {
        throw new Error(
          'City and State are "Not Found", Please Enter a Valid Pincode'
        );
        return;
      }
      const formatted_start_date = formatToLocalDateTimeString(
        values.project_start_date
      );
      const formatted_end_date = formatToLocalDateTimeString(
        values.project_end_date
      );

      const reformattedWorkPackages = values.project_work_packages.work_packages.map((workPackage) => {
        const updatedCategoriesList = workPackage.category_list.list.map((category) => ({
          name: category.name,
          makes: category.makes.map((make) => make.label), // Extract only the labels
        }));

        return {
          ...workPackage,
          category_list: {
            list: updatedCategoriesList,
          },
        };
      });

      const changedValues = {};

      if (values.project_name !== data?.project_name)
        changedValues["address_title"] = values.project_name;
      if (values.address_line_1 !== project_address?.address_line1)
        changedValues["address_line1"] = values.address_line_1;
      if (values.address_line_2 !== project_address?.address_line2)
        changedValues["address_line2"] = values.address_line_2;
      if (city !== project_address?.city) changedValues["city"] = city;
      if (state !== project_address?.state) changedValues["state"] = state;
      if (values.pin !== project_address?.pincode)
        changedValues["pincode"] = values.pin;
      if (values.email !== project_address?.email_id)
        changedValues["email_id"] = values.email;
      if (values.phone !== project_address?.phone)
        changedValues["phone"] = values.phone;

      if (Object.keys(changedValues).length) {
        await updateDoc("Address", data?.project_address, changedValues);
      }

      await updateDoc("Projects", projectId, {
        project_name: values.project_name,
        customer: values.customer,
        project_type: values.project_type,
        project_start_date: formatted_start_date,
        project_end_date: formatted_end_date,
        project_city: city,
        project_state: state,
        project_work_packages: { work_packages: reformattedWorkPackages },
        project_scopes: values.project_scopes,
      });

      await projectMutate();
      await project_address_mutate();

      toast({
        title: "Success!",
        description: `Project: ${data?.project_name} updated successfully!`,
        variant: "success",
      });

      toggleEditSheet();
    } catch (error) {
      console.log("error while updating project", error);
      toast({
        title: "Failed!",
        description: `${error?.message}`,
        variant: "destructive",
      });
    }
  }

  // Transform data to select options
  const options: SelectOption[] =
    company?.map((item) => ({
      label: item.company_name, // Adjust based on your data structure
      value: item.name,
    })) || [];

  const type_options: SelectOption[] =
    project_types?.map((item) => ({
      label: item.project_type_name, // Adjust based on your data structure
      value: item.name,
    })) || [];

  const wp_list =
    work_package_list?.map((item) => ({
      work_package_name: item.work_package_name, // Adjust based on your data structure
    })) || [];

  // console.log("projectData", data)
  // console.log("projectvalues", form.getValues())

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.stopPropagation();
          return form.handleSubmit(onSubmit)(event);
        }}
        className="flex-1"
      >
        <div className="flex flex-col ">
          <p className="text-sky-600 font-semibold pb-2">Project Details</p>
          <div className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="project_name"
              render={({ field }) => {
                return (
                  <FormItem className="lg:flex lg:items-center gap-4">
                    <FormLabel className="md:basis-3/12">
                      Project Name<sup className="text-sm text-red-600">*</sup>
                    </FormLabel>
                    <div className="flex flex-col items-start md:basis-2/4">
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </div>
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="customer"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">
                    Customer<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="md:basis-2/4">
                    <Select onValueChange={field.onChange} value={field.value}>
                      <div className="flex flex-col items-start">
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select the customer" />
                          </SelectTrigger>
                        </FormControl>
                        <FormMessage />
                      </div>
                      <SelectContent>
                        {company_isLoading && <div>Loading...</div>}
                        {company_error && (
                          <div>Error: {company_error.message}</div>
                        )}
                        {options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button variant="secondary">
                        <div className="flex items-center gap-1">
                          <CirclePlus className="w-3.5 h-3.5" />
                          <span className="text-xs">Add New Customer</span>
                        </div>
                      </Button>
                    </SheetTrigger>
                    <SheetContent className="overflow-y-auto">
                      <SheetHeader className="text-start">
                        <SheetTitle>
                          <div className=" text-2xl font-bold">
                            Create New Customer
                          </div>
                        </SheetTitle>
                        <SheetDescription>
                          <NewCustomer
                            company_mutate={company_mutate}
                            navigation={false}
                          />
                        </SheetDescription>
                      </SheetHeader>
                    </SheetContent>
                  </Sheet>
                </FormItem>
              )}
            />

            {/* // For `project_type` SelectField */}
            <FormField
              control={form.control}
              name="project_type"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">
                    Project Type<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="md:basis-2/4">
                    <Select onValueChange={field.onChange} value={field.value}>
                      <div className="flex flex-col items-start">
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a project type" />
                          </SelectTrigger>
                        </FormControl>
                        <FormMessage />
                      </div>
                      <SelectContent>
                        {project_types_isLoading && <div>Loading...</div>}
                        {project_types_error && (
                          <div>Error: {project_types_error.message}</div>
                        )}
                        {type_options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="secondary">
                        <div className="flex items-center gap-1">
                          <CirclePlus className="w-3.5 h-3.5" />
                          <span className="text-xs">New Project Type</span>
                        </div>
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[300px] md:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle>Add New Project Type</DialogTitle>
                        <DialogDescription>
                          Add new project types here.
                        </DialogDescription>
                      </DialogHeader>
                      <ProjectTypeForm
                        project_types_mutate={project_types_mutate}
                      />
                    </DialogContent>
                  </Dialog>
                </FormItem>
              )}
            />
          </div>
          <Separator className="my-6" />
          <p className="text-sky-600 font-semibold pb-2">
            Project Address Details
          </p>
          <div className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="address_line_1"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">
                    Address Line 1<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="md:basis-2/4">
                    <FormControl>
                      <Input placeholder="Address Line 1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address_line_2"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">
                    Address Line 2<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="md:basis-2/4">
                    <FormControl>
                      <Input placeholder="Address Line 2" {...field} />
                    </FormControl>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormItem className="lg:flex lg:items-center gap-4">
              <FormLabel className="md:basis-3/12">
                City<sup className="text-sm text-red-600">*</sup>
              </FormLabel>
              <div className="md:basis-2/4">
                <FormControl>
                  <Input placeholder={city || "City"} disabled={true} />
                </FormControl>
                <FormMessage />
              </div>
            </FormItem>
            <FormItem className="lg:flex lg:items-center gap-4">
              <FormLabel className="md:basis-3/12">
                State<sup className="text-sm text-red-600">*</sup>
              </FormLabel>
              <div className="md:basis-2/4">
                <FormControl>
                  <Input placeholder={state || "State"} disabled={true} />
                </FormControl>
                <FormMessage />
              </div>
            </FormItem>

            <FormField
              control={form.control}
              name="pin"
              render={({ field }) => (
                <FormItem className="lg:flex gap-4">
                  <FormLabel className="md:basis-3/12">
                    Pin Code<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col items-start md:basis-2/4">
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="6 digit PIN"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            handlePincodeChange(e);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </div>
                    <Alert variant="warning" className="md:basis-[30%]">
                      <MessageCircleWarning className="h-4 w-4" />
                      <AlertTitle className="text-sm">Heads Up</AlertTitle>
                      <AlertDescription className="text-xs">
                        Changing the Pincode will not change the project id
                      </AlertDescription>
                    </Alert>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">Phone</FormLabel>
                  <div className="md:basis-2/4">
                    <FormControl>
                      <Input type="number" placeholder="Phone" {...field} />
                    </FormControl>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">Email</FormLabel>
                  <div className="md:basis-2/4">
                    <FormControl>
                      <Input placeholder="Email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
          </div>
          <Separator className="my-6" />
          <p className="text-sky-600 font-semibold pb-2">Project Timeline</p>
          <div className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="project_start_date"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">
                    Project Start Date
                    <sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="md:basis-1/4">
                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "dd-MM-yyyy")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={(date) => {
                            field.onChange(date);
                            setPopoverOpen(false);
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </div>
                  <FormDescription>Edit project start date</FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="project_end_date"
              render={({ field }) => (
                <FormItem className="lg:flex lg:items-center gap-4">
                  <FormLabel className="md:basis-3/12">
                    Project End Date
                    <sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="md:basis-1/4">
                    <Popover open={popoverOpen2} onOpenChange={setPopoverOpen2}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "dd-MM-yyyy")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={(date) => {
                            field.onChange(date);
                            setPopoverOpen2(false);
                          }}
                          disabled={(date) =>
                            date < form.getValues("project_start_date")
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </div>
                  <FormDescription>Edit project end date</FormDescription>
                </FormItem>
              )}
            />
            <div className="flex items-center">
              <FormLabel className="md:basis-3/12">Duration: </FormLabel>
              <div className=" pl-4 flex items-center gap-2">
                <h1>{duration}</h1>
                <h1 className="text-sm text-red-600">
                  <sup>*</sup>(Days)
                </h1>
              </div>
            </div>
          </div>

          <Separator className="my-6" />
          {/* <p className="text-sky-600 font-semibold pb-6">
            Package Specification
          </p> */}
          {/* <FormField
            control={form.control}
            name="project_work_packages"
            render={() => (
              <FormItem>
                <div className="mb-4">
                  <div className="font-semibold">Edit work packages.</div>
                </div>
                {wp_list.map((item) => (
                  <Accordion
                    type="single"
                    collapsible
                    // value={
                    //   form
                    //     .getValues()
                    //     .project_work_packages.work_packages.find(
                    //       (d) => d.work_package_name === item.work_package_name
                    //     )?.work_package_name
                    // }
                    className="w-full"
                  >
                    <AccordionItem value={item.work_package_name}>
                      <AccordionTrigger>
                        <FormField
                          key={item.work_package_name}
                          control={form.control}
                          name="project_work_packages.work_packages"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={item.work_package_name}
                                className="flex flex-row items-start space-x-3 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    disabled={
                                      field.value.length === 1 &&
                                      field.value?.[0].work_package_name ===
                                        item.work_package_name
                                    }
                                    checked={field.value?.some(
                                      (i) =>
                                        i.work_package_name ===
                                        item.work_package_name
                                    )}
                                    onCheckedChange={(checked) => {
                                      const categoryOptions = []
                                      const selectedCategories = categoriesList?.filter(cat => cat.work_package === item.work_package_name)
                                      selectedCategories?.forEach(cat => {
                                          categoryOptions.push({
                                              // name: cat.category_name,
                                              // makes: []
                                              label: cat.category_name,
                                              value: cat.category_name
                                          })
                                      })
                                      return checked
                                          ? field.onChange([...field.value, { work_package_name: item.work_package_name, category_list : {list : categoryOptions} }])
                                          : field.onChange(
                                              field.value?.filter(
                                                  (value) => value.work_package_name !== item.work_package_name
                                              )
                                          )
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal">
                                  {item.work_package_name}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      </AccordionTrigger>
                      <AccordionContent>
        <FormField
          key={`${item.work_package_name}-categories`}
          control={form.control}
          name="project_work_packages.work_packages"
          render={({ field }) => {
            const selectedWorkPackage = field.value?.find(
              (wp) => wp.work_package_name === item.work_package_name
            );
            const selectedCategories =
              selectedWorkPackage?.category_list?.list || [];
            const categoryOptions = categoriesList
              ?.filter((cat) => cat.work_package === item.work_package_name)
              .map((cat) => ({
                label: cat.category_name,
                value: cat.category_name,
              }));

            return (
              <FormItem className="p-3">
                <ReactSelect
                  isMulti
                  options={categoryOptions}
                  value={selectedCategories}
                  onChange={(selected) => {
                    const updatedWorkPackages = [...(field.value || [])];
                    const workPackageIndex = updatedWorkPackages.findIndex(
                      (wp) => wp.work_package_name === item.work_package_name
                    );

                    if (workPackageIndex > -1) {
                      updatedWorkPackages[workPackageIndex].category_list.list =
                        selected;
                    } else {
                      updatedWorkPackages.push({
                        work_package_name: item.work_package_name,
                        category_list: { list: selected },
                      });
                    }

                    field.onChange(updatedWorkPackages);
                  }}
                />
              </FormItem>
            );
          }}
        />
      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ))}
                <FormMessage />
              </FormItem>
            )}
          /> */}

          {wp_list?.length > 0 && (
            <WorkPackageSelection form={form} wp_list={wp_list} />
          )}
          <div className="my-6">
            {loading ? (
              <ButtonLoading />
            ) : (
              <Button type="submit" className="flex items-center gap-1">
                <ListChecks className="h-4 w-4" />
                Submit
              </Button>
            )}
          </div>
        </div>
      </form>
    </Form>
  );
};


const WorkPackageSelection = ({ form, wp_list }) => {

  const [openValue, setOpenValue] = useState(null);

  const { data: categoriesList, isLoading: categoriesListLoading } = useFrappeGetDocList("Category", {
    fields: ["category_name", "work_package", "name"],
    filters: [["work_package", "not in", ["Tools & Equipments", "Services"]]],
    limit: 10000,
  });

  const { data: categoryMakeList, isLoading: categoryMakeListLoading } = useFrappeGetDocList("Category Makelist", {
    fields: ["make", "category"],
    limit: 100000,
  });

  const workPackages = form.watch("project_work_packages.work_packages");

  const handleSelectAll = (checked) => {
    if (checked) {
      const allWorkPackages = categoriesList.reduce((acc, category) => {
        const existingPackage = acc.find((wp) => wp.work_package_name === category.work_package);
        if (existingPackage) {
          existingPackage.category_list.list.push({
            name: category.category_name,
            makes: [],
          });
        } else {
          acc.push({
            work_package_name: category.work_package,
            category_list: {
              list: [
                {
                  name: category.category_name,
                  makes: [],
                },
              ],
            },
          });
        }
        return acc;
      }, []);

      form.setValue("project_work_packages.work_packages", allWorkPackages);
    } else {
      form.setValue("project_work_packages.work_packages", []);
    }
  };

  const handleSelectMake = (workPackageName, categoryName, selectedMakes) => {
    const updatedWorkPackages = [...workPackages];

    let workPackage = updatedWorkPackages.find((wp) => wp.work_package_name === workPackageName);

    if (!workPackage) {
      const associatedCategories = categoriesList
        .filter((cat) => cat.work_package === workPackageName)
        .map((cat) => ({
          name: cat.category_name,
          makes: [],
        }));

      workPackage = {
        work_package_name: workPackageName,
        category_list: {
          list: associatedCategories,
        },
      };

      updatedWorkPackages.push(workPackage);
    }

    const category = workPackage.category_list.list.find((cat) => cat.name === categoryName);

    if (!category) {
      workPackage.category_list.list.push({
        name: categoryName,
        makes: selectedMakes,
      });
    } else {
      category.makes = selectedMakes;
    }

    form.setValue("project_work_packages.work_packages", updatedWorkPackages);
  };


  if (categoriesListLoading || categoryMakeListLoading) return <div>loading..</div>

  return (
    <div>
      {/* <p className="text-sky-600 font-semibold">Package Specification</p> */}
      <FormField
        control={form.control}
        name="project_work_packages"
        render={() => (
          <FormItem>
            <div className="mb-4">
              <FormLabel className="text-base flex">
                Work Package Selection<sup className="text-sm text-red-600">*</sup>
              </FormLabel>
            </div>
            <Checkbox
              className="mr-3"
              onCheckedChange={handleSelectAll}
            /> <span className="text-sm text-red-600 font-bold">Select All</span>
            <Separator />
            <Separator />

            {wp_list?.map((item) => (
              <Accordion
                key={item.work_package_name}
                type="single"
                collapsible
                value={openValue}
                onValueChange={setOpenValue}
                className="w-full"
              >
                <AccordionItem value={item.work_package_name}>
                  <AccordionTrigger>
                    <FormField
                      control={form.control}
                      name="project_work_packages.work_packages"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              disabled={
                                field.value.length === 1 &&
                                field.value?.[0].work_package_name ===
                                item.work_package_name
                              }
                              checked={field.value?.some((i) => i.work_package_name === item.work_package_name)}
                              onCheckedChange={(checked) => {
                                const updatedCategories = categoriesList
                                  .filter((cat) => cat.work_package === item.work_package_name)
                                  .map((cat) => ({
                                    name: cat.category_name,
                                    makes: [],
                                  }));

                                const updatedWorkPackages = checked
                                  ? [
                                    ...field.value,
                                    { work_package_name: item.work_package_name, category_list: { list: updatedCategories } },
                                  ]
                                  : field.value.filter((wp) => wp.work_package_name !== item.work_package_name);

                                field.onChange(updatedWorkPackages);
                              }}
                            />
                          </FormControl>
                          <FormLabel>{item.work_package_name}</FormLabel>
                        </FormItem>
                      )}
                    />
                  </AccordionTrigger>
                  <AccordionContent>
                    {categoriesList
                      ?.filter((cat) => cat.work_package === item.work_package_name)
                      ?.map((cat) => {
                        const categoryMakeOptions = categoryMakeList?.filter((make) => make.category === cat.name);
                        const makeOptions = categoryMakeOptions.map((make) => ({
                          label: make.make,
                          value: make.make,
                        }));

                        const selectedMakes =
                          workPackages
                            .find((wp) => wp.work_package_name === item.work_package_name)
                            ?.category_list.list.find((c) => c.name === cat.category_name)?.makes || [];

                        return (
                          <div key={cat.name}>
                            <Separator />
                            <FormItem className="flex gap-4 items-center p-3">
                              <FormLabel className="w-[30%]">{cat.category_name}</FormLabel>
                              <Controller
                                control={form.control}
                                name="project_work_packages.work_packages"
                                render={() => (
                                  <ReactSelect
                                    className="w-full"
                                    placeholder="Select Makes..."
                                    isMulti
                                    options={makeOptions}
                                    value={selectedMakes}
                                    onChange={(selected) =>
                                      handleSelectMake(item.work_package_name, cat.category_name, selected)
                                    }
                                  />
                                )}
                              />
                            </FormItem>
                          </div>
                        );
                      })}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ))}
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
};