import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

// Flota › Tarifas: the flete tariffs as the business keeps them, to follow
// each increase. A reference only: no carga or liquidación reads them.

export type FreightTariffLine = {
  id: string;
  section: string | null;
  concept: string;
  /** Pesos; null when the line is a percentage or only a note. */
  price: number | null;
  /** «% x remito» lines; null otherwise. */
  percent: number | null;
  note: string | null;
};

export type FreightTariffVersion = {
  id: string;
  label: string;
  valid_from: string;
  /** The increase over the previous version when it came from one. */
  increase_pct: number | null;
  notes: string | null;
  lines: FreightTariffLine[];
};

export type FreightTariffList = {
  id: string;
  name: string;
  client: { id: string; name: string } | null;
  notes: string | null;
  /** Newest first. */
  versions: FreightTariffVersion[];
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Hasta ${max} caracteres.`)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const optionalNumber = (min: number, max: number, message: string) =>
  z
    .union([
      z.literal(""),
      z.coerce.number().min(min, message).max(max, message),
    ])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const FreightTariffLineInputSchema = z
  .object({
    section: optionalText(120),
    concept: z
      .string()
      .trim()
      .min(1, "Cada línea necesita un concepto.")
      .max(200, "Hasta 200 caracteres."),
    price: optionalNumber(0, 999_999_999_999.99, "Precio inválido."),
    percent: optionalNumber(0, 100, "El porcentaje va de 0 a 100."),
    note: optionalText(300),
  })
  .refine((l) => l.price == null || l.percent == null, {
    message: "Una línea lleva precio o porcentaje, no los dos.",
    path: ["percent"],
  });
export type FreightTariffLineInput = z.input<
  typeof FreightTariffLineInputSchema
>;

const LinesSchema = z
  .array(FreightTariffLineInputSchema)
  .max(300, "Hasta 300 líneas por tarifario.");

const LabelSchema = z
  .string()
  .trim()
  .min(1, "Poné el período (por ejemplo «Noviembre/Diciembre 26»).")
  .max(80, "Hasta 80 caracteres.");

export const FreightTariffListCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Poné un nombre.")
    .max(120, "Hasta 120 caracteres."),
  client_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  notes: optionalText(500),
  label: LabelSchema,
  valid_from: IsoDateSchema,
  lines: LinesSchema,
});
export type FreightTariffListCreateInput = z.input<
  typeof FreightTariffListCreateSchema
>;

export const FreightTariffListUpdateSchema = FreightTariffListCreateSchema.pick(
  {
    name: true,
    client_id: true,
    notes: true,
  },
).extend({ id: z.string().uuid() });
export type FreightTariffListUpdateInput = z.input<
  typeof FreightTariffListUpdateSchema
>;

export const FreightTariffVersionSaveSchema = z.object({
  id: z.string().uuid(),
  label: LabelSchema,
  valid_from: IsoDateSchema,
  lines: LinesSchema,
});
export type FreightTariffVersionSaveInput = z.input<
  typeof FreightTariffVersionSaveSchema
>;

export const FREIGHT_TARIFF_ROUNDINGS = [1, 10, 100] as const;

export const FreightTariffIncreaseSchema = z.object({
  list_ids: z.array(z.string().uuid()).min(1, "Elegí al menos un tarifario."),
  pct: z.coerce
    .number({ message: "Poné el porcentaje de aumento." })
    .gt(-100, "El aumento no puede bajar el precio a 0.")
    .max(1000, "Porcentaje demasiado alto."),
  label: LabelSchema,
  valid_from: IsoDateSchema,
  round_to: z.coerce
    .number()
    .refine(
      (v): v is (typeof FREIGHT_TARIFF_ROUNDINGS)[number] =>
        (FREIGHT_TARIFF_ROUNDINGS as readonly number[]).includes(v),
      { message: "El redondeo es a $1, $10 o $100." },
    ),
});
export type FreightTariffIncreaseInput = z.input<
  typeof FreightTariffIncreaseSchema
>;

export const FreightTariffIdSchema = z.object({ id: z.string().uuid() });

/** A line's change against the same line (section and concept) of the
 *  previous version: the previous price and the change in percent, or null
 *  when there is nothing to compare. */
export function lineChange(
  line: Pick<FreightTariffLine, "section" | "concept" | "price">,
  previous: FreightTariffVersion | undefined,
): { previous: number; pct: number } | null {
  if (!previous || line.price === null) return null;
  const match = previous.lines.find(
    (l) =>
      (l.section ?? "") === (line.section ?? "") &&
      l.concept === line.concept &&
      l.price !== null,
  );
  if (!match || match.price === null || match.price === 0) return null;
  return {
    previous: match.price,
    pct: ((line.price - match.price) / match.price) * 100,
  };
}
