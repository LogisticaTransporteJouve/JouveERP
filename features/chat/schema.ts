import { z } from "zod";

export const SendMessageSchema = z.object({
  channelId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "El mensaje no puede estar vacío.")
    .max(4000, "Máx 4000 caracteres."),
  replyToId: z.string().uuid().nullable().optional(),
  mentionUserIds: z.array(z.string().uuid()).max(50).optional(),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const EditMessageSchema = z.object({
  messageId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export type EditMessageInput = z.infer<typeof EditMessageSchema>;

export const ToggleReactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(16),
});

export type ToggleReactionInput = z.infer<typeof ToggleReactionSchema>;

export const CreateGroupSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido.").max(60),
  description: z.string().trim().max(280).optional(),
  memberIds: z
    .array(z.string().uuid())
    .min(1, "Agregá al menos un miembro.")
    .max(50, "Máx 50 miembros."),
});

export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

export const QUICK_REACTIONS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "😮",
  "😢",
  "🙏",
  "👀",
  "🔥",
  "💯",
  "✅",
  "❌",
] as const;
