import { z } from "zod";

import { AVATAR_COLORS } from "@/lib/avatars";

export const UpdateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Ingresá tu nombre.")
    .max(80, "Máx 80 caracteres."),
  lastName: z
    .string()
    .trim()
    .min(1, "Ingresá tu apellido.")
    .max(80, "Máx 80 caracteres."),
  color: z.enum(AVATAR_COLORS),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
