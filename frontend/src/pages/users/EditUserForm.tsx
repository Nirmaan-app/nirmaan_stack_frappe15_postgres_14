import { ArrowLeft, ListChecks, ListRestart } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useEffect } from "react";
import { toast } from "@/components/ui/use-toast";

const UserFormSchema = z.object({
  first_name: z
    .string({
      required_error: "Must Provide First name",
    })
    .min(3, {
      message: "Employee Name must be at least 3 characters.",
    }),
  last_name: z.string({
    required_error: "Must Provide Last name",
  }),
  mobile_no: z
    .string({
      required_error: "Must provide Unique Mobile Number",
    })
    .max(10, { message: "Mobile number must be of 10 digits" })
    .min(10, { message: "Mobile number must be of 10 digits" })
    .or(z.number()),
  email: z
    .string({
      required_error: "Must Provide Email",
    })
    .email({ message: "Invalid email address" }),
});

type UserFormValues = z.infer<typeof UserFormSchema>;

const EditUserForm = ({ toggleEditSheet }) => {
  const navigate = useNavigate();

  const { id } = useParams();

  const { data, mutate } = useFrappeGetDoc(
    "Nirmaan Users",
    id,
    id ? `Nirmaan Users ${id}` : null
  );

  // console.log("data", data)
  const { updateDoc, loading } = useFrappeUpdateDoc();

  const hasChanges = () => {
    const values = form.getValues();
    const originalValues = {
      first_name: data?.first_name || "",
      last_name: data?.last_name || "",
      email: data?.email || "",
      mobile_no: data?.mobile_no || "",
    };
    return JSON.stringify(values) !== JSON.stringify(originalValues);
  };

  const form = useForm<UserFormValues>({
    resolver: zodResolver(UserFormSchema),
    defaultValues: {
      first_name: data?.first_name || "",
      last_name: data?.last_name || "",
      email: data?.email || "",
      mobile_no: data?.mobile_no || "",
    },
    mode: "onBlur",
  });

  useEffect(() => {
    if (data) {
      form.reset({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        mobile_no: data.mobile_no,
      });
    }
  }, [data]);

  const onSubmit = async (values: UserFormValues) => {
    try {
      await updateDoc("User", id, values);
      toast({
        title: "Success",
        description: `User: ${id} updated successfully!`,
        variant: "success",
      });
      await mutate();

      toggleEditSheet();
    } catch (error: any) {
      toast({
        title: "Error",
        description: `${error?._debug_messages}`,
        variant: "destructive",
      });
      console.log("error", error);
    }
  };

  return (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        {/* <ArrowLeft
          className="cursor-pointer"
          onClick={() => navigate(`/users/${id}`)}
        /> */}
        <h2 className="text-xl md:text-2xl font-bold tracking-tight">
          Edit User: <span className="text-primary">{id}</span>
        </h2>
      </div>

      <Separator className="my-6 max-md:my-2" />
      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.stopPropagation();
            return form.handleSubmit(onSubmit)(event);
          }}
          className="px-6 max-md:px-2 flex flex-col gap-4"
        >
          <p className="text-sky-600 font-semibold">User Details</p>
          <FormField
            control={form.control}
            name="first_name"
            render={({ field }) => (
              <FormItem className="lg:flex lg:items-center gap-4">
                <FormLabel className="md:basis-3/12">
                  First Name<sup>*</sup>
                </FormLabel>
                <div className="flex flex-col items-start md:basis-2/4">
                  <FormControl className="">
                    <Input placeholder="First Name" {...field} />
                  </FormControl>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="last_name"
            render={({ field }) => (
              <FormItem className="lg:flex lg:items-center gap-4">
                <FormLabel className="md:basis-3/12">
                  Last Name<sup>*</sup>
                </FormLabel>
                <div className="flex flex-col items-start md:basis-2/4">
                  <FormControl className="">
                    <Input placeholder="Last Name" {...field} />
                  </FormControl>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="mobile_no"
            render={({ field }) => (
              <FormItem className="lg:flex lg:items-center gap-4">
                <FormLabel className="md:basis-3/12">
                  Mobile Number<sup>*</sup>
                </FormLabel>
                <div className="flex flex-col items-start md:basis-2/4">
                  <FormControl className="">
                    <Input placeholder="Mobile Number" {...field} />
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
                <FormLabel className="md:basis-3/12">
                  Email<sup>*</sup>
                </FormLabel>
                <div className="flex flex-col items-start md:basis-2/4">
                  <FormControl className="">
                    <Input disabled placeholder="Email" {...field} />
                  </FormControl>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <div className="flex items-center gap-2 justify-end lg:w-[68%]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.reset();
                form.clearErrors();
              }}
              className="flex items-center gap-1"
            >
              <ListRestart className="h-4 w-4" />
              Reset
            </Button>
            <Button
              disabled={!hasChanges() || loading}
              className="flex items-center gap-1"
              type="submit"
            >
              <ListChecks className="h-4 w-4" />
              {loading ? "Updating" : "Update"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default EditUserForm;
