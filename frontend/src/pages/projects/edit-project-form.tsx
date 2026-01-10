import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Projects as ProjectsType, ProjectWPCategoryMake } from "@/types/NirmaanStack/Projects";
import { formatToLocalDateTimeString } from "@/utils/FormatDate";
import { parseNumber } from "@/utils/parseNumber";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import {
  useFrappeDocTypeEventListener,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import {
  Building2,
  CalendarIcon,
  Calendar as CalendarIconAlt,
  CheckCircle2,
  CirclePlus,
  Info,
  ListChecks,
  MapPin,
  MessageCircleWarning,
  Package,
  Users,
} from "lucide-react";
import { FormSectionHeader } from "@/components/ui/form-field-row";
import React, { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import ReactSelect from "react-select";
import * as z from "zod";
import ProjectTypeForm from "../../components/project-type-form";
import { Button } from "../../components/ui/button";
import { ButtonLoading } from "../../components/ui/button-loading";
import { Calendar } from "../../components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import NewCustomer from "../customers/add-new-customer";
import { ProjectQueryKeys } from "./project";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";
import { Address } from "@/types/NirmaanStack/Address";

import {MultiSelect} from "./components/multi-select"


// 1.a Create Form Schema accordingly
const projectFormSchema = z.object({
  project_name: z
    .string({
      required_error: "Must Provide Project Name",
    })
    .min(6, {
      message: "Must Provide Project Name",
    }),
  customer: z.string().optional(),
  project_type: z.string().optional(),
  project_value: z.string().optional(),
  project_value_gst: z.string().optional(),
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
  project_gst_number: z.object({
    list: z.array(z.object({
      location: z.string(),
      gst: z.string(),
    }))
  }),
   carpet_area: z.coerce.number().nonnegative().optional(),
  
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

const allGstOptions = [
  { location: "Bengaluru", gst: "29ABFCS9095N1Z9" },
  { location: "Gurugram", gst: "06ABFCS9095N1ZH" },
  { location: "Noida", gst: "09ABFCS9095N1ZB" }, // Include Noida if it's a valid option
];

// Prepare options for the MultiSelect component
// MultiSelect expects { label: string, value: string } for options
const multiSelectGstOptions = allGstOptions.map(option => ({
  label: `${option.location} (${option.gst})`,
  value: option.location, // The unique identifier for the MultiSelect
}));



const formatWorkPackagesForForm = (data: ProjectsType | undefined): ProjectFormValues['project_work_packages']['work_packages'] => {

  if (!data) return [];
  // Transform `project_wp_category_makes` (child table) to frontend's nested structure
  const transformedWpConfigForForm: ProjectFormValues['project_work_packages']['work_packages'] = [];
  const wpCategoryMap: Record<string, Record<string, { name: string; makes: SelectOption[] }>> = {};


  // const reformattedWorkPackages = JSON.parse(data?.project_work_packages || "{}")?.work_packages?.map((workPackage) => {
  //   const updatedCategoriesList = workPackage.category_list.list.map((category) => ({
  //     name: category.name,
  //     makes: category.makes.map((make) => ({ label: make, value: make })), // Extract only the labels
  //   }));

  //   return {
  //     ...workPackage,
  //     category_list: {
  //       list: updatedCategoriesList,
  //     },
  //   };
  // });


  if (data.project_wp_category_makes && Array.isArray(data.project_wp_category_makes)) {
    data.project_wp_category_makes.forEach(childRow => {
      if (!childRow.procurement_package || !childRow.category) return;

      if (!wpCategoryMap[childRow.procurement_package]) {
        wpCategoryMap[childRow.procurement_package] = {};
      }
      if (!wpCategoryMap[childRow.procurement_package][childRow.category]) {
        wpCategoryMap[childRow.procurement_package][childRow.category] = {
          name: childRow.category, // This should be category DocName
          makes: [],
        };
      }
      if (childRow.make) { // Make is optional
        // We need make label for ReactSelect. Assuming Make DocName is also its label for now,
        // or you might need to fetch MakeList to map make DocName to make_name (label).
        // For simplicity, if make DocName is sufficient for display in ReactSelect, use it.
        // If your original JSON stored make labels, and your ReactSelect expects {label, value},
        // you'll need to fetch Makelist to get make_name for the label.
        // The current form Zod schema expects makes as {label, value}.
        // Let's assume 'childRow.make' is the Make DocName (value) and we need to find its label.
        // This part might require fetching all makes if not already available.
        // For now, to match Zod schema, let's assume make DocName is used for both label and value if label isn't readily available.
        // A better approach would be to fetch make_list and find the label.
        wpCategoryMap[childRow.procurement_package][childRow.category].makes.push({
          label: childRow.make, // Placeholder: Ideally, fetch actual make_name (label) from Makelist
          value: childRow.make,
        });
      }
    });
  }

  Object.keys(wpCategoryMap).forEach(wpName => {
    transformedWpConfigForForm.push({
      work_package_name: wpName,
      category_list: {
        list: Object.values(wpCategoryMap[wpName]),
      },
    });
  });

  return transformedWpConfigForForm;
}

interface EditProjectFormProps {
  toggleEditSheet: () => void;
  // projectMutate: KeyedMutatator<FrappeDoc<Projects>>;
}

export const EditProjectForm: React.FC<EditProjectFormProps> = ({ toggleEditSheet }) => {
  const { projectId } = useParams<{ projectId: string }>();

  const { data, mutate: projectMutate } = useFrappeGetDoc<ProjectsType>(
    "Projects",
    projectId,
    projectId ? ProjectQueryKeys.project(projectId) : null
  );

  // console.log("projectData", data)

  const {
    data: procuremeent_packages_list,
  } = useFrappeGetDocList<ProcurementPackages>("Procurement Packages", {
    fields: ["work_package_name"],
    filters: [["work_package_name", "not in", ["Tool & Equipments", "Services","Additional Charges"]]],
    limit: 0,
  });

  const {
    data: company,
    isLoading: company_isLoading,
    error: company_error,
    mutate: company_mutate,
  } = useFrappeGetDocList<Customers>("Customers", {
    fields: ["name", "company_name"],
    limit: 0,
  });

  const {
    data: project_types,
    isLoading: project_types_isLoading,
    error: project_types_error,
    mutate: project_types_mutate,
  } = useFrappeGetDocList<ProjectTypes>("Project Types", {
    fields: ["name", "project_type_name"],
    limit: 0,
  });

  const {
    data: project_address,
    mutate: project_address_mutate,
  } = useFrappeGetDoc<Address>("Address", data?.project_address, data?.project_address ? undefined : null);

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
      project_value: data?.project_value || "",
      project_value_gst: data?.project_value_gst || "",
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
        work_packages: formatWorkPackagesForForm(data),
      },
      project_gst_number: data?.project_gst_number
        ? (typeof data?.project_gst_number === "string" ? JSON.parse(data?.project_gst_number) : data?.project_gst_number)
        : {
          list: [
            {
              location: "Bengaluru",
              gst: "29ABFCS9095N1Z9",
            }
          ]
        },
      carpet_area: data?.carpet_area || "",  
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

      const transformedWpConfigForForm = formatWorkPackagesForForm(data);

      form.reset({
        project_name: data?.project_name || "",
        customer: data?.customer || "",
        project_type: data?.project_type || "",
        project_value: data?.project_value?.toString() || "",
        project_value_gst: data?.project_value_gst?.toString() || "",
        address_line_1: project_address?.address_line1 || "",
        address_line_2: project_address?.address_line2 || "",
        pin: project_address?.pincode || "",
        email: project_address?.email_id || "",
        phone: project_address?.phone || "",
        project_start_date: data?.project_start_date
          ? new Date(data?.project_start_date)
          : undefined,
        project_end_date: data?.project_end_date
          ? new Date(data?.project_end_date)
          : undefined,
        project_work_packages: {
          work_packages: transformedWpConfigForForm,
        },
        project_gst_number: data?.project_gst_number ? (typeof data.project_gst_number === 'string' ? JSON.parse(data.project_gst_number) : data.project_gst_number) : { list: [{ location: "Bengaluru", gst: "29ABFCS9095N1Z9" }] },
        carpet_area: data?.carpet_area || "", 
        project_scopes: data?.project_scopes ? (typeof data.project_scopes === 'string' ? JSON.parse(data.project_scopes) : data.project_scopes) : { scopes: [] },

      });

      // setPincode(project_address.pincode);
      if (project_address?.pincode) {
        setPincode(project_address.pincode); // For pincode lookup logic
        // Also directly set city/state from project_address if available, as pincode_data might be async
        setCity(project_address.city || "");
        setState(project_address.state || "");
      }
    }
  }, [data, project_address, form.reset]);

  const {
    updateDoc: updateDoc,
    loading: loading,
  } = useFrappeUpdateDoc();

  const [city, setCity] = useState(project_address?.city || "");
  const [state, setState] = useState(project_address?.state || "");
  const [pincode, setPincode] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverOpen2, setPopoverOpen2] = useState(false);
  const [duration, setDuration] = useState(0);

  const startDate = form.watch("project_start_date");
  const endDate = form.watch("project_end_date");
  // Watch customer field to show conditional message
  const customerValue = form.watch("customer");

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
  } = useFrappeGetDoc("Pincodes", pincode, pincode ? `Pincodes ${pincode}` : null);

  const debouncedFetch = useCallback((value: string) => {
    if (value.length >= 6) {
      setPincode(value);
    } else {
      setPincode("");
    }
  }, [pincode, setPincode]);

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
      }

      if (!values.project_start_date || !values.project_end_date) {
        toast({ title: "Validation Error", description: "Start and End dates are required.", variant: "destructive" });
        return;
      }
      const formatted_start_date = formatToLocalDateTimeString(
        values.project_start_date
      );
      const formatted_end_date = formatToLocalDateTimeString(
        values.project_end_date
      );

      // const reformattedWorkPackages = values.project_work_packages.work_packages.map((workPackage) => {
      //   const updatedCategoriesList = workPackage.category_list.list.map((category) => ({
      //     name: category.name,
      //     makes: category.makes.map((make) => make.label), // Extract only the labels
      //   }));

      //   return {
      //     ...workPackage,
      //     category_list: {
      //       list: updatedCategoriesList,
      //     },
      //   };
      // });

      // --- Transform frontend form's project_work_packages to backend child table structure ---
      const backendWPCategoryMakes: Omit<ProjectWPCategoryMake, 'name'>[] = [];
      if (values.project_work_packages?.work_packages) {
        values.project_work_packages.work_packages.forEach(feWP => {
          if (feWP.category_list?.list) {
            feWP.category_list.list.forEach(feCat => {
              if (feCat.makes && feCat.makes.length > 0) {
                feCat.makes.forEach(feMake => {
                  backendWPCategoryMakes.push({
                    procurement_package: feWP.work_package_name,
                    category: feCat.name, // feCat.name is Category DocName
                    make: feMake.value,   // feMake.value is Make DocName
                  });
                });
              } else {
                // If a category is listed for a WP but has no makes selected,
                // create a row with make as null (if 'make' is optional in child table)
                backendWPCategoryMakes.push({
                  procurement_package: feWP.work_package_name,
                  category: feCat.name,
                  make: null, // Or undefined, depending on how backend handles optional Link
                });
              }
            });
          }
        });
      }

      // const changedValues = {};

      // if (values.project_name !== data?.project_name)
      //   changedValues["address_title"] = values.project_name;
      // if (values.address_line_1 !== project_address?.address_line1)
      //   changedValues["address_line1"] = values.address_line_1;
      // if (values.address_line_2 !== project_address?.address_line2)
      //   changedValues["address_line2"] = values.address_line_2;
      // if (city !== project_address?.city) changedValues["city"] = city;
      // if (state !== project_address?.state) changedValues["state"] = state;
      // if (values.pin !== project_address?.pincode)
      //   changedValues["pincode"] = values.pin;
      // if (values.email !== project_address?.email_id)
      //   changedValues["email_id"] = values.email;
      // if (values.phone !== project_address?.phone)
      //   changedValues["phone"] = values.phone;
      // --- Update Address Document (remains largely the same) ---
      const changedAddressValues: Record<string, any> = {};
      // ... (your existing logic for changedAddressValues is good) ...
      if (values.project_name !== data?.project_name) changedAddressValues["address_title"] = values.project_name;
      if (values.address_line_1 !== project_address?.address_line1) changedAddressValues["address_line1"] = values.address_line_1;
      if (values.address_line_2 !== project_address?.address_line2) changedAddressValues["address_line2"] = values.address_line_2;
      if (city !== project_address?.city) changedAddressValues["city"] = city; // Use local state 'city'
      if (state !== project_address?.state) changedAddressValues["state"] = state; // Use local state 'state'
      if (values.pin !== project_address?.pincode) changedAddressValues["pincode"] = values.pin;
      if (values.email !== project_address?.email_id) changedAddressValues["email_id"] = values.email;
      if (values.phone !== project_address?.phone) changedAddressValues["phone"] = values.phone;

      // if (Object.keys(changedValues).length) {
      //   await updateDoc("Address", data?.project_address, changedValues);
      // }

      if (data?.project_address && Object.keys(changedAddressValues).length > 0) {
        await updateDoc("Address", data.project_address, changedAddressValues);
      }

      
      const gstList = values.project_gst_number?.list; // Use optional chaining for safety

    if (!gstList || gstList.length === 0) {
        toast({
            title: "Failed!",
            description: "At least one Project GST location must be selected for update.",
            variant: "destructive"
        });
        return; // Prevent update if validation fails
    }

      // --- Prepare Project Update Payload ---
      const projectUpdatePayload: Partial<ProjectsType> & { name: string } = {
        project_name: values.project_name,
        customer: values.customer,
        project_type: values.project_type,
        project_value: parseNumber(values.project_value).toString(), // Frappe might expect string for Data/Currency
        project_value_gst: parseNumber(values.project_value_gst).toString(),
        // GST and Scopes: Assuming they are still JSON fields and frontend sends them correctly
        project_gst_number: typeof values.project_gst_number === 'string' ? values.project_gst_number : JSON.stringify(values.project_gst_number),
        project_scopes: typeof values.project_scopes === 'string' ? values.project_scopes : JSON.stringify(values.project_scopes),
        carpet_area: values.carpet_area,

        project_start_date: formatted_start_date,
        project_end_date: formatted_end_date,
        // project_city and project_state in Projects are usually read-only, fetched from Address.
        // If you need to update them directly on Project, ensure they are not read-only.
        project_city: city,
        project_state: state,

        // NEW: Assign the transformed child table data
        project_wp_category_makes: backendWPCategoryMakes,

        // OLD JSON field should be cleared or not sent if removed from DocType
        // project_work_packages: null, // Explicitly clear if field still exists but unused
      };

      // If project_work_packages field is fully removed from Projects DocType, remove it from payload:
      // delete projectUpdatePayload.project_work_packages;

      // await updateDoc("Projects", projectId!, {
      //   project_name: values.project_name,
      //   customer: values.customer,
      //   project_type: values.project_type,
      //   project_value: parseNumber(values.project_value),
      //   project_gst_number: values.project_gst_number,
      //   project_start_date: formatted_start_date,
      //   project_end_date: formatted_end_date,
      //   project_city: city,
      //   project_state: state,
      //   project_work_packages: { work_packages: reformattedWorkPackages },
      //   project_scopes: values.project_scopes,
      // });
      await updateDoc("Projects", projectId!, projectUpdatePayload);

      await projectMutate();
      if (data?.project_address) {
        await project_address_mutate(); // Revalidate SWR cache for the address
      }

      toast({
        title: "Success!",
        description: `Project: ${data?.project_name} updated successfully!`,
        variant: "success",
      });

      toggleEditSheet();
    } catch (error: any) { // Catch any error
      console.error("Error while updating project:", error);
      toast({
        title: "Update Failed!",
        description: error?.message || "An unknown error occurred.",
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
    procuremeent_packages_list?.map((item) => ({
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
        <div className="flex flex-col">
          <FormSectionHeader
            title="Project Details"
            icon={<Building2 className="h-4 w-4" />}
          />
          <div className="flex flex-col gap-4 pt-2">
            <FormField
              control={form.control}
              name="project_name"
              render={({ field }) => {
                return (
                  <FormItem className="md:flex md:items-start gap-4">
                    <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                      Project Name<sup className="text-sm text-red-600">*</sup>
                    </FormLabel>
                    <div className="flex flex-col items-start flex-1 space-y-1.5">
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
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                    Customer
                  </FormLabel>
                  <div className="flex-1 space-y-2">
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
                    {/* Conditional message about customer requirement for invoices */}
                    {customerValue ? (
                      <div className="flex items-start gap-2 p-2.5 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50">
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-green-700 dark:text-green-300">
                          Now Invoices and Inflows can be added.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                        <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Project Invoice and Inflow Upload will not work if customer
                          remains unselected.
                        </p>
                      </div>
                    )}
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
            <FormField
              control={form.control}
              name="project_value"
              render={({ field }) => {
                return (
                  <FormItem className="md:flex md:items-start gap-4">
                    <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                      Project Value (excl.GST)
                    </FormLabel>
                    <div className="flex flex-col items-start flex-1">
                      <FormControl>
                        <Input placeholder="Auto-calculated" disabled={true} {...field} />
                      </FormControl>
                      <FormMessage />
                      <FormDescription className="text-amber-600 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Auto-calculated from Customer PO details.
                      </FormDescription>
                    </div>
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="project_value_gst"
              render={({ field }) => {
                return (
                  <FormItem className="md:flex md:items-start gap-4">
                    <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                      Project Value (incl. GST)
                    </FormLabel>
                    <div className="flex flex-col items-start flex-1">
                      <FormControl>
                        <Input placeholder="Auto-calculated" disabled={true} {...field} />
                      </FormControl>
                      <FormMessage />
                      <FormDescription className="text-amber-600 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Auto-calculated from Customer PO details.
                      </FormDescription>
                    </div>
                  </FormItem>
                );
              }}
            />

            {/* // For `project_type` SelectField */}
            <FormField
              control={form.control}
              name="project_type"
              render={({ field }) => (
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                    Project Type<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="flex-1">
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


<FormField
  control={form.control}
  name="project_gst_number" // Form expects { list: [{ location, gst }] }
  render={({ field }) => {
    // 1. Extract the currently selected location's name (the single value we need for the Select component).
    // This correctly displays the default/current selection if the list has one item.
    const currentValue = field.value?.list?.[0]?.location || "";

    return (
      <FormItem className="md:flex md:items-start gap-4">
        {/* Preserving the md:w-1/4 md:pt-2.5 shrink-0 from your last provided component */}
        <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">Project GST<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
        {/* Preserving the flex-1 from your last provided component */}
        <div className="flex-1">
          <Select
            onValueChange={(selectedLocationName: string) => {
              // 2. Find the full GST object for the selected location name
              const foundOption = allGstOptions.find(opt => opt.location === selectedLocationName);

              // 3. Update the form field with a new list containing only the selected item.
              if (foundOption) {
                  // Set the form value to { list: [the_selected_object] }
                  field.onChange({ list: [foundOption] });
              } else {
                  // Handle case where user might deselect or an unexpected value occurs
                  field.onChange({ list: [] });
              }
            }}
            value={currentValue}
            disabled={field.disabled}
          >
            <SelectTrigger className="w-full">
              {/* Display the selected location name or the placeholder */}
              <SelectValue placeholder="Select Project GST" />
            </SelectTrigger>
            <SelectContent>
              {/* Map all available options */}
              {allGstOptions.map((option) => (
                <SelectItem key={option.location} value={option.location}>
                  {/* Display both location and GST for user clarity */}
                  {option.location} - {option.gst} 
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </div>
      </FormItem>
    );
  }}
/>

<FormField
  control={form.control}
  name="carpet_area"
  render={({ field }) => {
    return (
      <FormItem className="md:flex md:items-start gap-4">
        <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
            Carpet Area (Sqft)
        </FormLabel>
        <div className="flex-1">
            <FormControl>
                <Input
                    type="number"
                    placeholder="Enter Area"
                    {...field}
                />
            </FormControl>
            <FormMessage />
        </div>
      </FormItem>
    );
  }}
/>

{/* <FormField
  control={form.control}
  name="project_gst_number" // Ensure this matches your form's schema for an array of objects
  render={({ field }) => {
    // Extract currently selected location names from the form field's value.
    // field.value is expected to be { list: [{ location: string, gst: string }, ...] }
    // We need an array of strings (e.g., ["Bengaluru", "Gurugram"]) for the MultiSelect's 'selected' prop.
    const currentSelectedLocations = field.value?.list?.map((item: { location: string }) => item.location) || [];

    return (
      <FormItem className="md:flex md:items-start gap-4">
        <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">Project GST<sup className="pl-1 text-sm text-red-600">*</sup></FormLabel>
        <div className="flex-1">
          <MultiSelect
            options={multiSelectGstOptions}
            selected={currentSelectedLocations} // Pass the array of selected location *values* (strings)
            onSelectedChange={(selectedLocationValues: string[]) => {
              // When the MultiSelect's selection changes, it provides an array of
              // selected location *values* (strings).
              // We need to convert this back to your form's expected format:
              // { list: [{ location: string, gst: string }, ...] }
              const updatedGstList = selectedLocationValues.map(locationName => {
                const foundOption = allGstOptions.find(opt => opt.location === locationName);
                // Return the full GST object. If for some reason not found,
                // handle gracefully (e.g., return a default or log error).
                return foundOption || { location: locationName, gst: "" };
              });
              field.onChange({ list: updatedGstList }); // Update the form field with the new list
            }}
            placeholder="Select Project GST(s)"
            className="w-full"
            disabled={field.disabled} // Inherit disabled state from form field
          />
          <FormMessage />
        </div>
      </FormItem>
    );
  }}
/> */}


          </div>
          <Separator className="my-6" />
          <FormSectionHeader
            title="Project Address"
            icon={<MapPin className="h-4 w-4" />}
          />
          <div className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="address_line_1"
              render={({ field }) => (
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                    Address Line 1<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="flex-1">
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
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                    Address Line 2<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="flex-1">
                    <FormControl>
                      <Input placeholder="Address Line 2" {...field} />
                    </FormControl>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormItem className="md:flex md:items-start gap-4">
              <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                City<sup className="text-sm text-red-600">*</sup>
              </FormLabel>
              <div className="flex-1">
                <FormControl>
                  <Input placeholder={city || "City"} disabled={true} />
                </FormControl>
                <FormMessage />
              </div>
            </FormItem>
            <FormItem className="md:flex md:items-start gap-4">
              <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                State<sup className="text-sm text-red-600">*</sup>
              </FormLabel>
              <div className="flex-1">
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
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
                    Pin Code<sup className="text-sm text-red-600">*</sup>
                  </FormLabel>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col items-start flex-1">
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
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">Phone</FormLabel>
                  <div className="flex-1">
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
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">Email</FormLabel>
                  <div className="flex-1">
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
          <FormSectionHeader
            title="Project Timeline"
            icon={<CalendarIconAlt className="h-4 w-4" />}
          />
          <div className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="project_start_date"
              render={({ field }) => (
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
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
                <FormItem className="md:flex md:items-start gap-4">
                  <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">
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
              <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">Duration: </FormLabel>
              <div className=" pl-4 flex items-center gap-2">
                <h1>{duration}</h1>
                <h1 className="text-sm text-red-600">
                  <sup>*</sup>(Days)
                </h1>
              </div>
            </div>
          </div>

          <Separator className="my-6" />
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
    filters: [["work_package", "not in", ["Tool & Equipments", "Services"]]],
    limit: 10000,
  });

  const { data: categoryMakeList, isLoading: categoryMakeListLoading } = useFrappeGetDocList("Category Makelist", {
    fields: ["make", "category"],
    limit: 100000,
  });

  const workPackages = form.watch("project_work_packages.work_packages");

  console.log("categoriesList",categoriesList)
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
                        const makeOptions = categoryMakeOptions?.map((make) => ({
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