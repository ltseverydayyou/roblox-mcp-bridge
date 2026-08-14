import { z } from "zod";

// This exact shape is required by ChatGPT file parameters. Keep all four
// properties declared, with only download_url and file_id required.
export const openAIFileInputSchema = z
  .object({
    download_url: z.string().url(),
    file_id: z.string().min(1),
    mime_type: z.string().optional(),
    file_name: z.string().optional(),
  })
  .strict();
