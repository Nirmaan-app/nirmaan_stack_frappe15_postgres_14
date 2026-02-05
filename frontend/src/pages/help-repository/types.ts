import { z } from "zod"

export const helpItemSchema = z.object({
	title: z.string().min(1, "Title is required"),
	description: z.string().optional(),
	video_link: z.string().min(1, "Video link is required")
		.refine(url => url.includes("loom.com"), "Must be a valid Loom URL"),
})

export type HelpItemFormValues = z.infer<typeof helpItemSchema>
