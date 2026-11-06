import { z } from "zod";

export type AccountingSettings = {
  fiscalYearStartMonth: number;
};

export const UpdateAccountingSettingsSchema = z.object({
  fiscalYearStartMonth: z
    .number()
    .int("Elegí un mes.")
    .min(1, "Elegí un mes.")
    .max(12, "Elegí un mes."),
});
