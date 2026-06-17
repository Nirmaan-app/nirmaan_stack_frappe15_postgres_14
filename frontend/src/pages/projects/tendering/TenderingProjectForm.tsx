import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useNavigate } from "react-router-dom";
import ReactSelect from "react-select";
import { ArrowLeft, ListChecks, Save } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";

import { useProjectFormCustomers } from "@/pages/projects/data/project-form/useProjectFormQueries";
import { usePincodeLocations, LocationOption } from "./hooks/usePincodeLocations";
import {
  useCreateTenderingProject,
  useUpdateTenderingProject,
} from "./hooks/useTenderingMutations";

const tenderingFormSchema = z.object({
  project_name: z
    .string({ required_error: "Project Name is required." })
    .min(3, { message: "Project Name must be at least 3 characters." }),
  project_state: z
    .string({ required_error: "State is required." })
    .min(1, { message: "State is required." }),
  project_city: z
    .string({ required_error: "City is required." })
    .min(1, { message: "City is required." }),
  customer: z.string().optional(),
});

type TenderingFormValues = z.infer<typeof tenderingFormSchema>;

/**
 * Existing Tendering stub being edited. When provided, the form switches to
 * EDIT mode: fields are pre-filled, submit calls `update_tendering_project`,
 * and the create-only navigation is replaced by the `onSuccess`/`onCancel`
 * callbacks supplied by the host (the lightweight `TenderingProjectView`).
 */
export interface TenderingProjectFormEditTarget {
  /** Frozen Projects docname (`{city}-PROJ-#####`). */
  name: string;
  project_name?: string;
  project_state?: string;
  project_city?: string;
  customer?: string;
}

interface TenderingProjectFormProps {
  /** Present => EDIT mode; absent => CREATE mode. */
  editProject?: TenderingProjectFormEditTarget;
  /** Called after a successful edit (EDIT mode only). */
  onSuccess?: () => void;
  /** Called when the user cancels. In EDIT mode always active; in CREATE mode
   *  active only when `embedded` is true (so the host can close the dialog). */
  onCancel?: () => void;
  /** CREATE mode only: called with the new project's docname after a successful
   *  create. When provided, the post-create navigation is suppressed — the host
   *  (e.g. the BoQ picker modal) takes over. */
  onCreated?: (newProjectId: string) => void;
  /** CREATE mode only: when true, renders the bare form body without the page
   *  chrome (back button, Card wrapper) so it sits cleanly inside a Dialog. */
  embedded?: boolean;
}

/**
 * Minimal single-screen form for creating OR editing a "Tendering" project stub.
 *
 * CREATE mode (no `editProject`): captures Project Name, State -> City
 * (cascading dropdowns from the Pincodes master) and an optional Customer, then
 * calls `create_tendering_project` and navigates back to the Tendering tab.
 *
 * EDIT mode (`editProject` provided): pre-fills the four stub fields from the
 * existing project and, on submit, calls `update_tendering_project` — which
 * edits ONLY those four fields and never changes the frozen docname even when
 * the City changes. The full edit-project form is deliberately NOT reachable
 * for a stub; this is the only edit path.
 */
export const TenderingProjectForm = ({
  editProject,
  onSuccess,
  onCancel,
  onCreated,
  embedded,
}: TenderingProjectFormProps = {}) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const isEditMode = Boolean(editProject);

  const form = useForm<TenderingFormValues>({
    resolver: zodResolver(tenderingFormSchema),
    mode: "onBlur",
    defaultValues: {
      project_name: editProject?.project_name || "",
      project_state: editProject?.project_state || "",
      project_city: editProject?.project_city || "",
      customer: editProject?.customer || "",
    },
  });

  const selectedState = form.watch("project_state");
  const selectedCity = form.watch("project_city");

  const { stateOptions, cityOptions, isLoading: locationsLoading } =
    usePincodeLocations(selectedState);

  const { data: customers, isLoading: customersLoading } =
    useProjectFormCustomers();

  const customerOptions = useMemo(
    () =>
      customers?.map((c) => ({ label: c.company_name, value: c.name })) || [],
    [customers]
  );

  // In EDIT mode a stub's stored State/City might not (yet) be present in the
  // Pincodes-derived option set; surface the stored value so the selects still
  // show the current value rather than appearing blank.
  const stateSelectOptions = useMemo<LocationOption[]>(() => {
    if (
      selectedState &&
      !stateOptions.some((o) => o.value === selectedState)
    ) {
      return [{ label: selectedState, value: selectedState }, ...stateOptions];
    }
    return stateOptions;
  }, [stateOptions, selectedState]);

  const citySelectOptions = useMemo<LocationOption[]>(() => {
    if (selectedCity && !cityOptions.some((o) => o.value === selectedCity)) {
      return [{ label: selectedCity, value: selectedCity }, ...cityOptions];
    }
    return cityOptions;
  }, [cityOptions, selectedCity]);

  const { createTenderingProject, loading: creating } =
    useCreateTenderingProject();
  const { updateTenderingProject, loading: updating } =
    useUpdateTenderingProject();

  const submitting = creating || updating;

  const onSubmit = async (values: TenderingFormValues) => {
    try {
      if (isEditMode && editProject) {
        const response = await updateTenderingProject({
          project_name: editProject.name,
          project_title: values.project_name,
          project_state: values.project_state,
          project_city: values.project_city,
          // Empty string clears the optional Customer link.
          customer: values.customer || "",
        });

        if (response.message.status !== 200) {
          throw new Error(
            response.message.error || "Failed to update tendering project"
          );
        }

        toast({
          title: "Success",
          description: (
            <>
              Tendering Project:{" "}
              <strong className="text-[14px]">{values.project_name}</strong>{" "}
              updated successfully!
            </>
          ),
          variant: "success",
        });

        onSuccess?.();
        return;
      }

      const response = await createTenderingProject({
        project_name: values.project_name,
        project_state: values.project_state,
        project_city: values.project_city,
        customer: values.customer || undefined,
      });

      if (response.message.status !== 200) {
        throw new Error(
          response.message.error || "Failed to create tendering project"
        );
      }

      toast({
        title: "Success",
        description: (
          <>
            Tendering Project:{" "}
            <strong className="text-[14px]">{values.project_name}</strong>{" "}
            created successfully!
          </>
        ),
        variant: "success",
      });

      if (onCreated) {
        onCreated(response.message.project_name ?? "");
      } else {
        navigate("/projects?tab=tendering");
      }
    } catch (err: any) {
      toast({
        title: "Failed!",
        description:
          err?.message ||
          `Error while ${isEditMode ? "updating" : "creating"} tendering project!`,
        variant: "destructive",
      });
      console.error(
        `Error while ${isEditMode ? "updating" : "creating"} tendering project:`,
        err
      );
    }
  };

  const formBody = (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.stopPropagation();
          return form.handleSubmit(onSubmit)(event);
        }}
        className="space-y-6"
      >
        {/* Project Name */}
        <FormField
          control={form.control}
          name="project_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex">
                Project Name
                <sup className="pl-1 text-sm text-red-600">*</sup>
              </FormLabel>
              <FormControl>
                <Input placeholder="Project Name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* State (cascading parent) */}
        <FormField
          control={form.control}
          name="project_state"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex">
                State
                <sup className="pl-1 text-sm text-red-600">*</sup>
              </FormLabel>
              <FormControl>
                <ReactSelect
                  options={stateSelectOptions}
                  isLoading={locationsLoading}
                  placeholder="Select State..."
                  value={
                    stateSelectOptions.find((o) => o.value === field.value) ||
                    null
                  }
                  onChange={(option) => {
                    field.onChange(option?.value || "");
                    // Reset city when state changes
                    form.setValue("project_city", "");
                  }}
                  menuPortalTarget={embedded ? undefined : document.body}
                  styles={{
                    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* City (cascading child, FuzzySearch because some states have >50 cities) */}
        <FormField
          control={form.control}
          name="project_city"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex">
                City
                <sup className="pl-1 text-sm text-red-600">*</sup>
              </FormLabel>
              <FormControl>
                <FuzzySearchSelect
                  allOptions={citySelectOptions}
                  tokenSearchConfig={{
                    searchFields: ["label"],
                    minSearchLength: 1,
                    fieldWeights: { label: 2.0 },
                  }}
                  isDisabled={!selectedState}
                  isLoading={locationsLoading}
                  placeholder={
                    selectedState
                      ? "Search & select City..."
                      : "Select a State first"
                  }
                  value={
                    citySelectOptions.find((o) => o.value === field.value) ||
                    null
                  }
                  onChange={(option: any) =>
                    field.onChange(option?.value || "")
                  }
                  menuPortalTarget={embedded ? undefined : document.body}
                  styles={{
                    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                  }}
                />
              </FormControl>
              {isEditMode && (
                <p className="text-xs text-muted-foreground">
                  Editing the city updates the field only — the project ID stays
                  frozen.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Customer (optional) */}
        <FormField
          control={form.control}
          name="customer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Customer (optional)</FormLabel>
              <FormControl>
                <ReactSelect
                  options={customerOptions}
                  isLoading={customersLoading}
                  isClearable
                  placeholder="Link a Customer (optional)..."
                  value={
                    customerOptions.find((o) => o.value === field.value) || null
                  }
                  onChange={(option) => field.onChange(option?.value || "")}
                  menuPortalTarget={embedded ? undefined : document.body}
                  styles={{
                    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              isEditMode || embedded
                ? onCancel?.()
                : navigate("/projects/new-project")
            }
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1"
          >
            {isEditMode ? (
              <Save className="h-4 w-4" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )}
            {submitting
              ? isEditMode
                ? "Saving..."
                : "Creating..."
              : isEditMode
                ? "Save Changes"
                : "Create Tendering Project"}
          </Button>
        </div>
      </form>
    </Form>
  );

  // EDIT mode and embedded CREATE mode both render the bare form so the host
  // can place it inside its own card/dialog without duplicate page chrome.
  if (isEditMode || embedded) {
    return formBody;
  }

  return (
    <div className="flex-1 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/projects/new-project")}
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New Tendering Project</CardTitle>
          <p className="text-sm text-muted-foreground">
            Register a prospect you are still bidding for. Capture only the
            essentials — the full project details are filled in later when the
            bid is won.
          </p>
        </CardHeader>
        <CardContent>{formBody}</CardContent>
      </Card>
    </div>
  );
};

export default TenderingProjectForm;
