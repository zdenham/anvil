import { z } from "zod";
export const IdentitySchema = z.object({
    device_id: z.string().uuid(),
    github_handle: z.string().min(1),
});
