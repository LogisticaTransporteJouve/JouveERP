import { z } from "zod";

export const IgnoreInsightSchema = z.object({
  id: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(3, { message: "Contá en pocas palabras por qué lo ignorás." })
    .max(500, { message: "Máximo 500 caracteres." }),
});

export type IgnoreInsightInput = z.input<typeof IgnoreInsightSchema>;
