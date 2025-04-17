// src/features/projects/validation/projectSchemas.ts
import * as z from "zod";

// Basic Address Schema (can be reused)
export const addressSchemaBase = z.object({
    address_line_1: z.string().min(1, "Address Line 1 is required"),
    address_line_2: z.string().min(1, "Address Line 2 is required"),
    project_city: z.string().min(1, "City is required").refine(val => val !== "Not Found", "Invalid Pincode provided"),
    project_state: z.string().min(1, "State is required").refine(val => val !== "Not Found", "Invalid Pincode provided"),
    pin: z.string()
        .min(6, "Pincode must be 6 digits")
        .max(6, "Pincode must be 6 digits")
        .regex(/^[1-9][0-9]{5}$/, "Invalid Pincode format"), // Stricter regex
    email: z.string().email("Invalid email format").optional().or(z.literal('')),
    phone: z.string()
        .min(10, "Mobile number must be 10 digits")
        .max(10, "Mobile number must be 10 digits")
        .regex(/^[6-9]\d{9}$/, "Invalid mobile number") // Basic Indian mobile check
        .optional().or(z.literal('')),
});

// --- Project Form Specific Schemas ---

const projectWorkPackageItemSchema = z.object({
    name: z.string(),
    makes: z.array(z.object({ label: z.string(), value: z.string() }))
});

const projectWorkPackageSchema = z.object({
    work_package_name: z.string(),
    category_list: z.object({
        list: z.array(projectWorkPackageItemSchema)
    }).optional() // Make category_list optional initially if populated later
});

const projectScopeSchema = z.object({
    scope_of_work_name: z.string(),
    work_package: z.string()
});

const projectGstSchema = z.object({
    location: z.string(),
    gst: z.string(), // Add GST validation if needed
});

export const projectFormSchema = z.object({
    // Section 1: Project Details
    project_name: z.string().min(6, "Project Name must be at least 6 characters"),
    customer: z.string({ required_error: "Please select a customer" }).min(1, "Customer is required"),
    project_type: z.string().optional(),
    project_value: z.string() // Keep as string, parse on submit
        .regex(/^\d+(\.\d{1,2})?$/, "Invalid currency format (e.g., 10000.00)")
        .optional().or(z.literal('')),
    subdivisions: z.string().min(1, "Number of subdivisions is required").regex(/^[1-9][0-9]*$/, "Must be a positive number"), // Ensure it's a positive number string

    // Section 2: Address (Extends base, maybe prefix fields if needed)
    address_line_1: z.string().min(1, "Address Line 1 is required"),
    address_line_2: z.string().min(1, "Address Line 2 is required"),
    project_city: z.string().min(1, "City is required").refine(val => val !== "Not Found", "Invalid Pincode provided"),
    project_state: z.string().min(1, "State is required").refine(val => val !== "Not Found", "Invalid Pincode provided"),
    pin: z.string()
        .min(6, "Pincode must be 6 digits")
        .max(6, "Pincode must be 6 digits")
        .regex(/^[1-9][0-9]{5}$/, "Invalid Pincode format"),
    email: z.string().email("Invalid email format").optional().or(z.literal('')),
    phone: z.string()
        .min(10, "Mobile number must be 10 digits")
        .max(10, "Mobile number must be 10 digits")
        .regex(/^[6-9]\d{9}$/, "Invalid mobile number")
        .optional().or(z.literal('')),

    // Section 3: Timeline
    project_start_date: z.date({ required_error: "Project start date is required" }),
    project_end_date: z.date({ required_error: "Project end date is required" })
        .optional() // Make optional here, but validate presence before submit if needed elsewhere
        // .superRefine((data, ctx) => { 
        //   // Use refine for cross-field validation
        //     // This refine seems misplaced here, better done at the top level or onSubmit
        //     if (ctx?.parent?.project_start_date && data && data < ctx.parent.project_start_date) {
        //         ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date cannot be before start date" });
        //     }
        //     return true;
        // }),
        ,

    // Section 4: Assignees
    project_lead: z.string().optional(),
    project_manager: z.string().optional(),
    design_lead: z.string().optional(),
    procurement_lead: z.string().optional(),
    estimates_exec: z.string().optional(),
    accountant: z.string().optional(),

    // Section 5: Packages & Scopes
    project_work_packages: z.object({
        work_packages: z.array(projectWorkPackageSchema)
    }).refine(data => data.work_packages.length > 0, {
        message: "Select at least one Work Package",
        path: ["project_work_packages"] // Attach error to the field group
    }),
    project_scopes: z.object({
        scopes: z.array(projectScopeSchema) // Add validation if scopes are required based on WPs
    }),

    // Other fields
    project_gst_number: z.object({
        list: z.array(projectGstSchema)
    }),

}).refine(data => { // Top-level refine for cross-field validation like dates
    if (data.project_start_date && data.project_end_date && data.project_end_date < data.project_start_date) {
        return false;
    }
    return true;
}, {
    message: "End date cannot be before start date",
    path: ["project_end_date"], // Attach error to end date field
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

// // Schemas for other forms (Customer, Project Type)
// export * from "@/features/customers/validation/customerSchemas"; // Assuming customer schema is here
// export * from "@/features/project-types/validation/projectTypeSchemas"; // Assuming project type schema is here