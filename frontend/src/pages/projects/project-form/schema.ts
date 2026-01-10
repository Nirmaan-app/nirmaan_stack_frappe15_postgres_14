import * as z from "zod";

/**
 * Project Form Schema
 *
 * Zod validation schema for the project creation wizard.
 * Defines all fields, their types, and validation rules.
 */

export const projectFormSchema = z.object({
    // Basic Details
    project_name: z
        .string({
            required_error: "Must Provide Project name"
        })
        .min(6, {
            message: "Project Name must be at least 6 characters",
        }),
    customer: z
        .string()
        .optional(),
    project_type: z
        .string()
        .optional(),
    project_value: z
        .string()
        .optional(),
    project_value_gst: z
        .string()
        .optional(),
    carpet_area: z.coerce.number({
        required_error: "Carpet area is required",
        invalid_type_error: "Please enter a valid number"
    }).positive({
        message: "Carpet area must be greater than 0"
    }),

    // Address Details
    address_line_1: z
        .string({
            required_error: "Address Line 1 Required"
        })
        .min(1, {
            message: "Address Line 1 Required"
        }),
    address_line_2: z
        .string({
            required_error: "Address Line 2 Required"
        })
        .min(1, {
            message: "Address Line 2 Required"
        }),
    project_city: z
        .string({
            required_error: "Must provide city"
        })
        .min(1, {
            message: "Must Provide City"
        }),
    project_state: z
        .string({
            required_error: "Must provide state"
        })
        .min(1, {
            message: "Must Provide State"
        }),
    pin: z
        .string({
            required_error: "Must provide pincode"
        })
        .max(6, { message: "Pincode must be of 6 digits" })
        .min(6, { message: "Pincode must be of 6 digits" })
        .or(z.number()),
    email: z.string().email().optional().or(z.literal('')),
    phone: z
        .string()
        .max(10, { message: "Mobile number must be of 10 digits" })
        .min(10, { message: "Mobile number must be of 10 digits" })
        .optional()
        .or(z.literal('')),

    // Timeline
    project_start_date: z
        .date({
            required_error: "Project must have a start date"
        }),
    project_end_date: z
        .date()
        .optional(),

    // Assignees
    project_lead: z
        .string()
        .optional(),
    project_manager: z
        .string()
        .optional(),
    design_lead: z
        .string()
        .optional(),
    procurement_lead: z
        .string()
        .optional(),
    estimates_exec: z
        .string()
        .optional(),
    accountant: z
        .string()
        .optional(),

    // Work Packages
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

    // Scopes
    project_scopes: z
        .object({
            scopes: z.array(
                z.object({
                    scope_of_work_name: z.string(),
                    work_package: z.string()
                })
            )
        }),

    // GST
    project_gst_number: z.object({
        list: z.array(z.object({
            location: z.string(),
            gst: z.string(),
        })),
    }),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

/**
 * Default values for the project form
 */
export const defaultFormValues: ProjectFormValues = {
    project_name: "",
    project_value: "",
    project_value_gst: "",
    project_start_date: new Date(),
    project_end_date: undefined,
    project_work_packages: {
        work_packages: []
    },
    project_gst_number: {
        list: [
            {
                location: "Bengaluru",
                gst: "29ABFCS9095N1Z9",
            }
        ]
    },
    carpet_area: undefined as unknown as number, // Will be validated on submit
    project_scopes: {
        scopes: []
    },
    address_line_1: "",
    address_line_2: "",
    project_city: "",
    project_state: "",
    pin: "",
    email: "",
    phone: "",
    customer: "",
    project_type: "",
    project_lead: "",
    procurement_lead: "",
    estimates_exec: "",
    design_lead: "",
    project_manager: "",
    accountant: "",
};

/**
 * Fields to validate for each wizard section
 */
export const sectionFields: Record<string, (keyof ProjectFormValues)[]> = {
    projectDetails: ["project_name", "project_type", "project_value", "project_value_gst", "carpet_area"],
    projectAddressDetails: ["address_line_1", "address_line_2", "project_city", "project_state", "pin", "email", "phone"],
    projectTimeline: ["project_start_date", "project_end_date"],
    projectAssignees: ["project_lead", "project_manager", "design_lead", "procurement_lead", "estimates_exec"],
    packageSelection: ["project_work_packages", "project_scopes"],
    reviewDetails: [],
};
