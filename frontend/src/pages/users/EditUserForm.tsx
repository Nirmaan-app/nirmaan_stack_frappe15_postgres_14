import { ListChecks, ListRestart, Lock, Info } from "lucide-react";
import { useParams } from "react-router-dom";
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
import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useEffect } from "react";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import ReactSelect from "react-select";

const UserFormSchema = z.object({
  first_name: z
    .string({
      required_error: "Must Provide First name",
    })
    .min(3, {
      message: "First name must be at least 3 characters.",
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
  role_profile_name: z
    .string({
      required_error: "Please select associated Role Profile."
    }),
});

type UserFormValues = z.infer<typeof UserFormSchema>;

interface SelectOption {
  label: string;
  value: string;
}

const EditUserForm = ({ toggleEditSheet }: any) => {

  const { userId: id } = useParams();

  const { role: role, user_id: actual_user_id } = useUserData()

  const { data, mutate } = useFrappeGetDoc(
    "Nirmaan Users",
    id,
    id ? `Nirmaan Users ${id}` : null
  );

  const { data: role_profile_list, isLoading: role_profile_list_loading, error: role_profile_list_error } = useFrappeGetDocList("Role Profile",
    {
      fields: ["*"],
    },
    "Role Profile"
  );

  const options: SelectOption[] = role_profile_list?.map(item => ({
    label: item?.role_profile
      .split(' ')
      .filter((word: string) => word !== 'Nirmaan' && word !== 'Profile')
      .join(' '),
    value: item.name
  })) || [];

  const { updateDoc, loading } = useFrappeUpdateDoc();

  const hasChanges = () => {
    const values = form.getValues();
    const originalValues = {
      first_name: data?.first_name || "",
      last_name: data?.last_name || "",
      email: data?.email || "",
      mobile_no: data?.mobile_no || "",
      role_profile_name: data?.role_profile || ""
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
      role_profile_name: data?.role_profile || ""
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
        role_profile_name: data.role_profile
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
        description: error?._debug_messages,
        variant: "destructive",
      });
      console.log("error", error);
    }
  };

  const isAdmin = role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || role === "Nirmaan HR Executive Profile";
  const isOwnProfile = actual_user_id === data?.email;
  // Only allow role editing if user is Admin/PMO/HR AND not editing their own profile
  const canEditRole = isAdmin && !isOwnProfile;

  return (
    <div className="flex-1 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Edit User</h2>
        <p className="text-sm text-muted-foreground">Update user details and permissions</p>
      </div>

      <Separator />

      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.stopPropagation();
            return form.handleSubmit(onSubmit)(event);
          }}
          className="space-y-6"
        >
          {/* Personal Information Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Personal Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-gray-700">
                      First Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., John" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-gray-700">
                      Last Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium text-gray-700">
                    Email Address <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        disabled
                        className="bg-gray-50 pr-10"
                        placeholder="e.g., john.doe@company.com"
                        {...field}
                      />
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                  </FormControl>
                  <FormMessage />
                  <div className="flex items-start gap-2 mt-2 p-2 bg-blue-50 border border-blue-100 rounded-md">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-700">
                      {canEditRole
                        ? "To change the email address, use the \"Rename Email\" option in the Actions menu."
                        : "To change the email address, please contact Admin or HR."}
                    </p>
                  </div>
                </FormItem>
              )}
            />
          </div>

          {/* Contact Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Contact</h3>
            <FormField
              control={form.control}
              name="mobile_no"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium text-gray-700">
                    Mobile Number <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 9876543210" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Access & Permissions Section */}
          {canEditRole && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Access & Permissions</h3>
              <FormField
                control={form.control}
                name="role_profile_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium text-gray-700">
                      Role Profile <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <ReactSelect
                        options={options}
                        value={options.find((option) => option.value === field.value) || null}
                        onChange={(val) => field.onChange(val ? val.value : "")}
                        isLoading={role_profile_list_loading}
                        isClearable={true}
                        placeholder="Select a role..."
                        noOptionsMessage={() => role_profile_list_error ? "Error loading roles" : "No roles available"}
                        styles={{
                          control: (base, state) => ({
                            ...base,
                            borderColor: state.isFocused ? "hsl(var(--ring))" : "hsl(var(--border))",
                            boxShadow: state.isFocused ? "0 0 0 1px hsl(var(--ring))" : "none",
                            "&:hover": { borderColor: "hsl(var(--border))" },
                            minHeight: "40px",
                          }),
                          menu: (base) => ({
                            ...base,
                            zIndex: 50,
                          }),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.reset();
                form.clearErrors();
              }}
              className="gap-2"
            >
              <ListRestart className="h-4 w-4" />
              Reset
            </Button>
            <Button
              disabled={!hasChanges() || loading}
              type="submit"
              className="gap-2"
            >
              <ListChecks className="h-4 w-4" />
              {loading ? "Updating..." : "Update User"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default EditUserForm;
