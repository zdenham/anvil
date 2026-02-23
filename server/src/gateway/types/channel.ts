import { z } from "zod";

export const ChannelSchema = z.object({
  channelId: z.string().uuid(),
  deviceId: z.string().uuid(),
  type: z.literal("github"),
  label: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelBodySchema = z.object({
  deviceId: z.string().uuid(),
  type: z.literal("github"),
  label: z.string().min(1),
});

export type CreateChannelBody = z.infer<typeof CreateChannelBodySchema>;
